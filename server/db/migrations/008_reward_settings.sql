-- ตั้งค่าของรางวัลเพิ่ม (หน้าหลังบ้าน "ของรางวัล")
--   kind: general = ของรางวัล/ส่วนลดที่ตั้งในหน้านี้ (ระบบสร้างคูปองภายในให้) · coupon = แลกเป็นคูปองที่สร้างไว้ในเมนูคูปอง
--   tiers: ระดับสมาชิกที่แลกได้ (NULL = ทุกระดับ) · limit_count/limit_period: แลกได้กี่ครั้งต่อคนต่อช่วงเวลา (NULL = ไม่จำกัด)
--   start_date/end_date: ช่วงวันที่เปิดให้แลก (เวลาไทย, NULL = ไม่กำหนด)
ALTER TABLE rewards ADD COLUMN kind text NOT NULL DEFAULT 'general' CHECK (kind IN ('general','coupon'));
ALTER TABLE rewards ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE rewards ADD COLUMN image_id int REFERENCES coupon_images(id);
ALTER TABLE rewards ADD COLUMN tiers text[];
ALTER TABLE rewards ADD COLUMN limit_count int CHECK (limit_count > 0);
ALTER TABLE rewards ADD COLUMN limit_period text NOT NULL DEFAULT 'all' CHECK (limit_period IN ('day','week','month','year','all'));
ALTER TABLE rewards ADD COLUMN start_date date;
ALTER TABLE rewards ADD COLUMN end_date date;
