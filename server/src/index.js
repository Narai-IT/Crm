// จุดเริ่มเซิร์ฟเวอร์: API + LINE webhook + เสิร์ฟหน้าเดโม/LIFF จากโฟลเดอร์ demo/
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createRouter, readBody, send, serveStatic, HttpError } from './http.js';
import { DEV, REQUIRE_OTP } from './util.js';
import { logApi, kindOf } from './apilog.js';
import { startWorker, drainOutbox } from './worker.js';
import { pool } from './db.js';
import { ensureDefaultAdmin } from './auth.js';
import liff from './routes/liff.js';
import pos from './routes/pos.js';
import admin from './routes/admin.js';
import webhook from './routes/webhook.js';
import dev from './routes/dev.js';
import pub from './routes/public.js';

const here = dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = process.env.STATIC_ROOT || join(here, '..', '..', 'demo');
const LIFF_ROOT = process.env.LIFF_ROOT || join(here, '..', '..', 'liff');
const ADMIN_ROOT = process.env.ADMIN_ROOT || join(here, '..', '..', 'admin');

export function buildServer() {
  const r = createRouter();
  r.get('/api/health', async () => { await pool.query('SELECT 1'); return { ok: true, dev: DEV }; });
  r.get('/api/config', async () => ({ dev: DEV, liffId: process.env.LIFF_ID || null, requireOtp: REQUIRE_OTP }));
  liff(r); pos(r); admin(r); webhook(r); pub(r);
  if (DEV) dev(r);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const path = url.pathname;
    const isApi = path.startsWith('/api/') || path.startsWith('/webhooks/');
    if (!isApi) {
      // หน้า LIFF ของลูกค้า: /liff/ (ตั้งเป็น Endpoint URL ของ LIFF app)
      if (path === '/liff') { res.writeHead(302, { location: '/liff/' + url.search }); return res.end(); }
      if (path.startsWith('/liff/') && req.method === 'GET' && (await serveStatic(LIFF_ROOT, path.slice(5), res))) return;
      // หลังบ้านจริง (ล็อกอินด้วยรหัสพนักงาน): /admin/
      if (path === '/admin') { res.writeHead(302, { location: '/admin/' }); return res.end(); }
      if (path.startsWith('/admin/') && req.method === 'GET' && (await serveStatic(ADMIN_ROOT, path.slice(6), res))) return;
      if (req.method === 'GET' && (await serveStatic(STATIC_ROOT, path, res))) return;
      return send(res, 404, { error: 'not_found' });
    }
    const m = r.match(req.method, path);
    let body = {}; let raw = Buffer.alloc(0);
    try {
      if (!m) throw new HttpError(404, 'not_found', 'ไม่พบ endpoint');
      if (req.method !== 'GET') {
        raw = await readBody(req);
        if (raw.length) { try { body = JSON.parse(raw.toString('utf8')); } catch { throw new HttpError(400, 'bad_json', 'JSON ไม่ถูกต้อง'); } }
      }
      const [handler, summary] = m.handlers;
      const out = await handler(req, body, url, m.params, raw);
      if (DEV && !path.startsWith('/api/dev/snapshot') && path !== '/api/dev/clear-log') {
        logApi({ method: req.method, path: path + (url.search || ''), body: req.method === 'GET' ? null : body, kind: kindOf(path),
          result: '200' + (typeof summary === 'function' ? ' · ' + summary(body, out) : summary ? ' · ' + summary : '') });
      }
      send(res, 200, out ?? { ok: true });
      if (req.method !== 'GET') setImmediate(() => drainOutbox().catch(() => {}));
    } catch (e) {
      const status = e instanceof HttpError ? e.status : (e.code === '23505' ? 409 : 500);
      if (status === 500) console.error(req.method, path, e);
      const msg = status === 500 ? 'เกิดข้อผิดพลาดในระบบ' : e.message;
      if (DEV && m) logApi({ method: req.method, path, body: req.method === 'GET' ? null : body, kind: kindOf(path), result: status + ' · ' + msg });
      send(res, status, { error: e.code || 'error', message: msg });
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const port = Number(process.env.PORT || 3000);
  ensureDefaultAdmin().then((made) => { if (made) console.log('สร้างบัญชีหลังบ้านเริ่มต้น admin / admin แล้ว (ระบบจะให้เปลี่ยนรหัสผ่านตอนเข้าครั้งแรก)'); })
    .catch((e) => console.error('สร้างบัญชี admin ไม่สำเร็จ (รัน npm run db:migrate แล้วหรือยัง?):', e.message));
  buildServer().listen(port, () => {
    console.log('Group CRM พร้อมใช้งานที่ http://localhost:' + port + (DEV ? '  (DEV_MODE: เปิดหน้าเดโมที่ลิงก์นี้ได้เลย)' : ''));
  });
  startWorker();
}
