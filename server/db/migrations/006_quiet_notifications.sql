-- ลดข้อความ LINE ที่นับโควต้า
-- แจ้งแต้มหลังชำระบิล: off = ไม่แจ้ง (ค่าเริ่มต้น) · all = ทุกบิล · min = เฉพาะบิลที่ยอดถึง points_notify_min บาท
ALTER TABLE brands ADD COLUMN points_notify text NOT NULL DEFAULT 'off' CHECK (points_notify IN ('off','all','min'));
ALTER TABLE brands ADD COLUMN points_notify_min numeric(10,2) NOT NULL DEFAULT 0;
