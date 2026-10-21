-- ระดับ Diamond · คูปองเลือกได้หลายระดับ · คูปองของขวัญส่งอัตโนมัติตามรอบ

-- Diamond เมื่อแต้มสะสม 12 เดือนถึง diamond_at (NULL = ไม่ใช้ระดับ Diamond)
ALTER TABLE earn_rules ADD COLUMN diamond_at int CHECK (diamond_at IS NULL OR diamond_at > 0);

ALTER TABLE coupon_templates DROP CONSTRAINT IF EXISTS coupon_templates_audience_tier_check;
ALTER TABLE coupon_templates ADD CONSTRAINT coupon_templates_audience_tier_check CHECK (audience_tier IN ('all','SILVER','GOLD','PLATINUM','DIAMOND'));
-- ระดับที่ได้คูปอง (NULL = ทุกระดับ) แทน audience_tier ที่เลือกได้ระดับเดียว
ALTER TABLE coupon_templates ADD COLUMN audience_tiers text[];
UPDATE coupon_templates SET audience_tiers = ARRAY[audience_tier] WHERE audience_tier <> 'all';
UPDATE coupon_templates SET audience_tier = 'all';

-- ของขวัญส่งอัตโนมัติ: ทุกเดือนวันที่ sched_day / ทุกสัปดาห์วัน sched_day (0 = อาทิตย์) / ครั้งเดียววันที่ sched_date · เวลา sched_time (เวลาไทย)
-- sched_since: รอบที่เกิดก่อนเวลานี้ไม่ส่งย้อนหลัง (ตั้งตอนเปิดส่งอัตโนมัติหรือเปลี่ยนรอบ)
-- round_limit: จำนวนคนต่อรอบ (NULL = ไม่จำกัด) เลือกตาม round_pick · per_member: ใบต่อคนต่อรอบ
ALTER TABLE coupon_templates
  ADD COLUMN auto_send   boolean NOT NULL DEFAULT false,
  ADD COLUMN sched_kind  text CHECK (sched_kind IN ('monthly','weekly','once')),
  ADD COLUMN sched_day   int,
  ADD COLUMN sched_date  date,
  ADD COLUMN sched_time  time NOT NULL DEFAULT '09:00',
  ADD COLUMN sched_since timestamptz,
  ADD COLUMN round_limit int CHECK (round_limit IS NULL OR round_limit > 0),
  ADD COLUMN round_pick  text NOT NULL DEFAULT 'points' CHECK (round_pick IN ('points','recent','random')),
  ADD COLUMN per_member  int NOT NULL DEFAULT 1 CHECK (per_member BETWEEN 1 AND 10),
  ADD COLUMN notify_line boolean NOT NULL DEFAULT false;

-- รอบที่ส่งแล้ว (กันส่งซ้ำ: 1 แถวต่อคูปองต่อรอบ)
CREATE TABLE coupon_rounds (
  id          serial PRIMARY KEY,
  template_id int NOT NULL REFERENCES coupon_templates(id) ON DELETE CASCADE,
  round_key   text NOT NULL,
  due_at      timestamptz NOT NULL,
  run_at      timestamptz NOT NULL DEFAULT now(),
  eligible    int NOT NULL DEFAULT 0,
  members     int NOT NULL DEFAULT 0,
  issued      int NOT NULL DEFAULT 0,
  UNIQUE (template_id, round_key)
);
