// API หน้าร้าน (POS / Kiosk) · ยืนยันด้วย API key ต่อเครื่อง ซึ่งผูกกับสาขา
import { q, one, tx } from '../db.js';
import { bad, notFound, HttpError } from '../http.js';
import { posTerminal } from '../auth.js';
import { readQrToken, maskPhone, signToken, verifyToken } from '../util.js';
import * as core from '../services/core.js';
import { COUPON_SQL, couponView } from './liff.js';

export default function (r) {
  // ระบุสมาชิกจาก QR บัตรสมาชิก (หมุนทุก 60 วิ) / QR คูปอง (CP.HL-7JCQ หรือรหัสคูปอง) / เลขสมาชิก / เบอร์โทร
  // สแกนคูปอง = ได้ทั้งสมาชิก (สะสมแต้ม) และคูปองที่จะใช้กับบิลนี้ (scannedCoupon)
  r.post('/api/pos/members/resolve', async (req, body) => {
    const t = await posTerminal(req);
    let m = null; let scanned = null;
    const qv = String(body.qrToken || body.query || '').trim();
    const cpCode = /^(CP\.)?([A-Z0-9]{2}-[A-Z0-9]{4,8})$/i.exec(qv);
    if (cpCode) {
      const c = await one('SELECT id, code, member_id FROM member_coupons WHERE code = $1', [cpCode[2].toUpperCase()]);
      if (!c) throw notFound('ไม่พบคูปอง ' + cpCode[2].toUpperCase());
      m = await one("SELECT * FROM members WHERE id = $1 AND status = 'active'", [c.member_id]);
      scanned = String(c.id);
    } else if (qv.startsWith('QR.')) {
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
    // คูปองที่สแกนใช้ไม่ได้แล้ว (ใช้ไป/หมดอายุ/คนละแบรนด์) → บอกเหตุผล แต่ยังได้สมาชิกไปสะสมแต้ม
    let scannedCoupon = null;
    if (scanned) {
      const sc = await one(COUPON_SQL + ' WHERE c.id = $1', [scanned]);
      const v = couponView(sc);
      const ok = coupons.some((x) => x.id === v.id);
      scannedCoupon = { id: v.id, code: v.code, title: v.title, usable: ok,
        reason: ok ? null : v.status === 'used' ? 'คูปองนี้ใช้ไปแล้ว' : v.status === 'expired' ? 'คูปองนี้หมดอายุแล้ว' : 'คูปองนี้ใช้กับร้านนี้ไม่ได้' };
    }
    return { member: { id: m.id, name: m.full_name, phone: maskPhone(m.phone) }, brand: t.brandId, balance: w[t.brandId].balance, tier: w[t.brandId].tier.name,
      otherBrands: Object.fromEntries(Object.entries(w).filter(([b]) => b !== t.brandId).map(([b, x]) => [b, x.balance])), coupons, scannedCoupon };
  }, (b, out) => out?.member?.id || '');

  // บิลชำระสำเร็จ · posBillId ใช้เป็น idempotency key: ส่งซ้ำได้ ไม่ให้แต้มซ้ำ
  r.post('/api/pos/transactions', async (req, body) => {
    const t = await posTerminal(req);
    if (!body.posBillId) throw bad('pos_bill_id_required', 'ต้องมีเลขบิล');
    const res = await tx((db) => core.recordSale(db, { branchId: t.branchId, terminalId: t.terminalId, staffId: body.staffId || t.staffId, posBillId: String(body.posBillId),
      memberId: body.memberId || null, items: body.items, couponIds: body.couponIds || [], channel: ['pos', 'kiosk'].includes(body.channel) ? body.channel : (t.kind === 'kiosk' ? 'kiosk' : 'pos'),
      storeDiscount: body.storeDiscount, paidTotal: body.paidTotal, couponRef: body.couponRef ? String(body.couponRef) : null,
      couponDiscount: body.couponIds && body.couponIds.length && body.couponDiscount !== undefined ? body.couponDiscount : undefined }));
    if (res.duplicate) return { duplicate: true, posBillId: res.txn.pos_bill_id, memberId: res.txn.member_id, points: res.txn.points_earned, total: res.txn.total };
    return { duplicate: false, posBillId: res.txn.pos_bill_id, memberId: res.txn.member_id, subtotal: res.txn.subtotal, discount: res.discount, total: res.txn.total, points: res.points, balance: res.balance, coupons: res.coupons.map(String) };
  }, (b, out) => out?.duplicate ? 'บิลนี้บันทึกแล้ว ไม่ให้แต้มซ้ำ' : '+' + (out?.points ?? 0) + ' แต้ม');

  // ── คูปอง/แลกแต้มที่หน้าร้าน ──
  // หน้าลูกค้าสั่งเอง (requireVerify) ต้องมี verifyToken จากรหัสที่ส่งเข้า LINE ของสมาชิก · หน้าขายของพนักงานไม่ต้อง (พนักงานสแกนบัตร/ถามลูกค้าเอง)
  const memberOf = (body) => {
    const id = String(body.memberId || '');
    if (!/^MB-\d{7}$/.test(id)) throw bad('member_required', 'ไม่พบเลขสมาชิก');
    if (body.verifyToken || body.requireVerify) {
      const v = verifyToken(String(body.verifyToken || ''));
      if (!v || v.vm !== id) throw new HttpError(401, 'verify_required', 'ยืนยันตัวตนด้วยรหัสที่ส่งไปใน LINE ก่อน');
    }
    return id;
  };
  // ลิงก์สมัครสมาชิกผ่าน LINE สำหรับปุ่มที่หน้าลูกค้าสั่งเอง (เลือกแบรนด์/สาขาของเครื่องนี้ให้)
  r.post('/api/pos/join-link', async (req) => {
    const t = await posTerminal(req);
    const id = process.env.LIFF_ID;
    return { url: id ? 'https://liff.line.me/' + id + '?brand=' + encodeURIComponent(t.brandId) + '&branch=' + encodeURIComponent(t.branchId) + '&from=kiosk' : null };
  });
  r.post('/api/pos/members/wallet', async (req, body) => {
    const t = await posTerminal(req);
    return tx((db) => core.posWallet(db, { memberId: memberOf(body), brandId: t.brandId, subtotal: body.subtotal, ref: body.ref ? String(body.ref) : null, items: body.items }));
  });
  r.post('/api/pos/coupons/reserve', async (req, body) => {
    const t = await posTerminal(req);
    const coupon = await tx((db) => core.reserveCoupon(db, { memberId: memberOf(body), brandId: t.brandId, couponId: body.couponId, ref: String(body.ref || ''), subtotal: body.subtotal, minutes: Number(body.minutes) || 30, items: body.items }));
    return { coupon };
  }, (b, out) => 'จองคูปอง ' + (out?.coupon?.code || ''));
  r.post('/api/pos/coupons/release', async (req, body) => {
    await posTerminal(req);
    return tx((db) => core.releaseCoupon(db, { couponId: body.couponId, ref: body.ref }));
  });
  r.post('/api/pos/redeem', async (req, body) => {
    const t = await posTerminal(req);
    if (!body.ref) throw bad('ref_required', 'ต้องมีรหัสบิลที่กำลังเปิด');
    return tx((db) => core.redeemAtPos(db, { memberId: memberOf(body), brandId: t.brandId, rewardId: body.rewardId, ref: String(body.ref), subtotal: body.subtotal, minutes: Number(body.minutes) || 30, items: body.items }));
  }, (b, out) => 'แลกแต้ม คงเหลือ ' + (out?.balance ?? ''));
  r.post('/api/pos/members/verify/send', async (req, body) => {
    const t = await posTerminal(req);
    const id = String(body.memberId || '');
    if (!/^MB-\d{7}$/.test(id)) throw bad('member_required', 'ไม่พบเลขสมาชิก');
    return tx((db) => core.sendMemberCode(db, { memberId: id, brandId: t.brandId }));
  });
  r.post('/api/pos/members/verify/check', async (req, body) => {
    const id = String(body.memberId || '');
    const t = await posTerminal(req);
    const ok = await tx((db) => core.checkMemberCode(db, { memberId: id, code: body.code, brandId: t.brandId }));
    if (!ok) throw bad('code_invalid', 'รหัสไม่ถูกต้อง ดูรหัส 6 หลักล่าสุดในบัตรสมาชิกแล้วลองใหม่');
    return { verifyToken: signToken({ vm: id }, 3600) };
  });

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

  // เมนูทั้งหมดของ POS (POS ส่งมาเองเมื่อแก้เมนูและทุก 30 นาที) ใช้เลือกของฟรี/เงื่อนไขสินค้าในหน้าคูปอง
  // เมนูที่ไม่อยู่ในรายการล่าสุดถูกปิด (ไม่ลบ เพราะคูปองเก่าอาจอ้างถึง)
  r.post('/api/pos/menu', async (req, body) => {
    const t = await posTerminal(req);
    if (!Array.isArray(body.items) || body.items.length > 5000) throw bad('items_invalid', 'รายการเมนูไม่ถูกต้อง');
    const items = body.items.map((i) => ({ id: String(i.id || '').slice(0, 60), name: String(i.name || '').trim().slice(0, 300), category: i.category ? String(i.category).slice(0, 100) : null,
      categoryName: i.categoryName ? String(i.categoryName).slice(0, 200) : null, price: Math.max(0, Number(i.price) || 0), active: i.active !== false })).filter((i) => i.id && i.name);
    await tx(async (db) => {
      await db.q('UPDATE pos_menu_items SET is_active = false WHERE brand_id = $1', [t.brandId]);
      if (items.length) {
        await db.q(`INSERT INTO pos_menu_items (brand_id, item_id, name, category, category_name, price, is_active, updated_at)
          SELECT $1, x.id, x.name, x.category, x."categoryName", x.price, x.active, now() FROM jsonb_to_recordset($2::jsonb) AS x(id text, name text, category text, "categoryName" text, price numeric, active boolean)
          ON CONFLICT (brand_id, item_id) DO UPDATE SET name = EXCLUDED.name, category = EXCLUDED.category, category_name = EXCLUDED.category_name, price = EXCLUDED.price, is_active = EXCLUDED.is_active, updated_at = now()`,
        [t.brandId, JSON.stringify(items)]);
      }
      await db.q('UPDATE brands SET menu_synced_at = now() WHERE id = $1', [t.brandId]);
    });
    return { count: items.length };
  }, (b, out) => 'ซิงก์เมนู ' + (out?.count ?? 0) + ' รายการ');

  r.get('/api/pos/bills', async (req) => {
    const t = await posTerminal(req);
    return q('SELECT pos_bill_id, member_id, total, points_earned, status, paid_at FROM sales_transactions WHERE branch_id = $1 ORDER BY paid_at DESC LIMIT 20', [t.branchId]);
  });
}
