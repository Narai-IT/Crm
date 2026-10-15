// การยืนยันตัวตน 3 ช่องทาง: ลูกค้า (LINE ID token จาก LIFF) · เครื่อง POS (API key) · พนักงานหลังบ้าน (token)
import { HttpError, forbidden } from './http.js';
import { one, q } from './db.js';
import { DEV, sha256, verifyToken } from './util.js';

const unauthorized = (m) => new HttpError(401, 'unauthorized', m || 'ต้องเข้าสู่ระบบ');
const idTokenCache = new Map();

export async function liffUser(req) {
  const auth = req.headers.authorization || '';
  if (auth.startsWith('Bearer ') && process.env.LINE_LOGIN_CHANNEL_ID) {
    const tok = auth.slice(7);
    const c = idTokenCache.get(tok);
    if (c && c.exp > Date.now() / 1000) return c;
    // ตรวจ ID token กับ LINE (ลายเซ็น, aud = channel ของเรา, ยังไม่หมดอายุ)
    const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token: tok, client_id: process.env.LINE_LOGIN_CHANNEL_ID })
    });
    if (!res.ok) throw unauthorized('LINE token ไม่ถูกต้องหรือหมดอายุ');
    const p = await res.json();
    const u = { userId: p.sub, displayName: p.name || null, exp: p.exp };
    idTokenCache.set(tok, u);
    return u;
  }
  if (DEV && req.headers['x-dev-line-user']) {
    return { userId: String(req.headers['x-dev-line-user']), displayName: decodeURIComponent(String(req.headers['x-dev-line-name'] || 'ลูกค้าทดลอง')) };
  }
  throw unauthorized('ต้องเปิดผ่าน LINE');
}

export async function posTerminal(req) {
  const key = req.headers['x-api-key'];
  if (key) {
    const t = await one('SELECT t.*, b.brand_id FROM pos_terminals t JOIN branches b ON b.id = t.branch_id WHERE t.api_key_hash = $1', [sha256(key)]);
    if (!t) throw unauthorized('API key ไม่ถูกต้อง');
    await q('UPDATE pos_terminals SET last_seen_at = now() WHERE id = $1', [t.id]);
    return { terminalId: t.id, branchId: t.branch_id, brandId: t.brand_id, kind: t.kind, staffId: req.headers['x-staff-id'] || null };
  }
  if (DEV && req.headers['x-dev-branch']) {
    const b = await one('SELECT * FROM branches WHERE id = $1', [String(req.headers['x-dev-branch'])]);
    if (!b) throw unauthorized('ไม่พบสาขา');
    return { terminalId: 'dev-' + b.id, branchId: b.id, brandId: b.brand_id, kind: 'pos', staffId: req.headers['x-staff-id'] || null };
  }
  throw unauthorized('ต้องใช้ API key ของเครื่อง POS');
}

export const ROLE_PAGES = {
  super: ['dash', 'members', 'approvals', 'rules', 'rewards', 'campaigns', 'line', 'branches', 'staff', 'audit', 'events'],
  marketing: ['dash', 'members', 'rules', 'rewards', 'campaigns', 'line', 'audit'],
  brand: ['dash', 'members', 'approvals', 'rules', 'rewards', 'campaigns'],
  branchmgr: ['dash', 'members', 'approvals'],
  cashier: []
};

export async function loadStaff(id) {
  const s = await one('SELECT id, name, role, email FROM staff WHERE id = $1 AND is_active', [id]);
  if (!s) return null;
  const scopes = await q('SELECT * FROM staff_scopes WHERE staff_id = $1', [id]);
  const allBrands = (await q('SELECT id FROM brands WHERE is_active ORDER BY id')).map((r) => r.id);
  let brands = []; let branches = null;
  for (const sc of scopes) {
    if (sc.scope_type === 'group') brands = allBrands;
    if (sc.scope_type === 'brand') brands.push(sc.scope_id);
    if (sc.scope_type === 'branch') {
      const b = await one('SELECT brand_id FROM branches WHERE id = $1', [sc.scope_id]);
      if (b) { brands.push(b.brand_id); branches = (branches || []).concat(sc.scope_id); }
    }
  }
  return { ...s, brands: [...new Set(brands)], branches, pages: ROLE_PAGES[s.role] || [], fullPii: s.role === 'super' };
}

export async function staffUser(req) {
  const auth = req.headers.authorization || '';
  let id = null;
  if (auth.startsWith('Bearer ')) { const p = verifyToken(auth.slice(7)); if (p) id = p.sid; }
  if (!id && DEV && req.headers['x-dev-staff']) id = String(req.headers['x-dev-staff']);
  if (!id) throw unauthorized();
  const s = await loadStaff(id);
  if (!s) throw unauthorized('บัญชีถูกปิดใช้งาน');
  if (!s.pages.length) throw forbidden('ตำแหน่งนี้ไม่มีสิทธิ์เข้าหลังบ้าน');
  return s;
}

export function requirePage(staff, page) { if (!staff.pages.includes(page)) throw forbidden('ตำแหน่งของคุณไม่มีสิทธิ์ใช้เมนูนี้'); }
export function requireBrand(staff, brandId) { if (!staff.brands.includes(brandId)) throw forbidden('ไม่มีสิทธิ์กับแบรนด์นี้'); }
export function scopeBrands(staff, wanted) {
  if (wanted && wanted !== 'all') { requireBrand(staff, wanted); return [wanted]; }
  return staff.brands;
}
