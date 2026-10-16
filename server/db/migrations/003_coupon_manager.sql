-- จัดการคูปองเต็มรูปแบบ: ประเภท รูป รายละเอียด ช่วงวันใช้/วันแจก กลุ่มผู้รับ วันในสัปดาห์ที่ใช้ได้ จำนวนจำกัด
-- kind: internal = แม่แบบที่ระบบสร้างเอง (ของรางวัล/แคมเปญ) ไม่โชว์ในหน้าคูปอง
--       general = แจกอัตโนมัติให้สมาชิกที่ตรงเงื่อนไข · code = ได้เมื่อกรอกโค้ด · birthday = แจกในเดือนเกิด
--       welcome = แจกตอนสมัคร · gift = พนักงานมอบให้รายคน
ALTER TABLE coupon_templates
  ADD COLUMN kind           text NOT NULL DEFAULT 'internal' CHECK (kind IN ('internal','general','code','birthday','welcome','gift')),
  ADD COLUMN description    text NOT NULL DEFAULT '',
  ADD COLUMN image_id       int,
  ADD COLUMN validity       text NOT NULL DEFAULT 'days' CHECK (validity IN ('dates','days')),
  ADD COLUMN valid_from     timestamptz,
  ADD COLUMN valid_to       timestamptz,
  ADD COLUMN issue_from     timestamptz,
  ADD COLUMN issue_to       timestamptz,
  ADD COLUMN audience_tier  text NOT NULL DEFAULT 'all' CHECK (audience_tier IN ('all','SILVER','GOLD','PLATINUM')),
  ADD COLUMN followers_only boolean NOT NULL DEFAULT false,
  ADD COLUMN use_days       int NOT NULL DEFAULT 127 CHECK (use_days BETWEEN 1 AND 127),   -- bit 0 = อาทิตย์ ... bit 6 = เสาร์
  ADD COLUMN max_issue      int CHECK (max_issue IS NULL OR max_issue > 0),             -- จำนวนใบทั้งหมด (NULL = ไม่จำกัด)
  ADD COLUMN max_discount   numeric(10,2),                                              -- เพดานส่วนลดของคูปอง %
  ADD COLUMN is_active      boolean NOT NULL DEFAULT true,
  ADD COLUMN created_by     text,
  ADD COLUMN created_at     timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN updated_at     timestamptz NOT NULL DEFAULT now();

-- รูปคูปองเก็บในฐานข้อมูล (สำรองข้อมูลไปพร้อมกัน และเสิร์ฟผ่าน /api/public ที่เปิดให้ LINE อยู่แล้ว)
CREATE TABLE coupon_images (
  id         serial PRIMARY KEY,
  brand_id   text REFERENCES brands(id),
  mime       text NOT NULL,
  data       bytea NOT NULL,
  created_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE coupon_templates ADD FOREIGN KEY (image_id) REFERENCES coupon_images(id);

-- ของเดิม: คูปองต้อนรับของแต่ละแบรนด์ และคูปองที่ผูกกับโค้ด
UPDATE coupon_templates t SET kind = 'welcome' FROM brands b WHERE b.welcome_template_id = t.id;
UPDATE coupon_templates SET kind = 'code' WHERE id IN (SELECT coupon_template_id FROM promo_codes) AND kind = 'internal';

ALTER TABLE member_coupons DROP CONSTRAINT member_coupons_source_check;
ALTER TABLE member_coupons ADD CONSTRAINT member_coupons_source_check CHECK (source IN ('welcome','redeem','campaign','code','birthday','manual','auto','gift'));
CREATE INDEX ON member_coupons(template_id);
CREATE INDEX ON coupon_templates(brand_id, kind) WHERE kind <> 'internal';
