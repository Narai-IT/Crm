// แกนธุรกิจ: กระเป๋าแต้ม (ledger + lots), คูปอง, สมาชิก, ขาย/คืนเงิน
// ทุกฟังก์ชันรับ db ที่อยู่ใน transaction (จาก tx()) เพื่อให้ทั้งชุดสำเร็จหรือยกเลิกพร้อมกัน
import crypto from 'node:crypto';
import { conflict, bad, notFound, HttpError } from '../http.js';
import { calcPoints, couponDiscount, memberIdOf, randomCode, sha256, DEV, REQUIRE_OTP, tierOf, checkMemberPin } from '../util.js';
import { queueMessage } from './line.js';
import { loadCart, itemProblem, itemDiscount } from './cart.js';

// สมาชิกของแบรนด์: สมัครกับแบรนด์ / ผูกกับแบรนด์ / เคยมีแต้มที่แบรนด์ ($1 = แบรนด์)
export const MEMBER_SCOPE = `(m.joined_brand_id = $1 OR EXISTS (SELECT 1 FROM member_brand_links k WHERE k.member_id = m.id AND k.brand_id = $1)
  OR EXISTS (SELECT 1 FROM point_ledger l WHERE l.member_id = m.id AND l.brand_id = $1))`;
export const currentRule = (db, brandId) => db.one('SELECT * FROM earn_rules WHERE brand_id = $1 AND effective_to IS NULL', [brandId]);

export async function audit(db, actor, action, entity, detail, before, after) {
  await db.q('INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, entity_type, entity_id, detail, before_json, after_json) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [actor.type, actor.id || null, actor.name || null, action, entity?.type || null, entity?.id || null, detail || null, before ? JSON.stringify(before) : null, after ? JSON.stringify(after) : null]);
}

/* ---------------- แต้ม ---------------- */
async function lockWallet(db, memberId, brandId) {
  await db.q('INSERT INTO wallets (member_id, brand_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [memberId, brandId]);
  return db.one('SELECT * FROM wallets WHERE member_id = $1 AND brand_id = $2 FOR UPDATE', [memberId, brandId]);
}

// เพิ่มแต้ม: ledger + lot ใหม่ (มีวันหมดอายุตามกฎ)
export async function credit(db, e) {
  const w = await lockWallet(db, e.memberId, e.brandId);
  const dup = await db.one('SELECT id, balance_after FROM point_ledger WHERE idempotency_key = $1', [e.key]);
  if (dup) return { duplicate: true, ledgerId: dup.id, balance: dup.balance_after };
  const balance = w.balance + e.points;
  const led = await db.one(
    `INSERT INTO point_ledger (member_id, brand_id, branch_id, entry_type, points, balance_after, ref_type, ref_id, idempotency_key, note, actor_type, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [e.memberId, e.brandId, e.branchId || null, e.type, e.points, balance, e.refType || null, e.refId || null, e.key, e.note || null, e.actorType, e.actorId || null]);
  await db.q('UPDATE wallets SET balance = $3, updated_at = now() WHERE member_id = $1 AND brand_id = $2', [e.memberId, e.brandId, balance]);
  const rule = await currentRule(db, e.brandId);
  const months = rule ? rule.expiry_months : 0;
  await db.q(`INSERT INTO point_lots (member_id, brand_id, source_ledger_id, points, remaining, expires_at)
              VALUES ($1,$2,$3,$4,$4, CASE WHEN $5::int > 0 THEN now() + make_interval(months => $5::int) END)`,
    [e.memberId, e.brandId, led.id, e.points, months]);
  return { ledgerId: led.id, balance };
}

// ตัดแต้ม: ล็อกกระเป๋า กันแลกพร้อมกัน · ตัดล็อตที่ใกล้หมดอายุก่อน
// e.capAtBalance = true ใช้กับการคืนเงิน (ถ้าลูกค้าใช้แต้มไปแล้ว หักเท่าที่เหลือ)
export async function debit(db, e) {
  const w = await lockWallet(db, e.memberId, e.brandId);
  const dup = await db.one('SELECT id, balance_after, points FROM point_ledger WHERE idempotency_key = $1', [e.key]);
  if (dup) return { duplicate: true, ledgerId: dup.id, balance: dup.balance_after, points: -dup.points };
  let pts = e.points;
  if (w.balance < pts) {
    if (!e.capAtBalance) throw conflict('insufficient_points', 'แต้มไม่พอ');
    pts = w.balance;
  }
  let left = pts;
  const lots = await db.q('SELECT id, remaining FROM point_lots WHERE member_id = $1 AND brand_id = $2 AND remaining > 0 ORDER BY expires_at NULLS LAST, id FOR UPDATE', [e.memberId, e.brandId]);
  for (const l of lots) {
    if (left <= 0) break;
    const take = Math.min(l.remaining, left);
    await db.q('UPDATE point_lots SET remaining = remaining - $2 WHERE id = $1', [l.id, take]);
    left -= take;
  }
  const balance = w.balance - pts;
  const led = await db.one(
    `INSERT INTO point_ledger (member_id, brand_id, branch_id, entry_type, points, balance_after, ref_type, ref_id, idempotency_key, note, actor_type, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
    [e.memberId, e.brandId, e.branchId || null, e.type, -pts, balance, e.refType || null, e.refId || null, e.key, e.note || null, e.actorType, e.actorId || null]);
  await db.q('UPDATE wallets SET balance = $3, updated_at = now() WHERE member_id = $1 AND brand_id = $2', [e.memberId, e.brandId, balance]);
  return { ledgerId: led.id, balance, points: pts };
}

export async function walletsOf(db, memberId) {
  const brands = await db.q('SELECT id FROM brands WHERE is_active ORDER BY id');
  const rows = await db.q(
    `SELECT b.id AS brand_id, COALESCE(w.balance, 0) AS balance,
            COALESCE((SELECT sum(points) FROM point_ledger l WHERE l.member_id = $1 AND l.brand_id = b.id AND l.points > 0
                      AND l.entry_type <> 'merge' AND l.created_at > now() - interval '365 days'), 0) AS earned_12m,
            (SELECT min(expires_at) FROM point_lots p WHERE p.member_id = $1 AND p.brand_id = b.id AND p.remaining > 0) AS next_expiry
       FROM brands b LEFT JOIN wallets w ON w.brand_id = b.id AND w.member_id = $1 WHERE b.is_active ORDER BY b.id`, [memberId]);
  const out = {};
  for (const b of brands) {
    const r = rows.find((x) => x.brand_id === b.id);
    const rule = await currentRule(db, b.id);
    out[b.id] = { balance: r.balance, earned12m: r.earned_12m, tier: tierOf(rule, r.earned_12m), nextExpiry: r.next_expiry };
  }
  return out;
}

// แต้มหมดอายุ (เรียกจาก worker)
export async function expireLots(db) {
  const lots = await db.q('SELECT id, member_id, brand_id, remaining FROM point_lots WHERE remaining > 0 AND expires_at < now() ORDER BY id LIMIT 500');
  for (const l of lots) {
    await db.q('UPDATE point_lots SET remaining = 0 WHERE id = $1', [l.id]);
    const w = await lockWallet(db, l.member_id, l.brand_id);
    const pts = Math.min(l.remaining, w.balance);
    if (pts <= 0) continue;
    const balance = w.balance - pts;
    await db.q(`INSERT INTO point_ledger (member_id, brand_id, entry_type, points, balance_after, ref_type, ref_id, idempotency_key, note, actor_type)
                VALUES ($1,$2,'expire',$3,$4,'lot',$5,$6,'แต้มหมดอายุ','system') ON CONFLICT (idempotency_key) DO NOTHING`,
      [l.member_id, l.brand_id, -pts, balance, String(l.id), 'expire:' + l.id]);
    await db.q('UPDATE wallets SET balance = $3, updated_at = now() WHERE member_id = $1 AND brand_id = $2', [l.member_id, l.brand_id, balance]);
  }
  return lots.length;
}

/* ---------------- คูปอง ---------------- */
export async function issueCoupon(db, { memberId, templateId, source, sourceRef }) {
  const t = await db.one('SELECT t.*, b.code_prefix FROM coupon_templates t LEFT JOIN brands b ON b.id = t.brand_id WHERE t.id = $1', [templateId]);
  if (!t) throw notFound('ไม่พบแม่แบบคูปอง');
  if (sourceRef) {
    const ex = await db.one('SELECT * FROM member_coupons WHERE member_id = $1 AND source = $2 AND source_ref = $3', [memberId, source, String(sourceRef)]);
    if (ex) return ex;
  }
  // จำกัดจำนวนใบทั้งหมด: ล็อกแม่แบบไว้ระหว่างนับ กันแจกเกินเมื่อมีคนรับพร้อมกัน
  if (t.max_issue) {
    await db.q('SELECT id FROM coupon_templates WHERE id = $1 FOR UPDATE', [t.id]);
    const n = await db.one('SELECT count(*)::int AS n FROM member_coupons WHERE template_id = $1', [t.id]);
    if (n.n >= t.max_issue) throw conflict('coupon_sold_out', 'คูปองนี้ถูกแจกครบจำนวนแล้ว');
  }
  // วันหมดอายุ: แบบช่วงวันที่ = วันสุดท้ายของช่วง · แบบระยะเวลา = นับจากวันที่ได้รับ (ไม่เกินวันสุดท้ายถ้ามี)
  const byDays = new Date(Date.now() + t.valid_days * 864e5);
  const expires = t.validity === 'dates' && t.valid_to ? t.valid_to : (t.valid_to && t.valid_to < byDays ? t.valid_to : byDays);
  for (let i = 0; i < 6; i++) {
    const code = (t.code_prefix || 'GR') + '-' + randomCode(4 + (i > 3 ? 2 : 0));
    const row = await db.one(
      `INSERT INTO member_coupons (code, template_id, member_id, brand_id, source, source_ref, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (code) DO NOTHING RETURNING *`,
      [code, templateId, memberId, t.brand_id, source, sourceRef ? String(sourceRef) : null, expires]);
    if (row) return row;
  }
  throw new Error('could not allocate coupon code');
}

// คูปองที่อยู่ในช่วงแจก (ยังไม่หมดเขตใช้) ของแบรนด์
export const OPEN_TPL = `t.is_active AND (t.issue_from IS NULL OR t.issue_from <= now()) AND (t.issue_to IS NULL OR t.issue_to >= now())
  AND (t.valid_to IS NULL OR t.valid_to > now())`;

// แจกคูปองอัตโนมัติ (ประเภททั่วไป/วันเกิด) ให้สมาชิกที่ตรงเงื่อนไข · เรียกตอนลูกค้าเปิดหน้าสมาชิก และตอน POS สแกน
// จึงครอบคลุมทั้งสมาชิกเดิมและสมาชิกใหม่ โดยไม่ต้องไล่แจกทั้งฐานล่วงหน้า · แจกซ้ำไม่ได้ (unique member+source+ref)
export async function autoIssue(db, memberId, brandId) {
  const tpls = await db.q(`SELECT t.* FROM coupon_templates t WHERE t.brand_id = $1 AND t.kind IN ('general','birthday') AND ${OPEN_TPL}
    AND NOT EXISTS (SELECT 1 FROM member_coupons c WHERE c.member_id = $2 AND c.template_id = t.id
      AND (t.kind = 'general' OR c.issued_at > date_trunc('year', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'))`, [brandId, memberId]);
  if (!tpls.length) return [];
  const m = await db.one(`SELECT m.birth_date, extract(month FROM m.birth_date)::int AS bmonth, extract(month FROM now() AT TIME ZONE 'Asia/Bangkok')::int AS nmonth,
      extract(year FROM now() AT TIME ZONE 'Asia/Bangkok')::int AS nyear, COALESCE(l.follow_status, '') AS follow
    FROM members m LEFT JOIN member_brand_links l ON l.member_id = m.id AND l.brand_id = $2 WHERE m.id = $1 AND m.status = 'active'`, [memberId, brandId]);
  if (!m) return [];
  let tier = null;
  const out = [];
  for (const t of tpls) {
    if (t.followers_only && m.follow !== 'follow') continue;
    if (t.kind === 'birthday' && (!m.birth_date || m.bmonth !== m.nmonth)) continue;
    if (t.audience_tiers && t.audience_tiers.length) {
      if (!tier) tier = (await walletsOf(db, memberId))[brandId].tier.name;
      if (!t.audience_tiers.includes(tier)) continue;
    }
    try {
      out.push(await issueCoupon(db, { memberId, templateId: t.id, source: t.kind === 'birthday' ? 'birthday' : 'auto', sourceRef: t.kind === 'birthday' ? t.id + ':' + m.nyear : String(t.id) }));
    } catch (e) { if (e.code !== 'coupon_sold_out') throw e; }
  }
  return out;
}

// พนักงานมอบคูปองให้สมาชิกรายคน (ประเภทของขวัญ หรือคูปองอื่นที่ยังเปิดอยู่)
export async function giftCoupon(db, { memberId, templateId, by }) {
  const t = await db.one(`SELECT t.* FROM coupon_templates t WHERE t.id = $1 AND t.kind <> 'internal' AND ${OPEN_TPL}`, [templateId]);
  if (!t) throw bad('coupon_closed', 'คูปองนี้ปิดอยู่หรือหมดช่วงแจกแล้ว');
  const c = await issueCoupon(db, { memberId, templateId, source: 'gift', sourceRef: 'gift:' + by.id + ':' + Date.now() });
  await audit(db, { type: 'staff', id: by.id, name: by.name }, 'gift_coupon', { type: 'member', id: memberId }, 'มอบคูปอง ' + t.title);
  return c;
}

export async function expireCoupons(db) {
  return (await db.q("UPDATE member_coupons SET status = 'expired' WHERE status = 'ready' AND expires_at < now() RETURNING id")).length;
}

/* ---------------- สมาชิก ---------------- */
export const memberByLine = (db, lineUserId) => db.one(
  `SELECT m.* FROM member_line_identities i JOIN members m ON m.id = i.member_id WHERE i.line_user_id = $1 AND m.status = 'active'`, [lineUserId]);

async function syncFollowLinks(db, memberId, lineUserId) {
  // OA ที่ลูกค้าแอดไว้ก่อนสมัคร → ใส่สถานะให้สมาชิก
  await db.q(`INSERT INTO member_brand_links (member_id, brand_id, follow_status, follow_changed_at)
              SELECT $1, brand_id, status, changed_at FROM line_followers WHERE line_user_id = $2
              ON CONFLICT (member_id, brand_id) DO UPDATE SET follow_status = EXCLUDED.follow_status, follow_changed_at = EXCLUDED.follow_changed_at`, [memberId, lineUserId]);
}

export async function createOtp(db, phone, lineUserId) {
  const recent = await db.one("SELECT count(*)::int AS n FROM otp_requests WHERE phone = $1 AND created_at > now() - interval '10 minutes'", [phone]);
  if (recent.n >= 5) throw new HttpError(429, 'otp_rate_limited', 'ขอ OTP บ่อยเกินไป ลองใหม่ในอีก 10 นาที');
  const code = String(crypto.randomInt(0, 1e6)).padStart(6, '0');
  await db.q("INSERT INTO otp_requests (phone, line_user_id, code_hash, expires_at) VALUES ($1,$2,$3, now() + interval '5 minutes')", [phone, lineUserId, sha256(phone + ':' + code)]);
  if (!DEV) await db.q("INSERT INTO outbox (kind, payload) VALUES ('sms_otp', $1)", [JSON.stringify({ phone, code })]);
  return DEV ? code : null;
}
export async function verifyOtp(db, phone, code, lineUserId) {
  const r = await db.one("SELECT * FROM otp_requests WHERE phone = $1 AND (line_user_id = $2::text OR $2::text IS NULL) AND verified_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1 FOR UPDATE", [phone, lineUserId || null]);
  if (!r) return false;
  if (r.attempts >= 5) return false;
  if (r.code_hash !== sha256(phone + ':' + code)) { await db.q('UPDATE otp_requests SET attempts = attempts + 1 WHERE id = $1', [r.id]); return false; }
  await db.q('UPDATE otp_requests SET verified_at = now() WHERE id = $1', [r.id]);
  return true;
}

export async function register(db, f) {
  if (await memberByLine(db, f.lineUserId)) throw conflict('already_member', 'บัญชี LINE นี้เป็นสมาชิกแล้ว');
  // OTP ถูกตรวจแล้วใน transaction แยก (เพื่อให้นับจำนวนครั้งที่ใส่ผิดได้จริง) ที่นี่ตรวจว่ามีการยืนยันล่าสุดของเบอร์ + LINE นี้
  const ok = await db.one("SELECT id FROM otp_requests WHERE phone = $1 AND line_user_id = $2 AND verified_at > now() - interval '15 minutes' ORDER BY id DESC LIMIT 1", [f.phone, f.lineUserId]);
  if (REQUIRE_OTP && !ok) throw bad('otp_required', 'ยืนยันเบอร์ด้วย OTP ก่อนสมัคร');
  const brand = await db.one('SELECT * FROM brands WHERE id = $1 AND is_active', [f.brandId]);
  if (!brand) throw bad('brand_invalid', 'ไม่พบแบรนด์');

  const existing = await db.one("SELECT * FROM members WHERE phone = $1 AND status = 'active' FOR UPDATE", [f.phone]);
  if (existing) {
    // ไม่มี OTP = พิสูจน์ไม่ได้ว่าเป็นเจ้าของเบอร์ → ไม่ผูกให้เอง (กันคนใส่เบอร์ผู้อื่นแล้วได้แต้มไป)
    if (!ok) throw conflict('phone_exists', 'เบอร์นี้เป็นสมาชิกอยู่แล้ว กรุณาติดต่อพนักงานที่ร้านเพื่อยืนยันและผูกบัญชีกับ LINE');
    // เบอร์นี้มีบัญชีอยู่แล้ว และเพิ่งยืนยัน OTP → ผูก LINE กับบัญชีเดิม (ไม่สร้างใหม่)
    await db.q('INSERT INTO member_line_identities (line_user_id, member_id, display_name) VALUES ($1,$2,$3) ON CONFLICT (line_user_id) DO UPDATE SET member_id = EXCLUDED.member_id, linked_at = now()', [f.lineUserId, existing.id, f.displayName || null]);
    await db.q('UPDATE members SET phone_verified_at = now(), updated_at = now() WHERE id = $1', [existing.id]);
    await syncFollowLinks(db, existing.id, f.lineUserId);
    await setConsent(db, existing.id, f.brandId, !!f.marketing);
    await audit(db, { type: 'member', id: existing.id }, 'link_line', { type: 'member', id: existing.id }, 'ผูก LINE กับสมาชิกเดิมผ่าน OA ' + brand.short_name);
    return { member: existing, linked: true };
  }

  return createMember(db, f, brand, ok);
}

// สร้างสมาชิกใหม่ + แต้ม/คูปองต้อนรับ · ใช้ทั้งสมัครผ่าน LINE (f.lineUserId) และพนักงานเพิ่มจากหลังบ้าน (ไม่มี LINE)
// ลูกค้าที่พนักงานเพิ่มให้ มาสมัครผ่าน LINE ด้วยเบอร์เดิม + OTP ภายหลัง → ผูก LINE กับบัญชีนี้ (ดู register)
async function createMember(db, f, brand, verified) {
  const no = (await db.one("SELECT nextval('member_no') AS n")).n;
  const id = memberIdOf(no);
  let home = f.branchId ? await db.one('SELECT id FROM branches WHERE id = $1 AND brand_id = $2', [f.branchId, f.brandId]) : null;
  if (!home) home = await db.one('SELECT id FROM branches WHERE brand_id = $1 AND is_active ORDER BY id LIMIT 1', [f.brandId]);
  const m = await db.one(
    `INSERT INTO members (id, full_name, phone, phone_verified_at, birth_date, home_branch_id, joined_brand_id, privacy_accepted_at, privacy_version)
     VALUES ($1,$2,$3, $8, $4, $5, $6, now(), $7) RETURNING *`,
    [id, f.name, f.phone, f.birthday || null, home ? home.id : null, f.brandId, f.privacyVersion || '2026-01', verified ? new Date() : null]);
  if (f.lineUserId) {
    await db.q('INSERT INTO member_line_identities (line_user_id, member_id, display_name) VALUES ($1,$2,$3)', [f.lineUserId, id, f.displayName || null]);
    await syncFollowLinks(db, id, f.lineUserId);
  }
  await setConsent(db, id, f.brandId, !!f.marketing);

  const rule = await currentRule(db, f.brandId);
  let welcomePts = 0;
  if (rule && rule.welcome_points > 0) {
    welcomePts = rule.welcome_points;
    await credit(db, { memberId: id, brandId: f.brandId, branchId: home?.id, type: 'welcome', points: welcomePts, key: 'welcome:' + id + ':' + f.brandId, note: 'แต้มต้อนรับสมาชิกใหม่', actorType: 'system' });
  }
  // คูปองต้อนรับ: ทุกใบประเภท "ต้อนรับ" ของแบรนด์ที่ยังอยู่ในช่วงแจก
  let coupon = null; const titles = [];
  // ตั้งให้เฉพาะบางสาขาได้: ได้เมื่อสาขาประจำที่เลือกตอนสมัครอยู่ในรายการ
  for (const t of await db.q(`SELECT t.* FROM coupon_templates t WHERE t.brand_id = $1 AND t.kind = 'welcome' AND ${OPEN_TPL}
      AND (t.branch_ids IS NULL OR $2::text = ANY(t.branch_ids)) ORDER BY t.id`, [f.brandId, home ? home.id : null])) {
    try {
      const c = await issueCoupon(db, { memberId: id, templateId: t.id, source: 'welcome', sourceRef: f.brandId + ':' + t.id });
      coupon = coupon || c; titles.push(t.title);
    } catch (e) { if (e.code !== 'coupon_sold_out') throw e; }
  }
  if (f.lineUserId) await queueMessage(db, { brandId: f.brandId, lineUserId: f.lineUserId, kind: 'welcome', data: { memberId: id, pts: welcomePts, coupon: titles.length ? titles.join(', ') : null } });
  if (f.staff) await audit(db, { type: 'staff', id: f.staff.id, name: f.staff.name }, 'add_member', { type: 'member', id }, 'เพิ่มสมาชิกจากหลังบ้าน ' + brand.short_name);
  else await audit(db, { type: 'member', id }, 'register', { type: 'member', id }, 'สมัครผ่าน OA ' + brand.short_name);
  return { member: m, linked: false, welcomePoints: welcomePts, coupon };
}

// พนักงานเพิ่มสมาชิกเอง (ลูกค้ายินยอมที่หน้าร้าน) · เบอร์ซ้ำ = บอกเลขสมาชิกเดิม ไม่สร้างซ้ำ
export async function registerByStaff(db, f) {
  const brand = await db.one('SELECT * FROM brands WHERE id = $1 AND is_active', [f.brandId]);
  if (!brand) throw bad('brand_invalid', 'ไม่พบแบรนด์');
  const existing = await db.one("SELECT id FROM members WHERE phone = $1 AND status = 'active'", [f.phone]);
  if (existing) throw conflict('phone_exists', 'เบอร์นี้เป็นสมาชิกอยู่แล้ว (' + existing.id + ')');
  return createMember(db, { ...f, lineUserId: null, privacyVersion: 'staff:' + f.staff.id }, brand, false);
}

export async function setConsent(db, memberId, brandId, marketing) {
  await db.q(`INSERT INTO member_brand_links (member_id, brand_id, marketing_consent, consent_changed_at) VALUES ($1,$2,$3, now())
              ON CONFLICT (member_id, brand_id) DO UPDATE SET marketing_consent = EXCLUDED.marketing_consent, consent_changed_at = now()`, [memberId, brandId, marketing]);
}

/* ---------------- แลกแต้ม ---------------- */
/* ---------------- ของรางวัล ---------------- */
const TIER_NAMES = { SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Platinum', DIAMOND: 'Diamond' };
const PERIOD_NAMES = { day: 'วันนี้', week: 'สัปดาห์นี้', month: 'เดือนนี้', year: 'ปีนี้', all: '' };
// ของรางวัลที่อยู่ในช่วงวันที่เปิดแลก (เวลาไทย) · คูปองที่ผูกไว้ต้องยังเปิดแจกอยู่
const REWARD_SQL = `SELECT r.*, to_char(r.end_date, 'YYYY-MM-DD') AS end_day, t.discount_type, t.discount_value, t.min_spend, t.badge_big, t.valid_days, t.title AS coupon_title,
    (${OPEN_TPL}) AS tpl_open
  FROM rewards r JOIN coupon_templates t ON t.id = r.coupon_template_id`;
const REWARD_OPEN = `r.is_active AND (r.start_date IS NULL OR r.start_date <= (now() AT TIME ZONE 'Asia/Bangkok')::date)
  AND (r.end_date IS NULL OR r.end_date >= (now() AT TIME ZONE 'Asia/Bangkok')::date)`;
// จำนวนครั้งที่สมาชิกแลกรางวัลนี้ในช่วงเวลาที่จำกัด (วัน/สัปดาห์/เดือน/ปี ตามเวลาไทย หรือทั้งหมด)
async function redeemedCount(db, memberId, r) {
  const since = r.limit_period === 'all' ? '' : ` AND created_at >= date_trunc('${r.limit_period}', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok'`;
  return (await db.one(`SELECT count(*)::int AS n FROM point_ledger WHERE member_id = $1 AND entry_type = 'redeem' AND ref_type = 'reward' AND ref_id = $2${since}`, [memberId, String(r.id)])).n;
}
// เหตุผลที่สมาชิกคนนี้แลกรางวัลนี้ไม่ได้ (null = แลกได้ ถ้าแต้มพอ) · tier = ระดับปัจจุบันของสมาชิก
async function rewardProblem(db, r, { memberId, tier }) {
  if (r.stock !== null && r.stock <= 0) return { code: 'out_of_stock', msg: 'ของรางวัลหมดแล้ว' };
  if (r.kind === 'coupon' && !r.tpl_open) return { code: 'reward_closed', msg: 'คูปองของรางวัลนี้ปิดแจกแล้ว' };
  if (r.tiers && r.tiers.length && tier && !r.tiers.includes(tier)) return { code: 'tier_required', msg: 'เฉพาะสมาชิกระดับ ' + r.tiers.map((x) => TIER_NAMES[x] || x).join(' / ') };
  if (r.limit_count && memberId && (await redeemedCount(db, memberId, r)) >= r.limit_count) {
    return { code: 'limit_reached', msg: 'แลกครบ ' + r.limit_count + ' ครั้ง' + (PERIOD_NAMES[r.limit_period] ? 'ใน' + PERIOD_NAMES[r.limit_period] : 'แล้ว') };
  }
  return null;
}
const tierNow = async (db, memberId, brandId) => (memberId ? (await walletsOf(db, memberId))[brandId]?.tier?.name : null);
// รายการของรางวัลของแบรนด์สำหรับสมาชิกคนหนึ่ง (memberId ว่าง = ดูอย่างเดียว) · why = เหตุผลที่แลกไม่ได้
export async function rewardsFor(db, { brandId, memberId }) {
  const rows = await db.q(REWARD_SQL + ' WHERE r.brand_id = $1 AND ' + REWARD_OPEN + ' ORDER BY r.points_cost', [brandId]);
  const tier = await tierNow(db, memberId, brandId);
  const out = [];
  for (const r of rows) {
    const p = await rewardProblem(db, r, { memberId, tier });
    out.push({ ...r, why: p ? p.msg : null });
  }
  return out;
}

export async function redeem(db, { memberId, rewardId, key }) {
  const r = await db.one(REWARD_SQL + ' WHERE r.id = $1 FOR UPDATE OF r', [rewardId]);
  if (!r || !r.is_active) throw notFound('ไม่พบของรางวัลนี้');
  const ikey = 'redeem:' + memberId + ':' + key;
  const dup = await db.one('SELECT id FROM point_ledger WHERE idempotency_key = $1', [ikey]);
  if (dup) return { duplicate: true, coupon: await db.one("SELECT * FROM member_coupons WHERE member_id = $1 AND source = 'redeem' AND source_ref = $2", [memberId, String(dup.id)]) };
  const open = await db.one('SELECT 1 FROM rewards r WHERE r.id = $1 AND ' + REWARD_OPEN, [r.id]);
  if (!open) throw bad('reward_closed', 'ของรางวัลนี้ยังไม่เปิดแลกหรือหมดเวลาแลกแล้ว');
  const p = await rewardProblem(db, r, { memberId, tier: await tierNow(db, memberId, r.brand_id) });
  if (p) throw p.code === 'out_of_stock' || p.code === 'limit_reached' ? conflict(p.code, p.msg) : bad(p.code, p.msg);
  const d = await debit(db, { memberId, brandId: r.brand_id, type: 'redeem', points: r.points_cost, refType: 'reward', refId: String(r.id), key: ikey, note: 'แลก ' + r.name, actorType: 'member', actorId: memberId });
  if (r.stock !== null) await db.q('UPDATE rewards SET stock = stock - 1 WHERE id = $1', [r.id]);
  const coupon = await issueCoupon(db, { memberId, templateId: r.coupon_template_id, source: 'redeem', sourceRef: d.ledgerId });
  return { coupon, balance: d.balance, reward: r };
}

export async function claimCode(db, { memberId, brandId, code }) {
  const p = await db.one('SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE', [String(code || '').trim().toUpperCase()]);
  if (!p || (p.expires_at && p.expires_at < new Date()) || (p.brand_id && p.brand_id !== brandId)) throw bad('code_invalid', 'โค้ดไม่ถูกต้องหรือใช้กับแบรนด์นี้ไม่ได้');
  const open = await db.one(`SELECT 1 FROM coupon_templates t WHERE t.id = $1 AND ${OPEN_TPL}`, [p.coupon_template_id]);
  if (!open) throw bad('code_invalid', 'โค้ดนี้หมดเขตหรือปิดใช้งานแล้ว');
  if (p.max_uses !== null && p.used_count >= p.max_uses) throw conflict('code_used_up', 'โค้ดนี้ถูกใช้ครบแล้ว');
  // ได้คูปองนี้จากโค้ดไปแล้ว (รวมโค้ดเดิมก่อนร้านเปลี่ยนโค้ด) กรอกซ้ำไม่ได้
  const before = await db.one("SELECT id FROM member_coupons WHERE member_id = $1 AND source = 'code' AND (source_ref = $2 OR template_id = $3)", [memberId, p.code, p.coupon_template_id]);
  if (before) throw conflict('code_already_claimed', 'คุณเพิ่มโค้ดนี้ไปแล้ว');
  const c = await issueCoupon(db, { memberId, templateId: p.coupon_template_id, source: 'code', sourceRef: p.code });
  await db.q('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = $1', [p.code]);
  return c;
}

/* ---------------- คูปอง/แลกแต้มที่หน้าร้าน ---------------- */
const COUPON_CHECK_SQL = `SELECT c.*, t.title, t.badge_big, t.badge_small, t.condition_text, t.description, t.image_id, t.discount_type, t.discount_value, t.min_spend, t.max_discount, t.valid_from, t.use_days,
    t.free_items, t.free_mode, t.free_qty, t.free_need_all, t.cond_mode, t.cond_items, t.cond_qty, t.cond_scope
  FROM member_coupons c JOIN coupon_templates t ON t.id = c.template_id`;
const bangkokDow = async (db) => (await db.one("SELECT extract(dow FROM now() AT TIME ZONE 'Asia/Bangkok')::int AS d")).d;
// เหตุผลที่คูปองใช้กับบิลนี้ไม่ได้ (null = ใช้ได้)
// ส่วนลดของคูปองกับบิลนี้ (ของฟรี/เงื่อนไขสินค้าคิดจากรายการอาหาร · cart = null คือ POS ไม่ได้ส่งรายการมา)
function couponAmount(c, subtotal, cart) {
  if (!c || c.status !== 'ready' || subtotal < Number(c.min_spend || 0)) return 0;
  const d = itemDiscount(c, cart, subtotal);
  return d === null ? couponDiscount(c, subtotal) : d;
}
function couponProblem(c, { memberId, brandId, subtotal, dow, ref, cart }) {
  if (c.member_id !== memberId) return { code: 'coupon_not_owner', msg: 'คูปอง ' + c.code + ' ไม่ใช่ของสมาชิกนี้' };
  if (c.status !== 'ready' || c.expires_at < new Date()) return { code: 'coupon_unusable', status: 409, msg: 'คูปอง ' + c.code + ' ใช้แล้วหรือหมดอายุ' };
  if (c.brand_id && c.brand_id !== brandId) return { code: 'coupon_wrong_brand', msg: 'คูปอง ' + c.code + ' ใช้กับแบรนด์นี้ไม่ได้' };
  if (c.valid_from && c.valid_from > new Date()) return { code: 'coupon_not_started', msg: 'คูปอง ' + c.code + ' ยังไม่ถึงวันที่ใช้ได้' };
  if (!(c.use_days & (1 << dow))) return { code: 'coupon_wrong_day', msg: 'คูปอง ' + c.code + ' ใช้วันนี้ไม่ได้' };
  if (c.reserved_ref && c.reserved_until > new Date() && c.reserved_ref !== ref) return { code: 'coupon_reserved', status: 409, msg: 'คูปอง ' + c.code + ' กำลังถูกใช้กับบิลอื่นอยู่' };
  const ip = itemProblem(c, cart);
  if (ip) return ip;
  if (couponAmount(c, subtotal, cart) <= 0) return { code: 'coupon_min_spend', msg: 'ยอดยังไม่ถึงขั้นต่ำของคูปอง ' + c.code + (Number(c.min_spend) ? ' (ขั้นต่ำ ' + Number(c.min_spend) + ' บาท)' : '') };
  return null;
}
const couponOut = (c, err, subtotal, cart) => ({
  id: String(c.id), code: c.code, title: c.title, big: c.badge_big, small: c.badge_small, cond: c.condition_text, desc: c.description || '',
  image: c.image_id ? '/api/public/coupon-images/' + c.image_id : null, expiresAt: c.expires_at,
  usable: !err, reason: err ? err.msg : null, discount: err ? 0 : couponAmount(c, subtotal, cart)
});

// กระเป๋าของสมาชิกที่หน้าร้าน: แต้ม + คูปองที่มี (บอกว่าใช้กับบิลนี้ได้ไหม และลดเท่าไร) + ของรางวัลที่แลกได้
export async function posWallet(db, { memberId, brandId, subtotal, ref, items }) {
  const m = await db.one("SELECT id FROM members WHERE id = $1 AND status = 'active'", [memberId]);
  if (!m) throw notFound('ไม่พบสมาชิก');
  await autoIssue(db, memberId, brandId);
  const balance = (await db.one('SELECT balance FROM wallets WHERE member_id = $1 AND brand_id = $2', [memberId, brandId]))?.balance ?? 0;
  const dow = await bangkokDow(db);
  const sub = Math.max(0, Number(subtotal) || 0);
  const cs = await db.q(COUPON_CHECK_SQL + " WHERE c.member_id = $1 AND c.status = 'ready' AND c.expires_at > now() AND (c.brand_id = $2 OR c.brand_id IS NULL) ORDER BY c.expires_at", [memberId, brandId]);
  const cart = await loadCart(db, brandId, items);
  const coupons = cs.map((c) => couponOut(c, couponProblem(c, { memberId, brandId, subtotal: sub, dow, ref, cart }), sub, cart));
  const rewards = (await rewardsFor(db, { brandId, memberId }))
    .map((r) => ({ id: r.id, name: r.name, cost: r.points_cost, big: r.badge_big, value: Number(r.discount_value), minSpend: Number(r.min_spend),
      outOfStock: r.stock !== null && r.stock <= 0, why: r.why, affordable: r.points_cost <= balance && !r.why }));
  return { balance, coupons, rewards };
}

// จองคูปองไว้กับบิลที่กำลังเปิด (ref) · คืนยอดส่วนลดที่ POS ต้องใช้ (คำนวณที่นี่ที่เดียว ให้ตรงกับตอนบันทึกบิล)
export async function reserveCoupon(db, { memberId, brandId, couponId, ref, subtotal, minutes = 30, items }) {
  if (!ref) throw bad('ref_required', 'ต้องมีรหัสบิลที่กำลังเปิด');
  const c = await db.one(COUPON_CHECK_SQL + ' WHERE c.id = $1 FOR UPDATE OF c', [parseInt(String(couponId).replace(/\D/g, ''), 10)]);
  if (!c) throw notFound('ไม่พบคูปอง');
  const sub = Math.max(0, Number(subtotal) || 0);
  const cart = await loadCart(db, brandId, items);
  const err = couponProblem(c, { memberId, brandId, subtotal: sub, dow: await bangkokDow(db), ref, cart });
  if (err) throw err.status === 409 ? conflict(err.code, err.msg) : bad(err.code, err.msg);
  // บิลหนึ่งใช้คูปองได้ใบเดียว: ปล่อยใบอื่นที่จองไว้กับบิลนี้
  await db.q('UPDATE member_coupons SET reserved_ref = NULL, reserved_until = NULL WHERE member_id = $1 AND reserved_ref = $2 AND id <> $3', [memberId, ref, c.id]);
  await db.q("UPDATE member_coupons SET reserved_ref = $2, reserved_until = now() + make_interval(mins => $3::int) WHERE id = $1", [c.id, ref, Math.min(180, Math.max(5, minutes))]);
  return couponOut(c, null, sub, cart);
}
export async function releaseCoupon(db, { couponId, ref }) {
  const r = await db.q("UPDATE member_coupons SET reserved_ref = NULL, reserved_until = NULL WHERE id = $1 AND reserved_ref = $2 AND status = 'ready' RETURNING id",
    [parseInt(String(couponId).replace(/\D/g, ''), 10), String(ref || '')]);
  return { released: r.length > 0 };
}
// แลกแต้มเป็นคูปองที่หน้าร้าน แล้วจองไว้กับบิลนี้ทันที · กดซ้ำ (ref+รางวัลเดิม) ไม่ตัดแต้มซ้ำ
export async function redeemAtPos(db, { memberId, brandId, rewardId, ref, subtotal, minutes, items }) {
  const r = await db.one('SELECT brand_id FROM rewards WHERE id = $1', [parseInt(rewardId, 10)]);
  if (!r || r.brand_id !== brandId) throw notFound('ไม่พบของรางวัลนี้');
  const red = await redeem(db, { memberId, rewardId: parseInt(rewardId, 10), key: 'pos:' + ref + ':' + rewardId });
  const coupon = await reserveCoupon(db, { memberId, brandId, couponId: red.coupon.id, ref, subtotal, minutes, items });
  const balance = (await db.one('SELECT balance FROM wallets WHERE member_id = $1 AND brand_id = $2', [memberId, brandId]))?.balance ?? 0;
  return { coupon, balance };
}

// ยืนยันตัวตนที่หน้าลูกค้าสั่งเอง: ลูกค้าเปิดบัตรสมาชิกใน LINE แล้วพิมพ์รหัส 6 หลักใต้ QR (ไม่ส่งข้อความ จึงไม่กินโควต้า LINE OA)
// ต้องเป็นเจ้าของบัญชี LINE ถึงเปิดบัตรได้ · ผิด 5 ครั้งใน 10 นาที ล็อก 10 นาที (นับในตาราง member_verifications)
export async function sendMemberCode(db, { memberId, brandId }) {
  const m = await db.one(`SELECT m.id FROM members m JOIN member_line_identities i ON i.member_id = m.id WHERE m.id = $1 AND m.status = 'active' LIMIT 1`, [memberId]);
  if (!m) throw bad('no_line', 'สมาชิกนี้ยังไม่ได้ผูก LINE ใช้คูปอง/แลกแต้มที่เคาน์เตอร์แทน');
  return { mode: 'card', liffUrl: process.env.LIFF_ID ? 'https://liff.line.me/' + process.env.LIFF_ID + '?brand=' + brandId : null };
}
export async function checkMemberCode(db, { memberId, code, brandId }) {
  const fails = await db.one("SELECT count(*)::int AS n FROM member_verifications WHERE member_id = $1 AND code_hash = 'fail' AND created_at > now() - interval '10 minutes'", [memberId]);
  if (fails.n >= 5) throw new HttpError(429, 'too_many', 'ใส่รหัสผิดหลายครั้ง รอ 10 นาทีแล้วลองใหม่');
  if (checkMemberPin(memberId, code)) return true;
  if (brandId) await db.q("INSERT INTO member_verifications (member_id, brand_id, code_hash, expires_at, attempts) VALUES ($1,$2,'fail', now(), 1)", [memberId, brandId]);
  return false;
}

/* ---------------- ขาย / คืนเงิน (POS) ---------------- */
export async function recordSale(db, s) {
  const br = await db.one('SELECT b.*, r.short_name FROM branches b JOIN brands r ON r.id = b.brand_id WHERE b.id = $1', [s.branchId]);
  if (!br) throw notFound('ไม่พบสาขา');
  const prev = await db.one('SELECT * FROM sales_transactions WHERE branch_id = $1 AND pos_bill_id = $2', [s.branchId, s.posBillId]);
  if (prev) return { duplicate: true, txn: prev };

  if (!Array.isArray(s.items) || !s.items.length) throw bad('items_required', 'บิลต้องมีรายการอย่างน้อย 1 รายการ');
  const items = s.items.map((i) => ({ id: String(i.id || ''), name: String(i.name || ''), price: Number(i.price), qty: Number(i.qty || 1) }));
  if (items.some((i) => !(i.price >= 0) || !(i.qty > 0))) throw bad('items_invalid', 'ราคาหรือจำนวนไม่ถูกต้อง');
  const subtotal = Math.round(items.reduce((a, i) => a + i.price * i.qty, 0) * 100) / 100;

  let member = null;
  if (s.memberId) {
    member = await db.one("SELECT * FROM members WHERE id = $1 AND status = 'active'", [s.memberId]);
    if (!member) throw notFound('ไม่พบสมาชิก');
  }
  // คูปอง: ตรวจกับ server ทุกครั้ง · ต้องเป็นของสมาชิกคนนี้ ยังไม่ใช้ ไม่หมดอายุ ใช้กับแบรนด์นี้ได้ และไม่ได้ถูกจองไว้กับบิลอื่น
  // lenient (POS ส่งยอดส่วนลดที่ให้ลูกค้าไปแล้วมาด้วย): ลูกค้าได้ส่วนลดไปแล้วจริง ถ้าคูปองใช้ไม่ได้ตอนบิลมาถึง (เช่นส่งช้าจนหมดอายุ)
  //   ยังบันทึกบิลและให้แต้มตามยอดที่จ่ายจริง แต่ไม่ตัดคูปอง และบันทึกไว้ให้ตรวจ
  let discount = 0; const used = [];
  const ids = (s.couponIds || []).map((x) => parseInt(String(x).replace(/\D/g, ''), 10)).filter(Number.isFinite);
  const lenient = s.couponDiscount !== undefined && s.couponDiscount !== null;
  const problems = [];
  if (ids.length) {
    if (!member) throw bad('coupon_needs_member', 'ต้องระบุสมาชิกก่อนใช้คูปอง');
    const dow = await bangkokDow(db);
    const cs = await db.q(COUPON_CHECK_SQL + ' WHERE c.id = ANY($1::bigint[]) ORDER BY c.id FOR UPDATE OF c', [ids]);
    // รายการในบิล: id ที่ POS ส่งมาเป็นลำดับแถว ไม่ใช่รหัสเมนู จึงใช้เฉพาะ menuId ที่ระบุมาชัด ๆ
    const cart = await loadCart(db, br.brand_id, s.items.map((i) => ({ menuId: i.menuId, name: i.name, price: i.price, qty: i.qty || 1, category: i.category })));
    for (const c of cs) {
      const err = couponProblem(c, { memberId: member.id, brandId: br.brand_id, subtotal: subtotal - discount, dow, ref: s.couponRef, cart });
      if (err) {
        if (!lenient) throw err.status === 409 ? conflict(err.code, err.msg) : bad(err.code, err.msg);
        problems.push(c.code + ': ' + err.msg);
        continue;
      }
      discount += couponAmount(c, subtotal - discount, cart); used.push(c);
    }
    if (cs.length < ids.length) problems.push('ไม่พบคูปองบางใบ');
  }
  if (lenient) {
    // ใช้ยอดส่วนลดที่ POS ให้ลูกค้าจริง (ไม่เกินยอดอาหาร) แทนยอดที่คำนวณใหม่
    discount = Math.min(Math.max(0, Number(s.couponDiscount) || 0), subtotal);
    if (problems.length) await audit(db, { type: 'pos', id: s.terminalId }, 'coupon_problem', { type: 'bill', id: s.branchId + ':' + s.posBillId }, problems.join(' · '));
  }
  // ส่วนลดอื่นของร้านที่ POS ให้เอง (ไม่ใช่คูปองสมาชิก) · แต้มคิดจากยอดหลังส่วนลด ก่อนค่าบริการและ VAT
  const storeDiscount = Math.min(Math.max(0, Number(s.storeDiscount) || 0), subtotal - discount);
  discount = Math.round((discount + storeDiscount) * 100) / 100;
  const net = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  // ยอดที่ลูกค้าจ่ายจริง (รวมค่าบริการ/VAT ถ้ามี) ใช้แสดงผลและรายงาน ถ้า POS ไม่ส่งมาใช้ยอดหลังส่วนลด
  const total = Number(s.paidTotal) >= 0 && s.paidTotal !== null && s.paidTotal !== undefined && s.paidTotal !== '' ? Math.round(Number(s.paidTotal) * 100) / 100 : net;
  const rule = await currentRule(db, br.brand_id);
  const points = member && br.earn_enabled ? calcPoints(rule, { subtotal, total: net }) : 0;

  const txn = await db.one(
    `INSERT INTO sales_transactions (pos_bill_id, branch_id, brand_id, member_id, channel, subtotal, discount, total, points_earned, rule_id, staff_id, items)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (branch_id, pos_bill_id) DO NOTHING RETURNING *`,
    [s.posBillId, s.branchId, br.brand_id, member?.id || null, s.channel || 'pos', subtotal, discount, total, points, rule?.id || null, s.staffId || null, JSON.stringify(items)]);
  if (!txn) return { duplicate: true, txn: await db.one('SELECT * FROM sales_transactions WHERE branch_id = $1 AND pos_bill_id = $2', [s.branchId, s.posBillId]) };

  for (const c of used) await db.q("UPDATE member_coupons SET status = 'used', used_at = now(), used_txn_id = $2, used_branch_id = $3, used_by = $4, reserved_ref = NULL, reserved_until = NULL WHERE id = $1", [c.id, txn.id, s.branchId, s.staffId || null]);
  await db.q('UPDATE branches SET pos_last_seen = now() WHERE id = $1', [s.branchId]);

  let balance = null;
  if (member) {
    await db.q('INSERT INTO member_brand_links (member_id, brand_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [member.id, br.brand_id]);
    if (points > 0) {
      balance = (await credit(db, { memberId: member.id, brandId: br.brand_id, branchId: s.branchId, type: 'earn', points, refType: 'sale', refId: String(txn.id),
        key: 'sale:' + s.branchId + ':' + s.posBillId, note: 'ชำระบิล ' + s.posBillId, actorType: 'pos', actorId: s.staffId || s.terminalId })).balance;
    } else {
      balance = (await db.one('SELECT balance FROM wallets WHERE member_id = $1 AND brand_id = $2', [member.id, br.brand_id]))?.balance ?? 0;
    }
    // แจ้งแต้มทาง LINE ตามที่แบรนด์ตั้งไว้ (ข้อความ push นับโควต้า LINE OA) · ค่าเริ่มต้นไม่แจ้ง ลูกค้าดูแต้มในบัตรสมาชิกได้ตลอด
    const brand = await db.one('SELECT points_notify, points_notify_min FROM brands WHERE id = $1', [br.brand_id]);
    const notify = brand && (brand.points_notify === 'all' || (brand.points_notify === 'min' && total >= Number(brand.points_notify_min)));
    const ident = notify && await db.one('SELECT line_user_id FROM member_line_identities WHERE member_id = $1 ORDER BY linked_at DESC LIMIT 1', [member.id]);
    if (ident) await queueMessage(db, { brandId: br.brand_id, lineUserId: ident.line_user_id, kind: 'points',
      data: { billId: s.posBillId, branch: br.name, total, discount, pts: points, bal: balance, memberId: member.id } });
  }
  return { txn, points, balance, discount, coupons: used.map((c) => c.id) };
}

export async function refundSale(db, { branchId, posBillId, posRefundId, amount, by }) {
  const t = await db.one('SELECT * FROM sales_transactions WHERE branch_id = $1 AND pos_bill_id = $2 FOR UPDATE', [branchId, posBillId]);
  if (!t) throw notFound('ไม่พบบิลนี้');
  const rid = posRefundId || 'R-' + posBillId;
  const prev = await db.one('SELECT * FROM refunds WHERE pos_refund_id = $1', [rid]);
  if (prev) return { duplicate: true, refund: prev };
  if (t.status === 'refunded' || t.status === 'void') throw conflict('already_refunded', 'บิลนี้คืนเงินไปแล้ว');
  const done = await db.one('SELECT COALESCE(sum(amount),0) AS a, COALESCE(sum(points_reversed),0) AS p FROM refunds WHERE txn_id = $1', [t.id]);
  const remaining = t.total - done.a;
  const amt = amount == null ? remaining : Math.min(Number(amount), remaining);
  if (!(amt > 0)) throw bad('amount_invalid', 'ยอดคืนเงินไม่ถูกต้อง');
  const full = amt >= remaining - 0.001;
  // หักแต้มคืนตามสัดส่วนยอดที่คืนจริง
  const wantPts = full ? t.points_earned - done.p : Math.floor(t.points_earned * amt / t.total);
  let reversed = 0;
  if (t.member_id && wantPts > 0) {
    reversed = (await debit(db, { memberId: t.member_id, brandId: t.brand_id, branchId, type: 'refund', points: wantPts, refType: 'refund', refId: rid, key: 'refund:' + rid,
      note: 'คืนเงินบิล ' + posBillId, actorType: 'pos', actorId: by, capAtBalance: true })).points;
  }
  const refund = await db.one('INSERT INTO refunds (txn_id, pos_refund_id, amount, points_reversed, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *', [t.id, rid, amt, reversed, by || null]);
  await db.q('UPDATE sales_transactions SET status = $2 WHERE id = $1', [t.id, full ? 'refunded' : 'partial_refund']);
  let returned = 0;
  if (full) returned = (await db.q("UPDATE member_coupons SET status = 'ready', used_at = NULL, used_txn_id = NULL, used_branch_id = NULL WHERE used_txn_id = $1 AND expires_at > now() RETURNING id", [t.id])).length;
  await audit(db, { type: 'staff', id: by }, 'refund', { type: 'sale', id: posBillId }, 'คืนเงิน ' + amt + ' บาท · หักแต้ม ' + reversed);
  return { refund, pointsReversed: reversed, couponsReturned: returned };
}

/* ---------------- ปรับแต้มด้วยมือ ---------------- */
export async function requestAdjust(db, r) {
  const m = await db.one('SELECT id FROM members WHERE id = $1', [r.memberId]);
  if (!m) throw notFound('ไม่พบสมาชิก');
  const row = await db.one(`INSERT INTO point_adjust_requests (member_id, brand_id, branch_id, points, reason, ref_pos_bill_id, requested_by)
                             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [r.memberId, r.brandId, r.branchId || null, r.points, r.reason, r.refPosBillId || null, r.by.id]);
  await audit(db, { type: 'staff', id: r.by.id, name: r.by.name }, 'request_adjust', { type: 'adjust_request', id: String(row.id) }, r.memberId + ' ' + (r.points > 0 ? '+' : '') + r.points + ' · ' + r.reason);
  return row;
}
export async function decideAdjust(db, { id, approve, by }) {
  const r = await db.one('SELECT * FROM point_adjust_requests WHERE id = $1 FOR UPDATE', [id]);
  if (!r) throw notFound('ไม่พบคำขอ');
  if (r.status !== 'pending') throw conflict('already_decided', 'คำขอนี้ตัดสินไปแล้ว');
  if (r.requested_by === by.id) throw conflict('same_person', 'ผู้ขอกับผู้อนุมัติต้องเป็นคนละคน');
  if (approve) {
    const e = { memberId: r.member_id, brandId: r.brand_id, branchId: r.branch_id, type: 'adjust', points: Math.abs(r.points), refType: 'adjust_request', refId: String(r.id),
      key: 'adjust:' + r.id, note: r.reason, actorType: 'staff', actorId: by.id };
    if (r.points > 0) await credit(db, e); else await debit(db, e);
  }
  await db.q('UPDATE point_adjust_requests SET status = $2, decided_by = $3, decided_at = now() WHERE id = $1', [id, approve ? 'approved' : 'rejected', by.id]);
  await audit(db, { type: 'staff', id: by.id, name: by.name }, approve ? 'approve_adjust' : 'reject_adjust', { type: 'adjust_request', id: String(id) }, r.member_id + ' ' + r.points);
  return { ok: true };
}
