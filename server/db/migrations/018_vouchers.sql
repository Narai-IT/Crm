-- Voucher: ใช้แทนเงินตอนชำระ (ไม่ใช่ส่วนลด) · มูลค่าเก็บใน discount_value ของแม่แบบ (บาท)
--   Voucher กระดาษ: ออกเป็นชุด ไม่ผูกสมาชิก (member_id = NULL, source = 'voucher') ใครถือมาก็ใช้ได้ ใบละครั้ง
--   Voucher ในบัตรสมาชิก LINE: มอบให้สมาชิกรายคน (source = 'gift') ใช้ได้เฉพาะเจ้าของ สแกน QR จากบัตร
-- ยอดไม่พอ = จ่ายส่วนที่เหลือด้วยวิธีอื่น · ยอดเกินบิล = ไม่ทอน ใบถูกใช้หมด
ALTER TABLE coupon_templates DROP CONSTRAINT coupon_templates_kind_check;
ALTER TABLE coupon_templates ADD CONSTRAINT coupon_templates_kind_check CHECK (kind IN ('internal','general','code','birthday','welcome','gift','voucher'));

ALTER TABLE member_coupons ALTER COLUMN member_id DROP NOT NULL;
ALTER TABLE member_coupons DROP CONSTRAINT member_coupons_source_check;
ALTER TABLE member_coupons ADD CONSTRAINT member_coupons_source_check CHECK (source IN ('welcome','redeem','campaign','code','birthday','manual','auto','gift','voucher'));
-- ใบที่ไม่มีเจ้าของต้องเป็น Voucher กระดาษเท่านั้น
ALTER TABLE member_coupons ADD CONSTRAINT member_coupons_owner_check CHECK (member_id IS NOT NULL OR source = 'voucher');
-- ยอดที่ Voucher จ่ายให้บิลจริง (ไม่เกินมูลค่า · ยอดเกินบิลไม่ทอน)
ALTER TABLE member_coupons ADD COLUMN used_amount numeric(10,2);
CREATE INDEX ON member_coupons(template_id, source) WHERE member_id IS NULL;

-- ยอดที่ลูกค้าจ่ายด้วย Voucher ในบิล (เป็นการชำระเงิน ไม่ใช่ส่วนลด จึงไม่กระทบแต้ม)
ALTER TABLE sales_transactions ADD COLUMN voucher_total numeric(12,2) NOT NULL DEFAULT 0;
