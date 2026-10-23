// รายการอาหารในบิลจาก POS → ตรวจเงื่อนไขสินค้าของคูปอง / คิดส่วนลดของฟรี
// POS หน้าพนักงานไม่มีรหัสเมนูในบิล จึงจับคู่ด้วยชื่อเมนูเป็นหลัก (ใช้ menuId เมื่อ POS ส่งมา) แล้วหาหมวดจากเมนูที่ POS ซิงก์มา
// ใช้หลายคูปองในบิลเดียว: แต่ละชิ้นในบิลถูกใช้ได้กับคูปองใบเดียว (ของฟรีและชิ้นที่นับเป็นเงื่อนไข) · ใบหลังใช้ได้เฉพาะชิ้นที่เหลือ
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
// ชิ้นในบิลที่ยังไม่ถูกคูปองใบไหนใช้ (left = จำนวนชิ้นที่เหลือของแต่ละแถว)
export const makePool = (cart) => (cart ? cart.map((l) => ({ ...l, left: Math.max(1, Math.floor(l.qty)) })) : null);

const hit = (l, r) => (r.type === 'cat' ? !!l.category && l.category === r.id : (l.menuId && l.menuId === r.id) || norm(l.name) === norm(r.name));
export const hasItemRules = (c) => !!((c.free_items && c.free_items.length) || (c.cond_mode && c.cond_items && c.cond_items.length));
const names = (list) => list.map((x) => (x.type === 'cat' ? 'หมวด' + x.name : x.name)).join(', ');

// ตรวจกฎสินค้าของคูปองกับชิ้นที่เหลือ · คืน { problem } หรือ { discount (null = คิดแบบปกติ), take: Map(แถว → จำนวนชิ้นที่ใช้) }
function tryItems(c, pool) {
  const take = new Map();
  const free = (i) => pool[i].left - (take.get(i) || 0);
  const grab = (i) => take.set(i, (take.get(i) || 0) + 1);
  // ชิ้นที่ยังว่างของกฎนี้ เรียงจากถูกไปแพง
  const units = (pred) => pool.flatMap((l, i) => (pred(l) ? Array.from({ length: Math.max(0, free(i)) }, () => i) : [])).sort((a, b) => pool[a].price - pool[b].price);
  let discount = null;
  if (c.free_items && c.free_items.length) {
    const priced = (f) => (l) => l.price > 0 && hit(l, f);
    let got = [];
    if (c.free_mode === 'all') {
      const missing = [];
      for (const f of c.free_items) { const u = units(priced(f))[0]; if (u === undefined) missing.push(f); else { grab(u); got.push(u); } }
      if (c.free_need_all && missing.length) return { problem: { code: 'coupon_items', msg: 'ต้องมี ' + missing.map((f) => f.name).join(', ') + ' ในบิล (ฟรีเมื่อมีครบทุกอย่าง)' } };
    } else {
      got = units((l) => l.price > 0 && c.free_items.some((f) => hit(l, f))).slice(0, c.free_mode === 'qty' ? Math.max(1, c.free_qty || 1) : 1);
      got.forEach(grab);
    }
    if (!got.length) return { problem: { code: 'coupon_items', msg: 'ต้องมี ' + c.free_items.map((f) => f.name).join(' หรือ ') + ' ในบิลก่อน' } };
    discount = Math.round(got.reduce((a, i) => a + pool[i].price, 0) * 100) / 100;
  }
  if (c.cond_mode && c.cond_items && c.cond_items.length) {
    const need = Math.max(1, c.cond_qty || 1); let n = 0;
    if (c.cond_mode === 'all') {
      const missing = [];
      for (const r of c.cond_items) { const u = units((l) => hit(l, r))[0]; if (u === undefined) missing.push(r); else { grab(u); n++; } }
      if (missing.length) return { problem: { code: 'coupon_items', msg: 'ต้องมี ' + names(missing) + ' ในบิล' } };
    }
    const rest = units((l) => c.cond_items.some((r) => hit(l, r)));
    if (n + rest.length < need) return { problem: { code: 'coupon_items', msg: 'ต้องมี ' + names(c.cond_items) + (c.cond_mode === 'all' ? ' (ครบทุกรายการ)' : '') + ' รวมอย่างน้อย ' + need + ' ชิ้นในบิล' } };
    // คิดส่วนลดเฉพาะเมนูที่ตรงเงื่อนไข = ใช้ทุกชิ้นที่ตรง · คิดจากทั้งบิล = ใช้แค่ชิ้นที่นับเป็นเงื่อนไข
    const use = discount === null && c.cond_scope === 'items' ? rest : rest.slice(0, Math.max(0, need - n));
    use.forEach(grab);
    if (discount === null && c.cond_scope === 'items') {
      const base = Math.round([...take].reduce((a, [i, k]) => a + pool[i].price * k, 0) * 100) / 100;
      discount = c.discount_type === 'pct' ? Math.min(Math.floor(base * Number(c.discount_value) / 100), c.max_discount ? Number(c.max_discount) : Infinity) : Math.min(Number(c.discount_value), base);
    }
  }
  return { discount, take };
}
export function evalItems(c, pool) {
  if (!hasItemRules(c)) return { discount: null, take: new Map() };
  if (!pool) return { problem: { code: 'coupon_needs_items', msg: 'คูปอง ' + c.code + ' ต้องตรวจรายการอาหาร (อัปเดตเครื่อง POS ก่อน)' } };
  const r = tryItems(c, pool);
  // ถ้าบิลมีเมนูครบแต่ถูกคูปองใบก่อนใช้ไปแล้ว บอกให้ชัด
  if (r.problem && pool.some((l) => l.left < Math.max(1, Math.floor(l.qty))) && !tryItems(c, makePool(pool)).problem) {
    return { problem: { code: 'coupon_items_used', msg: r.problem.msg + ' (ชิ้นในบิลถูกใช้กับคูปองอื่นแล้ว)' } };
  }
  return r;
}
export function consume(pool, take) { if (pool) for (const [i, k] of take) pool[i].left -= k; }
