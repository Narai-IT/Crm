import pg from 'pg';

// numeric / bigint เป็น number ในแอป (ยอดเงินเก็บ 2 ตำแหน่ง แต้มเป็นจำนวนเต็ม ไม่เกินช่วง safe integer)
pg.types.setTypeParser(1700, (v) => Number(v));
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: '-c search_path=crm,public',
  max: Number(process.env.DB_POOL_MAX || 10)
});

export async function q(text, params) {
  return (await pool.query(text, params)).rows;
}
export async function one(text, params) {
  return (await pool.query(text, params)).rows[0] || null;
}

// รันหลายคำสั่งใน transaction เดียว: สำเร็จทั้งหมดหรือไม่มีอะไรเปลี่ยน
export async function tx(fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const db = {
      q: async (t, p) => (await c.query(t, p)).rows,
      one: async (t, p) => (await c.query(t, p)).rows[0] || null
    };
    const out = await fn(db);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
