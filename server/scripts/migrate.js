// รัน migration ใน db/migrations ตามลำดับชื่อไฟล์ (แต่ละไฟล์รันครั้งเดียว)
// --reset : ลบ schema crm ทั้งหมดแล้วสร้างใหม่ (ใช้ได้เฉพาะ DEV_MODE=1)
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pool } from '../src/db.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'db', 'migrations');

export async function migrate({ reset = false, quiet = false } = {}) {
  const c = await pool.connect();
  try {
    if (reset) {
      if (process.env.DEV_MODE !== '1') throw new Error('--reset ใช้ได้เฉพาะ DEV_MODE=1 (กันลบข้อมูลจริงโดยไม่ตั้งใจ)');
      await c.query('DROP SCHEMA IF EXISTS crm CASCADE');
      if (!quiet) console.log('ลบ schema crm แล้ว');
    }
    await c.query('CREATE SCHEMA IF NOT EXISTS crm');
    await c.query('CREATE TABLE IF NOT EXISTS crm.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await c.query('SELECT name FROM crm.schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = await readFile(join(dir, f), 'utf8');
      await c.query('BEGIN');
      try {
        await c.query(sql);
        await c.query('INSERT INTO crm.schema_migrations (name) VALUES ($1)', [f]);
        await c.query('COMMIT');
        if (!quiet) console.log('✓ ' + f);
      } catch (e) {
        await c.query('ROLLBACK');
        throw new Error(f + ': ' + e.message);
      }
    }
    if (!quiet) console.log('ฐานข้อมูลเป็นเวอร์ชันล่าสุดแล้ว');
    const { ensureDefaultAdmin } = await import('../src/auth.js');
    if (await ensureDefaultAdmin() && !quiet) console.log('สร้างบัญชีหลังบ้านเริ่มต้น admin / admin แล้ว (ต้องเปลี่ยนรหัสผ่านตอนเข้าครั้งแรก)');
  } finally {
    c.release();
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  migrate({ reset: process.argv.includes('--reset') })
    .then(() => pool.end())
    .catch((e) => { console.error('migration ล้มเหลว:', e.message); process.exit(1); });
}
