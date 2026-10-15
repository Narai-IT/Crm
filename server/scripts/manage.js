// งานผู้ดูแลระบบจาก command line
//   node --env-file=.env scripts/manage.js pos-key <branchId> [pos|kiosk]     ออก API key ใหม่ให้เครื่อง POS/Kiosk (แสดงครั้งเดียว)
//   node --env-file=.env scripts/manage.js password <staffId> <newPassword>   ตั้งรหัสผ่านพนักงานหลังบ้าน
import crypto from 'node:crypto';
import { pool, one, q } from '../src/db.js';
import { sha256, hashPassword } from '../src/util.js';

const [cmd, a, b] = process.argv.slice(2);
try {
  if (cmd === 'pos-key') {
    const br = await one('SELECT id FROM branches WHERE id = $1', [a]);
    if (!br) throw new Error('ไม่พบสาขา ' + a);
    const kind = b === 'kiosk' ? 'kiosk' : 'pos';
    const id = kind.toUpperCase() + '-' + a + '-' + crypto.randomBytes(2).toString('hex').toUpperCase();
    const key = 'crm_' + crypto.randomBytes(24).toString('base64url');
    await q('INSERT INTO pos_terminals (id, branch_id, kind, api_key_hash) VALUES ($1,$2,$3,$4)', [id, a, kind, sha256(key)]);
    console.log('เครื่อง ' + id + '\nAPI key (เก็บไว้ในเครื่อง POS ระบบจะไม่แสดงอีก): ' + key);
  } else if (cmd === 'password') {
    if (!a || !b || b.length < 8) throw new Error('ใช้: password <staffId> <รหัสผ่านอย่างน้อย 8 ตัว>');
    const r = await q('UPDATE staff SET password_hash = $2 WHERE id = $1 RETURNING id', [a, hashPassword(b)]);
    if (!r.length) throw new Error('ไม่พบพนักงาน ' + a);
    console.log('ตั้งรหัสผ่านให้ ' + a + ' แล้ว');
  } else {
    console.log('คำสั่ง: pos-key <branchId> [pos|kiosk] · password <staffId> <newPassword>');
  }
} catch (e) {
  console.error(e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
