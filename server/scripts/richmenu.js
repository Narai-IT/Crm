// ติดตั้ง Rich Menu ให้ OA ผ่าน Messaging API (กำหนดจุดกดได้ตรงกับรูปจาก tools/richmenu.html)
//   node --env-file=.env scripts/richmenu.js <brand> <ไฟล์รูป .jpg/.png>
//   เช่น node --env-file=.env scripts/richmenu.js humlai C:\Users\Narai\Downloads\richmenu-humlai.jpg
// - ใช้ LINE_<BRAND>_TOKEN และ LIFF_ID จาก .env
// - ตั้งเป็นเมนูเริ่มต้นของทุกคนใน OA นั้น (มีผลเหนือเมนูที่ตั้งใน OA Manager) และลบเมนูเก่าที่สคริปต์นี้เคยสร้าง
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const [brand, file] = process.argv.slice(2);
const token = brand && process.env['LINE_' + brand.toUpperCase() + '_TOKEN'];
const liffId = process.env.LIFF_ID;

async function line(method, url, body, type) {
  const res = await fetch(url, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': type || 'application/json' } : {}) }, body: body && !type ? JSON.stringify(body) : body });
  const text = await res.text();
  if (!res.ok) throw new Error(method + ' ' + url.replace('https://', '') + ' → ' + res.status + ' ' + text);
  return text ? JSON.parse(text) : {};
}

try {
  if (!brand || !file) throw new Error('ใช้: node --env-file=.env scripts/richmenu.js <narai|wakame|humlai> <ไฟล์รูป>');
  if (!token) throw new Error('ยังไม่มี LINE_' + brand.toUpperCase() + '_TOKEN ในไฟล์ .env');
  if (!liffId) throw new Error('ยังไม่มี LIFF_ID ในไฟล์ .env');
  const img = await readFile(file);
  if (img.length > 1024 * 1024) throw new Error('รูปใหญ่เกิน 1 MB (ใช้ปุ่มดาวน์โหลด JPEG ใน tools/richmenu.html)');
  const type = extname(file).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';

  // จุดกด: ซ้ายครึ่งจอ = สมาชิก · ขวาบน = โปรโมชั่น · ขวาล่าง 2 ช่อง = สาขา / ติชม (ตรงกับรูป 2500×1686)
  const menu = {
    size: { width: 2500, height: 1686 }, selected: true, name: 'crm-' + brand, chatBarText: 'เมนู',
    areas: [
      { bounds: { x: 0, y: 0, width: 1250, height: 1686 }, action: { type: 'uri', label: 'สมาชิก', uri: 'https://liff.line.me/' + liffId + '?brand=' + brand } },
      { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: 'message', label: 'โปรโมชั่น', text: 'โปรโมชั่น' } },
      { bounds: { x: 1250, y: 843, width: 625, height: 843 }, action: { type: 'message', label: 'สาขา', text: 'สาขา' } },
      { bounds: { x: 1875, y: 843, width: 625, height: 843 }, action: { type: 'message', label: 'ติชม', text: 'ติชม' } }
    ]
  };

  const old = (await line('GET', 'https://api.line.me/v2/bot/richmenu/list')).richmenus.filter((m) => m.name === menu.name);
  const { richMenuId } = await line('POST', 'https://api.line.me/v2/bot/richmenu', menu);
  await line('POST', 'https://api-data.line.me/v2/bot/richmenu/' + richMenuId + '/content', img, type);
  await line('POST', 'https://api.line.me/v2/bot/user/all/richmenu/' + richMenuId);
  for (const m of old) await line('DELETE', 'https://api.line.me/v2/bot/richmenu/' + m.richMenuId);
  console.log('ติดตั้ง Rich Menu ของ ' + brand + ' แล้ว (' + richMenuId + ')' + (old.length ? ' · ลบเมนูเก่า ' + old.length + ' อัน' : ''));
  console.log('ปิดแล้วเปิดแชท OA ใหม่ในแอป LINE เพื่อดูเมนู (อาจใช้เวลาสักครู่)');
} catch (e) {
  console.error('ติดตั้งไม่สำเร็จ: ' + e.message);
  process.exitCode = 1;
}
