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

t('จัดการคูปอง: แจกอัตโนมัติตามเงื่อนไข · จำกัดจำนวน · วันที่ใช้ได้ · โค้ด · ของขวัญ · รูป · ล็อกมูลค่าหลังแจก', async () => {
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

  // แจกแล้วเปลี่ยนมูลค่าไม่ได้ แต่แก้คำอธิบายได้
  assert.equal((await call('PATCH', '/api/admin/coupon-templates/' + g.data.id, { ...base, kind: 'general', title: 'ลด 20 ทุกเมนู', type: 'baht', value: 30, maxIssue: 1, useDays: notToday }, adm)).data.error, 'coupon_locked');
  assert.equal((await call('PATCH', '/api/admin/coupon-templates/' + g.data.id, { ...base, kind: 'general', title: 'ลด 20 ทุกเมนู!', description: 'แก้แล้ว', type: 'baht', value: 20, maxIssue: 1, useDays: 127 }, adm)).status, 200);
  const ok = await pos({ posBillId: 'CP-2', memberId: me, couponIds: [mine[0].id], items: [{ id: 'h1', name: 'ข้าวมันไก่', price: 70, qty: 2 }] });
  assert.equal(ok.data.discount, 20, JSON.stringify(ok.data));

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
  assert.equal((await call('PATCH', '/api/admin/coupon-templates/' + cc.data.id, { active: false }, adm)).status, 200);
  assert.equal((await call('POST', '/api/liff/coupons/claim', { brand: 'humlai', code: 'HLSUMMER' }, u2)).status, 400);

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
