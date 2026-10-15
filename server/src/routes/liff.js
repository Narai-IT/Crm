// API ฝั่งลูกค้า (เรียกจาก LIFF) · ทุก endpoint ผูกกับ LINE userId ที่ยืนยันแล้ว
import { q, one, tx } from '../db.js';
import { bad, notFound } from '../http.js';
import { liffUser } from '../auth.js';
import { isPhone, qrToken } from '../util.js';
import * as core from '../services/core.js';

async function me(req) {
  const u = await liffUser(req);
  const m = await core.memberByLine({ one }, u.userId);
  return { u, m };
}
async function needMember(req) {
  const r = await me(req);
  if (!r.m) throw notFound('ยังไม่ได้สมัครสมาชิก');
  return r;
}

export function couponView(c) {
  return { id: String(c.id), code: c.code, brand: c.brand_id || 'all', title: c.title, big: c.badge_big, small: c.badge_small, cond: c.condition_text,
    cp: { kind: c.discount_type, value: c.discount_value, min: c.min_spend }, status: c.status === 'ready' && new Date(c.expires_at) < new Date() ? 'expired' : c.status,
    issuedAt: +new Date(c.issued_at), expiresAt: +new Date(c.expires_at), source: c.source, usedAt: c.used_at ? +new Date(c.used_at) : null, usedBranch: c.used_branch_id };
}
export const COUPON_SQL = 'SELECT c.*, t.title, t.badge_big, t.badge_small, t.condition_text, t.discount_type, t.discount_value, t.min_spend FROM member_coupons c JOIN coupon_templates t ON t.id = c.template_id';

export default function (r) {
  r.get('/api/liff/me', async (req) => {
    const { u, m } = await me(req);
    if (!m) return { member: null, lineUserId: u.userId, displayName: u.displayName };
    const links = await q('SELECT brand_id, follow_status, marketing_consent FROM member_brand_links WHERE member_id = $1', [m.id]);
    return { member: { id: m.id, name: m.full_name, phone: m.phone, birthday: m.birth_date, homeBranch: m.home_branch_id, joinedBrand: m.joined_brand_id, joinedAt: m.created_at },
      wallets: await core.walletsOf({ q, one }, m.id), links };
  });

  r.post('/api/liff/otp', async (req, body) => {
    const { u } = await me(req);
    if (!isPhone(body.phone)) throw bad('phone_invalid', 'กรอกเบอร์โทร 10 หลักที่ขึ้นต้นด้วย 0');
    const code = await tx((db) => core.createOtp(db, body.phone, u.userId));
    return { sent: true, devCode: code || undefined };
  }, 'ส่ง OTP');

  r.post('/api/liff/otp/verify', async (req, body) => {
    const { u } = await me(req);
    const ok = await tx((db) => core.verifyOtp(db, body.phone, String(body.code || ''), u.userId));
    if (!ok) throw bad('otp_invalid', 'รหัส OTP ไม่ถูกต้องหรือหมดอายุ');
    return { verified: true };
  });

  r.post('/api/liff/register', async (req, body) => {
    const { u } = await me(req);
    if (!String(body.name || '').trim()) throw bad('name_required', 'กรอกชื่อ - นามสกุล');
    if (!isPhone(body.phone)) throw bad('phone_invalid', 'กรอกเบอร์โทร 10 หลักที่ขึ้นต้นด้วย 0');
    if (!body.privacy) throw bad('privacy_required', 'ต้องยอมรับเงื่อนไขสมาชิกและนโยบายความเป็นส่วนตัว');
    if (body.otp) {
      const ok = await tx((db) => core.verifyOtp(db, body.phone, String(body.otp), u.userId));
      if (!ok) throw bad('otp_invalid', 'รหัส OTP ไม่ถูกต้องหรือหมดอายุ');
    }
    const res = await tx((db) => core.register(db, { lineUserId: u.userId, displayName: u.displayName, brandId: body.brand, name: String(body.name).trim(),
      phone: body.phone, birthday: body.birthday || null, branchId: body.branchId, marketing: !!body.marketing, privacyVersion: body.privacyVersion }));
    return { memberId: res.member.id, linked: res.linked, welcomePoints: res.welcomePoints || 0 };
  });

  r.get('/api/liff/qr', async (req) => { const { m } = await needMember(req); return qrToken(m.id); });

  r.get('/api/liff/coupons', async (req, _b, url) => {
    const { m } = await needMember(req);
    const brand = url.searchParams.get('brand');
    const rows = await q(COUPON_SQL + ' WHERE c.member_id = $1 AND ($2::text IS NULL OR c.brand_id = $2 OR c.brand_id IS NULL) ORDER BY c.expires_at', [m.id, brand]);
    return rows.map(couponView);
  });

  r.post('/api/liff/coupons/claim', async (req, body) => {
    const { m } = await needMember(req);
    const c = await tx((db) => core.claimCode(db, { memberId: m.id, brandId: body.brand, code: body.code }));
    return { couponId: String(c.id), code: c.code };
  });

  r.get('/api/liff/rewards', async (req, _b, url) => {
    await liffUser(req);
    return q('SELECT r.id, r.brand_id, r.name, r.category, r.points_cost, r.stock, t.discount_type, t.discount_value, t.min_spend FROM rewards r JOIN coupon_templates t ON t.id = r.coupon_template_id WHERE r.is_active AND r.brand_id = $1 ORDER BY r.points_cost', [url.searchParams.get('brand')]);
  });

  r.post('/api/liff/redemptions', async (req, body) => {
    const { m } = await needMember(req);
    const key = req.headers['idempotency-key'] || body.idempotencyKey;
    if (!key) throw bad('idempotency_key_required', 'ต้องส่ง Idempotency-Key');
    const res = await tx((db) => core.redeem(db, { memberId: m.id, rewardId: parseInt(String(body.rewardId).replace(/\D/g, ''), 10), key: String(key) }));
    return { couponId: String(res.coupon.id), code: res.coupon.code, balance: res.balance, duplicate: !!res.duplicate };
  }, (b, out) => (out?.duplicate ? 'คำขอซ้ำ คืนคูปองเดิม ' : 'ตัดแต้ม (ล็อกกระเป๋า) → คูปอง ') + (out?.code || ''));

  r.get('/api/liff/bills', async (req, _b, url) => {
    const { m } = await needMember(req);
    return q('SELECT pos_bill_id, branch_id, brand_id, subtotal, discount, total, points_earned, status, paid_at, items FROM sales_transactions WHERE member_id = $1 AND ($2::text IS NULL OR brand_id = $2) ORDER BY paid_at DESC LIMIT 100', [m.id, url.searchParams.get('brand')]);
  });
  r.get('/api/liff/ledger', async (req, _b, url) => {
    const { m } = await needMember(req);
    return q('SELECT entry_type, points, balance_after, note, created_at, brand_id FROM point_ledger WHERE member_id = $1 AND ($2::text IS NULL OR brand_id = $2) ORDER BY id DESC LIMIT 200', [m.id, url.searchParams.get('brand')]);
  });

  r.patch('/api/liff/consents', async (req, body) => {
    const { m } = await needMember(req);
    await tx(async (db) => { await core.setConsent(db, m.id, body.brand, !!body.marketing); await core.audit(db, { type: 'member', id: m.id }, 'consent', { type: 'member', id: m.id }, body.brand + ' marketing=' + !!body.marketing); });
    return { ok: true };
  });

  r.post('/api/liff/tax-invoice-requests', async (req, body) => {
    const { m } = await needMember(req);
    const t = await one('SELECT id FROM sales_transactions WHERE member_id = $1 AND pos_bill_id = $2', [m.id, body.posBillId]);
    if (!t) throw notFound('ไม่พบบิลนี้');
    return one('INSERT INTO tax_invoice_requests (member_id, txn_id) VALUES ($1,$2) RETURNING id, status', [m.id, t.id]);
  });
}
