# Group CRM · Server

Backend ของระบบสมาชิกหลายแบรนด์ หลายสาขา: REST API + LINE webhook + งานเบื้องหลัง บน **PostgreSQL**
เซิร์ฟเวอร์ตัวนี้เสิร์ฟหน้า `demo/` ให้ด้วย เมื่อเปิด `DEV_MODE=1` หน้าเดโมจะใช้ข้อมูลจริงจากฐานข้อมูลทันที

- Node.js 20.6 ขึ้นไป (แนะนำ 22 LTS) · ใช้ไลบรารีภายนอกตัวเดียวคือ `pg`
- PostgreSQL 14 ขึ้นไป (แนะนำ 16)

## ติดตั้งบนเครื่อง (ครั้งแรก)

### 1. ติดตั้ง PostgreSQL

**Windows**
1. ดาวน์โหลดตัวติดตั้ง PostgreSQL 16 จาก https://www.postgresql.org/download/windows/ (EDB installer)
2. ติดตั้งตามค่าเริ่มต้น ตั้งรหัสผ่านของผู้ใช้ `postgres` แล้วจดไว้ · พอร์ต `5432`
3. เปิด **SQL Shell (psql)** จากเมนู Start แล้วกด Enter ผ่านค่าเริ่มต้น ใส่รหัสผ่าน `postgres`

**macOS**: `brew install postgresql@16 && brew services start postgresql@16`

**ทางเลือก Docker**: ในโฟลเดอร์ `server/` รัน `docker compose up -d` แล้วข้ามไปข้อ 3 (ใช้ `DATABASE_URL=postgres://crm_app:crm_dev_password@localhost:5432/crm`)

### 2. สร้างฐานข้อมูลและผู้ใช้ของแอป

แก้รหัสผ่าน `change-me` ใน `db/setup-local.sql` ก่อน แล้วรัน

```bash
psql -U postgres -f db/setup-local.sql
```

(Windows ใน SQL Shell: `\i 'C:/path/to/Crm/server/db/setup-local.sql'`)

ได้ฐานข้อมูล `crm` (ใช้งาน) และ `crm_test` (สำหรับทดสอบอัตโนมัติ) โดยแอปใช้ผู้ใช้ `crm_app` ที่ไม่ใช่ superuser

### 3. ตั้งค่าและติดตั้ง

```bash
cd server
cp .env.example .env          # Windows: copy .env.example .env
```

เปิด `.env` แก้ `DATABASE_URL` / `TEST_DATABASE_URL` ให้รหัสผ่านตรงกับข้อ 2 และสุ่ม `APP_SECRET` ใหม่

```bash
npm install
npm run db:migrate            # สร้างตาราง (schema crm)
npm run db:seed               # แบรนด์ สาขา กฎแต้ม รางวัล พนักงาน + สมาชิกตัวอย่าง (เมื่อ DEV_MODE=1)
npm start
```

เปิด http://localhost:3000 จะเห็นหน้าเดโมเดิม แต่หัวเว็บขึ้นว่า **"เชื่อมฐานข้อมูล PostgreSQL จริง"** ทุกปุ่มบันทึกลงฐานข้อมูลจริง

> ให้ลูกค้าลองบนมือถือ: เปิด `http://<IP เครื่องนี้>:3000` จากมือถือในวง Wi-Fi เดียวกัน แล้วเปิดแท็บ POS บนโน้ตบุ๊ก หน้าจอทั้งสองดึงข้อมูลชุดเดียวกัน (อัปเดตทุก 4 วินาที)

## คำสั่งที่ใช้บ่อย

| คำสั่ง | ทำอะไร |
|---|---|
| `npm run dev` | รันแบบรีสตาร์ตอัตโนมัติเมื่อแก้โค้ด |
| `npm test` | ทดสอบทั้ง flow กับ `TEST_DATABASE_URL` (ฐานข้อมูลนี้ถูกล้างทุกครั้ง) |
| `npm run db:reset` | ลบข้อมูลทั้งหมดแล้ว seed ใหม่ (ทำได้เฉพาะ `DEV_MODE=1`) |
| `node --env-file=.env scripts/manage.js pos-key HL01` | ออก API key ใหม่ให้เครื่อง POS ของสาขา |
| `node --env-file=.env scripts/manage.js password S001 <รหัสใหม่>` | ตั้งรหัสผ่านพนักงานหลังบ้าน |

ข้อมูล seed สำหรับทดสอบ: พนักงาน `S001`–`S007` รหัสผ่าน `demo1234` · API key POS ตัวอย่าง `pos-hl01-demo-key` · โค้ดคูปอง `NEWMENU` · สมาชิกตัวอย่าง `MB-0012845` / `0812345678`

## โครงสร้าง

```
server/
  db/migrations/001_init.sql   ตารางทั้งหมด (สมาชิก กระเป๋าแต้ม ledger/lots คูปอง ธุรกรรม แคมเปญ สิทธิ์ audit outbox)
  scripts/                     migrate · seed · manage
  src/
    index.js                   HTTP server + เสิร์ฟ demo/
    auth.js                    LINE ID token (ลูกค้า) · API key (POS) · token + สิทธิ์ (หลังบ้าน)
    services/core.js           แต้ม (atomic + idempotent), คูปอง, สมัคร/OTP, ขาย/คืนเงิน, ปรับแต้ม
    services/line.js           ตรวจลายเซ็น webhook, ตอบ Rich Menu, สร้าง Flex, ส่งผ่าน outbox
    routes/                    liff · pos · admin · webhook · dev
    worker.js                  ส่งข้อความหลัง commit, แต้ม/คูปองหมดอายุ
  test/api.test.js             ทดสอบ flow หลัก 10 กรณี
```

## API

| กลุ่ม | ยืนยันตัวตน | Endpoint |
|---|---|---|
| ลูกค้า (LIFF) | `Authorization: Bearer <LINE ID token>` | `GET /api/liff/me` · `POST /api/liff/otp` · `POST /api/liff/register` · `GET /api/liff/qr` · `GET /api/liff/coupons` · `POST /api/liff/coupons/claim` · `GET /api/liff/rewards` · `POST /api/liff/redemptions` (ต้องมี `Idempotency-Key`) · `GET /api/liff/bills` · `GET /api/liff/ledger` · `PATCH /api/liff/consents` · `POST /api/liff/tax-invoice-requests` |
| หน้าร้าน | `X-Api-Key` ของเครื่อง (ผูกกับสาขา) | `POST /api/pos/members/resolve` · `POST /api/pos/transactions` (เลขบิลกันซ้ำ) · `POST /api/pos/refunds` · `POST /api/pos/point-requests` · `GET /api/pos/bills` |
| หลังบ้าน | `POST /api/admin/login` → `Authorization: Bearer <token>` | dashboard · members · point-adjustments (+approve/reject) · earn-rules · rewards · campaigns (+preview) · branches · staff · audit-logs · line-channels |
| LINE | `X-Line-Signature` | `POST /webhooks/line/{narai|wakame|humlai}` |

ตัวอย่างเรียกจาก POS:

```bash
curl -X POST http://localhost:3000/api/pos/transactions \
  -H 'content-type: application/json' -H 'x-api-key: pos-hl01-demo-key' \
  -d '{"posBillId":"HL01-000123","memberId":"MB-0012845","items":[{"id":"h1","name":"ข้าวมันไก่","price":70,"qty":2}]}'
```

ส่งบิลเดิมซ้ำได้อย่างปลอดภัย ระบบตอบ `duplicate: true` และไม่ให้แต้มซ้ำ

## ก่อนเปิดใช้จริง

1. ตั้ง `DEV_MODE=0` (ปิด `/api/dev/*`, ปิดการสวมบทผู้ใช้, OTP ไม่แสดงบนจอ)
2. สุ่ม `APP_SECRET` ใหม่ · ตั้งรหัสผ่านพนักงานทุกคนด้วย `scripts/manage.js` · ออก API key POS ใหม่ทุกสาขา และลบ key ตัวอย่าง
3. ใส่ `LINE_LOGIN_CHANNEL_ID`, `LIFF_ID` และ secret/token ของแต่ละ OA (OA ทั้งหมด + LINE Login ต้องอยู่ Provider เดียวกัน)
4. ตั้ง Webhook URL ของแต่ละ OA เป็น `https://<โดเมน>/webhooks/line/<brand>` (ต้องเป็น HTTPS)
5. สมัครสมาชิก: ค่าเริ่มต้น `REQUIRE_PHONE_OTP=0` ลูกค้ากรอกเบอร์อย่างเดียว (LINE ยืนยันตัวตนให้แล้ว) · เบอร์ที่เป็นสมาชิกอยู่แล้วระบบจะไม่ผูกให้เอง ต้องให้พนักงานผูก · ถ้าต้องการยืนยันเบอร์ด้วย SMS ให้ต่อผู้ให้บริการ SMS (งาน `sms_otp` เข้าคิวไว้แต่ยังไม่ส่ง) แล้วตั้ง `REQUIRE_PHONE_OTP=1`
6. ใช้ PostgreSQL แบบ managed (เช่น Cloud SQL / RDS / Supabase ใน region กรุงเทพหรือสิงคโปร์) เปิด backup อัตโนมัติ
7. หน้า LIFF จริงอยู่ที่ `/liff/` (โฟลเดอร์ `liff/`) ใช้ `liff.getIDToken()` เป็น Bearer token · ขั้นตอนตั้งค่าทั้งหมดอยู่ใน [docs/LINE-SETUP.md](../docs/LINE-SETUP.md)
