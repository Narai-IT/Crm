// งานเบื้องหลัง: ส่งข้อความจาก outbox (หลัง commit เท่านั้น) · แต้ม/คูปองหมดอายุ
import { pool, q, tx } from './db.js';
import { deliver } from './services/line.js';
import { expireLots, expireCoupons } from './services/core.js';
import { runDueRounds } from './services/rounds.js';
import { logApi } from './apilog.js';
import { DEV } from './util.js';

let busy = false;
export async function drainOutbox() {
  if (busy) return 0;
  busy = true;
  let n = 0;
  try {
    for (;;) {
      // SKIP LOCKED: รันหลาย instance พร้อมกันได้โดยไม่ส่งซ้ำ
      const done = await tx(async (db) => {
        const job = await db.one('SELECT * FROM outbox WHERE done_at IS NULL AND next_attempt_at <= now() ORDER BY id LIMIT 1 FOR UPDATE SKIP LOCKED');
        if (!job) return false;
        try {
          const res = await deliver(db, job);
          await db.q('UPDATE outbox SET done_at = now(), attempts = attempts + 1 WHERE id = $1', [job.id]);
          if (DEV) logApi({ method: 'POST', path: 'LINE ' + (job.kind === 'line_reply' ? 'reply' : 'push') + ' (' + (job.brand_id || '-') + ')', body: { to: job.payload.to }, result: res.sent ? 'ส่งแล้ว' : 'ไม่ส่งจริง: ' + (res.skipped || 'reroute'), kind: 'push' });
        } catch (e) {
          const wait = Math.min(3600, 10 * 2 ** job.attempts);
          await db.q("UPDATE outbox SET attempts = attempts + 1, last_error = $2, next_attempt_at = now() + make_interval(secs => $3) WHERE id = $1", [job.id, String(e.message).slice(0, 500), wait]);
          if (job.attempts + 1 >= 8) await db.q("UPDATE outbox SET done_at = now() WHERE id = $1", [job.id]);
        }
        return true;
      });
      if (!done) break;
      n++;
    }
  } finally { busy = false; }
  return n;
}

export async function housekeeping() {
  await tx(async (db) => { await expireLots(db); await expireCoupons(db); });
}

// คูปองของขวัญที่ถึงรอบส่ง (ตรวจทุกนาที)
let roundsBusy = false;
export async function giftRounds() {
  if (roundsBusy) return [];
  roundsBusy = true;
  try {
    const done = await runDueRounds({ q, tx });
    for (const r of done) console.log('ส่งคูปองของขวัญ #' + r.templateId + ' รอบ ' + r.key + ': ' + r.members + ' คน ' + r.issued + ' ใบ');
    if (done.length) drainOutbox().catch(() => {});
    return done;
  } finally { roundsBusy = false; }
}

export function startWorker() {
  const t1 = setInterval(() => drainOutbox().catch((e) => console.error('outbox', e.message)), 1500);
  const t2 = setInterval(() => housekeeping().catch((e) => console.error('housekeeping', e.message)), 3600 * 1000);
  const t3 = setInterval(() => giftRounds().catch((e) => console.error('gift rounds', e.message)), 60 * 1000);
  housekeeping().catch(() => {});
  giftRounds().catch(() => {});
  return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); };
}
export { pool };
