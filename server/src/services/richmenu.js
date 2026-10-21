// ริชเมนู LINE: แบบช่อง, ตรวจรูป, สร้าง action ของปุ่ม และติดตั้งผ่าน Messaging API
// ใช้ทั้งหน้าหลังบ้าน (routes/admin.js) และสคริปต์ scripts/richmenu.js

const L = 2500; const BIG = 1686; const SMALL = 843;
const thirds = [[0, 833], [833, 834], [1667, 833]];
export const LAYOUTS = {
  l4: { name: 'ใหญ่ 4 ช่อง', width: L, height: BIG, areas: [[0, 0, 1250, BIG], [1250, 0, 1250, SMALL], [1250, SMALL, 625, SMALL], [1875, SMALL, 625, SMALL]] },
  l6: { name: 'ใหญ่ 6 ช่อง', width: L, height: BIG, areas: [0, SMALL].flatMap((y) => thirds.map(([x, w]) => [x, y, w, SMALL])) },
  l22: { name: 'ใหญ่ 2×2', width: L, height: BIG, areas: [0, SMALL].flatMap((y) => [[0, y, 1250, SMALL], [1250, y, 1250, SMALL]]) },
  s3: { name: 'เล็ก 3 ช่อง', width: L, height: SMALL, areas: thirds.map(([x, w]) => [x, 0, w, SMALL]) },
  s2: { name: 'เล็ก 2 ช่อง', width: L, height: SMALL, areas: [[0, 0, 1250, SMALL], [1250, 0, 1250, SMALL]] }
};
// ปุ่มที่เลือกได้ · tab = แท็บในหน้า LIFF, value = ต้องกรอกเอง
export const ACTIONS = {
  card: { name: 'เปิดบัตรสมาชิก / สมัคร', tab: '' },
  coupons: { name: 'คูปองของฉัน', tab: 'coupons' },
  rewards: { name: 'แลกแต้ม', tab: 'rewards' },
  history: { name: 'ประวัติ / ใบเสร็จ', tab: 'history' },
  message: { name: 'ส่งข้อความ', value: true },
  uri: { name: 'เปิดลิงก์เว็บ', value: true }
};
// ปุ่มเริ่มต้นของแบบ l4 (ตรงกับรูปจาก tools/richmenu.html)
export const DEFAULT_ACTIONS = [{ kind: 'card' }, { kind: 'message', value: 'โปรโมชั่น' }, { kind: 'message', value: 'สาขา' }, { kind: 'message', value: 'ติชม' }];

const fail = (msg) => { const e = new Error(msg); e.code = 'richmenu_invalid'; return e; };

// ขนาดรูปจากเนื้อไฟล์ (PNG / JPEG) · null = ไม่ใช่รูปที่ LINE รับ
export function imageInfo(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89504e47) return { mime: 'image/png', width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { i += m === 0xff ? 1 : 2; continue; }
      if ((m >= 0xc0 && m <= 0xcf) && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { mime: 'image/jpeg', width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// ตรวจแบบ + ปุ่ม + ข้อความแถบเมนู · คืนค่าที่ทำความสะอาดแล้ว
export function checkMenu({ layout, actions, chatBar }) {
  const lay = LAYOUTS[layout];
  if (!lay) throw fail('เลือกแบบช่องของเมนู');
  if (!Array.isArray(actions) || actions.length !== lay.areas.length) throw fail('ตั้งค่าปุ่มให้ครบ ' + lay.areas.length + ' ช่อง');
  const out = actions.map((a, i) => {
    const k = ACTIONS[a && a.kind]; const name = 'ช่อง ' + String.fromCharCode(65 + i);
    if (!k) throw fail(name + ': เลือกการทำงานของปุ่ม');
    if (!k.value) return { kind: a.kind };
    const v = String(a.value || '').trim();
    if (a.kind === 'message' && (!v || v.length > 300)) throw fail(name + ': กรอกข้อความ (ไม่เกิน 300 ตัวอักษร)');
    if (a.kind === 'uri' && !/^https:\/\/[^\s]{3,990}$/.test(v)) throw fail(name + ': ลิงก์ต้องขึ้นต้นด้วย https://');
    return { kind: a.kind, value: v };
  });
  const bar = String(chatBar || '').trim() || 'เมนู';
  if ([...bar].length > 14) throw fail('ข้อความบนแถบเมนูยาวได้ไม่เกิน 14 ตัวอักษร');
  return { layout, actions: out, chatBar: bar };
}
export function checkImage(buf, layout) {
  const info = imageInfo(buf); const lay = LAYOUTS[layout];
  if (!info) throw fail('รองรับเฉพาะรูป JPG หรือ PNG');
  if (buf.length > 1024 * 1024) throw fail('รูปต้องไม่เกิน 1 MB');
  if (info.width !== lay.width || info.height !== lay.height) throw fail('รูปต้องมีขนาด ' + lay.width + ' × ' + lay.height + ' px (รูปนี้ ' + info.width + ' × ' + info.height + ')');
  return info;
}

function lineAction(a, i, brandId, liffId) {
  const label = (ACTIONS[a.kind].name.split(' /')[0]).slice(0, 20);
  if (a.kind === 'message') return { type: 'message', label: [...a.value].slice(0, 20).join(''), text: a.value };
  if (a.kind === 'uri') return { type: 'uri', label, uri: a.value };
  const tab = ACTIONS[a.kind].tab;
  return { type: 'uri', label, uri: 'https://liff.line.me/' + liffId + '?brand=' + brandId + (tab ? '&tab=' + tab : '') };
}

// ติดตั้งเป็นเมนูหลักของทุกคนใน OA แล้วลบเมนูเก่าที่ระบบนี้เคยสร้าง (ชื่อขึ้นต้น crm-<brand>)
export async function install({ brandId, token, liffId, layout, actions, chatBar, image, mime }) {
  if (!token) throw fail('ยังไม่ได้ตั้ง LINE_' + brandId.toUpperCase() + '_TOKEN ในไฟล์ .env');
  if (!liffId) throw fail('ยังไม่ได้ตั้ง LIFF_ID ในไฟล์ .env');
  const lay = LAYOUTS[layout];
  async function line(method, url, body, type) {
    const res = await fetch(url, { method, headers: { authorization: 'Bearer ' + token, ...(body ? { 'content-type': type || 'application/json' } : {}) }, body: body && !type ? JSON.stringify(body) : body, signal: AbortSignal.timeout(20000) });
    const text = await res.text();
    if (!res.ok) { const e = new Error('LINE ตอบกลับ ' + res.status + ': ' + text.slice(0, 200)); e.code = 'line_error'; throw e; }
    return text ? JSON.parse(text) : {};
  }
  const name = 'crm-' + brandId;
  const menu = {
    size: { width: lay.width, height: lay.height }, selected: true, name, chatBarText: chatBar,
    areas: lay.areas.map(([x, y, width, height], i) => ({ bounds: { x, y, width, height }, action: lineAction(actions[i], i, brandId, liffId) }))
  };
  const old = (await line('GET', 'https://api.line.me/v2/bot/richmenu/list')).richmenus.filter((m) => m.name === name);
  const { richMenuId } = await line('POST', 'https://api.line.me/v2/bot/richmenu', menu);
  try {
    await line('POST', 'https://api-data.line.me/v2/bot/richmenu/' + richMenuId + '/content', image, mime);
    await line('POST', 'https://api.line.me/v2/bot/user/all/richmenu/' + richMenuId);
  } catch (e) {
    await line('DELETE', 'https://api.line.me/v2/bot/richmenu/' + richMenuId).catch(() => {});
    throw e;
  }
  for (const m of old) await line('DELETE', 'https://api.line.me/v2/bot/richmenu/' + m.richMenuId).catch(() => {});
  return { richMenuId, removed: old.length };
}

// เมนูหลักที่ OA ใช้อยู่ตอนนี้ (ตั้งผ่าน API เท่านั้น · เมนูที่ตั้งใน OA Manager LINE ไม่ให้ดึง)
// null = OA ไม่มีเมนูหลักที่ตั้งผ่าน API · ถ้า id ตรงกับที่รู้อยู่แล้วไม่ดึงรูปซ้ำ
export async function fetchLive(token, knownId) {
  const get = (url) => fetch(url, { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(8000) });
  const d = await get('https://api.line.me/v2/bot/user/all/richmenu');
  if (d.status === 404) return null;
  if (!d.ok) throw new Error('LINE ' + d.status);
  const { richMenuId } = await d.json();
  if (!richMenuId) return null;
  if (richMenuId === knownId) return { richMenuId };
  const m = await get('https://api.line.me/v2/bot/richmenu/' + richMenuId);
  if (!m.ok) throw new Error('LINE ' + m.status);
  const menu = await m.json();
  const img = await get('https://api-data.line.me/v2/bot/richmenu/' + richMenuId + '/content');
  if (!img.ok) throw new Error('LINE ' + img.status);
  const image = Buffer.from(await img.arrayBuffer());
  return { richMenuId, menu, image, mime: (imageInfo(image) || {}).mime || img.headers.get('content-type') || 'image/jpeg' };
}

// แปลงเมนูจาก LINE กลับเป็นแบบช่อง/ปุ่มของระบบ · null = จุดกดไม่ตรงกับแบบไหน
export function fromLine(menu, brandId) {
  const areas = menu.areas.map((a) => [a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height]);
  const layout = Object.keys(LAYOUTS).find((k) => {
    const l = LAYOUTS[k];
    return l.width === menu.size.width && l.height === menu.size.height && l.areas.length === areas.length && l.areas.every((x, i) => x.every((v, j) => Math.abs(v - areas[i][j]) <= 2));
  });
  if (!layout) return null;
  const actions = menu.areas.map(({ action: a }) => {
    if (a.type === 'message') return { kind: 'message', value: a.text };
    const m = a.type === 'uri' && /^https:\/\/liff\.line\.me\/[^?]+\?(.*)$/.exec(a.uri || '');
    if (m) {
      const p = new URLSearchParams(m[1]);
      const kind = Object.keys(ACTIONS).find((k) => ACTIONS[k].tab !== undefined && ACTIONS[k].tab === (p.get('tab') || ''));
      if (kind && (!p.get('brand') || p.get('brand') === brandId)) return { kind };
    }
    return a.type === 'uri' && /^https:\/\//.test(a.uri || '') ? { kind: 'uri', value: a.uri } : { kind: 'message', value: a.text || a.label || '' };
  });
  return { layout, actions, chatBar: [...String(menu.chatBarText || 'เมนู')].slice(0, 14).join('') };
}
