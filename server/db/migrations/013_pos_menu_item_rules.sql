-- เมนูจาก POS (POS ส่งมาเอง) + คูปองของฟรีเลือกเมนู + เงื่อนไขสินค้าในบิล

CREATE TABLE pos_menu_items (
  brand_id      text NOT NULL REFERENCES brands(id),
  item_id       text NOT NULL,
  name          text NOT NULL,
  category      text,                                  -- รหัสหมวดใน POS
  category_name text,
  price         numeric(12,2) NOT NULL DEFAULT 0,
  is_active     boolean NOT NULL DEFAULT true,         -- ไม่อยู่ในรายการล่าสุดที่ POS ส่งมา = false
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (brand_id, item_id)
);
ALTER TABLE brands ADD COLUMN menu_synced_at timestamptz;

-- free_items: [{id, name, price}] ของที่ได้ฟรี (ลดเท่าราคาเมนูนั้น 1 ชิ้น ต้องมีในบิล)
-- cond_*: ต้องมีสินค้าในบิล · cond_items [{type: 'item'|'cat', id, name}] · any = อย่างใดอย่างหนึ่ง / all = ครบทุกรายการ
--         cond_qty = รวมกันอย่างน้อยกี่ชิ้น · cond_scope = คิดส่วนลดจากทั้งบิล (bill) หรือเฉพาะเมนูที่ตรงเงื่อนไข (items)
ALTER TABLE coupon_templates
  ADD COLUMN free_items jsonb,
  ADD COLUMN cond_mode  text CHECK (cond_mode IN ('any','all')),
  ADD COLUMN cond_items jsonb,
  ADD COLUMN cond_qty   int NOT NULL DEFAULT 1 CHECK (cond_qty BETWEEN 1 AND 99),
  ADD COLUMN cond_scope text NOT NULL DEFAULT 'bill' CHECK (cond_scope IN ('bill','items'));
