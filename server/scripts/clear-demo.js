// ล้างข้อมูลตัวอย่าง ก่อนเริ่มใช้งานจริง
//   node --env-file=.env scripts/clear-demo.js              ดูว่าจะลบอะไรบ้าง (ยังไม่ลบ)
//   node --env-file=.env scripts/clear-demo.js --yes        ลบจริง
//   node --env-file=.env scripts/clear-demo.js --settings --yes   ลบของรางวัล คูปอง และสาขาตัวอย่างด้วย (ตั้งใหม่เองในหลังบ้าน)
//   เพิ่ม --reset-number   ให้เลขสมาชิกเริ่มใหม่ที่ MB-0000001 (ต้องล้างข้อมูลสมาชิกฝั่ง POS ด้วย ดูข้อความตอนรัน)
//
// ลบเสมอ: สมาชิกทั้งหมด (รวมคนที่ลองสมัครผ่าน LINE) แต้ม คูปองที่แจกแล้ว บิล คืนเงิน คำขอปรับแต้ม แคมเปญ ประวัติแชท
//         พนักงานตัวอย่าง S001–S007 และ API key POS ตัวอย่าง · คืนสต็อกของรางวัลที่แลกตอนทดสอบ · ยอดใช้โค้ดคูปองเริ่มที่ 0
//         เลขสมาชิกนับต่อจากเดิม (ไม่ชนกับเลขที่ค้างอยู่ในเครื่อง POS) · ใส่ --reset-number ถ้าต้องการเริ่มที่ MB-0000001
// เก็บไว้: แบรนด์ การตั้งค่า LINE กฎแต้ม ผู้ใช้หลังบ้านที่สร้างเอง (รวม admin) ประวัติการแก้ไข
//         รายชื่อคนที่เป็นเพื่อนกับ OA จริง (สมัครใหม่แล้วผูกกับ OA ให้อัตโนมัติ)
import { pool, tx, q } from '../src/db.js';
import { sha256 } from '../src/util.js';
import { ensureDefaultAdmin } from '../src/auth.js';

const yes = process.argv.includes('--yes');
const settings = process.argv.includes('--settings');
const resetNumber = process.argv.includes('--reset-number');
// ของรางวัลที่ถูกแลกตอนทดสอบ (คูปองยังไม่ถูกยกเลิก) → คืนสต็อก
const STOCK_BACK = `SELECT r.id, r.name, count(*)::int AS n FROM point_ledger l
  JOIN rewards r ON l.ref_type = 'reward' AND r.id::text = l.ref_id AND r.stock IS NOT NULL
  JOIN member_coupons c ON c.source = 'redeem' AND c.source_ref = l.id::text AND c.status <> 'void'
  WHERE l.entry_type = 'redeem' GROUP BY r.id, r.name`;
const DEMO_STAFF = ['S001', 'S002', 'S003', 'S004', 'S005', 'S006', 'S007'];

async function counts() {
  const branches = (await q('SELECT id FROM branches')).map((b) => b.id);
  const demoKeys = branches.map((b) => sha256('pos-' + b.toLowerCase() + '-demo-key'));
  const one = async (sql, p) => (await q(sql, p))[0].n;
  const stockBack = await q(STOCK_BACK);
  // เครื่อง POS ที่ยังใช้ key ตัวอย่างอยู่ (key นี้เปิดเผยใน README ต้องลบ) → ต้องออก key ใหม่ใส่เครื่องก่อน ไม่อย่างนั้นบิลจะส่งเข้า CRM ไม่ได้
  const liveDemo = await q("SELECT branch_id, to_char(last_seen_at AT TIME ZONE 'Asia/Bangkok', 'DD/MM HH24:MI') AS seen FROM pos_terminals WHERE api_key_hash = ANY($1) AND last_seen_at > now() - interval '14 days' ORDER BY branch_id", [demoKeys]);
  return {
    demoKeys, stockBack, liveDemo,
    rows: [
      ['สมาชิก', await one('SELECT count(*)::int AS n FROM members')],
      ['บิลขาย', await one('SELECT count(*)::int AS n FROM sales_transactions')],
      ['รายการแต้ม', await one('SELECT count(*)::int AS n FROM point_ledger')],
      ['คูปองที่แจกแล้ว', await one('SELECT count(*)::int AS n FROM member_coupons')],
      ['คำขอปรับแต้ม', await one('SELECT count(*)::int AS n FROM point_adjust_requests')],
      ['แคมเปญ', await one('SELECT count(*)::int AS n FROM campaigns')],
      ['ข้อความ LINE ในระบบ', await one('SELECT count(*)::int AS n FROM line_messages')],
      ['โน้ต/แท็ก/การยืนยันตัวตนของสมาชิก', await one('SELECT ((SELECT count(*) FROM member_notes) + (SELECT count(*) FROM member_tags) + (SELECT count(*) FROM member_verifications))::int AS n')],
      ['ประวัติรอบส่งคูปองอัตโนมัติ', await one('SELECT count(*)::int AS n FROM coupon_rounds')],
      ['คืนสต็อกของรางวัล (ชิ้น)', stockBack.reduce((a, r) => a + r.n, 0)],
      ['โค้ดคูปองที่ถูกใช้ไปแล้ว (ครั้ง → 0)', await one('SELECT COALESCE(sum(used_count), 0)::int AS n FROM promo_codes')],
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
  for (const r of before.stockBack) console.log('      · ' + r.name + ' +' + r.n);
  const next = (await q('SELECT last_value::bigint + (CASE WHEN is_called THEN 1 ELSE 0 END) AS n FROM member_no'))[0].n;
  console.log('  - เลขสมาชิกคนถัดไป: ' + (resetNumber ? 'MB-0000001 (เริ่มใหม่)' : 'MB-' + String(next).padStart(7, '0') + ' (นับต่อ)'));
  if (before.liveDemo.length) {
    console.log('\n⚠ เครื่อง POS ที่ยังใช้ API key ตัวอย่างอยู่ — หลังล้างจะส่งบิล/สะสมแต้มเข้า CRM ไม่ได้จนกว่าจะใส่ key ใหม่:');
    for (const t of before.liveDemo) console.log('    สาขา ' + t.branch_id + ' (ใช้ล่าสุด ' + t.seen + ')  →  node --env-file=.env scripts/manage.js pos-key ' + t.branch_id);
  }
  if (!yes) {
    console.log('\nยังไม่ได้ลบอะไร ถ้าถูกต้องให้รันซ้ำพร้อม --yes');
    console.log('แนะนำให้สำรองฐานข้อมูลก่อน: pg_dump -U postgres -d crm -F c -f crm-before-clear.backup');
  } else {
    await tx(async (db) => {
      // ลำดับตาม foreign key: ลูกก่อนแม่
      await db.q('DELETE FROM tax_invoice_requests');
      await db.q('DELETE FROM refunds');
      for (const r of before.stockBack) await db.q('UPDATE rewards SET stock = stock + $2 WHERE id = $1', [r.id, r.n]);
      await db.q('UPDATE promo_codes SET used_count = 0');
      await db.q('DELETE FROM coupon_qr_used');
      await db.q('DELETE FROM coupon_rounds');
      await db.q('DELETE FROM member_coupons');
      await db.q('DELETE FROM point_lot_uses');
      await db.q('DELETE FROM point_lots');
      await db.q('DELETE FROM point_ledger');
      await db.q('DELETE FROM wallets');
      await db.q('DELETE FROM point_adjust_requests');
      await db.q('DELETE FROM campaign_recipients');
      await db.q('DELETE FROM campaigns');
      await db.q('DELETE FROM sales_transactions');
      await db.q('DELETE FROM member_brand_links');
      await db.q('DELETE FROM member_line_identities');
      await db.q('DELETE FROM member_notes');
      await db.q('DELETE FROM member_tags');
      await db.q('DELETE FROM member_verifications');
      await db.q('DELETE FROM members');
      await db.q('DELETE FROM otp_requests');
      await db.q('DELETE FROM line_messages');
      await db.q('DELETE FROM outbox');
      await db.q('DELETE FROM webhook_events');
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
      if (resetNumber) await db.q('ALTER SEQUENCE member_no RESTART WITH 1');
      await db.q(`INSERT INTO audit_logs (actor_type, actor_id, actor_name, action, detail) VALUES ('system', 'clear-demo', 'สคริปต์ล้างข้อมูลตัวอย่าง', 'clear_demo', $1)`,
        [before.rows.map(([k, n]) => k + ' ' + n).join(' · ')]);
    });
    if (await ensureDefaultAdmin()) console.log('สร้างบัญชี admin / admin ไว้ให้ (ยังไม่มีผู้ดูแลระบบ)');
    const left = await q("SELECT id, name, role FROM staff WHERE is_active ORDER BY id");
    console.log('\nล้างข้อมูลตัวอย่างเรียบร้อย');
    if (resetNumber) {
      console.log('เลขสมาชิกเริ่มใหม่ที่ MB-0000001 → ต้องล้างข้อมูลสมาชิกเดิมในเครื่อง POS ด้วย (บิลค้างส่ง CRM / โควตาเมนูสมาชิก)');
      console.log('  ไม่อย่างนั้นแต้มของบิลทดสอบที่ค้างส่งอาจเข้าบัญชีสมาชิกจริงที่ได้เลขเดียวกัน');
    }
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
