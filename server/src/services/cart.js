// รายการอาหารในบิลจาก POS → ตรวจเงื่อนไขสินค้าของคูปองและคิดส่วนลดของฟรี
// POS หน้าพนักงานไม่มีรหัสเมนูในบิล จึงจับคู่ด้วยชื่อเมนูเป็นหลัก (ใช้ menuId เมื่อ POS ส่งมา) แล้วหาหมวดจากเมนูที่ POS ซิงก์มา
const norm = (s) => String(s || '').trim().replace(/\s+/g, ' ').toLowerCase();

// items: [{ menuId?, name, price (ต่อชิ้น), qty, category? }] · null = POS ไม่ได้ส่งรายการมา
export async function loadCart(db, brandId, items) {
  if (!Array.isArray(items)) return null;
  const lines = items.slice(0, 300).map((i) => ({ menuId: i.menuId ? String(i.menuId) : null, name: String(i.name || '').slice(0, 300), price: Math.max(0, Number(i.price) || 0),
    qty: Math.max(0, Number(i.qty) || 0), category: i.category ? String(i.category) : null })).filter((l) => l.name && l.qty > 0);
  if (!lines.length) return lines;
  const menu = await db.q('SELECT item_id, name, category FROM pos_menu_items WHERE brand_id = $1', [brandId]);
  const byId = new Map(menu.map((m) => [m.item_id, m])); const byName = new Map(menu.map((m) => [norm(m.name), m]));
  for (const l of lines) {
    const m = (l.menuId && byId.get(l.menuId)) || byName.get(norm(l.name));
    if (m) { l.menuId = l.menuId || m.item_id; l.category = l.category || m.category; }
  }
  return lines;
}

const hit = (l, r) => (r.type === 'cat' ? !!l.category && l.category === r.id : (l.menuId && l.menuId === r.id) || norm(l.name) === norm(r.name));
export const hasItemRules = (c) => !!((c.free_items && c.free_items.length) || (c.cond_mode && c.cond_items && c.cond_items.length));
const names = (list) => list.map((x) => (x.type === 'cat' ? 'หมวด' + x.name : x.name)).join(', ');

// เหตุผลที่บิลนี้ยังไม่เข้าเงื่อนไขสินค้า (null = ผ่าน)
export function itemProblem(c, cart) {
  if (!hasItemRules(c)) return null;
  if (!cart) return { code: 'coupon_needs_items', msg: 'คูปอง ' + c.code + ' ต้องตรวจรายการอาหาร (อัปเดตเครื่อง POS ก่อน)' };
  if (c.cond_mode && c.cond_items && c.cond_items.length) {
    const qtyOf = (r) => cart.filter((l) => hit(l, r)).reduce((a, l) => a + l.qty, 0);
    const missing = c.cond_mode === 'all' ? c.cond_items.filter((r) => qtyOf(r) <= 0) : [];
    const total = cart.filter((l) => c.cond_items.some((r) => hit(l, r))).reduce((a, l) => a + l.qty, 0);
    const need = Math.max(1, c.cond_qty || 1);
    if (missing.length) return { code: 'coupon_items', msg: 'ต้องมี ' + names(missing) + ' ในบิล' };
    if (total < need) return { code: 'coupon_items', msg: 'ต้องมี ' + names(c.cond_items) + (c.cond_mode === 'all' ? ' (ครบทุกรายการ)' : '') + ' รวมอย่างน้อย ' + need + ' ชิ้นในบิล' };
  }
  if (c.free_items && c.free_items.length) {
    const has = (f) => cart.some((l) => l.price > 0 && hit(l, f));
    if (c.free_mode === 'all' && c.free_need_all) {
      const missing = c.free_items.filter((f) => !has(f));
      if (missing.length) return { code: 'coupon_items', msg: 'ต้องมี ' + missing.map((f) => f.name).join(', ') + ' ในบิล (ฟรีเมื่อมีครบทุกอย่าง)' };
    } else if (!c.free_items.some(has)) {
      return { code: 'coupon_items', msg: 'ต้องมี ' + c.free_items.map((f) => f.name).join(' หรือ ') + ' ในบิลก่อน' };
    }
  }
  return null;
}

// มูลค่าของฟรีในบิลนี้ · one = ชิ้นที่ถูกที่สุด 1 ชิ้น · qty = รวม N ชิ้น ถูกที่สุดก่อน · all = ทุกเมนูในรายการ อย่างละ 1 ชิ้น (ชิ้นที่ถูกที่สุดของเมนูนั้น)
function freeAmount(c, cart) {
  const lines = cart.filter((l) => l.price > 0);
  if (c.free_mode === 'all') {
    return Math.round(c.free_items.reduce((a, f) => { const p = lines.filter((l) => hit(l, f)).map((l) => l.price); return a + (p.length ? Math.min(...p) : 0); }, 0) * 100) / 100;
  }
  const units = lines.filter((l) => c.free_items.some((f) => hit(l, f))).flatMap((l) => Array(Math.max(1, Math.floor(l.qty))).fill(l.price)).sort((a, b) => a - b);
  const n = c.free_mode === 'qty' ? Math.max(1, c.free_qty || 1) : 1;
  return Math.round(units.slice(0, n).reduce((a, p) => a + p, 0) * 100) / 100;
}

// ส่วนลดของคูปองที่มีกฎสินค้า (เรียกเมื่อ itemProblem ผ่านแล้ว) · null = ไม่มีกฎสินค้า ใช้วิธีคิดปกติ
export function itemDiscount(c, cart, subtotal) {
  if (!hasItemRules(c) || !cart) return null;
  if (c.free_items && c.free_items.length) return Math.min(freeAmount(c, cart), subtotal);
  if (c.cond_scope !== 'items') return null;
  const base = Math.min(subtotal, Math.round(cart.filter((l) => c.cond_items.some((r) => hit(l, r))).reduce((a, l) => a + l.price * l.qty, 0) * 100) / 100);
  if (c.discount_type === 'pct') { const d = Math.floor(base * Number(c.discount_value) / 100); return c.max_discount ? Math.min(d, Number(c.max_discount)) : d; }
  return Math.min(Number(c.discount_value), base);
}
