-- บัญชีพนักงาน: บังคับเปลี่ยนรหัสผ่านครั้งแรก + เวลาเข้าระบบล่าสุด
-- บัญชีเริ่มต้น admin / admin ถูกสร้างตอนเปิด server (ต้องใช้ scrypt จึงทำใน SQL ไม่ได้)
ALTER TABLE staff ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
ALTER TABLE staff ADD COLUMN last_login_at timestamptz;
ALTER TABLE staff ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();
