-- บังคับให้ลูกค้าเพิ่มเพื่อน LINE OA ของแบรนด์ก่อนสมัครสมาชิกผ่าน LIFF
-- มีผลเมื่อแบรนด์ใส่ LINE OA ID (oa_basic_id) และตั้ง LINE_<BRAND>_TOKEN แล้วเท่านั้น
ALTER TABLE brands ADD COLUMN require_follow boolean NOT NULL DEFAULT true;
