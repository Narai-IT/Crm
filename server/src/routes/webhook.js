// LINE webhook: 1 URL ต่อ 1 OA → /webhooks/line/:brand · ตรวจลายเซ็นด้วย channel secret ของแบรนด์นั้น
import { one, tx } from '../db.js';
import { HttpError, notFound } from '../http.js';
import { DEV } from '../util.js';
import { verifySignature, handleEvent } from '../services/line.js';

export default function (r) {
  r.post('/webhooks/line/:brand', async (req, body, _u, p, raw) => {
    const brand = await one('SELECT id FROM brands WHERE id = $1', [p.brand]);
    if (!brand) throw notFound();
    const hasSecret = !!process.env['LINE_' + p.brand.toUpperCase() + '_SECRET'];
    if (hasSecret ? !verifySignature(p.brand, raw, req.headers['x-line-signature']) : !DEV) throw new HttpError(401, 'bad_signature', 'ลายเซ็นไม่ถูกต้อง');
    let n = 0;
    for (const ev of body.events || []) {
      // แต่ละ event ทำใน transaction ของตัวเอง: event หนึ่งพัง ไม่ทำให้ event อื่นหาย
      try { await tx((db) => handleEvent(db, p.brand, ev)); n++; } catch (e) { console.error('webhook event failed', p.brand, ev.type, e.message); }
    }
    return { ok: true, processed: n };
  }, (b) => (b.events || []).map((e) => e.type + (e.message?.text ? ':' + e.message.text : '')).join(', '));
}
