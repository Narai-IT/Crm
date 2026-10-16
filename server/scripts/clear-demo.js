// ล้างข้อมูลตัวอย่าง ก่อนเริ่มใช้งานจริง
//   node --env-file=.env scripts/clear-demo.js              ดูว่าจะลบอะไรบ้าง (ยังไม่ลบ)
//   node --env-file=.env scripts/clear-demo.js --yes        ลบจริง
//   node --env-file=.env scripts/clear-demo.js --settings --yes   ลบของรางวัล คูปอง และสาขาตัวอย่างด้วย (ตั้งใหม่เองในหลังบ้าน)
//
// ลบเสมอ: สมาชิกทั้งหมด (รวมคนที่ลองสมัครผ่าน LINE) แต้ม คูปองที่แจกแล้ว บิล คืนเงิน คำขอปรับแต้ม แคมเปญ ประวัติแชท
//         พนักงานตัวอย่าง S001–S007 และ API key POS ตัวอย่าง · เลขสมาชิกเริ่มใหม่ที่ MB-0000001
// เก็บไว้: แบรนด์ การตั้งค่า LINE กฎแต้ม ผู้ใช้หลังบ้านที่สร้างเอง (รวม admin) ประวัติการแก้ไข
//         รายชื่อคนที่เป็นเพื่อนกับ OA จริง (สมัครใหม่แล้วผูกกับ OA ให้อัตโนมัติ)
import { pool, tx, q } from '../src/db.js';
import { sha256 } from '../src/util.js';
import { ensureDefaultAdmin } from '../src/auth.js';

const yes = process.argv.includes('--yes');
const settings = process.argv.includes('--settings');
const DEMO_STAFF = ['S001', 'S002', 'S003', 'S004', 'S005', 'S006', 'S007'];

async function counts() {
  const branches = (await q('SELECT id FROM branches')).map((b) => b.id);
  const demoKeys = branches.map((b) => sha256('pos-' + b.toLowerCase() + '-demo-key'));
  const one = async (sql, p) => (await q(sql, p))[0].n;
  return {
    demoKeys,
    rows: [
      ['สมาชิก', await one('SELECT count(*)::int AS n FROM members')],
      ['บิลขาย', await one('SELECT count(*)::int AS n FROM sales_transactions')],
      ['รายการแต้ม', await one('SELECT count(*)::int AS n FROM point_ledger')],
      ['คูปองที่แจกแล้ว', await one('SELECT count(*)::int AS n FROM member_coupons')],
      ['คำขอปรับแต้ม', await one('SELECT count(*)::int AS n FROM point_adjust_requests')],
      ['แคมเปญ', await one('SELECT count(*)::int AS n FROM campaigns')],
      ['ข้อความ LINE ในระบบ', await one('SELECT count(*)::int AS n FROM line_messages')],
      ['พนักงานตัวอย่าง (S001–S007)', await one('SELECT count(*)::int AS n FROM staff WHERE id = ANY($1)', [DEMO_STAFF])],
      ['API key POS ตัวอย่าง', await one('SELECT count(*)::int AS n FROM pos_terminals WHERE api_key_hash = ANY($1)', [demoKeys])],
      ...(settings ? [
        ['ของรางวัล', await one('SELECT count(*)::int AS n FROM rewards')],
        ['คูปอง/แม่แบบคูปอง', await one('SELECT count(*)::int AS n FROM coupon_templates')],
        ['โค้ดคูปอง', await one('SELECT count(*)::int AS n FROM promo_codes')],
        ['สาขา', await one('SELECT count(*)::int AS n FROM branches')]
      ] : [])
    ]
  };
}

try {
  const before = await counts();
  console.log((yes ? 'กำลังลบ' : 'จะลบ') + (settings ? ' (รวมของรางวัล คูปอง และสาขา)' : '') + ':');
  for (const [k, n] of before.rows) console.log('  - ' + k + ': ' + n);
  if (!yes) {
    console.log('\nยังไม่ได้ลบอะไร ถ้าถูกต้องให้รันซ้ำพร้อม --yes');
    console.log('แนะนำให้สำรองฐานข้อมูลก่อน: pg_dump -U postgres -d crm -F c -f crm-before-clear.backup');
  } else {
    await tx(async (db) => {
      // ลำดับตาม foreign key: ลูกก่อนแม่
      await db.q('DELETE FROM tax_invoice_requests');
      await db.q('DELETE FROM refunds');
      await db.q('DELETE FROM member_coupons');
      await db.q('DELETE FROM point_lots');
      await db.q('DELETE FROM point_ledger');
      await db.q('DELETE FROM wallets');
      await db.q('DELETE FROM point_adjust_requests');
      await db.q('DELETE FROM campaign_recipients');
      await db.q('DELETE FROM campaigns');
      await db.q('DELETE FROM sales_transactions');
      await db.q('DELETE FROM member_brand_links');
      await db.q('DELETE FROM member_line_identities');
      await db.q('DELETE FROM members');
      await db.q('DELETE FROM otp_requests');
      await db.q('DELETE FROM line_messages');
      await db.q('DELETE FROM outbox');
      // ผู้ติดตามปลอมจาก seed / ผู้ใช้ทดสอบในเบราว์เซอร์ (ID จริงของ LINE ขึ้นต้น U ตามด้วยเลขฐาน 16 เท่านั้น)
      await db.q("DELETE FROM line_followers WHERE line_user_id !~ '^U[0-9a-f]{32}$'");
      await db.q('DELETE FROM staff_scopes WHERE staff_id = ANY($1)', [DEMO_STAFF]);
      await db.q('DELETE FROM staff WHERE id = ANY($1)', [DEMO_STAFF]);
      await db.q('DELETE FROM pos_terminals WHERE api_key_hash = ANY($1)', [before.demoKeys]);
      await db.q("UPDATE branches SET pos_last_seen = NULL");
      if (settings) {
        await db.q('DELETE FROM rewards');
        await db.q('DELETE FROM promo_codes');
        await db.q('UPDATE brands SET welcome_template_id = NULL');
        await db.q('DELETE FROM coupon_templates');
        await db.q('DELETE FROM coupon_images');
        await db.q('DELETE FROM pos_terminals');
        await db.q("DELETE FROM staff_scopes WHERE scope_type = 'branch'");
        await db.q('DELETE FROM branches');
      }
      await db.q('ALTER SEQUENCE member_no RESTART WITH 1');
      await db.q(`INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, detail) VALUES ('system', 'clear-demo', 'สคริปต์ล้างข้อมูลตัวอย่าง', 'clear_demo', $1)`,
        [before.rows.map(([k, n]) => k + ' ' + n).join(' · ')]);
    });
    if (await ensureDefaultAdmin()) console.log('สร้างบัญชี admin / admin ไว้ให้ (ยังไม่มีผู้ดูแลระบบ)');
    const left = await q("SELECT id, name, role FROM staff WHERE is_active ORDER BY id");
    console.log('\nล้างข้อมูลตัวอย่างเรียบร้อย · สมาชิกคนแรกจะได้เลข MB-0000001');
    console.log('ผู้ใช้หลังบ้านที่เหลือ: ' + (left.map((s) => s.id).join(', ') || '-'));
    if (settings) console.log('เข้าหลังบ้านเพื่อเพิ่มสาขา ของรางวัล และคูปองจริงได้เลย (สมัครสมาชิกต้องมีสาขาอย่างน้อย 1 สาขา)');
    console.log('ออก API key ให้เครื่อง POS แต่ละสาขา: node --env-file=.env scripts/manage.js pos-key <รหัสสาขา>');
  }
} catch (e) {
  console.error('ล้างข้อมูลไม่สำเร็จ (ยังไม่มีอะไรถูกลบ): ' + e.message);
  process.exitCode = 1;
} finally {
  await pool.end();
}
