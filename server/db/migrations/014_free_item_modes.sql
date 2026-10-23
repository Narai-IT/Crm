-- ของฟรีหลายรายการ: ฟรีกี่ชิ้น
--   one = ฟรี 1 ชิ้น (ชิ้นที่ถูกที่สุดในรายการ) · qty = ฟรีรวม free_qty ชิ้น (ถูกที่สุดก่อน) · all = ทุกเมนูในรายการ อย่างละ 1 ชิ้น
--   free_need_all (ใช้กับ all) = ต้องมีครบทุกเมนูในรายการถึงจะใช้ได้
ALTER TABLE coupon_templates
  ADD COLUMN free_mode     text NOT NULL DEFAULT 'one' CHECK (free_mode IN ('one','qty','all')),
  ADD COLUMN free_qty      int  NOT NULL DEFAULT 1 CHECK (free_qty BETWEEN 1 AND 20),
  ADD COLUMN free_need_all boolean NOT NULL DEFAULT false;
