// ทดสอบทั้ง flow กับ PostgreSQL จริง · ใช้ฐานข้อมูลแยก TEST_DATABASE_URL (จะถูกล้างทุกครั้ง)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) { process.env.DATABASE_URL = TEST_DB; process.env.DEV_MODE = '1'; process.env.LINE_HUMLAI_SECRET = 'test-secret-humlai'; }

let base; let server; let mods;
const base_url = () => base;
const USER = 'Utest000000000000000000000000001';
async function call(method, path, body, headers = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await res.json();
  return { status: res.status, data };
}
const asUser = { 'x-dev-line-user': USER };
const posHL01 = { 'x-api-key': 'pos-hl01-demo-key' };

before(async () => {
  if (!TEST_DB) return;
  const { migrate } = await import('../scripts/migrate.js');
  const { seed } = await import('../scripts/seed.js');
  await migrate({ reset: true, quiet: true });
  await seed({ demo: true, quiet: true });
  const { buildServer } = await import('../src/index.js');
  mods = { worker: await import('../src/worker.js'), db: await import('../src/db.js') };
  server = buildServer();
  await new Promise((r) => server.listen(0, r));
  base = 'http://127.0.0.1:' + server.address().port;
});
after(async () => { if (server) { server.closeAllConnections(); server.close(); await mods.db.pool.end(); } });

const t = (name, fn) => test(name, { skip: !TEST_DB && 'ตั้ง TEST_DATABASE_URL ก่อนรันทดสอบ' }, fn);

t('follow OA แล้วสมัครสมาชิกด้วย OTP ได้แต้มต้อนรับ', async () => {
  await call('POST', '/api/dev/line-event', { brand: 'humlai', type: 'follow', lineUserId: USER });
  assert.equal((await call('GET', '/api/liff/me', undefined, asUser)).data.member, null);
  const otp = await call('POST', '/api/liff/otp', { phone: '0899999999' }, asUser);
  assert.equal(otp.status, 200);
  const bad = await call('POST', '/api/liff/register', { brand: 'humlai', name: 'ทดสอบ', phone: '0899999999', otp: '000000x', privacy: true }, asUser);
  assert.equal(bad.status, 400);
  const reg = await call('POST', '/api/liff/register', { brand: 'humlai', name: 'ทดสอบ ระบบ', phone: '0899999999', otp: otp.data.devCode, privacy: true, marketing: true, branchId: 'HL01' }, asUser);
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.equal(reg.data.welcomePoints, 50);
  const me = await call('GET', '/api/liff/me', undefined, asUser);
  assert.equal(me.data.member.id, reg.data.memberId);
  assert.equal(me.data.wallets.humlai.balance, 50);
  assert.equal(me.data.wallets.narai.balance, 0);
});

t('สมัครด้วยเบอร์อย่างเดียว (ไม่มี OTP) ได้ · เบอร์ที่เป็นสมาชิกอยู่แล้วต้องให้พนักงานผูก', async () => {
  const u2 = { 'x-dev-line-user': 'Utest000000000000000000000000002' };
  const dup = await call('POST', '/api/liff/register', { brand: 'humlai', name: 'คนอื่น', phone: '0812345678', privacy: true }, u2);
  assert.equal(dup.status, 409);
  assert.equal((await call('GET', '/api/liff/me', undefined, u2)).data.member, null);
  const reg = await call('POST', '/api/liff/register', { brand: 'humlai', name: 'ไม่ใช้ OTP', phone: '0877777777', privacy: true, branchId: 'HL01' }, u2);
  assert.equal(reg.status, 200, JSON.stringify(reg.data));
  assert.equal(reg.data.linked, false);
  assert.equal(reg.data.welcomePoints, 50);
  assert.equal((await call('GET', '/api/config')).data.requireOtp, false);
});

t('POS: สแกน QR → ปิดบิล → แต้มเข้า · ส่งบิลซ้ำไม่ได้แต้มซ้ำ', async () => {
  const qr = await call('GET', '/api/liff/qr', undefined, asUser);
  const who = await call('POST', '/api/pos/members/resolve', { qrToken: qr.data.token }, posHL01);
  assert.equal(who.status, 200);
  const items = [{ id: 'h1', name: 'ข้าวมันไก่', price: 70, qty: 4 }, { id: 'h5', name: 'ไก่ต้มสับ', price: 220, qty: 1 }];
  const sale = await call('POST', '/api/pos/transactions', { posBillId: 'T-1', memberId: who.data.member.id, items }, posHL01);
  assert.equal(sale.data.points, 20);                     // 500 บาท / 25 = 20
  assert.equal(sale.data.balance, 70);
  const again = await call('POST', '/api/pos/transactions', { posBillId: 'T-1', memberId: who.data.member.id, items }, posHL01);
  assert.equal(again.data.duplicate, true);
  const me = await call('GET', '/api/liff/me', undefined, asUser);
  assert.equal(me.data.wallets.humlai.balance, 70);
  const forged = await call('POST', '/api/pos/members/resolve', { qrToken: qr.data.token.slice(0, -2) + 'xx' }, posHL01);
  assert.equal(forged.status, 400);
  assert.equal((await call('POST', '/api/pos/transactions', { posBillId: 'T-2', items }, { 'x-api-key': 'wrong' })).status, 401);
});

t('ใช้คูปองต้อนรับ 10% แล้วคืนเงิน: หักแต้มคืนและคืนคูปอง', async () => {
  const me = (await call('GET', '/api/liff/me', undefined, asUser)).data.member;
  const cps = (await call('GET', '/api/liff/coupons?brand=humlai', undefined, asUser)).data;
  const welcome = cps.find((c) => c.title.includes('10%'));
  const sale = await call('POST', '/api/pos/transactions', { posBillId: 'T-3', memberId: me.id, items: [{ id: 'h1', name: 'x', price: 100, qty: 3 }], couponIds: [welcome.id] }, posHL01);
  assert.equal(sale.data.discount, 30);
  assert.equal(sale.data.points, 10);                     // 270 / 25 = 10
  const reuse = await call('POST', '/api/pos/transactions', { posBillId: 'T-4', memberId: me.id, items: [{ id: 'h1', name: 'x', price: 100, qty: 1 }], couponIds: [welcome.id] }, posHL01);
  assert.equal(reuse.status, 409);
  const ref = await call('POST', '/api/pos/refunds', { posBillId: 'T-3' }, posHL01);
  assert.equal(ref.data.pointsReversed, 10);
  assert.equal(ref.data.couponsReturned, 1);
  assert.equal((await call('GET', '/api/liff/me', undefined, asUser)).data.wallets.humlai.balance, 70);
});

t('แลกแต้มพร้อมกันหลายคำขอ แต้มไม่ติดลบ', async () => {
  const rewards = (await call('GET', '/api/liff/rewards?brand=humlai', undefined, asUser)).data;
  const r50 = rewards.find((r) => r.points_cost === 50);
  const tries = await Promise.all([1, 2, 3].map((i) => call('POST', '/api/liff/redemptions', { rewardId: r50.id }, { ...asUser, 'idempotency-key': 'k' + i })));
  assert.equal(tries.filter((x) => x.status === 200).length, 1);   // 70 แต้ม แลก 50 ได้ครั้งเดียว
  assert.equal(tries.filter((x) => x.status === 409).length, 2);
  const again = await call('POST', '/api/liff/redemptions', { rewardId: r50.id }, { ...asUser, 'idempotency-key': 'k' + (tries.findIndex((x) => x.status === 200) + 1) });
  assert.equal(again.data.duplicate, true);
  assert.equal((await call('GET', '/api/liff/me', undefined, asUser)).data.wallets.humlai.balance, 20);
});

t('เปิด OA แบรนด์ที่สอง: ใช้สมาชิกเดิม แต้มแยกกระเป๋า', async () => {
  await call('POST', '/api/dev/line-event', { brand: 'wakame', type: 'follow', lineUserId: USER });
  const me = (await call('GET', '/api/liff/me', undefined, asUser)).data;
  assert.equal(me.links.find((l) => l.brand_id === 'wakame').follow_status, 'follow');
  const wk = await call('POST', '/api/pos/transactions', { posBillId: 'W-1', memberId: me.member.id, items: [{ id: 'w1', name: 'ราเมน', price: 189, qty: 2 }] }, { 'x-dev-branch': 'WK01' });
  assert.equal(wk.data.points, 3);
  const w = (await call('GET', '/api/liff/me', undefined, asUser)).data.wallets;
  assert.equal(w.wakame.balance, 3);
  assert.equal(w.humlai.balance, 20);
});

t('หลังบ้าน: ล็อกอิน · สิทธิ์ตามแบรนด์ · ผู้ขอกับผู้อนุมัติต้องคนละคน', async () => {
  assert.equal((await call('POST', '/api/admin/login', { username: 'S002', password: 'wrong' })).status, 401);
  const login = await call('POST', '/api/admin/login', { username: 'S003', password: 'demo1234' });
  const brandMgr = { authorization: 'Bearer ' + login.data.token };
  assert.equal((await call('GET', '/api/admin/dashboard?brand=narai', undefined, brandMgr)).status, 403);
  const dash = await call('GET', '/api/admin/dashboard', undefined, brandMgr);
  assert.ok(dash.data.kpi.total > 0);
  assert.equal((await call('GET', '/api/admin/audit-logs', undefined, brandMgr)).status, 403);

  const memberId = (await call('GET', '/api/liff/me', undefined, asUser)).data.member.id;
  const req = await call('POST', '/api/admin/point-adjustments', { memberId, brand: 'humlai', points: 15, reason: 'ทดสอบ' }, brandMgr);
  assert.equal((await call('POST', '/api/admin/point-adjustments/' + req.data.requestId + '/approve', {}, brandMgr)).status, 409);
  const mgr = { 'x-dev-staff': 'S004' };
  assert.equal((await call('POST', '/api/admin/point-adjustments/' + req.data.requestId + '/approve', {}, mgr)).status, 200);
  assert.equal((await call('GET', '/api/liff/me', undefined, asUser)).data.wallets.humlai.balance, 35);
  assert.equal((await call('GET', '/api/admin/dashboard', undefined, { 'x-dev-staff': 'S005' })).status, 403);   // แคชเชียร์
});

t('แก้กฎแต้มมีผลกับบิลถัดไปทันที และเก็บประวัติกฎเดิม', async () => {
  const admin = { 'x-dev-staff': 'S002' };
  const cur = (await call('GET', '/api/admin/earn-rules', undefined, admin)).data.find((r) => r.brand_id === 'humlai');
  await call('PUT', '/api/admin/earn-rules/humlai', { baht: 10, pts: 1, base: 'net', rounding: 'floor', expiryMonths: 12, welcome: 50, backdays: 3, tiers: { gold: cur.gold_at, platinum: cur.platinum_at }, promo: { on: false } }, admin);
  const sale = await call('POST', '/api/pos/transactions', { posBillId: 'T-5', items: [{ id: 'h1', name: 'x', price: 100, qty: 1 }], memberId: (await call('GET', '/api/liff/me', undefined, asUser)).data.member.id }, posHL01);
  assert.equal(sale.data.points, 10);
});

t('แคมเปญส่งเฉพาะคนที่ติดตาม OA และยินยอม พร้อมแจกคูปอง', async () => {
  const admin = { 'x-dev-staff': 'S002' };
  const pre = await call('POST', '/api/admin/campaigns/preview', { brand: 'humlai', segment: 'all' }, admin);
  const sent = await call('POST', '/api/admin/campaigns', { brand: 'humlai', segment: 'all', text: 'ทดสอบ', coupon: true, couponTitle: 'ส่วนลด 30 บาท', couponValue: 30 }, admin);
  assert.equal(sent.data.recipients, pre.data.recipients);
  const cps = (await call('GET', '/api/liff/coupons?brand=humlai', undefined, asUser)).data;
  assert.ok(cps.some((c) => c.title === 'ส่วนลด 30 บาท'));
  // worker ส่งข้อความหลัง commit (ไม่มี channel token ในการทดสอบ จึงบันทึกเป็น skipped)
  let left = 1;
  for (let i = 0; i < 40 && left; i++) { await mods.worker.drainOutbox(); left = (await mods.db.one('SELECT count(*)::int AS n FROM outbox WHERE done_at IS NULL')).n; if (left) await new Promise((r) => setTimeout(r, 100)); }
  assert.equal(left, 0);
});

t('Webhook จริง: ต้องมีลายเซ็นถูกต้อง และ event ซ้ำไม่ถูกทำสองครั้ง', async () => {
  const body = JSON.stringify({ destination: 'U0', events: [{ type: 'message', webhookEventId: 'EV1', replyToken: 'r', source: { type: 'user', userId: USER }, message: { type: 'text', text: 'สาขา' } }] });
  const sig = crypto.createHmac('sha256', 'test-secret-humlai').update(body).digest('base64');
  const post = (s) => fetch(base + '/webhooks/line/humlai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': s }, body }).then((r) => r.json().then((d) => ({ status: r.status, d })));
  assert.equal((await post('bad')).status, 401);
  assert.equal((await post(sig)).d.processed, 1);
  await post(sig);
  const n = await mods.db.one("SELECT count(*)::int AS n FROM line_messages WHERE line_user_id = $1 AND kind = 'branches'", [USER]);
  assert.equal(n.n, 1);
});

t('หลังบ้าน: แก้ของรางวัล (คูปองที่แลกไปแล้วไม่เปลี่ยน)', async () => {
  const login = await call('POST', '/api/admin/login', { username: 'S001', password: 'demo1234' });
  const adm = { authorization: 'Bearer ' + login.data.token };
  const add = await call('POST', '/api/admin/rewards', { brand: 'humlai', name: 'ไข่ต้มฟรี', cat: 'side', cost: 30, value: 10, stock: 5 }, adm);
  assert.equal(add.status, 200, JSON.stringify(add.data));
  const red = await call('POST', '/api/liff/redemptions', { rewardId: add.data.id }, { ...asUser, 'idempotency-key': 'k-egg-1' });
  assert.equal(red.status, 200, JSON.stringify(red.data));
  const ed = await call('PATCH', '/api/admin/rewards/' + add.data.id, { name: 'ไข่ต้ม 2 ฟอง', value: 20, stock: null }, adm);
  assert.equal(ed.status, 200, JSON.stringify(ed.data));
  assert.equal(ed.data.stock, null);
  assert.notEqual(ed.data.coupon_template_id, add.data.coupon_template_id);
  const list = (await call('GET', '/api/admin/rewards', undefined, adm)).data.find((r) => r.id === add.data.id);
  assert.equal(list.redeemed, 1);
  assert.equal(Number(list.discount_value), 20);
  const mine = (await call('GET', '/api/liff/coupons?brand=humlai', undefined, asUser)).data.find((c) => c.title === 'ไข่ต้มฟรี');
  assert.equal(Number(mine.cp.value), 10);

});

t('ผู้ใช้หลังบ้าน: admin/admin ต้องเปลี่ยนรหัสก่อน · เพิ่มผู้ใช้ตามแบรนด์ · ปิดใช้งาน · ต้องเหลือผู้ดูแลอย่างน้อย 1 คน', async () => {
  const { ensureDefaultAdmin } = await import('../src/auth.js');
  assert.equal(await ensureDefaultAdmin(), false);   // migrate สร้างไว้แล้ว
  const login = await call('POST', '/api/admin/login', { username: 'Admin ', password: 'admin' });   // มือถือพิมพ์ตัวใหญ่ให้เอง
  assert.equal(login.status, 200);
  assert.equal(login.data.staff.mustChange, true);
  const adm = { authorization: 'Bearer ' + login.data.token };
  assert.equal((await call('GET', '/api/admin/rewards', undefined, adm)).status, 403);
  assert.equal((await call('POST', '/api/admin/password', { current: 'admin', password: 'admin' }, adm)).status, 400);
  assert.equal((await call('POST', '/api/admin/password', { current: 'admin', password: 'Humlai-2026' }, adm)).status, 200);
  assert.equal((await call('GET', '/api/admin/rewards', undefined, adm)).status, 200);
  assert.equal((await call('POST', '/api/admin/login', { username: 'admin', password: 'admin' })).status, 401);

  const add = await call('POST', '/api/admin/staff', { id: 'hl.manager', name: 'ผจก หำไหล', role: 'brand', scopeIds: ['humlai'], password: 'Temp-pass-1' }, adm);
  assert.equal(add.status, 200, JSON.stringify(add.data));
  assert.equal((await call('POST', '/api/admin/staff', { id: 'x1', name: 'x', role: 'brand', scopeIds: [], password: 'Temp-pass-1' }, adm)).status, 400);
  const hl = await call('POST', '/api/admin/login', { username: 'hl.manager', password: 'Temp-pass-1' });
  assert.equal(hl.data.staff.mustChange, true);
  assert.deepEqual(hl.data.staff.brands, ['humlai']);
  const hlh = { authorization: 'Bearer ' + hl.data.token };
  await call('POST', '/api/admin/password', { current: 'Temp-pass-1', password: 'My-own-pass-9' }, hlh);
  assert.equal((await call('GET', '/api/admin/staff', undefined, hlh)).status, 403);
  assert.equal((await call('PATCH', '/api/admin/staff/hl.manager', { active: false }, adm)).status, 200);
  assert.equal((await call('GET', '/api/admin/rewards', undefined, hlh)).status, 401);

  assert.equal((await call('PATCH', '/api/admin/staff/admin', { active: false }, adm)).status, 400);
  for (const id of ['S001']) assert.equal((await call('PATCH', '/api/admin/staff/' + id, { active: false }, adm)).status, 200);
  const list = (await call('GET', '/api/admin/staff', undefined, adm)).data;
  assert.ok(list.roles.find((r) => r.id === 'cashier'));
});

t('จัดการคูปอง: แจกอัตโนมัติตามเงื่อนไข · จำกัดจำนวน · วันที่ใช้ได้ · โค้ด · ของขวัญ · รูป · แก้หลังแจก', async () => {
  const login = await call('POST', '/api/admin/login', { username: 'S003', password: 'demo1234' });
  const adm = { authorization: 'Bearer ' + login.data.token };
  const pos = (b) => call('POST', '/api/pos/transactions', b, posHL01);
  const today = new Date(Date.now() + 7 * 3600e3);
  const iso = (d) => d.toISOString().slice(0, 10);
  const notToday = 127 & ~(1 << today.getUTCDay());
  const base = { brand: 'humlai', validity: 'days', days: 7, useDays: 127 };

  // รูป: PNG 1x1
  const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const up = await call('POST', '/api/admin/coupon-images', { dataUrl: png, brand: 'humlai' }, adm);
  assert.equal(up.status, 200, JSON.stringify(up.data));
  const imgRes = await fetch(base_url() + up.data.url);
  assert.equal(imgRes.headers.get('content-type'), 'image/png');
  assert.equal((await call('POST', '/api/admin/coupon-images', { dataUrl: 'data:image/png;base64,' + Buffer.from('<svg>').toString('base64') }, adm)).status, 400);

  // ทั่วไป: แจกอัตโนมัติ 1 ใบ (จำกัด 1 ใบทั้งระบบ) · ใช้ได้ทุกวันยกเว้นวันนี้
  const g = await call('POST', '/api/admin/coupon-templates', { ...base, kind: 'general', title: 'ลด 20 ทุกเมนู', description: 'ทดสอบ', imageId: up.data.id, type: 'baht', value: 20, maxIssue: 1, useDays: notToday }, adm);
  assert.equal(g.status, 200, JSON.stringify(g.data));
  const mine = (await call('GET', '/api/liff/coupons?brand=humlai', undefined, asUser)).data.filter((c) => c.title === 'ลด 20 ทุกเมนู');
  assert.equal(mine.length, 1);
  assert.equal(mine[0].image, up.data.url);
  assert.equal((await call('GET', '/api/liff/coupons?brand=humlai', undefined, asUser)).data.filter((c) => c.title === 'ลด 20 ทุกเมนู').length, 1);
  const u2 = { 'x-dev-line-user': 'Utest000000000000000000000000002' };
  assert.equal((await call('GET', '/api/liff/coupons?brand=humlai', undefined, u2)).data.filter((c) => c.title === 'ลด 20 ทุกเมนู').length, 0);
  const me = (await call('GET', '/api/liff/me', undefined, asUser)).data.member.id;
  const wrongDay = await pos({ posBillId: 'CP-1', memberId: me, couponIds: [mine[0].id], items: [{ id: 'h1', name: 'ข้าวมันไก่', price: 70, qty: 2 }] });
  assert.equal(wrongDay.data.error, 'coupon_wrong_day');

  // แจกแล้วก็แก้ได้: มูลค่าใหม่มีผลกับใบที่ลูกค้าถืออยู่ทันที · จำนวนจำกัดต่ำกว่าที่แจกไปแล้วไม่ได้
  assert.equal((await call('PATCH', '/api/admin/coupon-templates/' + g.data.id, { ...base, kind: 'general', title: 'ลด 20 ทุกเมนู', type: 'baht', value: 30, maxIssue: 0, useDays: 127 }, adm)).status, 200);
  assert.equal((await call('PATCH', '/api/admin/coupon-templates/' + g.data.id, { ...base, kind: 'general', title: 'ลด 30 ทุกเมนู', description: 'แก้แล้ว', type: 'baht', value: 30, maxIssue: 1, useDays: 127 }, adm)).status, 200);
  assert.equal((await call('GET', '/api/liff/coupons?brand=humlai', undefined, asUser)).data.find((c) => c.id === mine[0].id).big, '-30');
  const ok = await pos({ posBillId: 'CP-2', memberId: me, couponIds: [mine[0].id], items: [{ id: 'h1', name: 'ข้าวมันไก่', price: 70, qty: 2 }] });
  assert.equal(ok.data.discount, 30, JSON.stringify(ok.data));

  // ทั่วไปเฉพาะ Platinum: สมาชิกใหม่ไม่ได้
  await call('POST', '/api/admin/coupon-templates', { ...base, kind: 'general', title: 'เฉพาะแพลทินัม', type: 'pct', value: 10, maxDiscount: 50, tier: 'PLATINUM' }, adm);
  assert.equal((await call('GET', '/api/liff/coupons?brand=humlai', undefined, u2)).data.some((c) => c.title === 'เฉพาะแพลทินัม'), false);

  // ช่วงวันที่: ยังไม่ถึงวันเริ่ม → ได้คูปองแต่ใช้ไม่ได้
  const tmr = iso(new Date(today.getTime() + 864e5)); const nextw = iso(new Date(today.getTime() + 7 * 864e5));
  await call('POST', '/api/admin/coupon-templates', { ...base, kind: 'general', title: 'เริ่มพรุ่งนี้', type: 'free', value: 25, validity: 'dates', validFrom: tmr, validTo: nextw }, adm);
  const fut = (await call('GET', '/api/liff/coupons?brand=humlai', undefined, u2)).data.find((c) => c.title === 'เริ่มพรุ่งนี้');
  assert.equal(fut.big, 'ฟรี');
  assert.ok(Math.abs(fut.expiresAt - new Date(nextw + 'T23:59:59+07:00')) < 1000);
  const u2id = (await call('GET', '/api/liff/me', undefined, u2)).data.member.id;
  assert.equal((await pos({ posBillId: 'CP-3', memberId: u2id, couponIds: [fut.id], items: [{ id: 'h6', name: 'น้ำ', price: 25, qty: 1 }] })).data.error, 'coupon_not_started');

  // หมดช่วงแจก → ไม่แจก
  const yday = iso(new Date(today.getTime() - 864e5));
  await call('POST', '/api/admin/coupon-templates', { ...base, kind: 'general', title: 'หมดช่วงแจก', type: 'baht', value: 5, issueFrom: yday, issueTo: yday }, adm);
  assert.equal((await call('GET', '/api/liff/coupons?brand=humlai', undefined, u2)).data.some((c) => c.title === 'หมดช่วงแจก'), false);

  // โค้ด: กรอกได้ครั้งเดียว · ปิดคูปองแล้วโค้ดใช้ไม่ได้
  const cc = await call('POST', '/api/admin/coupon-templates', { ...base, kind: 'code', code: 'hlsummer', title: 'โค้ดหน้าร้อน', type: 'baht', value: 15 }, adm);
  assert.equal(cc.status, 200, JSON.stringify(cc.data));
  assert.equal((await call('POST', '/api/liff/coupons/claim', { brand: 'humlai', code: 'HLSUMMER' }, asUser)).status, 200);
  assert.equal((await call('POST', '/api/liff/coupons/claim', { brand: 'humlai', code: 'HLSUMMER' }, asUser)).status, 409);
  // เปลี่ยนโค้ดหลังมีคนกรอกแล้ว: โค้ดเดิมใช้ไม่ได้ · คนที่ได้คูปองไปแล้วกรอกโค้ดใหม่ซ้ำไม่ได้ · คนอื่นกรอกโค้ดใหม่ได้
  assert.equal((await call('PATCH', '/api/admin/coupon-templates/' + cc.data.id, { ...base, kind: 'code', code: 'HLSUMMER2', title: 'โค้ดหน้าร้อน', type: 'baht', value: 20 }, adm)).status, 200);
  assert.equal((await call('POST', '/api/liff/coupons/claim', { brand: 'humlai', code: 'HLSUMMER' }, u2)).status, 400);
  assert.equal((await call('POST', '/api/liff/coupons/claim', { brand: 'humlai', code: 'HLSUMMER2' }, asUser)).status, 409);
  assert.equal((await call('POST', '/api/liff/coupons/claim', { brand: 'humlai', code: 'HLSUMMER2' }, u2)).status, 200);
  assert.equal((await call('PATCH', '/api/admin/coupon-templates/' + cc.data.id, { active: false }, adm)).status, 200);
  assert.equal((await call('POST', '/api/liff/coupons/claim', { brand: 'humlai', code: 'HLSUMMER2' }, u2)).status, 400);   // ปิดคูปองแล้วโค้ดใช้ไม่ได้

  // ของขวัญ: พนักงานมอบให้รายคน
  const gift = await call('POST', '/api/admin/coupon-templates', { ...base, kind: 'gift', title: 'ขอโทษที่รอนาน', type: 'free', value: 40 }, adm);
  const gv = await call('POST', '/api/admin/members/' + u2id + '/coupons', { templateId: gift.data.id }, adm);
  assert.equal(gv.status, 200, JSON.stringify(gv.data));
  assert.ok((await call('GET', '/api/liff/coupons?brand=humlai', undefined, u2)).data.some((c) => c.title === 'ขอโทษที่รอนาน'));

  const list = (await call('GET', '/api/admin/coupon-templates?brand=humlai', undefined, adm)).data;
  assert.equal(list.find((x) => x.id === g.data.id).used, 1);
  assert.ok(list.some((x) => x.kind === 'welcome'));
});

t('คูปองต้อนรับแยกตามสาขาที่สมัคร', async () => {
  const login = await call('POST', '/api/admin/login', { username: 'S003', password: 'demo1234' });
  const adm = { authorization: 'Bearer ' + login.data.token };
  const base = { brand: 'humlai', kind: 'welcome', validity: 'days', days: 30, useDays: 127, type: 'baht' };
  assert.equal((await call('POST', '/api/admin/coupon-templates', { ...base, title: 'x', value: 1, branchIds: [] }, adm)).data.error, 'branch_required');
  assert.equal((await call('POST', '/api/admin/coupon-templates', { ...base, title: 'x', value: 1, branchIds: ['NR01'] }, adm)).data.error, 'branch_invalid');
  assert.equal((await call('POST', '/api/admin/coupon-templates', { ...base, title: 'ต้อนรับสาขา 2', value: 30, branchIds: ['HL02'] }, adm)).status, 200);
  const reg = async (n, branchId) => {
    const u = { 'x-dev-line-user': 'Uwelcome' + n };
    const r = await call('POST', '/api/liff/register', { brand: 'humlai', name: 'สาขา ' + branchId, phone: '08000000' + n, privacy: true, branchId }, u);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    return (await call('GET', '/api/liff/coupons?brand=humlai', undefined, u)).data.map((c) => c.title);
  };
  const at2 = await reg('11', 'HL02'); const at1 = await reg('12', 'HL01');
  assert.ok(at2.includes('ต้อนรับสาขา 2'));
  assert.ok(!at1.includes('ต้อนรับสาขา 2'));
  assert.ok(at1.includes('ส่วนลด 10% บิลแรก') && at2.includes('ส่วนลด 10% บิลแรก'));   // ใบเดิมตั้งเป็นทุกสาขา
});

t('ลบข้อมูล: คูปอง · ของรางวัล · สมาชิก (บิลยังอยู่) · ผู้ใช้ · สาขา (ลบได้เฉพาะที่ยังไม่มีประวัติ)', async () => {
  const sup = { authorization: 'Bearer ' + (await call('POST', '/api/admin/login', { username: 'S002', password: 'demo1234' })).data.token };
  const login = await call('POST', '/api/admin/login', { username: 'admin', password: 'Humlai-2026' });
  const adm = { authorization: 'Bearer ' + login.data.token };

  const c = await call('POST', '/api/admin/coupon-templates', { brand: 'humlai', kind: 'general', title: 'จะลบ', type: 'baht', value: 9, validity: 'days', days: 7, useDays: 127 }, adm);
  const u = { 'x-dev-line-user': 'Udelete01' };
  await call('POST', '/api/liff/register', { brand: 'humlai', name: 'คนจะถูกลบ', phone: '0811110000', privacy: true, branchId: 'HL01' }, u);
  assert.ok((await call('GET', '/api/liff/coupons?brand=humlai', undefined, u)).data.some((x) => x.title === 'จะลบ'));
  const dc = await call('DELETE', '/api/admin/coupon-templates/' + c.data.id, undefined, adm);
  assert.equal(dc.status, 200, JSON.stringify(dc.data));
  assert.equal(dc.data.removedCoupons, 1);
  assert.ok(!(await call('GET', '/api/liff/coupons?brand=humlai', undefined, u)).data.some((x) => x.title === 'จะลบ'));

  const rw = (await call('GET', '/api/admin/rewards', undefined, adm)).data.find((r) => r.brand_id === 'humlai');
  assert.equal((await call('DELETE', '/api/admin/rewards/' + rw.id, undefined, adm)).status, 200);

  // สมาชิก: มีบิลแล้วลบได้ บิลยังอยู่แต่ไม่ผูกสมาชิก · ไม่ใช่ผู้ดูแลระบบลบไม่ได้
  const mid = (await call('GET', '/api/liff/me', undefined, u)).data.member.id;
  await call('POST', '/api/pos/transactions', { posBillId: 'DEL-1', memberId: mid, items: [{ id: 'h1', name: 'ข้าวมันไก่', price: 70, qty: 1 }] }, posHL01);
  assert.equal((await call('DELETE', '/api/admin/members/' + mid, undefined, sup)).status, 403);
  const dm = await call('DELETE', '/api/admin/members/' + mid, undefined, adm);
  assert.equal(dm.status, 200, JSON.stringify(dm.data));
  assert.equal((await call('GET', '/api/liff/me', undefined, u)).data.member, null);
  const bill = await mods.db.one("SELECT member_id FROM sales_transactions WHERE pos_bill_id = 'DEL-1'");
  assert.equal(bill.member_id, null);

  // ผู้ใช้
  await call('POST', '/api/admin/staff', { id: 'temp.user', name: 'ชั่วคราว', role: 'marketing', password: 'Temp-pass-1' }, adm);
  assert.equal((await call('DELETE', '/api/admin/staff/temp.user', undefined, adm)).status, 200);
  assert.equal((await call('DELETE', '/api/admin/staff/admin', undefined, adm)).status, 400);

  // สาขา: ใหม่ลบได้ · มีบิลแล้วลบไม่ได้ (ให้ปิดแทน)
  assert.equal((await call('POST', '/api/admin/branches', { brand: 'humlai', id: 'hl09', name: 'สาขาทดลอง', open: '08:00', close: '20:00' }, adm)).status, 200);
  assert.ok((await call('GET', '/api/public/brands')).data.find((b) => b.id === 'humlai').branches.some((b) => b.id === 'HL09'));
  assert.equal((await call('PATCH', '/api/admin/branches/HL09', { name: 'สาขาทดลอง', active: false }, adm)).status, 200);
  assert.ok(!(await call('GET', '/api/public/brands')).data.find((b) => b.id === 'humlai').branches.some((b) => b.id === 'HL09'));
  assert.equal((await call('DELETE', '/api/admin/branches/HL09', undefined, adm)).status, 200);
  assert.equal((await call('DELETE', '/api/admin/branches/HL01', undefined, adm)).data.error, 'branch_in_use');
});

t('POS ส่งส่วนลดร้าน + ยอดจ่ายจริง: แต้มคิดจากยอดหลังส่วนลด ก่อนค่าบริการ/VAT · บิลไม่ใช่สมาชิกก็บันทึก', async () => {
  const u = { 'x-dev-line-user': 'Upossum01' };
  await call('POST', '/api/liff/register', { brand: 'humlai', name: 'ทดสอบยอด', phone: '0822220000', privacy: true }, u);
  const mid = (await call('GET', '/api/liff/me', undefined, u)).data.member.id;
  // ราคา 300 ส่วนลดร้าน 50 → 250 · จ่ายจริงรวมค่าบริการ+VAT 294.25
  const r = await call('POST', '/api/pos/transactions', { posBillId: 'XUM-#901', memberId: mid, items: [{ id: 'a', name: 'ข้าวมันไก่', price: 100, qty: 3 }], storeDiscount: 50, paidTotal: 294.25 }, posHL01);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const rule = await mods.db.one("SELECT * FROM earn_rules WHERE brand_id = 'humlai' AND effective_to IS NULL");
  assert.equal(r.data.points, Math.floor(250 / Number(rule.baht_per_unit)) * rule.points_per_unit);   // คิดจาก 250 ไม่ใช่ 294.25
  assert.equal(Number(r.data.total), 294.25);
  assert.equal(Number(r.data.discount), 50);
  const again = await call('POST', '/api/pos/transactions', { posBillId: 'XUM-#901', memberId: mid, items: [{ id: 'a', name: 'ข้าวมันไก่', price: 100, qty: 3 }], storeDiscount: 50, paidTotal: 294.25 }, posHL01);
  assert.equal(again.data.duplicate, true);
  assert.equal(again.data.memberId, mid);
  const anon = await call('POST', '/api/pos/transactions', { posBillId: 'XUM-#902', items: [{ id: 'a', name: 'ข้าวมันไก่', price: 70, qty: 1 }], paidTotal: 70, channel: 'kiosk' }, posHL01);
  assert.equal(anon.status, 200);
  assert.equal(anon.data.points, 0);
});

t('หน้าร้าน: ดูคูปอง/รางวัล · จองคูปองกันใช้ซ้ำสองบิล · แลกแต้มเป็นคูปองแล้วใช้ทันที · หน้าลูกค้าต้องยืนยันรหัส LINE', async () => {
  const u = { 'x-dev-line-user': 'Upospay01' };
  await call('POST', '/api/liff/register', { brand: 'humlai', name: 'คูปองหน้าร้าน', phone: '0833330000', privacy: true }, u);
  const mid = (await call('GET', '/api/liff/me', undefined, u)).data.member.id;
  await mods.db.q("UPDATE member_line_identities SET line_user_id = 'Upospay01' WHERE member_id = $1", [mid]);
  // ให้แต้มพอแลก
  await call('POST', '/api/pos/transactions', { posBillId: 'CPN-0', memberId: mid, items: [{ id: 'a', name: 'ชุดใหญ่', price: 5000, qty: 1 }] }, posHL01);

  const w = await call('POST', '/api/pos/members/wallet', { memberId: mid, subtotal: 300, ref: 'R1' }, posHL01);
  assert.equal(w.status, 200, JSON.stringify(w.data));
  const welcome = w.data.coupons.find((c) => c.usable);
  assert.ok(welcome, 'ควรมีคูปองต้อนรับที่ใช้ได้');
  assert.ok(w.data.rewards.some((r) => r.affordable));

  // จองกับบิล R1 แล้ว บิล R2 จองซ้ำไม่ได้ · บิลที่ไม่ได้จองใช้ใบนี้ไม่ได้
  const res1 = await call('POST', '/api/pos/coupons/reserve', { memberId: mid, couponId: welcome.id, ref: 'R1', subtotal: 300 }, posHL01);
  assert.equal(res1.status, 200, JSON.stringify(res1.data));
  assert.equal(res1.data.coupon.discount, welcome.discount);
  assert.equal((await call('POST', '/api/pos/coupons/reserve', { memberId: mid, couponId: welcome.id, ref: 'R2', subtotal: 300 }, posHL01)).data.error, 'coupon_reserved');
  assert.equal((await call('POST', '/api/pos/transactions', { posBillId: 'CPN-X', memberId: mid, couponIds: [welcome.id], couponRef: 'R2', items: [{ id: 'a', name: 'x', price: 300, qty: 1 }] }, posHL01)).data.error, 'coupon_reserved');
  // ปิดบิล R1 ด้วยคูปอง
  const sale = await call('POST', '/api/pos/transactions', { posBillId: 'CPN-1', memberId: mid, couponIds: [welcome.id], couponRef: 'R1', couponDiscount: res1.data.coupon.discount, paidTotal: 300 - res1.data.coupon.discount, items: [{ id: 'a', name: 'x', price: 300, qty: 1 }] }, posHL01);
  assert.equal(sale.status, 200, JSON.stringify(sale.data));
  assert.equal(Number(sale.data.discount), res1.data.coupon.discount);
  assert.deepEqual(sale.data.coupons, [welcome.id]);

  // แลกแต้มที่หน้าร้าน → ได้คูปองจองกับบิล R3 · กดซ้ำไม่ตัดแต้มซ้ำ
  const rw = w.data.rewards.find((r) => r.affordable);
  const before = (await call('GET', '/api/liff/me', undefined, u)).data.wallets.humlai.balance;
  const red = await call('POST', '/api/pos/redeem', { memberId: mid, rewardId: rw.id, ref: 'R3', subtotal: 500 }, posHL01);
  assert.equal(red.status, 200, JSON.stringify(red.data));
  assert.equal(red.data.balance, before - rw.cost);
  const red2 = await call('POST', '/api/pos/redeem', { memberId: mid, rewardId: rw.id, ref: 'R3', subtotal: 500 }, posHL01);
  assert.equal(red2.data.balance, before - rw.cost);
  assert.equal((await call('POST', '/api/pos/coupons/release', { couponId: red.data.coupon.id, ref: 'R3' }, posHL01)).data.released, true);

  // หน้าลูกค้าสั่งเอง: ต้องมีรหัสยืนยันจาก LINE
  assert.equal((await call('POST', '/api/pos/members/wallet', { memberId: mid, requireVerify: true }, posHL01)).status, 401);
  // รหัส 6 หลักจากบัตรสมาชิก (ไม่ส่งข้อความ LINE)
  const msgsBefore = (await mods.db.one("SELECT count(*)::int AS n FROM line_messages WHERE line_user_id = 'Upospay01'")).n;
  const sendRes = await call('POST', '/api/pos/members/verify/send', { memberId: mid }, posHL01);
  assert.equal(sendRes.data.mode, 'card');
  assert.equal((await mods.db.one("SELECT count(*)::int AS n FROM line_messages WHERE line_user_id = 'Upospay01'")).n, msgsBefore);
  const code = (await call('GET', '/api/liff/qr', undefined, u)).data.pin;
  assert.match(code, /^\d{6}$/);
  assert.equal((await call('POST', '/api/pos/members/verify/check', { memberId: mid, code: code === '000000' ? '111111' : '000000' }, posHL01)).status, 400);
  const ok = await call('POST', '/api/pos/members/verify/check', { memberId: mid, code }, posHL01);
  assert.ok(ok.data.verifyToken);
  assert.equal((await call('POST', '/api/pos/members/wallet', { memberId: mid, requireVerify: true, verifyToken: ok.data.verifyToken }, posHL01)).status, 200);
  assert.equal((await call('POST', '/api/pos/members/wallet', { memberId: 'MB-0000001', requireVerify: true, verifyToken: ok.data.verifyToken }, posHL01)).status, 401);

  // บิลมาถึงช้า คูปองใช้ไม่ได้แล้ว: ยังบันทึกบิล ใช้ส่วนลดที่ POS ให้ไป ไม่ตัดคูปอง
  const late = await call('POST', '/api/pos/transactions', { posBillId: 'CPN-2', memberId: mid, couponIds: [welcome.id], couponRef: 'R9', couponDiscount: 30, paidTotal: 270, items: [{ id: 'a', name: 'x', price: 300, qty: 1 }] }, posHL01);
  assert.equal(late.status, 200, JSON.stringify(late.data));
  assert.equal(Number(late.data.discount), 30);
  assert.deepEqual(late.data.coupons, []);
});

t('แจ้งแต้มทาง LINE: ค่าเริ่มต้นไม่แจ้ง · เปิดทุกบิล · เฉพาะบิลยอดถึงขั้นต่ำ', async () => {
  const u = { 'x-dev-line-user': 'Unotify01' };
  await call('POST', '/api/liff/register', { brand: 'humlai', name: 'แจ้งเตือน', phone: '0844440000', privacy: true }, u);
  const mid = (await call('GET', '/api/liff/me', undefined, u)).data.member.id;
  const pts = () => mods.db.one("SELECT count(*)::int AS n FROM line_messages WHERE line_user_id = 'Unotify01' AND kind = 'points'").then((r) => r.n);
  const bill = (no, price) => call('POST', '/api/pos/transactions', { posBillId: no, memberId: mid, items: [{ id: 'a', name: 'x', price, qty: 1 }] }, posHL01);
  await mods.db.q("UPDATE brands SET points_notify = 'off' WHERE id = 'humlai'");
  await bill('NT-1', 100);
  assert.equal(await pts(), 0);
  const adm = { authorization: 'Bearer ' + (await call('POST', '/api/admin/login', { username: 'S003', password: 'demo1234' })).data.token };
  assert.equal((await call('PATCH', '/api/admin/brands/humlai/notify', { pointsNotify: 'min', pointsNotifyMin: 200 }, adm)).status, 200);
  await bill('NT-2', 100);
  assert.equal(await pts(), 0);
  await bill('NT-3', 250);
  assert.equal(await pts(), 1);
  assert.equal((await call('PATCH', '/api/admin/brands/humlai/notify', { pointsNotify: 'all' }, adm)).status, 200);
  await bill('NT-4', 50);
  assert.equal(await pts(), 2);
  const rule = (await call('GET', '/api/admin/earn-rules', undefined, adm)).data.find((r) => r.brand_id === 'humlai');
  assert.equal(rule.points_notify, 'all');
});

test('ลิงก์สมัครสมาชิกจากหน้าลูกค้าสั่งเอง: เลือกแบรนด์และสาขาของเครื่อง POS', { skip: !TEST_DB }, async () => {
  assert.equal((await call('POST', '/api/pos/join-link', {}, { 'x-api-key': 'wrong' })).status, 401);
  const old = process.env.LIFF_ID;
  process.env.LIFF_ID = '1234567890-abcdEFGH';
  try {
    const r = await call('POST', '/api/pos/join-link', {}, posHL01);
    assert.equal(r.status, 200);
    const u = new URL(r.data.url);
    assert.equal(u.origin + u.pathname, 'https://liff.line.me/1234567890-abcdEFGH');
    assert.equal(u.searchParams.get('brand'), 'humlai');
    assert.equal(u.searchParams.get('branch'), 'HL01');
    assert.equal(u.searchParams.get('from'), 'kiosk');
  } finally { if (old === undefined) delete process.env.LIFF_ID; else process.env.LIFF_ID = old; }
});

t('แต้มรีวิวร้านในแชท LINE: ตั้งค่าในหลังบ้าน · ได้เฉพาะวันที่มีบิล · วันละครั้ง', async () => {
  const uid = 'Ureview0000000000000000000000001';
  const u = { 'x-dev-line-user': uid };
  await call('POST', '/api/liff/register', { brand: 'humlai', name: 'รีวิว', phone: '0855550000', privacy: true }, u);
  const mid = (await call('GET', '/api/liff/me', undefined, u)).data.member.id;
  let ev = 0;
  const rate = () => {
    const body = JSON.stringify({ destination: 'U0', events: [{ type: 'message', webhookEventId: 'EVR' + (++ev), replyToken: 'r', source: { type: 'user', userId: uid }, message: { type: 'text', text: 'อร่อยมาก' } }] });
    const sig = crypto.createHmac('sha256', 'test-secret-humlai').update(body).digest('base64');
    return fetch(base + '/webhooks/line/humlai', { method: 'POST', headers: { 'content-type': 'application/json', 'x-line-signature': sig }, body });
  };
  const bonus = () => mods.db.one("SELECT COALESCE(sum(points),0)::int AS n FROM point_ledger WHERE member_id = $1 AND entry_type = 'bonus'", [mid]).then((r) => r.n);
  const adm = { authorization: 'Bearer ' + (await call('POST', '/api/admin/login', { username: 'S003', password: 'demo1234' })).data.token };
  assert.equal((await call('PATCH', '/api/admin/brands/humlai/review', { reviewPoints: -1 }, adm)).status, 400);
  assert.equal((await call('PATCH', '/api/admin/brands/humlai/review', { reviewPoints: 3 }, adm)).data.review_points, 3);
  assert.equal((await call('GET', '/api/admin/earn-rules', undefined, adm)).data.find((r) => r.brand_id === 'humlai').review_points, 3);

  // ยังไม่มีบิลวันนี้ → ไม่ได้แต้ม (บอกวิธีได้แต้มแทน)
  await rate();
  assert.equal(await bonus(), 0);
  // มีบิลวันนี้ → ได้ 3 แต้ม ครั้งเดียวต่อวัน
  await call('POST', '/api/pos/transactions', { posBillId: 'RV-1', memberId: mid, items: [{ id: 'a', name: 'x', price: 60, qty: 1 }] }, posHL01);
  await rate();
  assert.equal(await bonus(), 3);
  await rate();
  assert.equal(await bonus(), 3);
  // ปิด (0)
  assert.equal((await call('PATCH', '/api/admin/brands/humlai/review', { reviewPoints: 0 }, adm)).data.review_points, 0);
  await call('PATCH', '/api/admin/brands/humlai/review', { reviewPoints: 5 }, adm);
});

t('POS สแกน QR คูปอง: ได้สมาชิกและคูปองในครั้งเดียว', async () => {
  const u = { 'x-dev-line-user': 'Ucpscan000000000000000000000001' };
  await call('POST', '/api/liff/register', { brand: 'humlai', name: 'สแกนคูปอง', phone: '0866660000', privacy: true }, u);
  const mid = (await call('GET', '/api/liff/me', undefined, u)).data.member.id;
  const tpl = await mods.db.one(`SELECT id FROM coupon_templates t WHERE brand_id = 'humlai' AND t.is_active AND (t.issue_from IS NULL OR t.issue_from <= now())
    AND (t.issue_to IS NULL OR t.issue_to >= now()) AND (t.valid_to IS NULL OR t.valid_to > now()) ORDER BY id LIMIT 1`);
  const adm = { authorization: 'Bearer ' + (await call('POST', '/api/admin/login', { username: 'S003', password: 'demo1234' })).data.token };
  const gift = await call('POST', '/api/admin/members/' + mid + '/coupons', { templateId: tpl.id }, adm);
  assert.equal(gift.status, 200, JSON.stringify(gift.data));
  const code = gift.data.code;

  const r = await call('POST', '/api/pos/members/resolve', { query: 'CP.' + code }, posHL01);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.member.id, mid);
  assert.equal(r.data.scannedCoupon.id, gift.data.couponId);
  assert.equal(r.data.scannedCoupon.code, code);
  // พิมพ์รหัสคูปองเอง (ตัวเล็กก็ได้) เหมือนสแกน
  const r2 = await call('POST', '/api/pos/members/resolve', { query: code.toLowerCase() }, posHL01);
  assert.equal(r2.data.member.id, mid);
  assert.equal(r2.data.scannedCoupon.id, gift.data.couponId);
  // ใช้แล้ว → ยังได้สมาชิก แต่บอกว่าใช้ไม่ได้
  await mods.db.q("UPDATE member_coupons SET status = 'used', used_at = now() WHERE id = $1", [gift.data.couponId]);
  const r3 = await call('POST', '/api/pos/members/resolve', { query: 'CP.' + code }, posHL01);
  assert.equal(r3.data.member.id, mid);
  assert.equal(r3.data.scannedCoupon.usable, false);
  assert.equal(r3.data.scannedCoupon.reason, 'คูปองนี้ใช้ไปแล้ว');
  assert.equal((await call('POST', '/api/pos/members/resolve', { query: 'CP.ZZ-NONE99' }, posHL01)).status, 404);
  // QR บัตรสมาชิก / เบอร์โทร ไม่มี scannedCoupon
  assert.equal((await call('POST', '/api/pos/members/resolve', { query: '0866660000' }, posHL01)).data.scannedCoupon, null);
});

t('ของรางวัล: แบบคูปอง · จำกัดระดับ · จำกัดต่อคน · ช่วงวันที่', async () => {
  const u = { 'x-dev-line-user': 'Urewardset00000000000000000000001' };
  await call('POST', '/api/liff/register', { brand: 'humlai', name: 'ของรางวัล', phone: '0877770000', privacy: true }, u);
  const mid = (await call('GET', '/api/liff/me', undefined, u)).data.member.id;
  await mods.db.q(`INSERT INTO point_ledger (member_id, brand_id, entry_type, points, balance_after, idempotency_key, note, actor_type)
    VALUES ($1, 'humlai', 'adjust', 500, 500, 'test-rw-' || $1, 'ทดสอบ', 'system')`, [mid]).catch(() => {});
  await mods.db.q("INSERT INTO wallets (member_id, brand_id, balance) VALUES ($1, 'humlai', 500) ON CONFLICT (member_id, brand_id) DO UPDATE SET balance = 500", [mid]);
  const adm = { authorization: 'Bearer ' + (await call('POST', '/api/admin/login', { username: 'S003', password: 'demo1234' })).data.token };
  const tpl = await mods.db.one(`SELECT id FROM coupon_templates t WHERE brand_id = 'humlai' AND kind <> 'internal' AND t.is_active AND (t.issue_from IS NULL OR t.issue_from <= now())
    AND (t.issue_to IS NULL OR t.issue_to >= now()) AND (t.valid_to IS NULL OR t.valid_to > now()) ORDER BY id LIMIT 1`);
  const redeem = (id, k) => call('POST', '/api/liff/redemptions', { rewardId: id }, { ...u, 'idempotency-key': k });
  const list = async () => (await call('GET', '/api/liff/rewards?brand=humlai', undefined, u)).data;

  // แบบคูปอง: ต้องเลือกคูปอง · แลกแล้วได้คูปองใบนั้น · จำกัด 1 ครั้งต่อวัน
  assert.equal((await call('POST', '/api/admin/rewards', { brand: 'humlai', kind: 'coupon', name: 'แลกคูปอง', cost: 10 }, adm)).status, 400);
  const cp = await call('POST', '/api/admin/rewards', { brand: 'humlai', kind: 'coupon', templateId: tpl.id, name: 'แลกคูปอง', cost: 10, description: 'รายละเอียด', limitCount: 1, limitPeriod: 'day' }, adm);
  assert.equal(cp.status, 200, JSON.stringify(cp.data));
  assert.equal(cp.data.coupon_template_id, tpl.id);
  const r1 = await redeem(cp.data.id, 'rw-cp-1');
  assert.equal(r1.status, 200, JSON.stringify(r1.data));
  assert.equal((await mods.db.one('SELECT template_id FROM member_coupons WHERE id = $1', [r1.data.couponId])).template_id, tpl.id);
  assert.equal((await redeem(cp.data.id, 'rw-cp-2')).status, 409);
  assert.equal((await list()).find((r) => r.id === cp.data.id).why, 'แลกครบ 1 ครั้งในวันนี้');

  // เฉพาะ Gold/Platinum: สมาชิก Silver เห็นเหตุผล แลกไม่ได้
  const gold = await call('POST', '/api/admin/rewards', { brand: 'humlai', name: 'ของ Gold', cost: 10, value: 20, tiers: ['GOLD', 'PLATINUM'] }, adm);
  assert.equal(gold.status, 200, JSON.stringify(gold.data));
  assert.deepEqual(gold.data.tiers, ['GOLD', 'PLATINUM']);
  assert.match((await list()).find((r) => r.id === gold.data.id).why, /Gold/);
  assert.equal((await redeem(gold.data.id, 'rw-gold-1')).status, 400);
  // เลือกครบทุกระดับ = ไม่จำกัด (เก็บเป็น null)
  const all = await call('PATCH', '/api/admin/rewards/' + gold.data.id, { tiers: ['SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'] }, adm);
  assert.equal(all.data.tiers, null);
  assert.equal(all.data.name, 'ของ Gold');

  // ยังไม่ถึงวันเริ่ม: ไม่อยู่ในรายการ แลกไม่ได้ · แก้ให้เริ่มวันนี้แล้วแลกได้
  const future = await call('POST', '/api/admin/rewards', { brand: 'humlai', name: 'อนาคต', cost: 10, value: 5, startDate: '2099-01-01' }, adm);
  assert.equal(future.status, 200, JSON.stringify(future.data));
  assert.ok(!(await list()).some((r) => r.id === future.data.id));
  assert.equal((await redeem(future.data.id, 'rw-fut-1')).status, 400);
  assert.equal((await call('POST', '/api/admin/rewards', { brand: 'humlai', name: 'ผิด', cost: 10, startDate: '2099-02-01', endDate: '2099-01-01' }, adm)).status, 400);
  const adminRow = (await call('GET', '/api/admin/rewards', undefined, adm)).data.find((r) => r.id === future.data.id);
  assert.equal(adminRow.start_day, '2099-01-01');
  await call('PATCH', '/api/admin/rewards/' + future.data.id, { startDate: null }, adm);
  assert.equal((await redeem(future.data.id, 'rw-fut-2')).status, 200);
});

t('หลังบ้านสมาชิก: เพิ่มสมาชิกเอง · แท็ก (ติดเอง/อัตโนมัติ) · หมายเหตุ · กรอง/แบ่งหน้า', async () => {
  const adm = { authorization: 'Bearer ' + (await call('POST', '/api/admin/login', { username: 'S003', password: 'demo1234' })).data.token };
  // เพิ่มสมาชิก: ต้องยินยอม · เบอร์ซ้ำบอกเลขเดิม · ได้แต้มต้อนรับ
  assert.equal((await call('POST', '/api/admin/members', { brand: 'humlai', name: 'ลูกค้าหน้าร้าน', phone: '0811112222' }, adm)).status, 400);
  const add = await call('POST', '/api/admin/members', { brand: 'humlai', name: 'ลูกค้าหน้าร้าน', phone: '081-111-2222', birthday: '1990-05-01', branchId: 'HL01', consent: true }, adm);
  assert.equal(add.status, 200, JSON.stringify(add.data));
  const mid = add.data.id;
  const dup = await call('POST', '/api/admin/members', { brand: 'humlai', name: 'ซ้ำ', phone: '0811112222', consent: true }, adm);
  assert.equal(dup.status, 409); assert.match(dup.data.message, new RegExp(mid));
  assert.equal((await mods.db.one('SELECT line_user_id FROM member_line_identities WHERE member_id = $1', [mid])), null);

  // ค้นหาเจอ · มีแท็กอัตโนมัติ "ยังไม่ผูก LINE" + "สมาชิกใหม่"
  const noLine = await call('POST', '/api/admin/tags', { brand: 'humlai', name: 'ยังไม่ผูก LINE', kind: 'auto', rule: { type: 'no_line' }, color: 'gray' }, adm);
  assert.equal(noLine.status, 200, JSON.stringify(noLine.data));
  const fresh = await call('POST', '/api/admin/tags', { brand: 'humlai', name: 'สมาชิกใหม่ 30 วัน', kind: 'auto', rule: { type: 'new', days: 30 } }, adm);
  assert.equal((await call('POST', '/api/admin/tags', { brand: 'humlai', name: 'อะไร', kind: 'auto', rule: { type: 'hack' } }, adm)).status, 400);
  const vip = await call('POST', '/api/admin/tags', { brand: 'humlai', name: 'VIP', color: 'purple' }, adm);
  assert.equal((await call('POST', '/api/admin/tags', { brand: 'humlai', name: 'vip' }, adm)).status, 409);
  const found = (await call('GET', '/api/admin/members?brand=humlai&q=0811112222', undefined, adm)).data;
  assert.equal(found.total, 1);
  const names = found.rows[0].tags.map((x) => x.name);
  assert.ok(names.includes('ยังไม่ผูก LINE') && names.includes('สมาชิกใหม่ 30 วัน'), JSON.stringify(names));
  assert.equal(found.rows[0].tier, 'SILVER');

  // ติดแท็กเอง · กรองด้วยแท็ก · ติดแท็กอัตโนมัติเองไม่ได้ · ถอดแท็ก
  assert.equal((await call('POST', '/api/admin/members/' + mid + '/tags', { tagId: vip.data.id }, adm)).status, 200);
  assert.equal((await call('POST', '/api/admin/members/' + mid + '/tags', { tagId: noLine.data.id }, adm)).status, 400);
  const byTag = (await call('GET', '/api/admin/members?brand=humlai&tag=' + vip.data.id, undefined, adm)).data;
  assert.deepEqual(byTag.rows.map((r) => r.id), [mid]);
  const tags = (await call('GET', '/api/admin/tags?brand=humlai', undefined, adm)).data;
  assert.equal(tags.find((x) => x.id === vip.data.id).members, 1);
  assert.ok(tags.find((x) => x.id === fresh.data.id).members >= 1);
  assert.equal((await call('DELETE', '/api/admin/members/' + mid + '/tags/' + vip.data.id, undefined, adm)).status, 200);
  assert.equal((await call('GET', '/api/admin/members?brand=humlai&tag=' + vip.data.id, undefined, adm)).data.total, 0);

  // หมายเหตุ + รายละเอียดเฉพาะแบรนด์
  await call('PUT', '/api/admin/members/' + mid + '/note', { brand: 'humlai', note: 'แพ้ถั่ว' }, adm);
  const det = (await call('GET', '/api/admin/members/' + mid + '?brand=humlai', undefined, adm)).data;
  assert.equal(det.extra.note, 'แพ้ถั่ว');
  assert.ok(det.extra.tags.some((x) => x.name === 'ยังไม่ผูก LINE'));

  // แบ่งหน้า · กรองระดับ · ดาวน์โหลดทั้งหมดบันทึกประวัติ
  const p1 = (await call('GET', '/api/admin/members?brand=humlai&size=5&page=1', undefined, adm)).data;
  const p2 = (await call('GET', '/api/admin/members?brand=humlai&size=5&page=2', undefined, adm)).data;
  assert.equal(p1.rows.length, 5); assert.ok(p1.total > 5);
  assert.ok(!p2.rows.some((r) => p1.rows.some((x) => x.id === r.id)));
  const gold = (await call('GET', '/api/admin/members?brand=humlai&tier=GOLD', undefined, adm)).data;
  assert.ok(gold.rows.every((r) => r.tier === 'GOLD'));
  const all = (await call('GET', '/api/admin/members?brand=humlai&all=1', undefined, adm)).data;
  assert.equal(all.rows.length, p1.total);
  assert.ok(await mods.db.one("SELECT 1 FROM audit_logs WHERE action = 'export_members'"));
  // ลบแท็ก
  assert.equal((await call('DELETE', '/api/admin/tags/' + fresh.data.id, undefined, adm)).status, 200);
});

t('ต้องเพิ่มเพื่อน OA ก่อนสมัคร: ตรวจจาก LINE แล้วผ่านเมื่อ follow', async () => {
  const U = { 'x-dev-line-user': 'Utest000000000000000000000000f01d' };
  const realFetch = globalThis.fetch; let asked = 0;
  globalThis.fetch = (url, opt) => String(url).startsWith('https://api.line.me/v2/bot/profile/') ? (asked++, Promise.resolve(new Response('{}', { status: 404 }))) : realFetch(url, opt);
  process.env.LINE_HUMLAI_TOKEN = 'test-token';
  try {
    const me = await call('GET', '/api/liff/me?brand=humlai', undefined, U);
    assert.equal(me.data.friend.required, true);
    assert.match(me.data.friend.oa, /^@/);
    const reg = await call('POST', '/api/liff/register', { brand: 'humlai', name: 'ยังไม่แอด', phone: '0877777771', privacy: true, branchId: 'HL01' }, U);
    assert.equal(reg.status, 400); assert.equal(reg.data.error, 'friend_required');
    assert.ok(asked >= 2);
    await call('POST', '/api/dev/line-event', { brand: 'humlai', type: 'follow', lineUserId: U['x-dev-line-user'] });
    assert.equal((await call('GET', '/api/liff/me?brand=humlai', undefined, U)).data.friend.required, false);
    const ok = await call('POST', '/api/liff/register', { brand: 'humlai', name: 'แอดแล้ว', phone: '0877777771', privacy: true, branchId: 'HL01' }, U);
    assert.equal(ok.status, 200, JSON.stringify(ok.data));
  } finally { globalThis.fetch = realFetch; delete process.env.LINE_HUMLAI_TOKEN; }
});

t('ริชเมนู: ตรวจขนาดรูป ติดตั้งผ่าน LINE และย้อนกลับเมนูเดิม', async () => {
  const adm = { 'x-dev-staff': 'S002' };
  const png = (w, h) => { const b = Buffer.alloc(64); Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return 'data:image/png;base64,' + b.toString('base64'); };
  const realFetch = globalThis.fetch; const calls = []; let n = 0;
  globalThis.fetch = (url, opt = {}) => {
    const u = String(url);
    if (!u.includes('/v2/bot/richmenu') && !u.includes('/v2/bot/user/all/richmenu')) return u.includes('line.me') ? Promise.resolve(new Response('{}', { status: 200 })) : realFetch(url, opt);
    calls.push((opt.method || 'GET') + ' ' + u.replace(/^https:\/\/api(-data)?\.line\.me\/v2\/bot/, ''));
    const body = u.endsWith('/richmenu/list') ? { richmenus: [{ richMenuId: 'old-1', name: 'crm-humlai' }, { richMenuId: 'other', name: 'manual' }] } : u.endsWith('/v2/bot/richmenu') ? { richMenuId: 'rm-' + (++n) } : {};
    return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
  };
  process.env.LINE_HUMLAI_TOKEN = 'test-token'; process.env.LIFF_ID = 'test-liff';
  const acts = [{ kind: 'card' }, { kind: 'message', value: 'โปรโมชั่น' }, { kind: 'coupons' }, { kind: 'uri', value: 'https://example.com/menu' }];
  try {
    const info = await call('GET', '/api/admin/richmenus?brand=humlai', undefined, adm);
    assert.equal(info.status, 200); assert.equal(info.data.configured, true); assert.equal(info.data.list.length, 0);
    const wrong = await call('POST', '/api/admin/richmenus', { brand: 'humlai', layout: 'l4', actions: acts, chatBar: 'เมนู', dataUrl: png(1200, 810) }, adm);
    assert.equal(wrong.status, 400); assert.match(wrong.data.message, /2500 × 1686/);
    const badUri = await call('POST', '/api/admin/richmenus', { brand: 'humlai', layout: 'l4', actions: [acts[0], acts[1], acts[2], { kind: 'uri', value: 'http://x.com' }], chatBar: 'เมนู', dataUrl: png(2500, 1686) }, adm);
    assert.equal(badUri.status, 400);
    assert.equal(calls.filter((c) => !c.startsWith('GET ')).length, 0);
    const a = await call('POST', '/api/admin/richmenus', { brand: 'humlai', layout: 'l4', actions: acts, chatBar: 'เมนูร้าน', dataUrl: png(2500, 1686) }, adm);
    assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(a.data.is_active, true);
    assert.ok(calls.includes('DELETE /richmenu/old-1') && !calls.includes('DELETE /richmenu/other'));
    // เปลี่ยนแค่ปุ่ม ใช้รูปเดิม
    const b = await call('POST', '/api/admin/richmenus', { brand: 'humlai', layout: 'l4', actions: [acts[0], acts[1], acts[2], { kind: 'history' }], chatBar: 'เมนู', fromId: a.data.id }, adm);
    assert.equal(b.status, 200, JSON.stringify(b.data));
    let list = (await call('GET', '/api/admin/richmenus?brand=humlai', undefined, adm)).data.list;
    assert.deepEqual(list.filter((x) => x.is_active).map((x) => x.id), [b.data.id]);
    const r = await call('POST', '/api/admin/richmenus/' + a.data.id + '/restore', {}, adm);
    assert.equal(r.status, 200, JSON.stringify(r.data));
    list = (await call('GET', '/api/admin/richmenus?brand=humlai', undefined, adm)).data.list;
    assert.equal(list[0].id, a.data.id); assert.equal(list[0].is_active, true); assert.equal(list[0].chat_bar, 'เมนูร้าน');
    assert.equal((await call('POST', '/api/admin/richmenus/' + a.data.id + '/restore', {}, adm)).status, 409);
    const img = await realFetch(base_url() + list[0].image);
    assert.equal(img.status, 200); assert.equal(img.headers.get('content-type'), 'image/png');
    assert.equal((await call('GET', '/api/admin/richmenus?brand=humlai', undefined, { 'x-dev-staff': 'S005' })).status, 403);
  } finally { globalThis.fetch = realFetch; delete process.env.LINE_HUMLAI_TOKEN; delete process.env.LIFF_ID; }
});

t('ริชเมนู: ดึงเมนูที่ใช้อยู่ใน LINE มาแสดง (ตรงแบบ = เก็บเป็นเมนูปัจจุบัน · ไม่ตรง = แสดงอย่างเดียว)', async () => {
  const adm = { 'x-dev-staff': 'S002' };
  const pngBuf = (w, h) => { const b = Buffer.alloc(64); Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  const l4 = { size: { width: 2500, height: 1686 }, chatBarText: 'เมนูหลัก', areas: [
    { bounds: { x: 0, y: 0, width: 1250, height: 1686 }, action: { type: 'uri', uri: 'https://liff.line.me/abc?brand=narai' } },
    { bounds: { x: 1250, y: 0, width: 1250, height: 843 }, action: { type: 'message', text: 'โปรโมชั่น' } },
    { bounds: { x: 1250, y: 843, width: 625, height: 843 }, action: { type: 'uri', uri: 'https://liff.line.me/abc?brand=narai&tab=coupons' } },
    { bounds: { x: 1875, y: 843, width: 625, height: 843 }, action: { type: 'uri', uri: 'https://example.com/x' } }] };
  const one = { size: { width: 2500, height: 843 }, chatBarText: 'เมนู', areas: [{ bounds: { x: 0, y: 0, width: 2500, height: 843 }, action: { type: 'message', label: 'ทั้งหมด', text: 'ทั้งหมด' } }] };
  let live = 'live-1'; const menus = { 'live-1': l4, 'live-2': one }; let contentCalls = 0;
  const realFetch = globalThis.fetch;
  globalThis.fetch = (url, opt) => {
    const u = String(url);
    if (!u.includes('line.me/v2/bot')) return realFetch(url, opt);
    if (u.endsWith('/user/all/richmenu')) return Promise.resolve(live ? new Response(JSON.stringify({ richMenuId: live })) : new Response('{}', { status: 404 }));
    const c = /\/richmenu\/([^/]+)\/content$/.exec(u);
    if (c) { contentCalls++; const m = menus[c[1]]; return Promise.resolve(new Response(pngBuf(m.size.width, m.size.height), { headers: { 'content-type': 'image/png' } })); }
    const m = /\/richmenu\/([^/]+)$/.exec(u);
    return Promise.resolve(new Response(JSON.stringify(menus[m[1]] || {})));
  };
  process.env.LINE_NARAI_TOKEN = 'test-token'; process.env.LIFF_ID = 'test-liff';
  try {
    let r = (await call('GET', '/api/admin/richmenus?brand=narai', undefined, adm)).data;
    assert.equal(r.live, 'synced');
    assert.equal(r.list.length, 1); assert.equal(r.list[0].is_active, true); assert.equal(r.list[0].created_by, 'LINE');
    assert.equal(r.list[0].layout, 'l4'); assert.equal(r.list[0].chat_bar, 'เมนูหลัก');
    assert.deepEqual(r.list[0].actions, [{ kind: 'card' }, { kind: 'message', value: 'โปรโมชั่น' }, { kind: 'coupons' }, { kind: 'uri', value: 'https://example.com/x' }]);
    r = (await call('GET', '/api/admin/richmenus?brand=narai', undefined, adm)).data;    // id เดิม ไม่ดึงซ้ำ
    assert.equal(r.list.length, 1); assert.equal(contentCalls, 1);
    live = 'live-2';
    r = (await call('GET', '/api/admin/richmenus?brand=narai', undefined, adm)).data;
    assert.equal(r.live, 'other'); assert.equal(r.liveView.areas.length, 1); assert.match(r.liveView.image, /^data:image\/png;base64,/);
    live = null;
    r = (await call('GET', '/api/admin/richmenus?brand=narai', undefined, adm)).data;
    assert.equal(r.live, 'none'); assert.equal(r.liveView, null);
  } finally { globalThis.fetch = realFetch; delete process.env.LINE_NARAI_TOKEN; delete process.env.LIFF_ID; }
});

test('รอบส่งคูปอง: ทุกเดือน (วันที่เกินเดือน) · ทุกสัปดาห์ · ครั้งเดียว (เวลาไทย)', async () => {
  const { lastRound, nextRound } = await import('../src/services/rounds.js');
  const at = (s) => new Date(s);
  // 31 ทุกเดือน: ก.พ. 2027 มี 28 วัน → ส่ง 28 ก.พ. 09:00 น. ไทย (02:00Z)
  const m31 = { sched_kind: 'monthly', sched_day: 31, sched_time: '09:00' };
  assert.equal(lastRound(m31, at('2027-03-10T00:00:00Z')).at.toISOString(), '2027-02-28T02:00:00.000Z');
  assert.equal(lastRound(m31, at('2027-03-10T00:00:00Z')).key, '2027-02');
  assert.equal(nextRound(m31, at('2027-03-10T00:00:00Z')).at.toISOString(), '2027-03-31T02:00:00.000Z');
  // วันที่ 1 เวลา 09:00: ก่อนเวลาในวันที่ 1 ยังเป็นรอบเดือนก่อน
  const m1 = { sched_kind: 'monthly', sched_day: 1, sched_time: '09:00' };
  assert.equal(lastRound(m1, at('2026-11-01T01:59:00Z')).key, '2026-10');
  assert.equal(lastRound(m1, at('2026-11-01T02:00:00Z')).key, '2026-11');
  assert.equal(nextRound(m1, at('2026-12-15T00:00:00Z')).at.toISOString(), '2027-01-01T02:00:00.000Z');
  // ทุกวันจันทร์ 18:30 (2026-10-19 เป็นวันจันทร์)
  const w = { sched_kind: 'weekly', sched_day: 1, sched_time: '18:30' };
  assert.equal(lastRound(w, at('2026-10-21T05:00:00Z')).at.toISOString(), '2026-10-19T11:30:00.000Z');
  assert.equal(lastRound(w, at('2026-10-21T05:00:00Z')).key, 'W2026-10-19');
  assert.equal(nextRound(w, at('2026-10-21T05:00:00Z')).at.toISOString(), '2026-10-26T11:30:00.000Z');
  // ครั้งเดียว
  const o = { sched_kind: 'once', sched_date: '2026-12-25', sched_time: '10:00' };
  assert.equal(lastRound(o, at('2026-12-25T02:59:00Z')), null);
  assert.equal(lastRound(o, at('2026-12-25T03:00:00Z')).key, 'once');
  assert.equal(nextRound(o, at('2026-12-26T00:00:00Z')), null);
});

t('ระดับ Diamond + คูปองของขวัญส่งอัตโนมัติตามรอบ (จำกัดคนต่อรอบ · หลายใบต่อคน · ไม่ส่งซ้ำ)', async () => {
  const adm = { 'x-dev-staff': 'S002' };
  const rule = (await call('GET', '/api/admin/earn-rules', undefined, adm)).data.find((r) => r.brand_id === 'humlai');
  const put = (tiers) => call('PUT', '/api/admin/earn-rules/humlai', { baht: rule.baht_per_unit, pts: rule.points_per_unit, base: rule.base_amount, rounding: rule.rounding, welcome: rule.welcome_points,
    expiryMonths: rule.expiry_months, backdays: rule.backdate_days, tiers, promo: { on: rule.promo_on, day: rule.promo_day, mult: rule.promo_mult } }, adm);
  assert.equal((await put({ gold: 1, platinum: 2, diamond: 2 })).status, 400);              // Diamond ต้องมากกว่า Platinum
  assert.equal((await put({ gold: 1, platinum: 2, diamond: 3 })).status, 200);
  try {
    const list = (await call('GET', '/api/admin/members?brand=humlai&tier=DIAMOND&size=100', undefined, adm)).data;
    assert.ok(list.total >= 2, 'ต้องมีสมาชิก Diamond อย่างน้อย 2 คน');
    assert.ok(list.rows.every((m) => m.tier === 'DIAMOND' && m.earned >= 3));
    const base = { brand: 'humlai', kind: 'gift', title: 'ของขวัญรายเดือน Diamond', type: 'baht', value: 30, min: 0, validity: 'days', days: 30, useDays: 127, active: true, tiers: ['DIAMOND'] };
    assert.equal((await call('POST', '/api/admin/coupon-templates', { ...base, autoSend: true }, adm)).status, 400);   // ยังไม่เลือกรอบ
    const day = new Date(Date.now() + 7 * 3600e3).getUTCDate();
    const c = await call('POST', '/api/admin/coupon-templates', { ...base, autoSend: true, schedKind: 'monthly', schedDay: day, schedTime: '00:00', roundLimit: 2, roundPick: 'points', perMember: 2 }, adm);
    assert.equal(c.status, 200, JSON.stringify(c.data));
    assert.equal(c.data.auto_send, true); assert.deepEqual(c.data.audience_tiers, ['DIAMOND']); assert.equal(c.data.sched_time, '00:00');
    // เพิ่งเปิดส่งอัตโนมัติ: รอบวันนี้ 00:00 ผ่านไปแล้ว ไม่ส่งย้อนหลัง
    assert.equal((await mods.worker.giftRounds()).filter((r) => r.templateId === c.data.id).length, 0);
    const pv = await call('POST', '/api/admin/coupon-rounds/preview', { brand: 'humlai', tiers: ['DIAMOND'], schedKind: 'monthly', schedDay: day, schedTime: '00:00', roundLimit: 2, perMember: 2 }, adm);
    assert.equal(pv.data.eligible, list.total); assert.equal(pv.data.members, 2); assert.ok(pv.data.next);
    // จำลองว่าตั้งไว้ก่อนรอบวันนี้
    await mods.db.q("UPDATE coupon_templates SET sched_since = now() - interval '40 days' WHERE id = $1", [c.data.id]);
    const run = (await mods.worker.giftRounds()).find((r) => r.templateId === c.data.id);
    assert.ok(run, 'ต้องส่งรอบนี้');
    assert.equal(run.eligible, list.total); assert.equal(run.members, 2); assert.equal(run.issued, 4);
    assert.equal((await mods.worker.giftRounds()).filter((r) => r.templateId === c.data.id).length, 0);   // รอบเดิมไม่ส่งซ้ำ
    const got = await mods.db.q('SELECT member_id, count(*)::int AS n FROM member_coupons WHERE template_id = $1 GROUP BY member_id', [c.data.id]);
    assert.equal(got.length, 2); assert.ok(got.every((g) => g.n === 2));
    const rounds = (await call('GET', '/api/admin/coupon-templates/' + c.data.id + '/rounds', undefined, adm)).data;
    assert.equal(rounds.length, 1); assert.equal(rounds[0].issued, 4); assert.equal(rounds[0].used, 0);
    const listed = (await call('GET', '/api/admin/coupon-templates?brand=humlai', undefined, adm)).data.find((x) => x.id === c.data.id);
    assert.equal(listed.last_round.issued, 4); assert.ok(listed.next_round);
  } finally { await put({ gold: rule.gold_at, platinum: rule.platinum_at, diamond: null }); }
});

t('เมนูจาก POS + คูปองของฟรี + เงื่อนไขสินค้าในบิล (หน้าร้านและตอนบันทึกบิล)', async () => {
  const adm = { 'x-dev-staff': 'S002' };
  const menu = [
    { id: 'M1', name: 'ข้าวมันไก่ต้ม', category: 'chicken', categoryName: 'ข้าวมันไก่', price: 55 },
    { id: 'M2', name: 'ข้าวมันไก่ทอด', category: 'chicken', categoryName: 'ข้าวมันไก่', price: 65 },
    { id: 'M3', name: 'น้ำเก๊กฮวย', category: 'drink', categoryName: 'เครื่องดื่ม', price: 25 },
    { id: 'M4', name: 'ซุปฟักตุ๋น', category: 'side', categoryName: 'ทานเล่น', price: 40 }];
  const sync = await call('POST', '/api/pos/menu', { items: menu }, posHL01);
  assert.equal(sync.status, 200, JSON.stringify(sync.data)); assert.equal(sync.data.count, 4);
  const pm = (await call('GET', '/api/admin/pos-menu?brand=humlai', undefined, adm)).data;
  assert.equal(pm.items.length, 4); assert.ok(pm.syncedAt); assert.deepEqual(pm.categories.map((c) => c.id).sort(), ['chicken', 'drink', 'side']);

  const base = { brand: 'humlai', kind: 'gift', validity: 'days', days: 30, useDays: 127, active: true, min: 0 };
  // ฟรีน้ำเก๊กฮวย เมื่อมีหมวดข้าวมันไก่รวม 2 จาน
  const free = await call('POST', '/api/admin/coupon-templates', { ...base, title: 'ฟรีเก๊กฮวย', type: 'free', freeItems: [{ id: 'M3', name: 'น้ำเก๊กฮวย', price: 25 }],
    condMode: 'any', condItems: [{ type: 'cat', id: 'chicken', name: 'ข้าวมันไก่' }], condQty: 2 }, adm);
  assert.equal(free.status, 200, JSON.stringify(free.data));
  assert.equal(Number(free.data.discount_value), 25); assert.match(free.data.condition_text, /ฟรี น้ำเก๊กฮวย/); assert.match(free.data.condition_text, /หมวดข้าวมันไก่ รวม 2 ชิ้นขึ้นไป/);
  // ลด 20% เฉพาะซุปฟักตุ๋น
  const soup = await call('POST', '/api/admin/coupon-templates', { ...base, title: 'ซุปลด 20%', type: 'pct', value: 20, condMode: 'all', condItems: [{ type: 'item', id: 'M4', name: 'ซุปฟักตุ๋น' }], condScope: 'items' }, adm);
  assert.equal(soup.status, 200, JSON.stringify(soup.data));
  assert.equal((await call('POST', '/api/admin/coupon-templates', { ...base, title: 'x', type: 'baht', value: 10, condMode: 'any', condItems: [] }, adm)).status, 400);

  const mem = (await call('GET', '/api/admin/members?brand=humlai&size=5', undefined, adm)).data.rows[0].id;
  const give = async (tpl) => (await call('POST', '/api/admin/members/' + mem + '/coupons', { templateId: tpl }, adm)).data.couponId;
  const cFree = await give(free.data.id); const cSoup = await give(soup.data.id);
  const wallet = async (items, subtotal) => (await call('POST', '/api/pos/members/wallet', { memberId: mem, subtotal, ref: 'cart-test', items }, posHL01)).data.coupons;
  const pick = (list, id) => list.find((c) => c.id === String(id));

  // POS เก่าไม่ส่งรายการ → ใช้ไม่ได้ บอกให้อัปเดต
  let w = await wallet(undefined, 200);
  assert.equal(pick(w, cFree).usable, false); assert.match(pick(w, cFree).reason, /อัปเดตเครื่อง POS/);
  // มีข้าวมันไก่จานเดียว + เก๊กฮวย → ยังไม่ครบ 2 จาน
  w = await wallet([{ name: 'ข้าวมันไก่ทอด', price: 65, qty: 1 }, { name: 'น้ำเก๊กฮวย', price: 25, qty: 1 }], 90);
  assert.equal(pick(w, cFree).usable, false); assert.match(pick(w, cFree).reason, /อย่างน้อย 2 ชิ้น/);
  // ข้าวมันไก่ 2 จาน (ชื่อเว้นวรรคต่างกันก็จับคู่ได้) แต่ไม่มีเก๊กฮวย
  w = await wallet([{ name: ' ข้าวมันไก่ทอด ', price: 65, qty: 1 }, { name: 'ข้าวมันไก่ต้ม', price: 55, qty: 1 }], 120);
  assert.equal(pick(w, cFree).usable, false); assert.match(pick(w, cFree).reason, /น้ำเก๊กฮวย/);
  assert.equal(pick(w, cSoup).usable, false); assert.match(pick(w, cSoup).reason, /ซุปฟักตุ๋น/);
  const cart = [{ name: 'ข้าวมันไก่ทอด', price: 65, qty: 1 }, { name: 'ข้าวมันไก่ต้ม', price: 55, qty: 1 }, { name: 'น้ำเก๊กฮวย', price: 25, qty: 2 }, { menuId: 'M4', name: 'ซุป (ถ้วยใหญ่)', price: 40, qty: 1 }];
  w = await wallet(cart, 210);
  assert.equal(pick(w, cFree).usable, true); assert.equal(pick(w, cFree).discount, 25);
  assert.equal(pick(w, cSoup).usable, true); assert.equal(pick(w, cSoup).discount, 8);            // 20% ของซุป 40 บาท ไม่ใช่ทั้งบิล
  const rs = await call('POST', '/api/pos/coupons/reserve', { memberId: mem, couponId: cFree, ref: 'cart-test', subtotal: 210, items: cart }, posHL01);
  assert.equal(rs.status, 200, JSON.stringify(rs.data)); assert.equal(rs.data.coupon.discount, 25);
  // บันทึกบิลแบบให้ CRM คิดส่วนลดเอง (ไม่ส่ง couponDiscount) · id ในบิลเป็นลำดับแถว ใช้ชื่อจับคู่
  const sale = await call('POST', '/api/pos/transactions', { posBillId: 'CART-1', memberId: mem, couponIds: [cFree], couponRef: 'cart-test',
    items: cart.map((i, n) => ({ id: String(n + 1), name: i.name, price: i.price, qty: i.qty })) }, posHL01);
  assert.equal(sale.status, 200, JSON.stringify(sale.data)); assert.equal(Number(sale.data.discount), 25);
  // เมนูที่หายไปจากรายการล่าสุดถูกปิด
  await call('POST', '/api/pos/menu', { items: menu.slice(0, 3) }, posHL01);
  assert.equal((await call('GET', '/api/admin/pos-menu?brand=humlai', undefined, adm)).data.items.length, 3);
});

t('ของฟรีหลายรายการ: ฟรี 1 ชิ้น · ฟรีรวม N ชิ้น (ถูกสุดก่อน) · ฟรีทุกเมนูในรายการ · ต้องมีครบ', async () => {
  const adm = { 'x-dev-staff': 'S002' };
  const free = [{ id: 'M3', name: 'น้ำเก๊กฮวย', price: 25 }, { id: 'M4', name: 'ซุปฟักตุ๋น', price: 40 }, { id: 'M2', name: 'ข้าวมันไก่ทอด', price: 65 }];
  const base = { brand: 'humlai', kind: 'gift', validity: 'days', days: 30, useDays: 127, active: true, min: 0, type: 'free', freeItems: free };
  const mk = async (title, extra) => { const r = await call('POST', '/api/admin/coupon-templates', { ...base, title, ...extra }, adm); assert.equal(r.status, 200, JSON.stringify(r.data)); return r.data; };
  const one = await mk('ฟรี1', { freeMode: 'one' });
  const q2 = await mk('ฟรี2', { freeMode: 'qty', freeQty: 2 });
  const q3 = await mk('ฟรี3', { freeMode: 'qty', freeQty: 3 });
  const all = await mk('ฟรีหมด', { freeMode: 'all' });
  const need = await mk('ฟรีครบ', { freeMode: 'all', freeNeedAll: true });
  assert.equal(Number(q3.discount_value), 195); assert.equal(Number(all.discount_value), 130);
  assert.match(q2.condition_text, /รวม 2 ชิ้น/); assert.match(need.condition_text, /ต้องมีครบทุกอย่าง/);
  const mem = (await call('GET', '/api/admin/members?brand=humlai&size=5', undefined, adm)).data.rows[1].id;
  const ids = {};
  for (const tp of [one, q2, q3, all, need]) ids[tp.title] = (await call('POST', '/api/admin/members/' + mem + '/coupons', { templateId: tp.id }, adm)).data.couponId;
  const cart = [{ name: 'ข้าวมันไก่ต้ม', price: 55, qty: 1 }, { name: 'น้ำเก๊กฮวย', price: 25, qty: 2 }, { name: 'ซุปฟักตุ๋น', price: 40, qty: 1 }];
  const w = (await call('POST', '/api/pos/members/wallet', { memberId: mem, subtotal: 145, ref: 'free-modes', items: cart }, posHL01)).data.coupons;
  const c = (t) => w.find((x) => x.id === String(ids[t]));
  assert.equal(c('ฟรี1').discount, 25);
  assert.equal(c('ฟรี2').discount, 50);                        // เก๊กฮวย 2 แก้ว
  assert.equal(c('ฟรี3').discount, 90);                        // เก๊กฮวย 2 + ซุป 1
  assert.equal(c('ฟรีหมด').discount, 65);                      // เก๊กฮวย 1 + ซุป 1 (ไม่มีข้าวมันไก่ทอด ข้ามไป)
  assert.equal(c('ฟรีครบ').usable, false); assert.match(c('ฟรีครบ').reason, /ข้าวมันไก่ทอด/);
  const w2 = (await call('POST', '/api/pos/members/wallet', { memberId: mem, subtotal: 210, ref: 'free-modes', items: [...cart, { name: 'ข้าวมันไก่ทอด', price: 65, qty: 1 }] }, posHL01)).data.coupons;
  assert.equal(w2.find((x) => x.id === String(ids['ฟรีครบ'])).discount, 130);
});
