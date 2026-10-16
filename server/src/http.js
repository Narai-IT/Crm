// router เล็ก ๆ บน node:http (ไม่ต้องพึ่ง framework)
import { readFile, stat } from 'node:fs/promises';
import { dirname, extname, join, normalize } from 'node:path';

export class HttpError extends Error {
  constructor(status, code, message) { super(message || code); this.status = status; this.code = code; }
}
export const bad = (code, msg) => new HttpError(400, code, msg);
export const notFound = (msg) => new HttpError(404, 'not_found', msg || 'ไม่พบข้อมูล');
export const forbidden = (msg) => new HttpError(403, 'forbidden', msg || 'ไม่มีสิทธิ์');
export const conflict = (code, msg) => new HttpError(409, code, msg);

export function createRouter() {
  const routes = [];
  const add = (method) => (path, ...handlers) => {
    const keys = [];
    const re = new RegExp('^' + path.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
    routes.push({ method, re, keys, handlers });
  };
  return {
    get: add('GET'), post: add('POST'), put: add('PUT'), patch: add('PATCH'), del: add('DELETE'),
    match(method, path) {
      for (const r of routes) {
        if (r.method !== method) continue;
        const m = r.re.exec(path);
        if (m) return { handlers: r.handlers, params: Object.fromEntries(r.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])])) };
      }
      return null;
    }
  };
}

export async function readBody(req, limit = 1e6) {
  const chunks = []; let size = 0;
  for await (const c of req) { size += c.length; if (size > limit) throw new HttpError(413, 'too_large'); chunks.push(c); }
  return Buffer.concat(chunks);
}

export function send(res, status, body, headers = {}) {
  const data = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(data);
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };
// หน้า HTML: ห้าม cache และต่อท้ายไฟล์ .js/.css ด้วยเวอร์ชัน (เวลาแก้ไขไฟล์) ทุกครั้งที่ส่ง
// แอป LINE และ Cloudflare จึงต้องโหลดไฟล์ใหม่ทันทีหลังอัปเดต ไม่ค้างหน้าเก่า
export async function serveStatic(root, urlPath, res) {
  const rel = normalize(decodeURIComponent(urlPath)).replace(/^([/\\])+/, '');
  if (rel.startsWith('..')) return false;
  let file = join(root, rel || 'index.html');
  try {
    const s = await stat(file);
    if (s.isDirectory()) file = join(file, 'index.html');
    let data = await readFile(file);
    const ext = extname(file);
    const headers = { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': 'no-cache' };
    if (ext === '.html') {
      const dir = dirname(file);
      let html = data.toString('utf8');
      const refs = [...new Set([...html.matchAll(/(?:src|href)="([\w.-]+\.(?:js|css))"/g)].map((m) => m[1]))];
      for (const r of refs) {
        const v = await stat(join(dir, r)).then((x) => Math.floor(x.mtimeMs).toString(36), () => null);
        if (v) html = html.split('"' + r + '"').join('"' + r + '?v=' + v + '"');
      }
      data = Buffer.from(html);
      headers['cache-control'] = 'no-store, max-age=0';
    }
    res.writeHead(200, headers);
    res.end(data);
    return true;
  } catch { return false; }
}
