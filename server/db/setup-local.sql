-- รันครั้งเดียวด้วยผู้ใช้ postgres หลังติดตั้ง PostgreSQL ลงเครื่อง:
--   psql -U postgres -f db/setup-local.sql
-- เปลี่ยนรหัสผ่านก่อนใช้ แล้วใส่ให้ตรงกับ DATABASE_URL ใน .env
CREATE ROLE crm_app LOGIN PASSWORD 'change-me';
CREATE DATABASE crm OWNER crm_app ENCODING 'UTF8' TEMPLATE template0;
CREATE DATABASE crm_test OWNER crm_app ENCODING 'UTF8' TEMPLATE template0;   -- สำหรับ npm test (ถูกล้างทุกครั้งที่ทดสอบ)
