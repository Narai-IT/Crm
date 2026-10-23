-- ใช้หลายคูปองในบิลเดียว: ลำดับที่กดใช้ (คูปองใบหลังใช้ได้เฉพาะชิ้นในบิลที่ใบก่อนยังไม่ได้ใช้)
ALTER TABLE member_coupons ADD COLUMN reserved_at timestamptz;
