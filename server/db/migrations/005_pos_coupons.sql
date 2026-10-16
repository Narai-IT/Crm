-- ใช้คูปอง/แลกแต้มจากหน้าร้าน (POS) และหน้าลูกค้าสั่งเอง
-- จองคูปองไว้กับบิลที่กำลังเปิดอยู่ (ref) กันใช้ใบเดียวกันสองบิลพร้อมกัน · หมดเวลาจองแล้วปล่อยเอง
ALTER TABLE member_coupons ADD COLUMN reserved_ref text;
ALTER TABLE member_coupons ADD COLUMN reserved_until timestamptz;

-- รหัสยืนยันตัวตนที่ส่งเข้า LINE ของสมาชิก (ก่อนใช้คูปอง/แลกแต้มที่หน้าลูกค้าสั่งเอง)
CREATE TABLE member_verifications (
  id          bigserial PRIMARY KEY,
  member_id   text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  brand_id    text NOT NULL REFERENCES brands(id),
  code_hash   text NOT NULL,
  attempts    int NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  verified_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON member_verifications(member_id, created_at DESC);
