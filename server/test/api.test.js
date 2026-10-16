// ทดสอบทั้ง flow กับ PostgreSQL จริง · ใช้ฐานข้อมูลแยก TEST_DATABASE_URL (จะถูกล้างทุกครั้ง)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

const TEST_DB = process.env.TEST_DATABASE_URL;
if (TEST_DB) { process.env.DATABASE_URL = TEST_DB; process.env.DEV_MODE = '1'; process.env.LINE_HUMLAI_SECRET = 'test-secret-humlai'; }

let base; let server; let mods;
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
