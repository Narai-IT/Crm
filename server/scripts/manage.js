// งานผู้ดูแลระบบจาก command line
//   node --env-file=.env scripts/manage.js pos-key <branchId> [pos|kiosk]     ออก API key ใหม่ให้เครื่อง POS/Kiosk (แสดงครั้งเดียว)
//   node --env-file=.env scripts/manage.js password <staffId> <newPassword>   ตั้งรหัสผ่านพนักงานหลังบ้าน
//   node --env-file=.env scripts/manage.js reset-admin                         คืนบัญชี admin / admin (ผู้ดูแลระบบ) ใช้ตอนเข้าหลังบ้านไม่ได้
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
    const r = await q('UPDATE staff SET password_hash = $2, must_change_password = false, is_active = true WHERE id = $1 RETURNING id', [a, hashPassword(b)]);
    if (!r.length) throw new Error('ไม่พบพนักงาน ' + a);
    console.log('ตั้งรหัสผ่านให้ ' + a + ' แล้ว');
  } else if (cmd === 'reset-admin') {
    const ex = await one("SELECT id, is_active, must_change_password FROM staff WHERE id = 'admin'");
    if (ex) {
      await q("UPDATE staff SET password_hash = $1, must_change_password = true, is_active = true, role = 'super' WHERE id = 'admin'", [hashPassword('admin')]);
      await q("DELETE FROM staff_scopes WHERE staff_id = 'admin'");
      await q("INSERT INTO staff_scopes (staff_id, scope_type, scope_id) VALUES ('admin', 'group', '*')");
      console.log('ตั้งบัญชี admin ใหม่แล้ว (ก่อนหน้านี้: ' + (ex.is_active ? 'ใช้งานอยู่' : 'ถูกปิดใช้งาน') + (ex.must_change_password ? ', ยังไม่เคยเปลี่ยนรหัส' : ', เคยเปลี่ยนรหัสแล้ว') + ')');
    } else {
      const { ensureDefaultAdmin } = await import('../src/auth.js');
      await ensureDefaultAdmin();
      console.log('สร้างบัญชี admin แล้ว (ก่อนหน้านี้ยังไม่มี)');
    }
    console.log('เข้าหลังบ้านด้วย admin / admin แล้วตั้งรหัสผ่านใหม่ทันที');
  } else {
    console.log('คำสั่ง: reset-admin · pos-key <branchId> [pos|kiosk] · password <staffId> <newPassword>');
  }
} catch (e) {
  console.error(e.message); process.exitCode = 1;
} finally {
  await pool.end();
}
