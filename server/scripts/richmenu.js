// ติดตั้ง Rich Menu ให้ OA ผ่าน Messaging API (แบบใหญ่ 4 ช่อง ตรงกับรูปจาก tools/richmenu.html)
//   node --env-file=.env scripts/richmenu.js <brand> <ไฟล์รูป .jpg/.png>
//   เช่น node --env-file=.env scripts/richmenu.js humlai C:\Users\Narai\Downloads\richmenu-humlai.jpg
// - ใช้ LINE_<BRAND>_TOKEN และ LIFF_ID จาก .env
// - ตั้งเป็นเมนูเริ่มต้นของทุกคนใน OA นั้น (มีผลเหนือเมนูที่ตั้งใน OA Manager) และลบเมนูเก่าที่ระบบเคยสร้าง
// - ทำแบบเดียวกันได้ที่หลังบ้าน เมนู "ริชเมนู LINE" (เลือกแบบช่อง/ปุ่ม และย้อนกลับเมนูเดิมได้)
import { readFile } from 'node:fs/promises';
import { DEFAULT_ACTIONS, checkImage, install } from '../src/services/richmenu.js';

const [brand, file] = process.argv.slice(2);

try {
  if (!brand || !file) throw new Error('ใช้: node --env-file=.env scripts/richmenu.js <narai|wakame|humlai> <ไฟล์รูป>');
  const img = await readFile(file);
  const info = checkImage(img, 'l4');
  const r = await install({ brandId: brand, token: process.env['LINE_' + brand.toUpperCase() + '_TOKEN'], liffId: process.env.LIFF_ID,
    layout: 'l4', actions: DEFAULT_ACTIONS, chatBar: 'เมนู', image: img, mime: info.mime });
  console.log('ติดตั้ง Rich Menu ของ ' + brand + ' แล้ว (' + r.richMenuId + ')' + (r.removed ? ' · ลบเมนูเก่า ' + r.removed + ' อัน' : ''));
  console.log('ปิดแล้วเปิดแชท OA ใหม่ในแอป LINE เพื่อดูเมนู (อาจใช้เวลาสักครู่)');
} catch (e) {
  console.error('ติดตั้งไม่สำเร็จ: ' + e.message);
  process.exitCode = 1;
}
