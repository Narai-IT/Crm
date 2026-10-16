import crypto from 'node:crypto';

export const SECRET = process.env.APP_SECRET || 'dev-secret-change-me';
export const DEV = process.env.DEV_MODE === '1';
// 1 = ต้องยืนยันเบอร์ด้วย SMS OTP ตอนสมัคร · 0 (ค่าเริ่มต้น) = สมัครด้วยเบอร์ได้เลย เพราะ LINE ยืนยันตัวตนให้แล้ว
export const REQUIRE_OTP = process.env.REQUIRE_PHONE_OTP === '1';

export const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
export const hmac = (s) => crypto.createHmac('sha256', SECRET).update(String(s)).digest('base64url');
export const randomCode = (n = 4) => {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; const b = crypto.randomBytes(n);
  for (let i = 0; i < n; i++) s += abc[b[i] % abc.length];
  return s;
};
export const memberIdOf = (no) => 'MB-' + String(no).padStart(7, '0');
export const intId = (v) => { const n = parseInt(String(v ?? '').replace(/\D/g, ''), 10); return Number.isFinite(n) ? n : null; };
export const isPhone = (p) => /^0\d{8,9}$/.test(String(p || ''));
export const maskPhone = (p) => (p && p.length > 4 ? '***-***-' + p.slice(-4) : p);

// รหัสผ่านพนักงาน: scrypt
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  return 'scrypt$' + salt + '$' + crypto.scryptSync(pw, salt, 32).toString('hex');
}
export function checkPassword(pw, stored) {
  if (!stored) return false;
  const [, salt, hash] = stored.split('$');
  const got = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

// token หลังบ้าน: payload.sig (HMAC) อายุ 12 ชม.
export function signToken(payload, ttlSec = 12 * 3600) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return body + '.' + hmac(body);
}
export function verifyToken(tok) {
  const [body, sig] = String(tok || '').split('.');
  if (!body || !sig) return null;
  const want = hmac(body);
  if (want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) return null;
  const p = JSON.parse(Buffer.from(body, 'base64url').toString());
  return p.exp > Date.now() / 1000 ? p : null;
}

// QR สมาชิก: เปลี่ยนทุก 60 วินาที รับช่วงเวลาก่อนหน้า 1 ช่วง (ลูกค้าเปิดค้างตอนเวลาเปลี่ยน)
const WINDOW = 60;
export function qrToken(memberId, at = Date.now()) {
  const w = Math.floor(at / 1000 / WINDOW);
  const sig = hmac('qr:' + memberId + ':' + w).slice(0, 10);
  return { token: 'QR.' + memberId.replace('MB-', '') + '.' + w + '.' + sig, expiresIn: WINDOW - Math.floor((at / 1000) % WINDOW) };
}
export function readQrToken(token, at = Date.now()) {
  const m = /^QR\.(\d{7})\.(\d+)\.([\w-]{10})$/.exec(String(token || ''));
  if (!m) return null;
  const memberId = 'MB-' + m[1]; const w = Number(m[2]);
  const now = Math.floor(at / 1000 / WINDOW);
  if (w !== now && w !== now - 1) return { memberId, expired: true };
  const sig = hmac('qr:' + memberId + ':' + w).slice(0, 10);
  return sig === m[3] ? { memberId, expired: false } : null;
}

// คำนวณแต้มจากกฎของแบรนด์
export function calcPoints(rule, { subtotal, total }, at = new Date()) {
  if (!rule) return 0;
  const base = rule.base_amount === 'gross' ? subtotal : rule.base_amount === 'exvat' ? total / 1.07 : total;
  const units = base / Number(rule.baht_per_unit);
  let p = (rule.rounding === 'round' ? Math.round(units) : Math.floor(units + 1e-9)) * rule.points_per_unit;
  if (rule.promo_on && new Date(at).getDay() === rule.promo_day) p = Math.floor(p * Number(rule.promo_mult));
  return Math.max(0, p);
}
export function tierOf(rule, earned12m) {
  if (earned12m >= rule.platinum_at) return { name: 'PLATINUM', next: null, need: 0, at: earned12m, max: rule.platinum_at };
  if (earned12m >= rule.gold_at) return { name: 'GOLD', next: 'Platinum', need: rule.platinum_at - earned12m, at: earned12m, max: rule.platinum_at };
  return { name: 'SILVER', next: 'Gold', need: rule.gold_at - earned12m, at: earned12m, max: rule.gold_at };
}
export function couponDiscount(c, subtotal) {
  if (!c || c.status !== 'ready' || subtotal < Number(c.min_spend || 0)) return 0;
  if (c.discount_type === 'pct') {
    const d = Math.floor(subtotal * Number(c.discount_value) / 100);
    return c.max_discount ? Math.min(d, Number(c.max_discount)) : d;
  }
  return Math.min(Number(c.discount_value), subtotal);
}
