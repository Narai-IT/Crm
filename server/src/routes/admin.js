// API หลังบ้าน · ตรวจตำแหน่ง + ขอบเขตแบรนด์/สาขาทุกครั้งฝั่ง server
import { q, one, tx } from '../db.js';
import { bad, notFound, HttpError } from '../http.js';
import { staffUser, loadStaff, requirePage, requireBrand, scopeBrands, ROLE_PAGES, ROLE_NAMES, ROLE_SCOPE } from '../auth.js';
import { checkPassword, hashPassword, signToken, maskPhone } from '../util.js';
import * as core from '../services/core.js';
import { queueMessage } from '../services/line.js';
import { COUPON_SQL, couponView } from './liff.js';

const actor = (s) => ({ type: 'staff', id: s.id, name: s.name });


function checkNewPassword(pw, id) {
  pw = String(pw || '');
  if (pw.length < 8) throw bad('password_short', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if (pw.toLowerCase() === String(id).toLowerCase() || ['admin', 'password', '12345678', 'demo1234'].includes(pw.toLowerCase())) throw bad('password_weak', 'รหัสผ่านนี้เดาง่ายเกินไป');
  return pw;
}
// ตรวจตำแหน่ง + ขอบเขต: ผู้ดูแลระบบ/การตลาด = ทั้งเครือ · ผู้จัดการแบรนด์ = แบรนด์ · ผู้จัดการสาขา/แคชเชียร์ = สาขา
async function staffFields(b, keepScopes) {
  const name = String(b.name || '').trim();
  if (!name) throw bad('name_required', 'ใส่ชื่อพนักงาน');
  if (!ROLE_PAGES[b.role]) throw bad('role_invalid', 'เลือกตำแหน่ง');
  const scope = ROLE_SCOPE[b.role];
  const email = String(b.email || '').trim() || null;
  if (keepScopes) return { name, role: b.role, email, scope, scopeIds: null, limit: null };
  let ids = scope === 'group' ? ['*'] : [...new Set((b.scopeIds || []).map(String))];
  if (scope !== 'group') {
    if (!ids.length) throw bad('scope_required', scope === 'brand' ? 'เลือกแบรนด์ที่ดูแลอย่างน้อย 1 แบรนด์' : 'เลือกสาขาอย่างน้อย 1 สาขา');
    const ok = await q(scope === 'brand' ? 'SELECT id FROM brands WHERE id = ANY($1)' : 'SELECT id FROM branches WHERE id = ANY($1)', [ids]);
    if (ok.length !== ids.length) throw bad('scope_invalid', 'มีแบรนด์หรือสาขาที่ไม่ถูกต้อง');
  }
  const limit = b.role === 'branchmgr' ? (b.approveLimit === '' || b.approveLimit == null ? 200 : Math.max(0, parseInt(b.approveLimit, 10) || 0)) : null;
  return { name, role: b.role, email, scope, scopeIds: ids, limit };
}
async function setScopes(db, id, f) {
  if (!f.scopeIds) {
    // เปลี่ยนตำแหน่งโดยไม่ได้ส่งขอบเขตมา: ใช้ได้เฉพาะตำแหน่งที่ขอบเขตแบบเดิม
    const cur = await db.q('SELECT scope_type, scope_id, approve_limit FROM staff_scopes WHERE staff_id = $1', [id]);
    if (cur.some((c) => c.scope_type !== f.scope)) throw bad('scope_required', 'ตำแหน่งใหม่ต้องเลือกขอบเขตใหม่');
    if (f.role !== 'branchmgr') await db.q('UPDATE staff_scopes SET approve_limit = NULL WHERE staff_id = $1', [id]);
    return;
  }
  await db.q('DELETE FROM staff_scopes WHERE staff_id = $1', [id]);
  for (const sid of f.scopeIds) await db.q('INSERT INTO staff_scopes (staff_id, scope_type, scope_id, approve_limit) VALUES ($1,$2,$3,$4)', [id, f.scope, sid, f.limit]);
}

const CATS = ['food', 'side', 'drink', 'discount'];
const optInt = (v) => (v === '' || v === null || v === undefined ? null : Math.max(0, parseInt(v, 10) || 0));
const endOfDay = (d) => { const x = new Date(String(d).length <= 10 ? d + 'T23:59:59+07:00' : d); if (isNaN(x)) throw bad('date_invalid', 'วันที่ไม่ถูกต้อง'); return x; };
function couponFields(b) {
  const type = b.type === 'pct' ? 'pct' : 'baht';
  const value = Number(b.value);
  if (!(value > 0) || (type === 'pct' && value > 100)) throw bad('coupon_invalid', 'ใส่มูลค่าส่วนลดให้ถูกต้อง');
  return { title: String(b.title || '').trim(), type, value, min: Math.max(0, Number(b.min) || 0), days: Math.min(365, Math.max(1, parseInt(b.days, 10) || 30)) };
}
const defaultTitle = (f) => 'ส่วนลด ' + f.value + (f.type === 'pct' ? '%' : ' บาท') + (f.min ? ' เมื่อซื้อครบ ' + f.min + ' บาท' : '');
function rewardFields(b) {
  const name = String(b.name || '').trim(); const cost = parseInt(b.cost, 10);
  if (!name || !(cost > 0)) throw bad('reward_invalid', 'ใส่ชื่อรางวัลและแต้มที่ใช้');
  const cat = CATS.includes(b.cat) ? b.cat : 'food';
  const type = cat === 'discount' && b.type === 'pct' ? 'pct' : 'baht'; const value = Math.max(0, Number(b.value) || 0);
  if (cat === 'discount' && !(value > 0)) throw bad('reward_invalid', 'รางวัลแบบส่วนลด ต้องใส่มูลค่าส่วนลด');
  return { name, cost, cat, type, value, min: Math.max(0, Number(b.min) || 0), days: Math.min(365, Math.max(1, parseInt(b.days, 10) || 30)), stock: optInt(b.stock) };
}
// รางวัลแบบของฟรี: คูปองลดเท่าราคาของชิ้นนั้น (value) · แบบส่วนลด: ลดตามที่ตั้ง
const rewardTemplate = (f) => f.cat === 'discount'
  ? { title: f.name, big: f.type === 'pct' ? '-' + f.value + '%' : '-' + f.value, small: f.type === 'pct' ? 'ส่วนลด' : 'บาท', cond: 'แลกด้วย ' + f.cost + ' แต้ม' + (f.min ? ' · ซื้อครบ ' + f.min + ' บาท' : ''), type: f.type, value: f.value, min: f.min, days: f.days }
  : { title: f.name, big: 'ฟรี', small: 'แลกแต้ม', cond: 'แลกด้วย ' + f.cost + ' แต้ม', type: 'baht', value: f.value, min: f.min, days: f.days };
async function newTemplate(db, brandId, t) {
  const big = t.big || (t.type === 'pct' ? '-' + t.value + '%' : '-' + t.value);
  const small = t.small || (t.type === 'pct' ? 'ส่วนลด' : 'บาท');
  return (await db.one(`INSERT INTO coupon_templates (brand_id, title, badge_big, badge_small, condition_text, discount_type, discount_value, min_spend, valid_days)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [brandId, t.title, big, small, t.cond || '', t.type, t.value, t.min || 0, t.days || 30])).id;
}

// กลุ่มเป้าหมายแคมเปญ: ต้องติดตาม OA ของแบรนด์ + ยินยอมรับข่าวสารของแบรนด์นั้นเสมอ
export function audienceSql(segment) {
  const base = `SELECT m.id, i.line_user_id FROM members m
    JOIN member_brand_links l ON l.member_id = m.id AND l.brand_id = $1 AND l.follow_status = 'follow' AND l.marketing_consent
    JOIN LATERAL (SELECT line_user_id FROM member_line_identities WHERE member_id = m.id ORDER BY linked_at DESC LIMIT 1) i ON true
    WHERE m.status = 'active'`;
  const seg = {
    all: '',
    new: " AND m.created_at > now() - interval '30 days'",
    gold: " AND (SELECT COALESCE(sum(points),0) FROM point_ledger p WHERE p.member_id = m.id AND p.brand_id = $1 AND p.points > 0 AND p.created_at > now() - interval '365 days') >= (SELECT gold_at FROM earn_rules WHERE brand_id = $1 AND effective_to IS NULL)",
    lapsed: " AND NOT EXISTS (SELECT 1 FROM sales_transactions s WHERE s.member_id = m.id AND s.brand_id = $1 AND s.status <> 'void' AND s.paid_at > now() - interval '30 days')",
    cross: " AND NOT EXISTS (SELECT 1 FROM sales_transactions s WHERE s.member_id = m.id AND s.brand_id = $1) AND EXISTS (SELECT 1 FROM sales_transactions s WHERE s.member_id = m.id AND s.brand_id <> $1)"
  }[segment];
  if (seg === undefined) throw bad('segment_invalid', 'ไม่รู้จักกลุ่มเป้าหมายนี้');
  return base + seg;
}

export default function (r) {
  r.post('/api/admin/login', async (_req, body) => {
    const s = await one('SELECT id, password_hash FROM staff WHERE (id = $1 OR email = $1) AND is_active', [String(body.username || '')]);
    if (!s || !checkPassword(String(body.password || ''), s.password_hash)) throw new HttpError(401, 'login_failed', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    const st = await loadStaff(s.id);
    if (!st.pages.length) throw new HttpError(403, 'forbidden', 'ตำแหน่งนี้ไม่มีสิทธิ์เข้าหลังบ้าน');
    await q('UPDATE staff SET last_login_at = now() WHERE id = $1', [s.id]);
    return { token: signToken({ sid: s.id }), staff: st };
  });
  r.get('/api/admin/me', async (req) => staffUser(req));
  // เปลี่ยนรหัสผ่านตัวเอง (บังคับครั้งแรกสำหรับรหัสเริ่มต้น/รหัสชั่วคราว)
  r.post('/api/admin/password', async (req, b) => {
    const s = await staffUser(req);
    const row = await one('SELECT password_hash FROM staff WHERE id = $1', [s.id]);
    if (!checkPassword(String(b.current || ''), row.password_hash)) throw bad('wrong_password', 'รหัสผ่านเดิมไม่ถูกต้อง');
    const pw = checkNewPassword(b.password, s.id);
    if (checkPassword(pw, row.password_hash)) throw bad('same_password', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
    await tx(async (db) => {
      await db.q('UPDATE staff SET password_hash = $2, must_change_password = false WHERE id = $1', [s.id, hashPassword(pw)]);
      await core.audit(db, actor(s), 'change_password', { type: 'staff', id: s.id }, 'เปลี่ยนรหัสผ่านตัวเอง');
    });
    return { ok: true, staff: await loadStaff(s.id) };
  });

  r.get('/api/admin/dashboard', async (req, _b, url) => {
    const s = await staffUser(req); requirePage(s, 'dash');
    const bs = scopeBrands(s, url.searchParams.get('brand'));
    const k = await one(`
      WITH mem AS (SELECT DISTINCT member_id FROM point_ledger WHERE brand_id = ANY($1)),
           paid AS (SELECT * FROM sales_transactions WHERE brand_id = ANY($1) AND status IN ('paid','partial_refund')),
           buyers AS (SELECT member_id, count(*) n, max(paid_at) last FROM paid WHERE member_id IS NOT NULL GROUP BY member_id),
           brandsper AS (SELECT member_id, count(DISTINCT brand_id) nb FROM sales_transactions WHERE member_id IS NOT NULL AND status <> 'void' GROUP BY member_id)
      SELECT (SELECT count(*) FROM mem)::int AS total,
             (SELECT count(*) FROM members m JOIN mem ON mem.member_id = m.id WHERE m.created_at > now() - interval '30 days')::int AS new30,
             (SELECT count(*) FROM buyers WHERE last > now() - interval '30 days')::int AS active30,
             (SELECT count(*) FROM buyers)::int AS buyers,
             (SELECT count(*) FROM buyers WHERE n >= 2)::int AS repeaters,
             (SELECT count(*) FROM paid WHERE member_id IS NOT NULL)::int AS member_bills,
             (SELECT COALESCE(sum(total),0) FROM paid WHERE member_id IS NOT NULL) AS member_sales,
             (SELECT COALESCE(sum(total),0) FROM paid) AS all_sales,
             (SELECT count(*) FROM brandsper b JOIN mem ON mem.member_id = b.member_id WHERE nb > 1)::int AS cross_brand,
             (SELECT COALESCE(sum(points) FILTER (WHERE points > 0),0) FROM point_ledger WHERE brand_id = ANY($1)) AS issued,
             (SELECT COALESCE(-sum(points) FILTER (WHERE entry_type = 'redeem'),0) FROM point_ledger WHERE brand_id = ANY($1)) AS redeemed,
             (SELECT COALESCE(sum(balance),0) FROM wallets WHERE brand_id = ANY($1)) AS outstanding`, [bs]);
    const byBrand = await q(`SELECT b.id, (SELECT count(DISTINCT member_id) FROM point_ledger WHERE brand_id = b.id)::int AS members,
        (SELECT COALESCE(sum(total),0) FROM sales_transactions WHERE brand_id = b.id AND member_id IS NOT NULL AND status <> 'void') AS member_sales,
        (SELECT COALESCE(sum(total),0) FROM sales_transactions WHERE brand_id = b.id AND member_id IS NULL AND status <> 'void') AS other_sales
      FROM brands b WHERE b.id = ANY($1) ORDER BY b.id`, [bs]);
    const branches = await q(`SELECT br.id, br.name, br.pos_mode, br.pos_last_seen,
        (SELECT count(*) FROM members WHERE home_branch_id = br.id)::int AS home_members,
        count(s.*) FILTER (WHERE s.member_id IS NOT NULL)::int AS member_bills, count(s.*)::int AS bills,
        COALESCE(sum(s.total) FILTER (WHERE s.member_id IS NOT NULL),0) AS member_sales
      FROM branches br LEFT JOIN sales_transactions s ON s.branch_id = br.id AND s.status <> 'void'
      WHERE br.brand_id = ANY($1) ${s.branches ? 'AND br.id = ANY($2)' : ''} GROUP BY br.id ORDER BY br.id`, s.branches ? [bs, s.branches] : [bs]);
    return { kpi: k, byBrand, branches };
  });

  r.get('/api/admin/members', async (req, _b, url) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const bs = scopeBrands(s, url.searchParams.get('brand'));
    const term = String(url.searchParams.get('q') || '').trim();
    const rows = await q(`SELECT m.id, m.full_name, m.phone, m.created_at,
        (SELECT json_object_agg(w.brand_id, w.balance) FROM wallets w WHERE w.member_id = m.id) AS wallets
      FROM members m WHERE m.status = 'active' AND EXISTS (SELECT 1 FROM point_ledger l WHERE l.member_id = m.id AND l.brand_id = ANY($1))
        AND ($2 = '' OR m.id ILIKE '%' || $2 || '%' OR m.full_name ILIKE '%' || $2 || '%' OR m.phone LIKE '%' || $2 || '%')
      ORDER BY m.created_at DESC LIMIT 200`, [bs, term]);
    return rows.map((m) => ({ ...m, phone: s.fullPii ? m.phone : maskPhone(m.phone) }));
  });

  r.get('/api/admin/members/:id', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const m = await one('SELECT * FROM members WHERE id = $1', [p.id]);
    if (!m) throw notFound('ไม่พบสมาชิก');
    const inScope = await one('SELECT 1 FROM point_ledger WHERE member_id = $1 AND brand_id = ANY($2) LIMIT 1', [m.id, s.brands]);
    if (!inScope) throw new HttpError(403, 'forbidden', 'สมาชิกนี้ไม่อยู่ในแบรนด์ที่คุณดูแล');
    return {
      member: { ...m, phone: s.fullPii ? m.phone : maskPhone(m.phone) },
      wallets: await core.walletsOf({ q, one }, m.id),
      links: await q('SELECT * FROM member_brand_links WHERE member_id = $1', [m.id]),
      ledger: await q('SELECT * FROM point_ledger WHERE member_id = $1 AND brand_id = ANY($2) ORDER BY id DESC LIMIT 50', [m.id, s.brands]),
      coupons: (await q(COUPON_SQL + ' WHERE c.member_id = $1 AND (c.brand_id = ANY($2) OR c.brand_id IS NULL) ORDER BY c.id DESC', [m.id, s.brands])).map(couponView),
      bills: await q('SELECT pos_bill_id, branch_id, brand_id, total, points_earned, status, paid_at FROM sales_transactions WHERE member_id = $1 AND brand_id = ANY($2) ORDER BY paid_at DESC LIMIT 50', [m.id, s.brands])
    };
  });

  r.get('/api/admin/point-adjustments', async (req) => {
    const s = await staffUser(req); requirePage(s, 'approvals');
    return q('SELECT r.*, st.name AS requested_by_name FROM point_adjust_requests r LEFT JOIN staff st ON st.id = r.requested_by WHERE r.brand_id = ANY($1) ORDER BY r.id DESC LIMIT 200', [s.brands]);
  });
  r.post('/api/admin/point-adjustments', async (req, body) => {
    const s = await staffUser(req); requirePage(s, 'members'); requireBrand(s, body.brand);
    const pts = parseInt(body.points, 10);
    if (!pts || !String(body.reason || '').trim()) throw bad('invalid', 'ใส่จำนวนแต้มและเหตุผล');
    const row = await tx((db) => core.requestAdjust(db, { memberId: body.memberId, brandId: body.brand, branchId: body.branchId || null, points: pts, reason: String(body.reason).trim(), by: s }));
    return { requestId: row.id };
  });
  r.post('/api/admin/point-adjustments/:id/:decision', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'approvals');
    if (!['approve', 'reject'].includes(p.decision)) throw notFound();
    const rq = await one('SELECT * FROM point_adjust_requests WHERE id = $1', [parseInt(p.id.replace(/\D/g, ''), 10)]);
    if (!rq) throw notFound('ไม่พบคำขอ');
    requireBrand(s, rq.brand_id);
    if (s.branches && rq.branch_id && !s.branches.includes(rq.branch_id)) throw new HttpError(403, 'forbidden', 'คำขอนี้ไม่ใช่สาขาของคุณ');
    const lim = s.role === 'branchmgr' ? (await one('SELECT max(approve_limit) AS l FROM staff_scopes WHERE staff_id = $1', [s.id])).l : null;
    if (lim !== null && lim !== undefined && Math.abs(rq.points) > lim) throw new HttpError(403, 'over_limit', 'เกินวงเงินอนุมัติของคุณ (' + lim + ' แต้ม)');
    return tx((db) => core.decideAdjust(db, { id: rq.id, approve: p.decision === 'approve', by: s }));
  });

  r.get('/api/admin/earn-rules', async (req) => {
    const s = await staffUser(req); requirePage(s, 'rules');
    return q('SELECT * FROM earn_rules WHERE effective_to IS NULL AND brand_id = ANY($1) ORDER BY brand_id', [s.brands]);
  });
  // แก้กฎ = ปิดกฎเดิม (effective_to) แล้วเพิ่มกฎใหม่ · ย้อนดูได้ว่าบิลไหนใช้กฎไหน
  r.put('/api/admin/earn-rules/:brand', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rules'); requireBrand(s, p.brand);
    if (!(Number(b.baht) > 0) || !(Number(b.pts) >= 0)) throw bad('rule_invalid', 'อัตราแต้มไม่ถูกต้อง');
    return tx(async (db) => {
      const old = await db.one('UPDATE earn_rules SET effective_to = now() WHERE brand_id = $1 AND effective_to IS NULL RETURNING *', [p.brand]);
      const nw = await db.one(`INSERT INTO earn_rules (brand_id, baht_per_unit, points_per_unit, base_amount, rounding, expiry_months, welcome_points, backdate_days, gold_at, platinum_at, promo_on, promo_mult, promo_day, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [p.brand, b.baht, b.pts, b.base || 'net', b.rounding || 'floor', b.expiryMonths ?? 12, b.welcome ?? 0, b.backdays ?? 3, b.tiers?.gold ?? 0, b.tiers?.platinum ?? 0, !!b.promo?.on, b.promo?.mult ?? 2, b.promo?.day ?? 3, s.id]);
      await core.audit(db, actor(s), 'update_earn_rule', { type: 'brand', id: p.brand }, nw.baht_per_unit + ' บาท = ' + nw.points_per_unit + ' แต้ม · หมดอายุ ' + nw.expiry_months + ' เดือน' + (nw.promo_on ? ' · คูณ ' + nw.promo_mult : ''), old, nw);
      return nw;
    });
  });

  r.get('/api/admin/rewards', async (req) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    return q(`SELECT r.*, t.discount_type, t.discount_value, t.min_spend, t.valid_days,
      (SELECT count(*) FROM point_ledger l WHERE l.entry_type = 'redeem' AND l.ref_type = 'reward' AND l.ref_id = r.id::text)::int AS redeemed
      FROM rewards r JOIN coupon_templates t ON t.id = r.coupon_template_id WHERE r.brand_id = ANY($1) ORDER BY r.brand_id, r.is_active DESC, r.points_cost`, [s.brands]);
  });
  r.post('/api/admin/rewards', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'rewards'); requireBrand(s, b.brand);
    const f = rewardFields(b);
    return tx(async (db) => {
      const t = await newTemplate(db, b.brand, rewardTemplate(f));
      const rw = await db.one('INSERT INTO rewards (brand_id, name, category, points_cost, coupon_template_id, stock, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
        [b.brand, f.name, f.cat, f.cost, t, f.stock, b.active !== false]);
      await core.audit(db, actor(s), 'create_reward', { type: 'reward', id: String(rw.id) }, b.brand + ' · ' + f.name + ' · ' + f.cost + ' แต้ม');
      return rw;
    });
  });
  // แก้รางวัล: ถ้าเปลี่ยนชื่อ/ส่วนลด จะสร้างแม่แบบคูปองใหม่ คูปองที่ลูกค้าแลกไปแล้วยังใช้ตามเงื่อนไขเดิม
  r.patch('/api/admin/rewards/:id', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const rw = await one('SELECT r.*, t.discount_type, t.discount_value, t.min_spend, t.valid_days FROM rewards r JOIN coupon_templates t ON t.id = r.coupon_template_id WHERE r.id = $1', [parseInt(p.id.replace(/\D/g, ''), 10)]);
    if (!rw) throw notFound(); requireBrand(s, rw.brand_id);
    const f = rewardFields({
      name: b.name ?? rw.name, cat: b.cat ?? rw.category, cost: b.cost ?? rw.points_cost,
      value: b.value ?? rw.discount_value, type: b.type ?? rw.discount_type, min: b.min ?? rw.min_spend, days: b.days ?? rw.valid_days,
      stock: 'stock' in b ? b.stock : rw.stock
    });
    return tx(async (db) => {
      const changed = f.name !== rw.name || f.cat !== rw.category || f.value !== Number(rw.discount_value) || f.type !== rw.discount_type || f.min !== Number(rw.min_spend) || f.days !== rw.valid_days;
      const tpl = changed ? await newTemplate(db, rw.brand_id, rewardTemplate(f)) : rw.coupon_template_id;
      const out = await db.one('UPDATE rewards SET name = $2, category = $3, points_cost = $4, stock = $5, is_active = COALESCE($6, is_active), coupon_template_id = $7 WHERE id = $1 RETURNING *',
        [rw.id, f.name, f.cat, f.cost, f.stock, b.active ?? null, tpl]);
      await core.audit(db, actor(s), 'update_reward', { type: 'reward', id: String(rw.id) }, out.name + ' · ' + out.points_cost + ' แต้ม' + (out.is_active ? '' : ' · ปิดแลก'), rw, out);
      return out;
    });
  });

  // คูปองต้อนรับสมาชิกใหม่ + โค้ดคูปองที่ลูกค้ากรอกเอง
  r.get('/api/admin/coupons', async (req) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const welcome = await q(`SELECT b.id AS brand_id, b.name, t.id AS template_id, t.title, t.discount_type, t.discount_value, t.min_spend, t.valid_days
      FROM brands b LEFT JOIN coupon_templates t ON t.id = b.welcome_template_id WHERE b.id = ANY($1) ORDER BY b.id`, [s.brands]);
    const codes = await q(`SELECT p.*, t.title, t.discount_type, t.discount_value, t.min_spend, t.valid_days FROM promo_codes p JOIN coupon_templates t ON t.id = p.coupon_template_id
      WHERE p.brand_id = ANY($1) OR (p.brand_id IS NULL AND $2) ORDER BY (p.expires_at IS NULL OR p.expires_at > now()) DESC, p.code`, [s.brands, s.role === 'super']);
    return { welcome, codes };
  });
  r.put('/api/admin/welcome-coupon/:brand', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rewards'); requireBrand(s, p.brand);
    return tx(async (db) => {
      const old = await db.one('SELECT welcome_template_id FROM brands WHERE id = $1', [p.brand]);
      let tpl = null;
      if (!b.off) {
        const f = couponFields(b);
        tpl = await newTemplate(db, p.brand, { ...f, title: f.title || defaultTitle(f), cond: 'สำหรับสมาชิกใหม่ · 1 ครั้ง', small: 'บิลแรก' });
      }
      await db.q('UPDATE brands SET welcome_template_id = $2 WHERE id = $1', [p.brand, tpl]);
      await core.audit(db, actor(s), 'update_welcome_coupon', { type: 'brand', id: p.brand }, tpl ? 'คูปองต้อนรับ ' + (String(b.title || '').trim() || defaultTitle(couponFields(b))) : 'ปิดคูปองต้อนรับ', old, { welcome_template_id: tpl });
      return { templateId: tpl };
    });
  });
  r.post('/api/admin/promo-codes', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    if (b.brand) requireBrand(s, b.brand); else if (s.role !== 'super') throw new HttpError(403, 'forbidden', 'โค้ดที่ใช้ได้ทุกแบรนด์ สร้างได้เฉพาะผู้ดูแลกลุ่ม');
    const code = String(b.code || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4,20}$/.test(code)) throw bad('code_invalid', 'โค้ดต้องเป็นตัวอังกฤษหรือตัวเลข 4-20 ตัว');
    const f = couponFields(b);
    return tx(async (db) => {
      if (await db.one('SELECT 1 FROM promo_codes WHERE code = $1', [code])) throw new HttpError(409, 'code_exists', 'มีโค้ดนี้อยู่แล้ว');
      const tpl = await newTemplate(db, b.brand || null, { ...f, title: f.title || defaultTitle(f), cond: 'จากโค้ด ' + code + ' · ใช้ได้ 1 ครั้ง', small: 'โค้ดพิเศษ' });
      const row = await db.one('INSERT INTO promo_codes (code, brand_id, coupon_template_id, max_uses, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [code, b.brand || null, tpl, optInt(b.maxUses), b.expiresAt ? endOfDay(b.expiresAt) : null]);
      await core.audit(db, actor(s), 'create_promo_code', { type: 'promo_code', id: code }, (b.brand || 'ทุกแบรนด์') + ' · ' + defaultTitle(f));
      return row;
    });
  });
  r.patch('/api/admin/promo-codes/:code', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const pc = await one('SELECT * FROM promo_codes WHERE code = $1', [p.code.toUpperCase()]);
    if (!pc) throw notFound('ไม่พบโค้ด');
    if (pc.brand_id) requireBrand(s, pc.brand_id); else if (s.role !== 'super') throw new HttpError(403, 'forbidden', 'โค้ดนี้ใช้ได้ทุกแบรนด์ แก้ได้เฉพาะผู้ดูแลกลุ่ม');
    const exp = b.active === false ? new Date() : 'expiresAt' in b ? (b.expiresAt ? endOfDay(b.expiresAt) : null) : pc.expires_at;
    return tx(async (db) => {
      const out = await db.one('UPDATE promo_codes SET max_uses = $2, expires_at = $3 WHERE code = $1 RETURNING *', [pc.code, 'maxUses' in b ? optInt(b.maxUses) : pc.max_uses, exp]);
      await core.audit(db, actor(s), 'update_promo_code', { type: 'promo_code', id: pc.code }, b.active === false ? 'ปิดโค้ด' : 'แก้โค้ด', pc, out);
      return out;
    });
  });

  r.post('/api/admin/campaigns/preview', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'campaigns'); requireBrand(s, b.brand);
    const n = await one('SELECT count(*)::int AS n FROM (' + audienceSql(b.segment || 'all') + ') x', [b.brand]);
    const f = await one("SELECT count(*)::int AS n FROM member_brand_links WHERE brand_id = $1 AND follow_status = 'follow'", [b.brand]);
    return { recipients: n.n, followers: f.n };
  });
  r.get('/api/admin/campaigns', async (req) => {
    const s = await staffUser(req); requirePage(s, 'campaigns');
    return q('SELECT c.*, t.title AS coupon_title, st.name AS created_by_name FROM campaigns c LEFT JOIN coupon_templates t ON t.id = c.coupon_template_id LEFT JOIN staff st ON st.id = c.created_by WHERE c.brand_id = ANY($1) ORDER BY c.id DESC', [s.brands]);
  });
  r.post('/api/admin/campaigns', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'campaigns'); requireBrand(s, b.brand);
    if (!String(b.text || '').trim()) throw bad('text_required', 'ใส่ข้อความ');
    return tx(async (db) => {
      let tplId = null;
      if (b.coupon) {
        const v = Number(b.couponValue);
        if (!(v > 0)) throw bad('coupon_invalid', 'ใส่มูลค่าคูปอง');
        tplId = (await db.one(`INSERT INTO coupon_templates (brand_id, title, badge_big, badge_small, condition_text, discount_type, discount_value, valid_days)
          VALUES ($1,$2,$3,'บาท','จากแคมเปญ','baht',$4,14) RETURNING id`, [b.brand, b.couponTitle || 'ส่วนลด ' + v + ' บาท', '-' + v, v])).id;
      }
      const list = await db.q(audienceSql(b.segment || 'all'), [b.brand]);
      const c = await db.one('INSERT INTO campaigns (brand_id, segment, message_text, coupon_template_id, recipients, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [b.brand, b.segment || 'all', b.text, tplId, list.length, s.id]);
      for (const m of list) {
        await db.q('INSERT INTO campaign_recipients (campaign_id, member_id, line_user_id) VALUES ($1,$2,$3)', [c.id, m.id, m.line_user_id]);
        if (tplId) await core.issueCoupon(db, { memberId: m.id, templateId: tplId, source: 'campaign', sourceRef: c.id });
        await queueMessage(db, { brandId: b.brand, lineUserId: m.line_user_id, kind: 'broadcast', data: { text: b.text, coupon: tplId ? (b.couponTitle || null) : null, campaignId: c.id } });
      }
      await core.audit(db, actor(s), 'send_campaign', { type: 'campaign', id: String(c.id) }, b.brand + ' · ' + b.segment + ' · ' + list.length + ' คน');
      return { id: c.id, recipients: list.length };
    });
  }, (b, out) => 'ส่งถึง ' + (out?.recipients ?? 0) + ' คน');

  r.get('/api/admin/branches', async (req) => {
    const s = await staffUser(req);
    return q('SELECT * FROM branches WHERE brand_id = ANY($1) ORDER BY id', [s.brands]);
  });
  r.patch('/api/admin/branches/:id', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'branches');
    const br = await one('SELECT * FROM branches WHERE id = $1', [p.id]);
    if (!br) throw notFound(); requireBrand(s, br.brand_id);
    return tx(async (db) => {
      const out = await db.one('UPDATE branches SET earn_enabled = COALESCE($2, earn_enabled) WHERE id = $1 RETURNING *', [p.id, b.earnEnabled ?? null]);
      await core.audit(db, actor(s), 'update_branch', { type: 'branch', id: p.id }, br.name + ' สะสมแต้ม = ' + (out.earn_enabled ? 'เปิด' : 'ปิด'));
      return out;
    });
  });

  r.get('/api/admin/staff', async (req) => {
    const s = await staffUser(req); requirePage(s, 'staff');
    const rows = await q(`SELECT st.id, st.name, st.role, st.email, st.is_active, st.must_change_password, st.last_login_at, st.created_at,
        COALESCE(json_agg(json_build_object('type', sc.scope_type, 'id', sc.scope_id, 'limit', sc.approve_limit)) FILTER (WHERE sc.staff_id IS NOT NULL), '[]') AS scopes
      FROM staff st LEFT JOIN staff_scopes sc ON sc.staff_id = st.id GROUP BY st.id ORDER BY st.is_active DESC, st.id`);
    return { staff: rows, roles: Object.keys(ROLE_PAGES).map((k) => ({ id: k, name: ROLE_NAMES[k], scope: ROLE_SCOPE[k], pages: ROLE_PAGES[k] })) };
  });
  r.post('/api/admin/staff', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'staff');
    const id = String(b.id || '').trim();
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(id)) throw bad('id_invalid', 'ชื่อผู้ใช้ต้องเป็นตัวอังกฤษ/ตัวเลข 3-30 ตัว (ใช้ . _ - ได้)');
    const f = await staffFields(b);
    const pw = checkNewPassword(b.password, id);
    return tx(async (db) => {
      if (await db.one('SELECT 1 FROM staff WHERE lower(id) = lower($1)', [id])) throw new HttpError(409, 'staff_exists', 'มีชื่อผู้ใช้นี้แล้ว');
      if (f.email && await db.one('SELECT 1 FROM staff WHERE lower(email) = lower($1)', [f.email])) throw new HttpError(409, 'email_exists', 'อีเมลนี้มีผู้ใช้แล้ว');
      await db.q('INSERT INTO staff (id, name, role, email, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,true)', [id, f.name, f.role, f.email, hashPassword(pw)]);
      await setScopes(db, id, f);
      await core.audit(db, actor(s), 'create_staff', { type: 'staff', id }, f.name + ' · ' + ROLE_NAMES[f.role] + ' · ' + f.scopeIds.join(', '));
      return { id };
    });
  });
  r.patch('/api/admin/staff/:id', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'staff');
    const old = await one('SELECT id, name, role, email, is_active FROM staff WHERE id = $1', [p.id]);
    if (!old) throw notFound('ไม่พบผู้ใช้');
    const f = await staffFields({ name: b.name ?? old.name, role: b.role ?? old.role, email: 'email' in b ? b.email : old.email, scopeIds: b.scopeIds, approveLimit: b.approveLimit }, !b.scopeIds);
    const active = b.active ?? old.is_active;
    if (old.id === s.id && (!active || f.role !== 'super')) throw bad('self_lock', 'ปิดหรือลดสิทธิ์บัญชีที่ตัวเองใช้อยู่ไม่ได้');
    return tx(async (db) => {
      if (old.role === 'super' && (f.role !== 'super' || !active)) {
        const n = await db.one("SELECT count(*)::int AS n FROM staff WHERE role = 'super' AND is_active AND id <> $1", [old.id]);
        if (!n.n) throw bad('last_admin', 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
      }
      if (f.email && await db.one('SELECT 1 FROM staff WHERE lower(email) = lower($1) AND id <> $2', [f.email, old.id])) throw new HttpError(409, 'email_exists', 'อีเมลนี้มีผู้ใช้แล้ว');
      await db.q('UPDATE staff SET name = $2, role = $3, email = $4, is_active = $5 WHERE id = $1', [old.id, f.name, f.role, f.email, active]);
      if (b.scopeIds || f.role !== old.role) await setScopes(db, old.id, f);
      await core.audit(db, actor(s), 'update_staff', { type: 'staff', id: old.id }, f.name + ' · ' + ROLE_NAMES[f.role] + (active ? '' : ' · ปิดใช้งาน'), old, { ...f, is_active: active });
      return { id: old.id };
    });
  });
  // ตั้งรหัสผ่านชั่วคราวให้พนักงาน (เข้าครั้งถัดไปต้องเปลี่ยนเอง)
  r.post('/api/admin/staff/:id/password', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'staff');
    const pw = checkNewPassword(b.password, p.id);
    return tx(async (db) => {
      const row = await db.one('UPDATE staff SET password_hash = $2, must_change_password = $3 WHERE id = $1 RETURNING id', [p.id, hashPassword(pw), p.id !== s.id]);
      if (!row) throw notFound('ไม่พบผู้ใช้');
      await core.audit(db, actor(s), 'reset_password', { type: 'staff', id: p.id }, 'ตั้งรหัสผ่านใหม่');
      return { ok: true };
    });
  });
  r.get('/api/admin/audit-logs', async (req) => {
    const s = await staffUser(req); requirePage(s, 'audit');
    return q('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300');
  });
  r.get('/api/admin/line-channels', async (req) => {
    const s = await staffUser(req); requirePage(s, 'line');
    const rows = await q(`SELECT b.id, b.name, b.oa_basic_id, c.channel_id,
        (SELECT count(*) FROM line_followers f WHERE f.brand_id = b.id AND f.status = 'follow')::int AS followers,
        (SELECT count(*) FROM line_followers f WHERE f.brand_id = b.id AND f.status = 'blocked')::int AS blocked,
        (SELECT count(*) FROM line_messages m WHERE m.brand_id = b.id AND m.direction = 'out' AND m.created_at > date_trunc('month', now()))::int AS sent_this_month
      FROM brands b LEFT JOIN line_channels c ON c.brand_id = b.id WHERE b.id = ANY($1) ORDER BY b.id`, [s.brands]);
    return rows.map((x) => ({ ...x, configured: !!process.env['LINE_' + x.id.toUpperCase() + '_TOKEN'] }));
  });
}
