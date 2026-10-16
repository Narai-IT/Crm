# Group CRM

ระบบสมาชิก (CRM) สำหรับหลายแบรนด์ หลายสาขา ผูกกับ LINE OA แยกตามแบรนด์ แต่ใช้ฐานสมาชิกกลางร่วมกัน (แบบ C)

- [`demo/`](demo/index.html): เดโมที่ใช้งานได้จริง เปิด `demo/index.html` ในเบราว์เซอร์ได้เลย มี 3 มุมมองที่ใช้ข้อมูลชุดเดียวกัน
  - **ลูกค้า (LINE)**: แชท OA + Rich Menu + LIFF (สมัคร, บัตร QR, คูปอง, แลกแต้ม, ประวัติ, ความยินยอมรายแบรนด์)
  - **หน้าร้าน POS**: เครื่องแคชเชียร์ (สแกน QR, ใช้คูปอง, ปิดบิล, คืนเงิน, ขอแต้มย้อนหลัง) และ Kiosk สั่งเองที่โต๊ะ
  - **หลังบ้าน**: ภาพรวม KPI, สมาชิก 360°, อนุมัติแต้ม, กฎแต้ม, รางวัล, แคมเปญ, LINE OA, สาขา, สิทธิ์, Audit Log
- [`docs/DESIGN.md`](docs/DESIGN.md): สถาปัตยกรรม การตั้งค่า LINE หน้าจอ API ลำดับการทำงาน และกรณีพิเศษ
- [`liff/`](liff/): หน้าสมาชิกตัวจริงที่ลูกค้าเปิดจาก Rich Menu ในแอป LINE (ล็อกอินด้วย LINE, QR สแกนได้จริง) เสิร์ฟที่ `/liff/`
- [`docs/LINE-SETUP.md`](docs/LINE-SETUP.md): ขั้นตอนตั้งค่า LINE OA, LINE Login/LIFF, webhook และ Cloudflare Access
- [`server/`](server/README.md): backend ใช้งานจริงบน **PostgreSQL** (REST API, LINE webhook, งานส่งข้อความ/แต้มหมดอายุ) พร้อมวิธีติดตั้งบนเครื่อง และชุดทดสอบอัตโนมัติ

## เริ่มใช้แบบต่อฐานข้อมูลจริง (บนเครื่อง)

```bash
cd server
cp .env.example .env      # แก้ DATABASE_URL ให้ตรงกับเครื่อง
npm install
npm run db:migrate && npm run db:seed
npm start                 # เปิด http://localhost:3000
```

ขั้นตอนติดตั้ง PostgreSQL บน Windows/macOS อยู่ใน [server/README.md](server/README.md)

ข้อมูลในเดโม (ชื่อ เบอร์ ราคา อัตราแต้ม รางวัล) เป็นตัวอย่างทั้งหมด
