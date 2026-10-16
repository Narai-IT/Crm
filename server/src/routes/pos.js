// API หน้าร้าน (POS / Kiosk) · ยืนยันด้วย API key ต่อเครื่อง ซึ่งผูกกับสาขา
import { q, one, tx } from '../db.js';
import { bad, notFound, HttpError } from '../http.js';
import { posTerminal } from '../auth.js';
import { readQrToken, maskPhone } from '../util.js';
import * as core from '../services/core.js';
import { COUPON_SQL, couponView } from './liff.js';

export default function (r) {
  // ระบุสมาชิกจาก QR (หมุนทุก 60 วิ) / เลขสมาชิก / เบอร์โทร
  r.post('/api/pos/members/resolve', async (req, body) => {
    const t = await posTerminal(req);
    let m = null;
    const qv = String(body.qrToken || body.query || '').trim();
    if (qv.startsWith('QR.')) {
      const qr = readQrToken(qv);
      if (!qr) throw bad('qr_invalid', 'QR ไม่ถูกต้อง');
      if (qr.expired) throw new HttpError(410, 'qr_expired', 'QR หมดอายุ ให้ลูกค้าเปิดบัตรใหม่');
      m = await one("SELECT * FROM members WHERE id = $1 AND status = 'active'", [qr.memberId]);
    } else {
      const digits = qv.replace(/\D/g, '');
      if (!digits) throw bad('query_required', 'ใส่เลขสมาชิกหรือเบอร์โทร');
      m = await one("SELECT * FROM members WHERE status = 'active' AND (id = $1 OR phone = $2)", ['MB-' + digits.slice(-7).padStart(7, '0'), digits.length >= 9 ? digits : '-']);
    }
    if (!m) throw notFound('ไม่พบสมาชิก');
    await tx((db) => core.autoIssue(db, m.id, t.brandId));
    const w = (await core.walletsOf({ q, one }, m.id));
    const coupons = (await q(COUPON_SQL + " WHERE c.member_id = $1 AND c.status = 'ready' AND c.expires_at > now() AND (c.brand_id = $2 OR c.brand_id IS NULL) ORDER BY c.expires_at", [m.id, t.brandId])).map(couponView);
    return { member: { id: m.id, name: m.full_name, phone: maskPhone(m.phone) }, brand: t.brandId, balance: w[t.brandId].balance, tier: w[t.brandId].tier.name,
      otherBrands: Object.fromEntries(Object.entries(w).filter(([b]) => b !== t.brandId).map(([b, x]) => [b, x.balance])), coupons };
  }, (b, out) => out?.member?.id || '');

  // บิลชำระสำเร็จ · posBillId ใช้เป็น idempotency key: ส่งซ้ำได้ ไม่ให้แต้มซ้ำ
  r.post('/api/pos/transactions', async (req, body) => {
    const t = await posTerminal(req);
    if (!body.posBillId) throw bad('pos_bill_id_required', 'ต้องมีเลขบิล');
    const res = await tx((db) => core.recordSale(db, { branchId: t.branchId, terminalId: t.terminalId, staffId: body.staffId || t.staffId, posBillId: String(body.posBillId),
      memberId: body.memberId || null, items: body.items, couponIds: body.couponIds || [], channel: ['pos', 'kiosk'].includes(body.channel) ? body.channel : (t.kind === 'kiosk' ? 'kiosk' : 'pos'),
      storeDiscount: body.storeDiscount, paidTotal: body.paidTotal }));
    if (res.duplicate) return { duplicate: true, posBillId: res.txn.pos_bill_id, memberId: res.txn.member_id, points: res.txn.points_earned, total: res.txn.total };
    return { duplicate: false, posBillId: res.txn.pos_bill_id, memberId: res.txn.member_id, subtotal: res.txn.subtotal, discount: res.discount, total: res.txn.total, points: res.points, balance: res.balance, coupons: res.coupons.map(String) };
  }, (b, out) => out?.duplicate ? 'บิลนี้บันทึกแล้ว ไม่ให้แต้มซ้ำ' : '+' + (out?.points ?? 0) + ' แต้ม');

  r.post('/api/pos/refunds', async (req, body) => {
    const t = await posTerminal(req);
    const res = await tx((db) => core.refundSale(db, { branchId: t.branchId, posBillId: String(body.posBillId), posRefundId: body.posRefundId, amount: body.amount ?? null, by: body.staffId || t.staffId || t.terminalId }));
    return { duplicate: !!res.duplicate, pointsReversed: res.pointsReversed ?? res.refund.points_reversed, couponsReturned: res.couponsReturned ?? 0 };
  }, (b, out) => 'หักแต้มคืน ' + (out?.pointsReversed ?? 0) + ' · คืนคูปอง ' + (out?.couponsReturned ?? 0));

  r.post('/api/pos/point-requests', async (req, body) => {
    const t = await posTerminal(req);
    const pts = parseInt(body.points, 10);
    if (!pts || !String(body.reason || '').trim()) throw bad('invalid', 'ใส่จำนวนแต้มและเหตุผล');
    const by = body.staffId ? await one('SELECT id, name FROM staff WHERE id = $1', [body.staffId]) : null;
    const row = await tx((db) => core.requestAdjust(db, { memberId: body.memberId, brandId: t.brandId, branchId: t.branchId, points: pts, reason: String(body.reason).trim(),
      refPosBillId: body.refPosBillId, by: by || { id: t.terminalId, name: 'เครื่อง ' + t.terminalId } }));
    return { requestId: row.id, status: row.status };
  });

  r.get('/api/pos/bills', async (req) => {
    const t = await posTerminal(req);
    return q('SELECT pos_bill_id, member_id, total, points_earned, status, paid_at FROM sales_transactions WHERE branch_id = $1 ORDER BY paid_at DESC LIMIT 20', [t.branchId]);
  });
}
