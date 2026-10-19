// LINE Messaging API: ตรวจลายเซ็น webhook, จัดการ event, สร้าง Flex, ส่งผ่าน outbox
import crypto from 'node:crypto';
import { credit, memberByLine } from './core.js';

const env = (brand, k) => process.env['LINE_' + brand.toUpperCase() + '_' + k] || '';
export const channelConfigured = (brand) => !!env(brand, 'TOKEN');

export function verifySignature(brand, rawBody, signature) {
  const secret = env(brand, 'SECRET');
  if (!secret || !signature) return false;
  const want = crypto.createHmac('sha256', secret).update(rawBody).digest('base64');
  return want.length === signature.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(signature));
}

// บันทึกข้อความขาออก + เข้าคิวส่ง (ส่งจริงหลัง commit โดย worker)
export async function queueMessage(db, { brandId, lineUserId, kind, data, replyToken }) {
  const m = await db.one("INSERT INTO line_messages (brand_id, line_user_id, direction, kind, data, status) VALUES ($1,$2,'out',$3,$4,'queued') RETURNING id",
    [brandId, lineUserId, kind, JSON.stringify(data || {})]);
  await db.q('INSERT INTO outbox (kind, brand_id, payload) VALUES ($1,$2,$3)',
    [replyToken ? 'line_reply' : 'line_push', brandId, JSON.stringify({ messageId: m.id, to: lineUserId, replyToken: replyToken || null })]);
  return m.id;
}

/* ---------- ตัวสร้างข้อความ LINE จริงจากข้อมูลเดียวกับที่เดโมแสดง ---------- */
const txt = (text, extra = {}) => ({ type: 'text', text, wrap: true, ...extra });
const row = (k, v) => ({ type: 'box', layout: 'horizontal', contents: [txt(k, { size: 'sm', color: '#6B5146', flex: 3 }), txt(v, { size: 'sm', align: 'end', weight: 'bold', flex: 4 })] });
const uriBtn = (label, uri, color) => ({ type: 'button', style: 'primary', color, height: 'sm', action: { type: 'uri', label, uri } });
const liff = (brand, tab) => 'https://liff.line.me/' + (process.env.LIFF_ID || 'LIFF_ID') + '?brand=' + brand + (tab ? '&tab=' + tab : '');
function bubble(brand, head, sub, rows, buttons) {
  return {
    type: 'bubble',
    header: { type: 'box', layout: 'vertical', backgroundColor: brand.theme_color, contents: [txt(sub, { size: 'xs', color: '#FFFFFF' }), txt(head, { size: 'xl', weight: 'bold', color: '#FFFFFF' })] },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: rows },
    footer: buttons?.length ? { type: 'box', layout: 'vertical', spacing: 'sm', contents: buttons } : undefined
  };
}
export function buildMessages(kind, data, brand, branches) {
  const c = brand.theme_color;
  if (kind === 'text') return [{ type: 'text', text: data.text, ...(data.quick ? { quickReply: { items: data.quick.map((q) => ({ type: 'action', action: { type: 'message', label: q, text: q } })) } } : {}) }];
  if (kind === 'welcome') return [{ type: 'flex', altText: 'สมัครสมาชิกสำเร็จ ' + data.memberId, contents: bubble(brand, 'ยินดีต้อนรับ', 'สมัครสมาชิกสำเร็จ',
    [row('เลขสมาชิก', data.memberId), row('แต้มต้อนรับ', '+' + data.pts + ' แต้ม'), ...(data.coupon ? [row('คูปอง', data.coupon)] : [])], [uriBtn('ดูบัตรสมาชิก', liff(brand.id), c)]) }];
  if (kind === 'points') return [{ type: 'flex', altText: 'ได้รับ +' + data.pts + ' แต้ม', contents: bubble(brand, 'ได้รับ +' + data.pts + ' แต้ม', 'ขอบคุณที่อุดหนุน',
    [row('สมาชิก', data.memberId), row('สาขา', data.branch), row('ยอดชำระ', Number(data.total).toFixed(2) + ' บาท'), ...(data.discount ? [row('ส่วนลดคูปอง', '-' + Number(data.discount).toFixed(2))] : []), row('แต้ม ' + brand.short_name + ' คงเหลือ', String(data.bal))],
    [uriBtn('ดูบัตรสมาชิก', liff(brand.id), c), uriBtn('ดูใบเสร็จ / ขอใบกำกับภาษี', liff(brand.id, 'history'), brand.ink_color)]) }];
  if (kind === 'broadcast') {
    const out = [{ type: 'text', text: data.text }];
    if (data.coupon) out.push({ type: 'flex', altText: 'คูปอง ' + data.coupon, contents: bubble(brand, data.coupon, 'คูปองถูกเพิ่มเข้ากระเป๋าแล้ว', [txt('ใช้ได้ที่ ' + brand.name + ' ทุกสาขา', { size: 'sm' })], [uriBtn('ดูคูปองของฉัน', liff(brand.id, 'coupons'), c)]) });
    return out;
  }
  if (kind === 'promo') return [{ type: 'flex', altText: 'โปรโมชั่น ' + brand.name, contents: { type: 'carousel', contents: (data.items || []).map((p) => bubble(brand, p.title, brand.name, [txt(p.body, { size: 'sm' })], [uriBtn('ดูรายละเอียด', liff(brand.id, 'rewards'), c)])) } }];
  if (kind === 'branches') return [{ type: 'flex', altText: 'สาขา ' + brand.name, contents: bubble(brand, 'สาขา & เวลาเปิด-ปิด', brand.name,
    (branches || []).map((b) => ({ type: 'box', layout: 'vertical', contents: [txt(b.name, { weight: 'bold', size: 'sm' }), txt('เปิด ' + b.open + ' – ' + b.close + (b.phone ? ' · โทร ' + b.phone : ''), { size: 'xs', color: '#6B5146' })] }))) }];
  return [{ type: 'text', text: data.text || '' }];
}

/* ---------- event จาก OA ---------- */
const PROMOS = [{ title: 'โปรเดือนนี้', body: '[ชื่อโปรโมชั่น] · ถึง [วันที่]' }, { title: 'สมาชิกเท่านั้น', body: 'แสดงบัตรสมาชิกรับสิทธิ์เพิ่ม' }];
const RATINGS = ['อร่อยมาก', 'โอเค', 'ควรปรับปรุง'];

export async function handleEvent(db, brandId, ev) {
  if (ev.webhookEventId) {
    const seen = await db.one('INSERT INTO webhook_events (webhook_event_id, brand_id, event_type, payload) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING RETURNING webhook_event_id',
      [ev.webhookEventId, brandId, ev.type, JSON.stringify(ev)]);
    if (!seen) return { duplicate: true };                 // LINE ส่ง event ซ้ำ
  }
  const userId = ev.source?.userId;
  if (!userId) return { ignored: true };
  const brand = await db.one('SELECT * FROM brands WHERE id = $1', [brandId]);
  const member = await memberByLine(db, userId);
  const reply = (kind, data) => queueMessage(db, { brandId, lineUserId: userId, kind, data, replyToken: ev.replyToken });

  if (ev.type === 'follow' || ev.type === 'unfollow') {
    const st = ev.type === 'follow' ? 'follow' : 'blocked';
    await db.q(`INSERT INTO line_followers (line_user_id, brand_id, status, changed_at) VALUES ($1,$2,$3, now())
                ON CONFLICT (line_user_id, brand_id) DO UPDATE SET status = EXCLUDED.status, changed_at = now()`, [userId, brandId, st]);
    if (member) await db.q(`INSERT INTO member_brand_links (member_id, brand_id, follow_status, follow_changed_at) VALUES ($1,$2,$3, now())
                            ON CONFLICT (member_id, brand_id) DO UPDATE SET follow_status = EXCLUDED.follow_status, follow_changed_at = now()`, [member.id, brandId, st]);
    if (ev.type === 'follow') await reply('text', { text: 'สวัสดีครับ ยินดีต้อนรับสู่ ' + brand.name + '\nกดเมนู "สมาชิก" ด้านล่าง เพื่อสมัครหรือเปิดบัตรสมาชิก' + (member ? '\n\nระบบพบบัญชีสมาชิก ' + member.id + ' ของคุณแล้ว ใช้ได้ทันทีที่ร้านนี้' : '') });
    return { ok: true };
  }
  if (ev.type !== 'message' || ev.message?.type !== 'text') return { ignored: true };
  const text = String(ev.message.text || '').trim();
  await db.q("INSERT INTO line_messages (brand_id, line_user_id, direction, kind, data) VALUES ($1,$2,'in','text',$3)", [brandId, userId, JSON.stringify({ text })]);

  if (text === 'โปรโมชั่น') await reply('promo', { items: PROMOS });
  else if (text === 'สาขา') {
    const brs = await db.q("SELECT name, to_char(open_time,'HH24:MI') AS open, to_char(close_time,'HH24:MI') AS close, phone FROM branches WHERE brand_id = $1 AND is_active ORDER BY id", [brandId]);
    await reply('branches', { branches: brs });
  } else if (text === 'ติชม') await reply('text', { text: 'ยินดีรับฟังครับ พิมพ์คำติชมหรือคำถามไว้ได้เลย\nพนักงานจะตอบกลับในเวลาทำการ', quick: RATINGS });
  else if (RATINGS.includes(text)) {
    let extra = '';
    const pts = Number(brand.review_points) || 0;
    if (member && pts > 0) {
      // แต้มรีวิว: เฉพาะคนที่มีบิลของแบรนด์นี้วันนี้ (เวลาไทย) · วันละ 1 ครั้งต่อแบรนด์
      const today = await db.one(`SELECT to_char(now() AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS day,
          EXISTS (SELECT 1 FROM sales_transactions WHERE member_id = $1 AND brand_id = $2 AND status <> 'void'
                  AND paid_at >= date_trunc('day', now() AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'Asia/Bangkok') AS bought`, [member.id, brandId]);
      if (today.bought) {
        const r = await credit(db, { memberId: member.id, brandId, type: 'bonus', points: pts, key: 'rating:' + member.id + ':' + brandId + ':' + today.day, note: 'ให้คะแนนร้าน', actorType: 'line', actorId: userId });
        if (!r.duplicate) extra = '\nได้รับ +' + pts + ' แต้ม ' + brand.short_name;
      } else extra = '\n(รีวิวในวันที่ทานที่ร้านและใส่เลขสมาชิก รับ +' + pts + ' แต้ม)';
    }
    await reply('text', { text: 'ขอบคุณสำหรับรีวิวครับ' + extra });
  } else await reply('text', { text: 'ได้รับข้อความแล้ว แอดมินจะตอบกลับในเวลาทำการครับ' });
  return { ok: true };
}

/* ---------- ส่งจริง (เรียกจาก worker) ---------- */
export async function deliver(db, job) {
  const p = job.payload;
  if (job.kind === 'sms_otp') return { skipped: 'ยังไม่ได้ต่อผู้ให้บริการ SMS' };
  const msg = await db.one('SELECT * FROM line_messages WHERE id = $1', [p.messageId]);
  const brand = await db.one('SELECT * FROM brands WHERE id = $1', [job.brand_id]);
  if (!msg || !brand) return { skipped: 'missing' };
  const token = env(brand.id, 'TOKEN');
  if (!token || p.to.startsWith('Udemo')) {                 // ยังไม่ตั้งค่า OA หรือเป็นผู้ใช้เดโม: เก็บไว้ ไม่ส่งจริง
    await db.q("UPDATE line_messages SET status = 'skipped' WHERE id = $1", [msg.id]);
    return { skipped: token ? 'demo user' : 'no channel token' };
  }
  const messages = buildMessages(msg.kind, msg.data, brand, msg.data.branches);
  const url = p.replyToken ? 'https://api.line.me/v2/bot/message/reply' : 'https://api.line.me/v2/bot/message/push';
  const body = p.replyToken ? { replyToken: p.replyToken, messages } : { to: p.to, messages };
  const headers = { 'content-type': 'application/json', authorization: 'Bearer ' + token };
  if (!p.replyToken) {
    // retry key คงที่ต่องาน: ถ้า worker ส่งซ้ำหลัง timeout LINE จะไม่ส่งข้อความซ้ำให้ลูกค้า
    const h = crypto.createHash('sha256').update('outbox:' + job.id).digest('hex');
    headers['X-Line-Retry-Key'] = [h.slice(0, 8), h.slice(8, 12), '4' + h.slice(13, 16), '8' + h.slice(17, 20), h.slice(20, 32)].join('-');
  }
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const err = await res.text();
    // reply token หมดอายุ (เกิน ~1 นาที) → เปลี่ยนเป็น push
    if (p.replyToken && res.status === 400) { await db.q("INSERT INTO outbox (kind, brand_id, payload) VALUES ('line_push',$1,$2)", [brand.id, JSON.stringify({ ...p, replyToken: null })]); return { rerouted: true }; }
    throw new Error('LINE ' + res.status + ' ' + err.slice(0, 200));
  }
  await db.q("UPDATE line_messages SET status = 'done' WHERE id = $1", [msg.id]);
  return { sent: true };
}
