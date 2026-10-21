// เฉพาะ DEV_MODE=1: ให้หน้าเดโม (demo/) ทำงานกับฐานข้อมูลจริง
// - snapshot: ข้อมูลทั้งหมดในรูปเดียวกับ mock store ของเดโม (ใช้ได้เพราะข้อมูลทดสอบมีไม่มาก)
// - line-event: จำลองลูกค้าแชทกับ OA โดยไม่ต้องมีลายเซ็นจาก LINE
// ห้ามเปิดใน production: route เหล่านี้ไม่ถูกลงทะเบียนเมื่อ DEV_MODE ไม่ใช่ 1
import { q, one, tx } from '../db.js';
import { bad } from '../http.js';
import { qrToken } from '../util.js';
import { apiRows, clearApi } from '../apilog.js';
import { handleEvent } from '../services/line.js';
import { migrate } from '../../scripts/migrate.js';
import { seed } from '../../scripts/seed.js';
import { COUPON_SQL, couponView } from './liff.js';

export const DEMO_USER = 'Udemo00000000000000000000000001';
const ms = (d) => (d ? +new Date(d) : null);

export default function (r) {
  r.get('/api/dev/snapshot', async (_req, _b, url) => {
    const lineUserId = url.searchParams.get('lineUserId') || DEMO_USER;
    const rules = {};
    for (const x of await q('SELECT * FROM earn_rules WHERE effective_to IS NULL')) {
      rules[x.brand_id] = { baht: x.baht_per_unit, pts: x.points_per_unit, base: x.base_amount, rounding: x.rounding, expiryMonths: x.expiry_months, welcome: x.welcome_points,
        backdays: x.backdate_days, tiers: { gold: x.gold_at, platinum: x.platinum_at, diamond: x.diamond_at }, promo: { on: x.promo_on, mult: x.promo_mult, day: x.promo_day } };
    }
    const branches = (await q("SELECT *, to_char(open_time,'HH24:MI') AS o, to_char(close_time,'HH24:MI') AS c FROM branches ORDER BY id")).map((b) => ({
      id: b.id, brand: b.brand_id, name: b.name, open: b.o, close: b.c, phone: b.phone, earn: b.earn_enabled,
      pos: b.pos_mode === 'manual' ? 'manual' : (!b.pos_last_seen || Date.now() - ms(b.pos_last_seen) < 7 * 864e5 ? 'online' : 'delayed') }));
    const rewards = (await q('SELECT r.*, t.discount_type, t.discount_value, t.min_spend FROM rewards r JOIN coupon_templates t ON t.id = r.coupon_template_id ORDER BY r.brand_id, r.points_cost')).map((x) => ({
      id: String(x.id), brand: x.brand_id, name: x.name, cost: x.points_cost, cat: x.category, stock: x.stock ?? 9999, active: x.is_active, cp: { kind: x.discount_type, value: x.discount_value, min: x.min_spend } }));
    const staff = (await q('SELECT s.id, s.name, s.role, sc.scope_type, sc.scope_id FROM staff s LEFT JOIN staff_scopes sc ON sc.staff_id = s.id ORDER BY s.id')).map((s) => ({
      id: s.id, name: s.name, role: s.role, scope: s.scope_type === 'group' ? 'ทั้งเครือ' : s.scope_id }));
    const links = await q('SELECT * FROM member_brand_links');
    const idents = await q('SELECT DISTINCT ON (member_id) member_id, line_user_id FROM member_line_identities ORDER BY member_id, linked_at DESC');
    const members = (await q("SELECT * FROM members WHERE status = 'active' ORDER BY created_at")).map((m) => {
      const mine = links.filter((l) => l.member_id === m.id);
      return { id: m.id, name: m.full_name, phone: m.phone, birthday: m.birth_date ? new Date(m.birth_date).toISOString().slice(0, 10) : '', homeBranch: m.home_branch_id, joinedBrand: m.joined_brand_id,
        joinedAt: ms(m.created_at), lineUserId: (idents.find((i) => i.member_id === m.id) || {}).line_user_id || '',
        consent: { privacy: true, mkt: Object.fromEntries(mine.map((l) => [l.brand_id, l.marketing_consent])) },
        follow: Object.fromEntries(mine.filter((l) => l.follow_status !== 'none').map((l) => [l.brand_id, l.follow_status])) };
    });
    const ledger = (await q('SELECT * FROM point_ledger ORDER BY created_at, id')).map((l) => ({ id: 'L' + l.id, at: ms(l.created_at), memberId: l.member_id, brand: l.brand_id, branch: l.branch_id,
      type: l.entry_type, pts: l.points, note: l.note, ref: l.ref_id, by: l.actor_id || l.actor_type }));
    const used = await q('SELECT id, used_txn_id FROM member_coupons WHERE used_txn_id IS NOT NULL');
    const bills = (await q('SELECT * FROM sales_transactions ORDER BY paid_at, id')).map((b) => ({ id: b.pos_bill_id, brand: b.brand_id, branch: b.branch_id, memberId: b.member_id, items: b.items,
      subtotal: b.subtotal, discount: b.discount, total: b.total, pts: b.points_earned, at: ms(b.paid_at), channel: b.channel, status: b.status === 'refunded' ? 'refunded' : 'paid',
      coupons: used.filter((c) => c.used_txn_id === b.id).map((c) => String(c.id)), staff: b.staff_id }));
    const coupons = (await q(COUPON_SQL + ' ORDER BY c.id')).map((c) => ({ ...couponView(c), memberId: c.member_id }));
    const requests = (await q('SELECT r.*, a.name AS by_name, d.name AS decided_name FROM point_adjust_requests r LEFT JOIN staff a ON a.id = r.requested_by LEFT JOIN staff d ON d.id = r.decided_by ORDER BY r.id DESC')).map((x) => ({
      id: 'REQ-' + x.id, at: ms(x.created_at), memberId: x.member_id, brand: x.brand_id, branch: x.branch_id, pts: x.points, reason: x.reason, by: x.by_name || x.requested_by, byId: x.requested_by,
      status: x.status, decidedBy: x.decided_name || x.decided_by }));
    const broadcasts = (await q('SELECT c.*, t.title, s.name AS by_name FROM campaigns c LEFT JOIN coupon_templates t ON t.id = c.coupon_template_id LEFT JOIN staff s ON s.id = c.created_by ORDER BY c.id DESC')).map((c) => ({
      id: 'BC-' + c.id, at: ms(c.created_at), brand: c.brand_id, segment: c.segment, text: c.message_text, recipients: c.recipients, coupon: c.title || null, by: c.by_name || c.created_by }));
    const audit = (await q('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 200')).map((a) => ({ at: ms(a.at), actor: a.actor_name || a.actor_id || a.actor_type, action: a.action, detail: a.detail }));

    const chats = {};
    const brandIds = (await q('SELECT id FROM brands ORDER BY id')).map((b) => b.id);
    for (const b of brandIds) {
      const rows = await q('SELECT * FROM line_messages WHERE line_user_id = $1 AND brand_id = $2 ORDER BY id DESC LIMIT 40', [lineUserId, b]);
      chats[b] = rows.reverse().map((m, i, arr) => m.direction === 'in'
        ? { from: 'me', kind: 'text', text: m.data.text, at: ms(m.created_at) }
        : { from: 'oa', kind: m.kind, ...m.data, quick: i === arr.length - 1 ? m.data.quick || null : null, at: ms(m.created_at), status: m.status });
    }
    const followed = Object.fromEntries((await q("SELECT brand_id FROM line_followers WHERE line_user_id = $1 AND status = 'follow'", [lineUserId])).map((f) => [f.brand_id, true]));
    const me = await one("SELECT m.id FROM member_line_identities i JOIN members m ON m.id = i.member_id WHERE i.line_user_id = $1 AND m.status = 'active'", [lineUserId]);
    return { v: 1, live: true, rules, branches, rewards, staff, members, ledger, bills, coupons, requests, broadcasts, audit, api: apiRows(), chats,
      demo: { lineUserId, displayName: 'ลูกค้าทดลอง', memberId: me ? me.id : null, followed }, qr: me ? qrToken(me.id) : null };
  });

  // จำลองลูกค้ากด Rich Menu / พิมพ์ / แอดเพื่อน OA (เส้นทางเดียวกับ webhook จริง แต่ไม่ต้องมีลายเซ็น)
  r.post('/api/dev/line-event', async (_req, b) => {
    if (!['follow', 'unfollow', 'message'].includes(b.type)) throw bad('type_invalid');
    const ev = { type: b.type, webhookEventId: 'dev-' + Date.now() + '-' + Math.random().toString(36).slice(2), timestamp: Date.now(),
      source: { type: 'user', userId: b.lineUserId || DEMO_USER }, ...(b.type === 'message' ? { message: { type: 'text', text: String(b.text || '') } } : {}) };
    if (b.type === 'follow' && b.onlyIfNew) {
      const seen = await one('SELECT 1 FROM line_followers WHERE line_user_id = $1 AND brand_id = $2', [ev.source.userId, b.brand]);
      if (seen) return { skipped: true };
    }
    return tx((db) => handleEvent(db, b.brand, ev));
  }, (b) => b.type + (b.text ? ':' + b.text : '') + ' → ' + b.brand);

  // ล้างฐานข้อมูลแล้วใส่ข้อมูลตัวอย่างใหม่ (ปุ่ม "ล้างข้อมูลทดสอบ" ในหน้าเดโม)
  r.post('/api/dev/reset', async () => { await migrate({ reset: true, quiet: true }); await seed({ demo: true, quiet: true }); clearApi(); return { ok: true }; });

  r.post('/api/dev/clear-log', async () => { clearApi(); return { ok: true }; });
}
