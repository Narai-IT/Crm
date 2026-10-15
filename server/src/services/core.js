// แกนธุรกิจ: กระเป๋าแต้ม (ledger + lots), คูปอง, สมาชิก, ขาย/คืนเงิน
// ทุกฟังก์ชันรับ db ที่อยู่ใน transaction (จาก tx()) เพื่อให้ทั้งชุดสำเร็จหรือยกเลิกพร้อมกัน
import crypto from 'node:crypto';
import { conflict, bad, notFound, HttpError } from '../http.js';
import { calcPoints, couponDiscount, memberIdOf, randomCode, sha256, DEV, tierOf } from '../util.js';
import { queueMessage } from './line.js';

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
  for (let i = 0; i < 6; i++) {
    const code = (t.code_prefix || 'GR') + '-' + randomCode(4 + (i > 3 ? 2 : 0));
    const row = await db.one(
      `INSERT INTO member_coupons (code, template_id, member_id, brand_id, source, source_ref, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6, now() + make_interval(days => $7::int)) ON CONFLICT (code) DO NOTHING RETURNING *`,
      [code, templateId, memberId, t.brand_id, source, sourceRef ? String(sourceRef) : null, t.valid_days]);
    if (row) return row;
  }
  throw new Error('could not allocate coupon code');
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
  if (!ok) throw bad('otp_required', 'ยืนยันเบอร์ด้วย OTP ก่อนสมัคร');
  const brand = await db.one('SELECT * FROM brands WHERE id = $1 AND is_active', [f.brandId]);
  if (!brand) throw bad('brand_invalid', 'ไม่พบแบรนด์');

  const existing = await db.one("SELECT * FROM members WHERE phone = $1 AND status = 'active' FOR UPDATE", [f.phone]);
  if (existing) {
    // เบอร์นี้มีบัญชีอยู่แล้ว และเพิ่งยืนยัน OTP → ผูก LINE กับบัญชีเดิม (ไม่สร้างใหม่)
    await db.q('INSERT INTO member_line_identities (line_user_id, member_id, display_name) VALUES ($1,$2,$3) ON CONFLICT (line_user_id) DO UPDATE SET member_id = EXCLUDED.member_id, linked_at = now()', [f.lineUserId, existing.id, f.displayName || null]);
    await db.q('UPDATE members SET phone_verified_at = now(), updated_at = now() WHERE id = $1', [existing.id]);
    await syncFollowLinks(db, existing.id, f.lineUserId);
    await setConsent(db, existing.id, f.brandId, !!f.marketing);
    await audit(db, { type: 'member', id: existing.id }, 'link_line', { type: 'member', id: existing.id }, 'ผูก LINE กับสมาชิกเดิมผ่าน OA ' + brand.short_name);
    return { member: existing, linked: true };
  }

  const no = (await db.one("SELECT nextval('member_no') AS n")).n;
  const id = memberIdOf(no);
  let home = f.branchId ? await db.one('SELECT id FROM branches WHERE id = $1 AND brand_id = $2', [f.branchId, f.brandId]) : null;
  if (!home) home = await db.one('SELECT id FROM branches WHERE brand_id = $1 AND is_active ORDER BY id LIMIT 1', [f.brandId]);
  const m = await db.one(
    `INSERT INTO members (id, full_name, phone, phone_verified_at, birth_date, home_branch_id, joined_brand_id, privacy_accepted_at, privacy_version)
     VALUES ($1,$2,$3, now(), $4, $5, $6, now(), $7) RETURNING *`,
    [id, f.name, f.phone, f.birthday || null, home ? home.id : null, f.brandId, f.privacyVersion || '2026-01']);
  await db.q('INSERT INTO member_line_identities (line_user_id, member_id, display_name) VALUES ($1,$2,$3)', [f.lineUserId, id, f.displayName || null]);
  await syncFollowLinks(db, id, f.lineUserId);
  await setConsent(db, id, f.brandId, !!f.marketing);

  const rule = await currentRule(db, f.brandId);
  let welcomePts = 0;
  if (rule && rule.welcome_points > 0) {
    welcomePts = rule.welcome_points;
    await credit(db, { memberId: id, brandId: f.brandId, branchId: home?.id, type: 'welcome', points: welcomePts, key: 'welcome:' + id + ':' + f.brandId, note: 'แต้มต้อนรับสมาชิกใหม่', actorType: 'system' });
  }
  let coupon = null;
  if (brand.welcome_template_id) coupon = await issueCoupon(db, { memberId: id, templateId: brand.welcome_template_id, source: 'welcome', sourceRef: f.brandId });
  await queueMessage(db, { brandId: f.brandId, lineUserId: f.lineUserId, kind: 'welcome', data: { memberId: id, pts: welcomePts, coupon: coupon ? 'ส่วนลด 10% บิลแรก' : null } });
  await audit(db, { type: 'member', id }, 'register', { type: 'member', id }, 'สมัครผ่าน OA ' + brand.short_name);
  return { member: m, linked: false, welcomePoints: welcomePts, coupon };
}

export async function setConsent(db, memberId, brandId, marketing) {
  await db.q(`INSERT INTO member_brand_links (member_id, brand_id, marketing_consent, consent_changed_at) VALUES ($1,$2,$3, now())
              ON CONFLICT (member_id, brand_id) DO UPDATE SET marketing_consent = EXCLUDED.marketing_consent, consent_changed_at = now()`, [memberId, brandId, marketing]);
}

/* ---------------- แลกแต้ม ---------------- */
export async function redeem(db, { memberId, rewardId, key }) {
  const r = await db.one('SELECT * FROM rewards WHERE id = $1 FOR UPDATE', [rewardId]);
  if (!r || !r.is_active) throw notFound('ไม่พบของรางวัลนี้');
  const ikey = 'redeem:' + memberId + ':' + key;
  const dup = await db.one('SELECT id FROM point_ledger WHERE idempotency_key = $1', [ikey]);
  if (dup) return { duplicate: true, coupon: await db.one("SELECT * FROM member_coupons WHERE member_id = $1 AND source = 'redeem' AND source_ref = $2", [memberId, String(dup.id)]) };
  if (r.stock !== null && r.stock <= 0) throw conflict('out_of_stock', 'ของรางวัลหมดแล้ว');
  const d = await debit(db, { memberId, brandId: r.brand_id, type: 'redeem', points: r.points_cost, refType: 'reward', refId: String(r.id), key: ikey, note: 'แลก ' + r.name, actorType: 'member', actorId: memberId });
  if (r.stock !== null) await db.q('UPDATE rewards SET stock = stock - 1 WHERE id = $1', [r.id]);
  const coupon = await issueCoupon(db, { memberId, templateId: r.coupon_template_id, source: 'redeem', sourceRef: d.ledgerId });
  return { coupon, balance: d.balance, reward: r };
}

export async function claimCode(db, { memberId, brandId, code }) {
  const p = await db.one('SELECT * FROM promo_codes WHERE code = $1 FOR UPDATE', [String(code || '').trim().toUpperCase()]);
  if (!p || (p.expires_at && p.expires_at < new Date()) || (p.brand_id && p.brand_id !== brandId)) throw bad('code_invalid', 'โค้ดไม่ถูกต้องหรือใช้กับแบรนด์นี้ไม่ได้');
  if (p.max_uses !== null && p.used_count >= p.max_uses) throw conflict('code_used_up', 'โค้ดนี้ถูกใช้ครบแล้ว');
  const before = await db.one("SELECT id FROM member_coupons WHERE member_id = $1 AND source = 'code' AND source_ref = $2", [memberId, p.code]);
  if (before) throw conflict('code_already_claimed', 'คุณเพิ่มโค้ดนี้ไปแล้ว');
  const c = await issueCoupon(db, { memberId, templateId: p.coupon_template_id, source: 'code', sourceRef: p.code });
  await db.q('UPDATE promo_codes SET used_count = used_count + 1 WHERE code = $1', [p.code]);
  return c;
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
  // คูปอง: ตรวจกับ server ทุกครั้ง · ต้องเป็นของสมาชิกคนนี้ ยังไม่ใช้ ไม่หมดอายุ และใช้กับแบรนด์นี้ได้
  let discount = 0; const used = [];
  const ids = (s.couponIds || []).map((x) => parseInt(String(x).replace(/\D/g, ''), 10)).filter(Number.isFinite);
  if (ids.length) {
    if (!member) throw bad('coupon_needs_member', 'ต้องระบุสมาชิกก่อนใช้คูปอง');
    const cs = await db.q(`SELECT c.*, t.discount_type, t.discount_value, t.min_spend, t.title FROM member_coupons c JOIN coupon_templates t ON t.id = c.template_id
                           WHERE c.id = ANY($1::bigint[]) ORDER BY c.id FOR UPDATE OF c`, [ids]);
    for (const c of cs) {
      if (c.member_id !== member.id) throw bad('coupon_not_owner', 'คูปอง ' + c.code + ' ไม่ใช่ของสมาชิกนี้');
      if (c.status !== 'ready' || c.expires_at < new Date()) throw conflict('coupon_unusable', 'คูปอง ' + c.code + ' ใช้แล้วหรือหมดอายุ');
      if (c.brand_id && c.brand_id !== br.brand_id) throw bad('coupon_wrong_brand', 'คูปอง ' + c.code + ' ใช้กับแบรนด์นี้ไม่ได้');
      const d = couponDiscount(c, subtotal - discount);
      if (d <= 0) throw bad('coupon_min_spend', 'ยอดยังไม่ถึงขั้นต่ำของคูปอง ' + c.code);
      discount += d; used.push(c);
    }
  }
  const total = Math.max(0, Math.round((subtotal - discount) * 100) / 100);
  const rule = await currentRule(db, br.brand_id);
  const points = member && br.earn_enabled ? calcPoints(rule, { subtotal, total }) : 0;

  const txn = await db.one(
    `INSERT INTO sales_transactions (pos_bill_id, branch_id, brand_id, member_id, channel, subtotal, discount, total, points_earned, rule_id, staff_id, items)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (branch_id, pos_bill_id) DO NOTHING RETURNING *`,
    [s.posBillId, s.branchId, br.brand_id, member?.id || null, s.channel || 'pos', subtotal, discount, total, points, rule?.id || null, s.staffId || null, JSON.stringify(items)]);
  if (!txn) return { duplicate: true, txn: await db.one('SELECT * FROM sales_transactions WHERE branch_id = $1 AND pos_bill_id = $2', [s.branchId, s.posBillId]) };

  for (const c of used) await db.q("UPDATE member_coupons SET status = 'used', used_at = now(), used_txn_id = $2, used_branch_id = $3, used_by = $4 WHERE id = $1", [c.id, txn.id, s.branchId, s.staffId || null]);
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
    const ident = await db.one('SELECT line_user_id FROM member_line_identities WHERE member_id = $1 ORDER BY linked_at DESC LIMIT 1', [member.id]);
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
