// บันทึกคำขอล่าสุดไว้ในหน่วยความจำ ให้หน้าเดโมแสดง "ระบบหลังบ้านเห็นอะไร" (เปิดเฉพาะ DEV_MODE)
const rows = [];
const SECRET_KEYS = /otp|password|token|secret|idToken/i;

function redact(v) {
  if (!v || typeof v !== 'object') return v;
  const out = Array.isArray(v) ? [] : {};
  for (const [k, x] of Object.entries(v)) {
    if (SECRET_KEYS.test(k)) out[k] = '***';
    else if (k === 'phone' && typeof x === 'string' && x.length > 4) out[k] = '***-***-' + x.slice(-4);
    else out[k] = typeof x === 'object' ? redact(x) : x;
  }
  return out;
}
export function logApi(e) {
  rows.unshift({ at: Date.now(), method: e.method, path: e.path, body: redact(e.body) || null, result: e.result || null, kind: e.kind || 'api' });
  if (rows.length > 120) rows.length = 120;
}
export const apiRows = () => rows;
export const clearApi = () => { rows.length = 0; };
export function kindOf(path) {
  if (path.startsWith('/api/pos')) return 'pos';
  if (path.startsWith('/api/admin')) return 'admin';
  if (path.startsWith('/webhooks') || path.startsWith('/api/dev/line')) return 'webhook';
  return 'api';
}
