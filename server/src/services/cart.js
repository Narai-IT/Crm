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
  if (c.free_items && c.free_items.length && !cart.some((l) => l.price > 0 && c.free_items.some((f) => hit(l, f)))) {
    return { code: 'coupon_items', msg: 'ต้องมี ' + c.free_items.map((f) => f.name).join(' หรือ ') + ' ในบิลก่อน' };
  }
  return null;
}

// ส่วนลดของคูปองที่มีกฎสินค้า (เรียกเมื่อ itemProblem ผ่านแล้ว) · null = ไม่มีกฎสินค้า ใช้วิธีคิดปกติ
export function itemDiscount(c, cart, subtotal) {
  if (!hasItemRules(c) || !cart) return null;
  if (c.free_items && c.free_items.length) {
    const prices = cart.filter((l) => l.price > 0 && c.free_items.some((f) => hit(l, f))).map((l) => l.price);
    return prices.length ? Math.min(Math.min(...prices), subtotal) : 0;          // ฟรี 1 ชิ้น (ชิ้นที่ถูกที่สุดถ้าเลือกไว้หลายเมนู)
  }
  if (c.cond_scope !== 'items') return null;
  const base = Math.min(subtotal, Math.round(cart.filter((l) => c.cond_items.some((r) => hit(l, r))).reduce((a, l) => a + l.price * l.qty, 0) * 100) / 100);
  if (c.discount_type === 'pct') { const d = Math.floor(base * Number(c.discount_value) / 100); return c.max_discount ? Math.min(d, Number(c.max_discount)) : d; }
  return Math.min(Number(c.discount_value), base);
}
