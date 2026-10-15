// API หลังบ้าน · ตรวจตำแหน่ง + ขอบเขตแบรนด์/สาขาทุกครั้งฝั่ง server
import { q, one, tx } from '../db.js';
import { bad, notFound, HttpError } from '../http.js';
import { staffUser, loadStaff, requirePage, requireBrand, scopeBrands } from '../auth.js';
import { checkPassword, signToken, maskPhone } from '../util.js';
import * as core from '../services/core.js';
import { queueMessage } from '../services/line.js';
import { COUPON_SQL, couponView } from './liff.js';

const actor = (s) => ({ type: 'staff', id: s.id, name: s.name });

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
    return { token: signToken({ sid: s.id }), staff: st };
  });
  r.get('/api/admin/me', async (req) => staffUser(req));

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
    return q(`SELECT r.*, t.discount_type, t.discount_value, t.min_spend,
      (SELECT count(*) FROM member_coupons c WHERE c.source = 'redeem' AND c.template_id = r.coupon_template_id)::int AS redeemed
      FROM rewards r JOIN coupon_templates t ON t.id = r.coupon_template_id WHERE r.brand_id = ANY($1) ORDER BY r.brand_id, r.points_cost`, [s.brands]);
  });
  r.post('/api/admin/rewards', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'rewards'); requireBrand(s, b.brand);
    if (!String(b.name || '').trim() || !(Number(b.cost) > 0)) throw bad('reward_invalid', 'ใส่ชื่อรางวัลและแต้มที่ใช้');
    return tx(async (db) => {
      const isDisc = b.cat === 'discount';
      const t = await db.one(`INSERT INTO coupon_templates (brand_id, title, badge_big, badge_small, condition_text, discount_type, discount_value, min_spend, valid_days)
        VALUES ($1,$2,$3,$4,$5,'baht',$6,$7,30) RETURNING id`, [b.brand, b.name, isDisc ? '-' + Number(b.value || 0) : 'ฟรี', isDisc ? 'บาท' : 'แลกแต้ม', 'แลกด้วย ' + b.cost + ' แต้ม', Number(b.value || 0), Number(b.min || 0)]);
      const rw = await db.one('INSERT INTO rewards (brand_id, name, category, points_cost, coupon_template_id, stock) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [b.brand, b.name, b.cat || 'food', Number(b.cost), t.id, b.stock === '' || b.stock == null ? null : Number(b.stock)]);
      await core.audit(db, actor(s), 'create_reward', { type: 'reward', id: String(rw.id) }, b.brand + ' · ' + b.name);
      return rw;
    });
  });
  r.patch('/api/admin/rewards/:id', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const rw = await one('SELECT * FROM rewards WHERE id = $1', [parseInt(p.id.replace(/\D/g, ''), 10)]);
    if (!rw) throw notFound(); requireBrand(s, rw.brand_id);
    return tx(async (db) => {
      const out = await db.one('UPDATE rewards SET is_active = COALESCE($2, is_active), stock = COALESCE($3, stock), points_cost = COALESCE($4, points_cost) WHERE id = $1 RETURNING *',
        [rw.id, b.active ?? null, b.stock ?? null, b.cost ?? null]);
      await core.audit(db, actor(s), 'update_reward', { type: 'reward', id: String(rw.id) }, rw.name + (b.active !== undefined ? ' active=' + b.active : ''), rw, out);
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
    return q("SELECT st.id, st.name, st.role, st.email, st.is_active, json_agg(json_build_object('type', sc.scope_type, 'id', sc.scope_id)) AS scopes FROM staff st LEFT JOIN staff_scopes sc ON sc.staff_id = st.id GROUP BY st.id ORDER BY st.id");
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
