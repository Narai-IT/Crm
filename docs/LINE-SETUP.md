# ตั้งค่า LINE ให้ต่อกับระบบ CRM

ตัวอย่างใช้โดเมน `https://crm.naraipizzeria.com` (ผ่าน Cloudflare Tunnel) · ทำตามลำดับ

## 0. ก่อนเริ่ม

- ได้สิทธิ์ **Admin** ใน LINE Official Account Manager ของทั้ง 3 OA และสิทธิ์ **Admin** ใน Provider บน LINE Developers Console
- **OA ทั้ง 3 + LINE Login channel ต้องอยู่ Provider เดียวกัน** (เลือกตอนเปิด Messaging API และย้ายภายหลังไม่ได้) เพื่อให้ลูกค้าคนเดิมได้ LINE userId เดียวกันทุก OA

## 1. เปิด Messaging API ให้แต่ละ OA

ทำทีละ OA: https://manager.line.biz → เลือก OA → **ตั้งค่า → Messaging API → เปิดใช้งาน** → เลือก Provider เดียวกันทั้งหมด

จากนั้นที่ https://developers.line.biz/console/ → Provider → channel ของ OA นั้น:

| เก็บค่า | อยู่ที่ |
|---|---|
| Channel secret | แท็บ Basic settings |
| Channel access token (long-lived) | แท็บ Messaging API → Issue |

ในแท็บ Messaging API ตั้ง

| OA | Webhook URL |
|---|---|
| Narai | `https://crm.naraipizzeria.com/webhooks/line/narai` |
| Wakame | `https://crm.naraipizzeria.com/webhooks/line/wakame` |
| หำไหล | `https://crm.naraipizzeria.com/webhooks/line/humlai` |

แล้วเปิด **Use webhook** · ใน OA Manager ปิด **ข้อความตอบกลับอัตโนมัติ** (Auto-reply) เพื่อไม่ให้ตอบซ้ำกับระบบ

## 2. สร้าง LINE Login channel + LIFF app (ทำครั้งเดียว ใช้ร่วมทุกแบรนด์)

1. Provider เดียวกัน → **Create a new channel → LINE Login** · App types เลือก **Web app**
2. เก็บ **Channel ID** (แท็บ Basic settings)
3. แท็บ **LIFF → Add**

| ช่อง | ใส่ |
|---|---|
| LIFF app name | สมาชิก |
| Size | **Full** |
| Endpoint URL | `https://crm.naraipizzeria.com/liff/` |
| Scopes | ติ๊ก **openid** และ **profile** |
| Bot link feature | On (Normal) |

4. เก็บ **LIFF ID** (รูปแบบ `1234567890-AbCdEfGh`)
5. กด **Publish** channel เมื่อพร้อมให้ลูกค้าใช้ (ระหว่าง Developing ใช้ได้เฉพาะคนที่เป็น Tester/Admin)

## 3. ใส่ค่าในไฟล์ `.env` บนเครื่อง server

```
LINE_LOGIN_CHANNEL_ID=<Channel ID ข้อ 2>
LIFF_ID=<LIFF ID ข้อ 2>
LINE_NARAI_SECRET=<Channel secret ของ OA Narai>
LINE_NARAI_TOKEN=<Channel access token ของ OA Narai>
LINE_WAKAME_SECRET=...
LINE_WAKAME_TOKEN=...
LINE_HUMLAI_SECRET=...
LINE_HUMLAI_TOKEN=...
```

แล้วรีสตาร์ต: `nssm restart GroupCRM`

> ค่าเหล่านี้เป็นความลับ ห้ามใส่ใน GitHub หรือส่งในแชท

## 4. Cloudflare Access: เปิดทางให้ LINE และลูกค้า

หน้าหลักทั้งเว็บล็อกด้วยอีเมลไว้ (Application แรก) · สร้าง **Application ที่สอง** สำหรับ path ที่ต้องเปิดสาธารณะ

Zero Trust → Access → Applications → Add → **Self-hosted**
- Name: `CRM public`
- เพิ่ม hostname `crm.naraipizzeria.com` ทีละ path:
  - `liff`
  - `api/liff`
  - `api/public`
  - `api/config`
  - `webhooks`
- Policy: Action **Bypass** · Include **Everyone**

Cloudflare ใช้กฎที่ตรง path มากที่สุด ส่วน `/` (หน้าเดโม), `/api/admin`, `/api/pos`, `/api/dev` ยังต้องล็อกอินด้วยอีเมลตามเดิม

> หมายเหตุความปลอดภัย: ทุก API ของลูกค้าตรวจ LINE ID token ที่ server อยู่แล้ว · webhook ตรวจลายเซ็นของ LINE · ในโหมดทดสอบ การสวมบทผู้ใช้ทำได้เฉพาะ ID ทดสอบ (ไม่ใช่รูปแบบ LINE จริง) จึงเข้าบัญชีลูกค้าจริงไม่ได้

## 5. ทดสอบ

1. ที่ LINE Developers → Messaging API ของแต่ละ OA กด **Verify** ที่ Webhook URL ต้องได้ Success
2. เปิดลิงก์ `https://liff.line.me/<LIFF_ID>?brand=humlai` **ในแอป LINE บนมือถือ** (ส่งลิงก์ให้ตัวเองในแชท แล้วกด)
   - ต้องเห็นหน้าสมัครสมาชิกสีของหำไหล · ไม่มีแถบเหลือง "โหมดทดสอบ"
3. สมัคร → ได้ข้อความ Flex "ยินดีต้อนรับ" ในแชท OA หำไหล
4. แอดเพื่อน OA Wakame → ได้ข้อความทักทายและบอกว่าพบบัญชีสมาชิกเดิม

## 6. Rich Menu (4 ปุ่ม ตามแบบที่ออกแบบไว้)

สร้างใน OA Manager → **Rich menu** → เทมเพลต 1 ช่องใหญ่ซ้าย + 3 ช่องขวา (ขนาดภาพ 2500×1686)

| ปุ่ม | Action | ค่า |
|---|---|---|
| สมาชิก (ช่องใหญ่) | ลิงก์ | `https://liff.line.me/<LIFF_ID>?brand=<narai|wakame|humlai>` |
| โปรโมชั่น | ข้อความ | `โปรโมชั่น` |
| สาขา | ข้อความ | `สาขา` |
| ติชม | ข้อความ | `ติชม` |

แต่ละ OA ใช้ `brand=` ของตัวเอง ระบบตอบปุ่มข้อความให้อัตโนมัติผ่าน webhook

## 7. ก่อนเปิดให้ลูกค้าจริง

- ตั้ง `DEV_MODE=0` ใน `.env` แล้ว `nssm restart GroupCRM` (ปิดหน้าเดโม/ปุ่มล้างข้อมูล/OTP บนจอ)
- ต่อผู้ให้บริการ SMS สำหรับ OTP (ตอนนี้ระบบเข้าคิวไว้แต่ยังไม่ส่ง)
- ล้างข้อมูลตัวอย่าง: `npm run db:reset` ก่อนตั้ง `DEV_MODE=0` แล้วรัน `node --env-file=.env scripts/seed.js --no-demo`
- เปลี่ยนรหัสผ่านพนักงาน และออก API key POS ใหม่ (`scripts/manage.js`)
- เปลี่ยน token ของ Cloudflare Tunnel (เคยแชร์ในแชท)
