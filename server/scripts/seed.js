// ข้อมูลตั้งต้น: แบรนด์ สาขา กฎแต้ม รางวัล พนักงาน เครื่อง POS
// --demo (ค่าเริ่มต้นเมื่อ DEV_MODE=1): เพิ่มสมาชิกตัวอย่างและประวัติการซื้อย้อนหลัง ให้ Dashboard มีตัวเลข
import { fileURLToPath } from 'node:url';
import { pool, tx } from '../src/db.js';
import { hashPassword, sha256, calcPoints } from '../src/util.js';

const BRANDS = [
  ['narai', 'Narai x ข้าน้อย', 'Narai', 'บุฟเฟต์', 'NR', '#1F5A85', '#E4EEF6', '#123A57', 'N', '@narai.demo'],
  ['wakame', 'Wakame', 'Wakame', 'ราเมน', 'WK', '#2F6B4F', '#E3F0E8', '#1C4432', 'W', '@wakame.demo'],
  ['humlai', 'ข้าวมันไก่หำไหล', 'หำไหล', 'ข้าวมันไก่', 'HL', '#C7481A', '#FDEBE1', '#8A3A16', 'ห', '@humlai.demo']
];
const BRANCHES = [
  ['NR01', 'narai', 'Narai สาขา 1', '11:00', '22:00', 'api'], ['NR02', 'narai', 'Narai สาขา 2', '11:00', '22:00', 'api'],
  ['WK01', 'wakame', 'Wakame สาขา 1', '10:30', '21:30', 'api'], ['WK02', 'wakame', 'Wakame สาขา 2', '10:30', '21:30', 'api'],
  ['HL01', 'humlai', 'หำไหล สาขา 1', '07:00', '15:00', 'api'], ['HL02', 'humlai', 'หำไหล สาขา 2', '07:00', '15:00', 'api'], ['HL03', 'humlai', 'หำไหล สาขา 3', '08:00', '20:00', 'manual']
];
// อัตราแต้มเป็นตัวเลขสมมติ รอฝ่ายการตลาดกำหนดจริง
const RULES = { narai: [100, 1, 20, 150, 400], wakame: [100, 1, 10, 120, 300], humlai: [25, 1, 50, 1500, 3000] };
const REWARDS = [
  ['narai', 'ส่วนลด 100 บาท', 'discount', 50, 100, 500, 200], ['narai', 'เครื่องดื่มรีฟิลฟรี', 'drink', 20, 59, 0, 500], ['narai', 'บุฟเฟต์เด็กฟรี 1 ท่าน', 'food', 120, 249, 998, 50],
  ['wakame', 'ไข่ออนเซ็นฟรี', 'side', 10, 25, 0, 500], ['wakame', 'เกี๊ยวซ่าฟรี 1 จาน', 'side', 30, 79, 150, 300], ['wakame', 'ราเมนฟรี 1 ชาม', 'food', 80, 189, 0, 100],
  ['humlai', 'น้ำเก๊กฮวยฟรี', 'drink', 50, 25, 0, 500], ['humlai', 'ซุปฟักตุ๋น', 'side', 150, 40, 0, 500], ['humlai', 'ข้าวมันไก่ทอด', 'food', 300, 65, 0, 300],
  ['humlai', 'ข้าวมันไก่สองใจ', 'food', 400, 80, 0, 300], ['humlai', 'ส่วนลด 50 บาท', 'discount', 500, 50, 200, 200], ['humlai', 'ไก่ต้มสับ (จานใหญ่)', 'food', 900, 220, 0, 80]
];
const STAFF = [
  ['S001', 'แอดมินไอที', 'super', 'group', '*'], ['S002', 'ทีมการตลาดกลาง', 'marketing', 'group', '*'], ['S003', 'ผู้จัดการแบรนด์ หำไหล', 'brand', 'brand', 'humlai'],
  ['S004', 'ผู้จัดการ หำไหล สาขา 1', 'branchmgr', 'branch', 'HL01'], ['S005', 'แคชเชียร์ หำไหล สาขา 1', 'cashier', 'branch', 'HL01'],
  ['S006', 'แคชเชียร์ Narai สาขา 1', 'cashier', 'branch', 'NR01'], ['S007', 'แคชเชียร์ Wakame สาขา 1', 'cashier', 'branch', 'WK01']
];
const MENUS = {
  narai: [['n1', 'บุฟเฟต์ผู้ใหญ่', 499], ['n2', 'บุฟเฟต์เด็ก', 249], ['n3', 'อัพเกรดพรีเมียม', 150], ['n4', 'เครื่องดื่มรีฟิล', 59], ['n5', 'ของหวานพิเศษ', 89], ['n6', 'น้ำแร่', 25]],
  wakame: [['w1', 'ราเมนทงคตสึ', 189], ['w2', 'ราเมนโชยุ', 169], ['w3', 'เกี๊ยวซ่า', 79], ['w4', 'ข้าวหน้าหมูชาชู', 129], ['w5', 'ไข่ออนเซ็น', 25], ['w6', 'ชาเขียว', 35]],
  humlai: [['h1', 'ข้าวมันไก่หำไหล', 70], ['h2', 'ข้าวมันไก่สองใจ', 80], ['h3', 'ข้าวมันไก่ทอด', 65], ['h4', 'ซุปฟักตุ๋น', 40], ['h5', 'ไก่ต้มสับ (จานใหญ่)', 220], ['h6', 'น้ำเก๊กฮวย', 25]]
};
const DEV_PASSWORD = 'demo1234';

async function seedBase(db) {
  if (await db.one('SELECT 1 FROM brands LIMIT 1')) { console.log('มีข้อมูลตั้งต้นแล้ว ข้าม (ใช้ npm run db:reset เพื่อเริ่มใหม่)'); return false; }
  for (const b of BRANDS) await db.q('INSERT INTO brands (id, name, short_name, kind, code_prefix, theme_color, soft_color, ink_color, initial, oa_basic_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', b);
  for (const b of BRANCHES) await db.q("INSERT INTO branches (id, brand_id, name, open_time, close_time, pos_mode, phone) VALUES ($1,$2,$3,$4,$5,$6,'0X-XXX-XX' || right($1, 2))", b);
  for (const [brand, [baht, pts, welcome, gold, plat]] of Object.entries(RULES)) {
    await db.q('INSERT INTO earn_rules (brand_id, baht_per_unit, points_per_unit, welcome_points, gold_at, platinum_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [brand, baht, pts, welcome, gold, plat, 'seed']);
    const t = await db.one("INSERT INTO coupon_templates (brand_id, kind, title, badge_big, badge_small, condition_text, discount_type, discount_value, valid_days) VALUES ($1,'welcome','ส่วนลด 10% บิลแรก','-10%','บิลแรก','สำหรับสมาชิกใหม่ · 1 ครั้ง','pct',10,30) RETURNING id", [brand]);
    await db.q('UPDATE brands SET welcome_template_id = $2 WHERE id = $1', [brand, t.id]);
    await db.q('INSERT INTO line_channels (brand_id) VALUES ($1)', [brand]);
  }
  for (const [brand, name, cat, cost, value, min, stock] of REWARDS) {
    const disc = cat === 'discount';
    const t = await db.one(`INSERT INTO coupon_templates (brand_id, title, badge_big, badge_small, condition_text, discount_type, discount_value, min_spend)
      VALUES ($1,$2,$3,$4,$5,'baht',$6,$7) RETURNING id`, [brand, name, disc ? '-' + value : 'ฟรี', disc ? 'บาท' : 'แลกแต้ม', 'แลกด้วย ' + cost + ' แต้ม' + (min ? ' · ขั้นต่ำ ' + min + ' บาท' : ''), value, min]);
    await db.q('INSERT INTO rewards (brand_id, name, category, points_cost, coupon_template_id, stock) VALUES ($1,$2,$3,$4,$5,$6)', [brand, name, cat, cost, t.id, stock]);
  }
  const code = await db.one("INSERT INTO coupon_templates (brand_id, kind, title, badge_big, badge_small, condition_text, discount_type, discount_value) VALUES (NULL,'code','ส่วนลด 15% จากโค้ด','-15%','โค้ดพิเศษ','ใช้ได้ 1 ครั้ง · ทุกแบรนด์','pct',15) RETURNING id");
  await db.q("INSERT INTO promo_codes (code, coupon_template_id, max_uses) VALUES ('NEWMENU', $1, 1000)", [code.id]);
  const pw = hashPassword(process.env.SEED_STAFF_PASSWORD || DEV_PASSWORD);
  for (const [id, name, role, st, sid] of STAFF) {
    await db.q('INSERT INTO staff (id, name, role, password_hash) VALUES ($1,$2,$3,$4)', [id, name, role, pw]);
    await db.q('INSERT INTO staff_scopes (staff_id, scope_type, scope_id, approve_limit) VALUES ($1,$2,$3,$4)', [id, st, sid, role === 'branchmgr' ? 200 : null]);
  }
  for (const b of BRANCHES) await db.q("INSERT INTO pos_terminals (id, branch_id, kind, api_key_hash) VALUES ($1,$2,'pos',$3)", ['POS-' + b[0], b[0], sha256('pos-' + b[0].toLowerCase() + '-demo-key')]);
  return true;
}

function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

async function addPoints(db, { memberId, brand, branch, type, points, at, note, refId, key, actor }) {
  await db.q('INSERT INTO wallets (member_id, brand_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [memberId, brand]);
  const w = await db.one('SELECT balance FROM wallets WHERE member_id = $1 AND brand_id = $2 FOR UPDATE', [memberId, brand]);
  const bal = w.balance + points;
  const l = await db.one(`INSERT INTO point_ledger (member_id, brand_id, branch_id, entry_type, points, balance_after, ref_type, ref_id, idempotency_key, note, actor_type, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,'sale',$7,$8,$9,$10,$11) RETURNING id`, [memberId, brand, branch, type, points, bal, refId || null, key, note, actor, new Date(at)]);
  await db.q("INSERT INTO point_lots (member_id, brand_id, source_ledger_id, points, remaining, expires_at) VALUES ($1,$2,$3,$4,$4, $5::timestamptz + interval '12 months')", [memberId, brand, l.id, points, new Date(at)]);
  await db.q('UPDATE wallets SET balance = $3 WHERE member_id = $1 AND brand_id = $2', [memberId, brand, bal]);
}

async function seedDemo(db) {
  const rnd = rng(42); const now = Date.now(); const DAY = 864e5;
  const rules = Object.fromEntries((await db.q('SELECT * FROM earn_rules WHERE effective_to IS NULL')).map((r) => [r.brand_id, r]));
  const names = ['สมชาย ใจดี', 'สมหญิง รักสงบ', 'มานี มีนา', 'ปิติ ยินดี', 'ชูใจ ใฝ่รู้', 'วีระ กล้าหาญ', 'ดวงใจ สุขสันต์', 'ประเสริฐ มั่นคง', 'นภา แสงทอง', 'อารีย์ ใจงาม', 'กิตติ ทองดี', 'สุดา พรมมา', 'วิภา ศรีสุข', 'ธนา เจริญผล'];
  let billNo = 1000;
  for (let i = 0; i < names.length; i++) {
    const id = i === 0 ? 'MB-0012845' : 'MB-' + String(12000 + i * 37).padStart(7, '0');
    const joined = now - (Math.floor(rnd() * 120) + (i < 4 ? 3 : 8)) * DAY;
    const home = BRANCHES[Math.floor(rnd() * BRANCHES.length)];
    const phone = i === 0 ? '0812345678' : '08' + String(10000000 + Math.floor(rnd() * 89999999));
    await db.q(`INSERT INTO members (id, full_name, phone, phone_verified_at, birth_date, home_branch_id, joined_brand_id, privacy_accepted_at, privacy_version, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$4,'2026-01',$4)`, [id, names[i], phone, new Date(joined), '199' + (i % 9) + '-0' + (1 + (i % 9)) + '-1' + (i % 9), home[0], home[1]]);
    await db.q('INSERT INTO member_line_identities (line_user_id, member_id, display_name, linked_at) VALUES ($1,$2,$3,$4)', ['Useed' + id.replace('-', '').toLowerCase(), id, names[i], new Date(joined)]);
    const brands = [home[1], ...BRANDS.map((b) => b[0]).filter((b) => b !== home[1] && rnd() < 0.4)];
    for (const b of brands) {
      const follow = rnd() < 0.9 ? 'follow' : 'blocked';
      await db.q('INSERT INTO member_brand_links (member_id, brand_id, follow_status, follow_changed_at, marketing_consent, consent_changed_at) VALUES ($1,$2,$3,$4,$5,$4)', [id, b, follow, new Date(joined), rnd() < 0.75]);
      await db.q('INSERT INTO line_followers (line_user_id, brand_id, status, changed_at) VALUES ($1,$2,$3,$4)', ['Useed' + id.replace('-', '').toLowerCase(), b, follow, new Date(joined)]);
    }
    await addPoints(db, { memberId: id, brand: home[1], branch: home[0], type: 'welcome', points: rules[home[1]].welcome_points, at: joined, note: 'แต้มต้อนรับสมาชิกใหม่', key: 'welcome:' + id + ':' + home[1], actor: 'system' });
    const events = [];
    for (const b of brands) {
      const visits = 1 + Math.floor(rnd() * (i === 0 ? 12 : 6));
      const brs = BRANCHES.filter((x) => x[1] === b);
      for (let k = 0; k < visits; k++) events.push({ b, br: brs[Math.floor(rnd() * brs.length)][0], at: joined + Math.floor(rnd() * (now - joined)), n: 1 + Math.floor(rnd() * 4), picks: [rnd(), rnd(), rnd(), rnd()] });
    }
    events.sort((a, c) => a.at - c.at);
    for (const e of events) {
      const items = e.picks.slice(0, e.n).map((p) => { const it = MENUS[e.b][Math.floor(p * 6)]; return { id: it[0], name: it[1], price: it[2], qty: 1 }; });
      const total = items.reduce((s, x) => s + x.price, 0);
      const bill = e.br + '-' + (++billNo);
      const pts = calcPoints(rules[e.b], { subtotal: total, total }, new Date(e.at));
      const t = await db.one(`INSERT INTO sales_transactions (pos_bill_id, branch_id, brand_id, member_id, channel, subtotal, total, points_earned, rule_id, paid_at, items)
        VALUES ($1,$2,$3,$4,'pos',$5,$5,$6,$7,$8,$9) RETURNING id`, [bill, e.br, e.b, id, total, pts, rules[e.b].id, new Date(e.at), JSON.stringify(items)]);
      if (pts > 0) await addPoints(db, { memberId: id, brand: e.b, branch: e.br, type: 'earn', points: pts, at: e.at, note: 'ชำระบิล ' + bill, refId: String(t.id), key: 'sale:' + e.br + ':' + bill, actor: 'pos' });
    }
  }
  // บิลลูกค้าที่ไม่ใช่สมาชิก (ใช้คำนวณสัดส่วนยอดขายจากสมาชิก)
  for (const br of BRANCHES) for (let k = 0; k < 6; k++) {
    const it = MENUS[br[1]][Math.floor(rnd() * 6)];
    await db.q(`INSERT INTO sales_transactions (pos_bill_id, branch_id, brand_id, channel, subtotal, total, paid_at, items) VALUES ($1,$2,$3,'pos',$4,$4,$5,$6)`,
      [br[0] + '-' + (++billNo), br[0], br[1], it[2] * 2, new Date(now - Math.floor(rnd() * 30) * DAY), JSON.stringify([{ id: it[0], name: it[1], price: it[2], qty: 2 }])]);
  }
  // คูปองตัวอย่างของ MB-0012845 + คำขอปรับแต้มที่รออนุมัติ
  for (const [title, big, small, cond, value, min, days] of [['ซุปฟักตุ๋น ฟรี', 'ฟรี', '1 ถ้วย', 'เมื่อสั่งข้าวมันไก่ 2 จานขึ้นไป', 40, 0, 3], ['ส่วนลด 20 บาท', '-20', 'บาท', 'ขั้นต่ำ 200 บาท · ทุกสาขา', 20, 200, 16]]) {
    const t = await db.one("INSERT INTO coupon_templates (brand_id, title, badge_big, badge_small, condition_text, discount_type, discount_value, min_spend, valid_days) VALUES ('humlai',$1,$2,$3,$4,'baht',$5,$6,$7) RETURNING id", [title, big, small, cond, value, min, days]);
    await db.q("INSERT INTO member_coupons (code, template_id, member_id, brand_id, source, source_ref, expires_at) VALUES ($1,$2,'MB-0012845','humlai','campaign',$3, now() + make_interval(days => $4::int))", ['HL-SEED' + t.id, t.id, 'seed-' + t.id, days]);
  }
  await db.q("INSERT INTO point_adjust_requests (member_id, brand_id, branch_id, points, reason, requested_by, created_at) VALUES ('MB-0012074','humlai','HL01',18,'ลูกค้าลืมแจ้งสมาชิก บิล HL01-1003','S005', now() - interval '3 hours')");
  await db.q("SELECT setval('member_no', 12846, false)");
  console.log('เพิ่มสมาชิกตัวอย่าง ' + names.length + ' คน พร้อมประวัติการซื้อ');
}

export async function seed({ demo = process.env.DEV_MODE === '1', quiet = false } = {}) {
  const fresh = await tx(seedBase);
  if (fresh && demo) await tx(seedDemo);
  if (fresh && !quiet) {
    console.log('\nข้อมูลตั้งต้นพร้อมแล้ว');
    console.log('  พนักงานหลังบ้าน: S001 (Super Admin), S002 (การตลาด), S003, S004 · รหัสผ่าน ' + (process.env.SEED_STAFF_PASSWORD ? '(ตาม SEED_STAFF_PASSWORD)' : DEV_PASSWORD));
    console.log('  API key เครื่อง POS ตัวอย่าง: pos-hl01-demo-key (สาขา HL01) · เปลี่ยนก่อนใช้จริงด้วย scripts/manage.js');
  }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  seed({ demo: process.argv.includes('--no-demo') ? false : process.env.DEV_MODE === '1' || process.argv.includes('--demo') })
    .then(() => pool.end())
    .catch((e) => { console.error('seed ล้มเหลว:', e.message); process.exit(1); });
}
