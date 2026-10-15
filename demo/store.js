/* Mock backend ของเดโม — จำลอง Central CRM API + LINE Webhook ในเบราว์เซอร์
 * ทุกฟังก์ชันใน API.* ตรงกับ endpoint จริงที่ออกแบบไว้ใน docs/DESIGN.md
 * ข้อมูลเก็บใน localStorage ของผู้ชม (ล้างได้ด้วยปุ่ม "รีเซ็ตเดโม") */
(function () {
  const KEY = 'crm-demo-v1';
  const DAY = 86400000;

  const BRANDS = {
    narai:  { id: 'narai',  name: 'Narai x ข้าน้อย', short: 'Narai',  kind: 'บุฟเฟต์', accent: '#1F5A85', soft: '#E4EEF6', ink: '#123A57', oa: '@narai.demo',  initial: 'N' },
    wakame: { id: 'wakame', name: 'Wakame',          short: 'Wakame', kind: 'ราเมน',   accent: '#2F6B4F', soft: '#E3F0E8', ink: '#1C4432', oa: '@wakame.demo', initial: 'W' },
    humlai: { id: 'humlai', name: 'ข้าวมันไก่หำไหล',  short: 'หำไหล',  kind: 'ข้าวมันไก่', accent: '#C7481A', soft: '#FDEBE1', ink: '#8A3A16', oa: '@humlai.demo', initial: 'ห' }
  };
  const BRAND_IDS = Object.keys(BRANDS);

  const MENUS = {
    narai: [
      { id: 'n1', name: 'บุฟเฟต์ผู้ใหญ่', price: 499 }, { id: 'n2', name: 'บุฟเฟต์เด็ก', price: 249 },
      { id: 'n3', name: 'อัพเกรดพรีเมียม', price: 150 }, { id: 'n4', name: 'เครื่องดื่มรีฟิล', price: 59 },
      { id: 'n5', name: 'ของหวานพิเศษ', price: 89 }, { id: 'n6', name: 'น้ำแร่', price: 25 }
    ],
    wakame: [
      { id: 'w1', name: 'ราเมนทงคตสึ', price: 189 }, { id: 'w2', name: 'ราเมนโชยุ', price: 169 },
      { id: 'w3', name: 'เกี๊ยวซ่า', price: 79 }, { id: 'w4', name: 'ข้าวหน้าหมูชาชู', price: 129 },
      { id: 'w5', name: 'ไข่ออนเซ็น', price: 25 }, { id: 'w6', name: 'ชาเขียว', price: 35 }
    ],
    humlai: [
      { id: 'h1', name: 'ข้าวมันไก่หำไหล', price: 70 }, { id: 'h2', name: 'ข้าวมันไก่สองใจ', price: 80 },
      { id: 'h3', name: 'ข้าวมันไก่ทอด', price: 65 }, { id: 'h4', name: 'ซุปฟักตุ๋น', price: 40 },
      { id: 'h5', name: 'ไก่ต้มสับ (จานใหญ่)', price: 220 }, { id: 'h6', name: 'น้ำเก๊กฮวย', price: 25 }
    ]
  };

  function seedRng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  function seed() {
    const now = Date.now();
    const rnd = seedRng(42);
    const st = {
      v: 1, seq: { member: 12845, bill: 1000, coupon: 500, ledger: 1, req: 1, bc: 1 },
      rules: {
        narai:  { baht: 100, pts: 1, base: 'net', rounding: 'floor', expiryMonths: 12, welcome: 20, backdays: 3, tiers: { gold: 150, platinum: 400 }, promo: { on: false, mult: 2, day: 3 } },
        wakame: { baht: 100, pts: 1, base: 'net', rounding: 'floor', expiryMonths: 12, welcome: 10, backdays: 3, tiers: { gold: 120, platinum: 300 }, promo: { on: false, mult: 2, day: 3 } },
        humlai: { baht: 25,  pts: 1, base: 'net', rounding: 'floor', expiryMonths: 12, welcome: 50, backdays: 3, tiers: { gold: 1500, platinum: 3000 }, promo: { on: false, mult: 2, day: 3 } }
      },
      branches: [
        { id: 'NR01', brand: 'narai', name: 'Narai สาขา 1', open: '11:00', close: '22:00', phone: '0X-XXX-XX01', pos: 'online', earn: true },
        { id: 'NR02', brand: 'narai', name: 'Narai สาขา 2', open: '11:00', close: '22:00', phone: '0X-XXX-XX02', pos: 'online', earn: true },
        { id: 'WK01', brand: 'wakame', name: 'Wakame สาขา 1', open: '10:30', close: '21:30', phone: '0X-XXX-XX11', pos: 'online', earn: true },
        { id: 'WK02', brand: 'wakame', name: 'Wakame สาขา 2', open: '10:30', close: '21:30', phone: '0X-XXX-XX12', pos: 'delayed', earn: true },
        { id: 'HL01', brand: 'humlai', name: 'หำไหล สาขา 1', open: '07:00', close: '15:00', phone: '0X-XXX-XX21', pos: 'online', earn: true },
        { id: 'HL02', brand: 'humlai', name: 'หำไหล สาขา 2', open: '07:00', close: '15:00', phone: '0X-XXX-XX22', pos: 'online', earn: true },
        { id: 'HL03', brand: 'humlai', name: 'หำไหล สาขา 3', open: '08:00', close: '20:00', phone: '0X-XXX-XX23', pos: 'manual', earn: true }
      ],
      rewards: [
        { id: 'r-n1', brand: 'narai', name: 'ส่วนลด 100 บาท', cost: 50, cat: 'discount', stock: 200, active: true, cp: { kind: 'baht', value: 100, min: 500 } },
        { id: 'r-n2', brand: 'narai', name: 'เครื่องดื่มรีฟิลฟรี', cost: 20, cat: 'drink', stock: 500, active: true, cp: { kind: 'baht', value: 59, min: 0 } },
        { id: 'r-n3', brand: 'narai', name: 'บุฟเฟต์เด็กฟรี 1 ท่าน', cost: 120, cat: 'food', stock: 50, active: true, cp: { kind: 'baht', value: 249, min: 998 } },
        { id: 'r-w1', brand: 'wakame', name: 'ไข่ออนเซ็นฟรี', cost: 10, cat: 'side', stock: 500, active: true, cp: { kind: 'baht', value: 25, min: 0 } },
        { id: 'r-w2', brand: 'wakame', name: 'เกี๊ยวซ่าฟรี 1 จาน', cost: 30, cat: 'side', stock: 300, active: true, cp: { kind: 'baht', value: 79, min: 150 } },
        { id: 'r-w3', brand: 'wakame', name: 'ราเมนฟรี 1 ชาม', cost: 80, cat: 'food', stock: 100, active: true, cp: { kind: 'baht', value: 189, min: 0 } },
        { id: 'r-h0', brand: 'humlai', name: 'น้ำเก๊กฮวยฟรี', cost: 50, cat: 'drink', stock: 500, active: true, cp: { kind: 'baht', value: 25, min: 0 } },
        { id: 'r-h1', brand: 'humlai', name: 'ซุปฟักตุ๋น', cost: 150, cat: 'side', stock: 500, active: true, cp: { kind: 'baht', value: 40, min: 0 } },
        { id: 'r-h2', brand: 'humlai', name: 'ข้าวมันไก่ทอด', cost: 300, cat: 'food', stock: 300, active: true, cp: { kind: 'baht', value: 65, min: 0 } },
        { id: 'r-h3', brand: 'humlai', name: 'ข้าวมันไก่สองใจ', cost: 400, cat: 'food', stock: 300, active: true, cp: { kind: 'baht', value: 80, min: 0 } },
        { id: 'r-h4', brand: 'humlai', name: 'ส่วนลด 50 บาท', cost: 500, cat: 'discount', stock: 200, active: true, cp: { kind: 'baht', value: 50, min: 200 } },
        { id: 'r-h5', brand: 'humlai', name: 'ไก่ต้มสับ (จานใหญ่)', cost: 900, cat: 'food', stock: 80, active: true, cp: { kind: 'baht', value: 220, min: 0 } }
      ],
      staff: [
        { id: 'S001', name: 'แอดมินไอที', role: 'super', scope: 'ทั้งเครือ' },
        { id: 'S002', name: 'ทีมการตลาดกลาง', role: 'marketing', scope: 'ทั้งเครือ' },
        { id: 'S003', name: 'ผู้จัดการแบรนด์ หำไหล', role: 'brand', scope: 'humlai' },
        { id: 'S004', name: 'ผู้จัดการ หำไหล สาขา 1', role: 'branchmgr', scope: 'HL01' },
        { id: 'S005', name: 'แคชเชียร์ หำไหล สาขา 1', role: 'cashier', scope: 'HL01' },
        { id: 'S006', name: 'แคชเชียร์ Narai สาขา 1', role: 'cashier', scope: 'NR01' },
        { id: 'S007', name: 'แคชเชียร์ Wakame สาขา 1', role: 'cashier', scope: 'WK01' }
      ],
      members: [], ledger: [], bills: [], coupons: [], requests: [], broadcasts: [], audit: [], api: [],
      chats: { narai: [], wakame: [], humlai: [] },
      demo: { lineUserId: 'Udemo00000000000000000000000001', displayName: 'ลูกค้าทดลอง', memberId: null, followed: {} }
    };

    const names = ['สมชาย ใจดี', 'สมหญิง รักสงบ', 'มานี มีนา', 'ปิติ ยินดี', 'ชูใจ ใฝ่รู้', 'วีระ กล้าหาญ', 'ดวงใจ สุขสันต์', 'ประเสริฐ มั่นคง', 'นภา แสงทอง', 'อารีย์ ใจงาม', 'กิตติ ทองดี', 'สุดา พรมมา', 'วิภา ศรีสุข', 'ธนา เจริญผล'];
    names.forEach((name, i) => {
      const id = i === 0 ? 'MB-0012845' : 'MB-' + String(12000 + i * 37).padStart(7, '0');
      const joinedDaysAgo = Math.floor(rnd() * 120) + (i < 4 ? 3 : 8);
      const home = st.branches[Math.floor(rnd() * st.branches.length)];
      const brandsVisited = [home.brand];
      BRAND_IDS.forEach((b) => { if (b !== home.brand && rnd() < 0.4) brandsVisited.push(b); });
      const m = {
        id, name, phone: i === 0 ? '0812345678' : '08' + String(10000000 + Math.floor(rnd() * 89999999)),
        birthday: '199' + Math.floor(rnd() * 9) + '-0' + (1 + Math.floor(rnd() * 9)) + '-1' + Math.floor(rnd() * 9),
        homeBranch: home.id, joinedBrand: home.brand, joinedAt: now - joinedDaysAgo * DAY, lineUserId: 'U' + id.replace('-', '').toLowerCase() + 'x',
        consent: { privacy: true, mkt: {} }, follow: {}
      };
      brandsVisited.forEach((b) => { m.follow[b] = rnd() < 0.9 ? 'follow' : 'blocked'; m.consent.mkt[b] = rnd() < 0.75; });
      st.members.push(m);
      addLedger(st, { at: m.joinedAt, memberId: id, brand: home.brand, branch: home.id, type: 'welcome', pts: st.rules[home.brand].welcome, note: 'แต้มต้อนรับสมาชิกใหม่', by: 'system' });
      brandsVisited.forEach((b) => {
        const visits = 1 + Math.floor(rnd() * (i === 0 ? 12 : 6));
        const brs = st.branches.filter((x) => x.brand === b);
        for (let k = 0; k < visits; k++) {
          const at = m.joinedAt + Math.floor(rnd() * (now - m.joinedAt));
          const br = brs[Math.floor(rnd() * brs.length)];
          const menu = MENUS[b];
          const items = [];
          const n = 1 + Math.floor(rnd() * 4);
          for (let j = 0; j < n; j++) { const it = menu[Math.floor(rnd() * menu.length)]; items.push({ id: it.id, name: it.name, price: it.price, qty: 1 }); }
          const total = items.reduce((s, x) => s + x.price * x.qty, 0);
          const billId = br.id + '-' + (++st.seq.bill);
          const pts = calcPoints(st.rules[b], total, at);
          st.bills.push({ id: billId, brand: b, branch: br.id, memberId: id, items, subtotal: total, discount: 0, total, pts, at, channel: 'pos', status: 'paid', coupons: [] });
          addLedger(st, { at, memberId: id, brand: b, branch: br.id, type: 'earn', pts, note: 'ชำระบิล ' + billId, ref: billId, by: 'pos' });
        }
      });
    });
    // anonymous (non-member) bills for repeat-rate context
    st.branches.forEach((br) => {
      for (let k = 0; k < 6; k++) {
        const it = MENUS[br.brand][Math.floor(rnd() * 6)];
        st.bills.push({ id: br.id + '-' + (++st.seq.bill), brand: br.brand, branch: br.id, memberId: null, items: [{ id: it.id, name: it.name, price: it.price, qty: 2 }], subtotal: it.price * 2, discount: 0, total: it.price * 2, pts: 0, at: now - Math.floor(rnd() * 30) * DAY, channel: 'pos', status: 'paid', coupons: [] });
      }
    });
    // sample coupons for MB-0012845
    issueCoupon(st, { memberId: 'MB-0012845', brand: 'humlai', title: 'ซุปฟักตุ๋น ฟรี', big: 'ฟรี', small: '1 ถ้วย', cond: 'เมื่อสั่งข้าวมันไก่ 2 จานขึ้นไป', cp: { kind: 'baht', value: 40, min: 0 }, days: 3, source: 'campaign' });
    issueCoupon(st, { memberId: 'MB-0012845', brand: 'humlai', title: 'ส่วนลด 20 บาท', big: '-20', small: 'บาท', cond: 'ขั้นต่ำ 200 บาท · ทุกสาขา', cp: { kind: 'baht', value: 20, min: 200 }, days: 16, source: 'campaign' });
    st.requests.push({ id: 'REQ-' + (st.seq.req++), at: now - 3 * 3600000, memberId: 'MB-' + String(12000 + 2 * 37).padStart(7, '0'), brand: 'humlai', branch: 'HL01', pts: 18, reason: 'ลูกค้าลืมแจ้งสมาชิก บิล HL01-1003', by: 'แคชเชียร์ หำไหล สาขา 1', status: 'pending' });
    st.broadcasts.push({ id: 'BC-0', at: now - 6 * DAY, brand: 'narai', segment: 'all', text: 'โปรเดือนนี้ (ตัวอย่าง): มา 4 จ่าย 3 ทุกวันจันทร์–พฤหัส', recipients: 9, coupon: null, by: 'ทีมการตลาดกลาง' });
    st.ledger.sort((a, b) => a.at - b.at);
    st.bills.sort((a, b) => a.at - b.at);
    return st;
  }

  function addLedger(st, e) {
    const row = Object.assign({ id: 'L' + (st.seq.ledger++), branch: null, ref: null, note: '' }, e);
    if (row.at === undefined) row.at = Date.now();
    st.ledger.push(row);
    return row;
  }
  function issueCoupon(st, o) {
    const id = 'CP-' + (++st.seq.coupon);
    const c = { id, code: ({ narai: 'NR', wakame: 'WK', humlai: 'HL' }[o.brand] || 'GR') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(), memberId: o.memberId, brand: o.brand, title: o.title, big: o.big, small: o.small, cond: o.cond, cp: o.cp, status: 'ready', issuedAt: Date.now(), expiresAt: Date.now() + (o.days || 30) * DAY, source: o.source, usedAt: null, usedBranch: null };
    st.coupons.push(c);
    return c;
  }
  function calcPoints(rule, base, at) {
    if (rule.baht <= 0) return 0;
    let p = Math.floor(base / rule.baht) * rule.pts;
    if (rule.rounding === 'round') p = Math.round(base / rule.baht) * rule.pts;
    const d = new Date(at || Date.now()).getDay();
    if (rule.promo && rule.promo.on && d === Number(rule.promo.day)) p = p * Number(rule.promo.mult);
    return p;
  }

  let st;
  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) { const s = JSON.parse(raw); if (s && s.v === 1) return s; } } catch (e) { /* ignore */ }
    return seed();
  }
  function save() { if (st.live) return; try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* ignore */ } }
  st = load();

  const listeners = [];
  function emit() { save(); listeners.forEach((f) => f()); }
  function log(method, path, body, result, kind) {
    st.api.unshift({ at: Date.now(), method, path, body: body || null, result: result || null, kind: kind || 'api' });
    st.api = st.api.slice(0, 80);
  }
  function audit(actor, action, detail) { st.audit.unshift({ at: Date.now(), actor, action, detail }); }

  /* ---------- read helpers ---------- */
  const R = {
    state: () => st,
    brands: BRANDS, brandIds: BRAND_IDS, menus: MENUS,
    member: (id) => st.members.find((m) => m.id === id),
    demoMember: () => (st.demo.memberId ? R.member(st.demo.memberId) : null),
    branch: (id) => st.branches.find((b) => b.id === id),
    balance(memberId, brand) { return st.ledger.reduce((s, l) => s + (l.memberId === memberId && l.brand === brand ? l.pts : 0), 0); },
    earnedYear(memberId, brand) { const t = Date.now() - 365 * DAY; return st.ledger.reduce((s, l) => s + (l.memberId === memberId && l.brand === brand && l.pts > 0 && l.at > t ? l.pts : 0), 0); },
    tier(memberId, brand) {
      const e = R.earnedYear(memberId, brand); const t = st.rules[brand].tiers;
      if (e >= t.platinum) return { name: 'PLATINUM', next: null, need: 0, at: e, max: t.platinum };
      if (e >= t.gold) return { name: 'GOLD', next: 'Platinum', need: t.platinum - e, at: e, max: t.platinum };
      return { name: 'SILVER', next: 'Gold', need: t.gold - e, at: e, max: t.gold };
    },
    coupons(memberId, brand) {
      const now = Date.now();
      st.coupons.forEach((c) => { if (c.status === 'ready' && c.expiresAt < now) c.status = 'expired'; });
      return st.coupons.filter((c) => c.memberId === memberId && (!brand || c.brand === brand || c.brand === 'all'));
    },
    bills(memberId, brand) { return st.bills.filter((b) => b.memberId === memberId && (!brand || b.brand === brand)).sort((a, b) => b.at - a.at); },
    calcPoints: (brand, base) => calcPoints(st.rules[brand], base, Date.now()),
    findMember(q) {
      q = String(q || '').trim().toUpperCase();
      if (!q) return null;
      const digits = q.replace(/\D/g, '');
      return st.members.find((m) => m.id === q || m.id === 'MB-' + digits.padStart(7, '0') || (digits.length >= 9 && m.phone === digits)) || null;
    },
    qrToken(memberId) {
      const win = Math.floor(Date.now() / 60000);
      let h = 0; const s = memberId + ':' + win;
      for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
      return { token: 'QR.' + memberId.slice(3) + '.' + h.toString(36).toUpperCase(), left: 60 - Math.floor((Date.now() / 1000) % 60) };
    }
  };

  /* ---------- API (mock endpoints) ---------- */
  const API = {
    onChange(f) { listeners.push(f); },
    reset() { st = seed(); emit(); },

    // LINE Webhook: follow event เมื่อเพิ่มเพื่อน OA ครั้งแรก
    openOa(brand) {
      if (!st.demo.followed[brand]) {
        st.demo.followed[brand] = true;
        log('POST', '/webhooks/line/' + brand, { type: 'follow', source: { userId: st.demo.lineUserId } }, '200 · verify X-Line-Signature ด้วย channel secret ของ ' + BRANDS[brand].short, 'webhook');
        const m = R.demoMember();
        if (m) m.follow[brand] = 'follow';
        st.chats[brand].push({ from: 'oa', kind: 'text', text: 'สวัสดีครับ ยินดีต้อนรับสู่ ' + BRANDS[brand].name + '\nกดเมนู "สมาชิก" ด้านล่าง เพื่อสมัครหรือเปิดบัตรสมาชิก' + (m ? '\n\nระบบพบบัญชีสมาชิก ' + m.id + ' ของคุณแล้ว ใช้ได้ทันทีที่ร้านนี้' : ''), at: Date.now() });
        emit();
      }
    },
    // ข้อความจาก Rich Menu (postback/message) → webhook → reply
    chat(brand, text) {
      const b = BRANDS[brand];
      st.chats[brand].push({ from: 'me', kind: 'text', text, at: Date.now() });
      log('POST', '/webhooks/line/' + brand, { type: 'message', text }, 'reply ด้วย channel token ของ ' + b.short, 'webhook');
      if (text === 'โปรโมชั่น') st.chats[brand].push({ from: 'oa', kind: 'promo', at: Date.now() });
      else if (text === 'สาขา') st.chats[brand].push({ from: 'oa', kind: 'branches', at: Date.now() });
      else if (text === 'ติชม') st.chats[brand].push({ from: 'oa', kind: 'text', text: 'ยินดีรับฟังครับ พิมพ์คำติชมหรือคำถามไว้ได้เลย\nพนักงานจะตอบกลับในเวลาทำการ', quick: ['อร่อยมาก', 'โอเค', 'ควรปรับปรุง'], at: Date.now() });
      else if (['อร่อยมาก', 'โอเค', 'ควรปรับปรุง'].includes(text)) {
        const m = R.demoMember();
        let extra = '';
        if (m) { addLedger(st, { at: Date.now(), memberId: m.id, brand, type: 'bonus', pts: 5, note: 'ให้คะแนนร้าน', by: 'line' }); extra = '\nได้รับ +5 แต้ม ' + b.short; }
        st.chats[brand].push({ from: 'oa', kind: 'text', text: 'ขอบคุณสำหรับรีวิวครับ' + extra, at: Date.now() });
      } else st.chats[brand].push({ from: 'oa', kind: 'text', text: 'ได้รับข้อความแล้ว แอดมินจะตอบกลับในเวลาทำการครับ', at: Date.now() });
      st.chats[brand].forEach((c) => { if (c.quick && c.from === 'oa' && text !== 'ติชม') c.quick = null; });
      emit();
    },
    liffOpen(brand) {
      const m = R.demoMember();
      log('GET', '/liff/me?brand=' + brand, { idToken: 'eyJ…(LINE Login)' }, m ? '200 · ' + m.id : '404 · ยังไม่เป็นสมาชิก → หน้าสมัคร', 'api');
    },
    sendOtp(phone) { log('POST', '/auth/otp', { phone: mask(phone) }, '200 · ส่ง SMS (ตัวอย่าง: ใส่เลขอะไรก็ได้)', 'api'); emit(); },
    register(brand, f) {
      const dup = st.members.find((m) => m.phone === f.phone);
      if (dup) {
        // บัญชีเดิมจากเบอร์เดียวกัน: ผูก LINE ใหม่หลังยืนยัน OTP (ไม่รวมจากชื่อ/เบอร์อย่างเดียว)
        dup.lineUserId = st.demo.lineUserId; st.demo.memberId = dup.id;
        dup.follow[brand] = 'follow'; dup.consent.mkt[brand] = !!f.mkt;
        log('POST', '/members/link', { phone: mask(f.phone), otp: 'verified' }, '200 · ผูก LINE กับสมาชิกเดิม ' + dup.id, 'api');
        audit('ลูกค้า (LIFF)', 'ผูกบัญชีสมาชิกเดิม', dup.id);
        emit(); return { member: dup, linked: true };
      }
      const id = 'MB-' + String(++st.seq.member).padStart(7, '0');
      const m = { id, name: f.name, phone: f.phone, birthday: f.birthday, homeBranch: f.branch, joinedBrand: brand, joinedAt: Date.now(), lineUserId: st.demo.lineUserId, consent: { privacy: true, mkt: {} }, follow: {} };
      Object.keys(st.demo.followed).forEach((b) => { m.follow[b] = 'follow'; });
      m.follow[brand] = 'follow'; m.consent.mkt[brand] = !!f.mkt;
      st.members.push(m); st.demo.memberId = id;
      const w = st.rules[brand].welcome;
      addLedger(st, { at: Date.now(), memberId: id, brand, branch: f.branch, type: 'welcome', pts: w, note: 'แต้มต้อนรับสมาชิกใหม่', by: 'system' });
      const c = issueCoupon(st, { memberId: id, brand, title: 'ส่วนลด 10% บิลแรก', big: '-10%', small: 'บิลแรก', cond: 'สำหรับสมาชิกใหม่ · 1 ครั้ง', cp: { kind: 'pct', value: 10, min: 0 }, days: 30, source: 'welcome' });
      log('POST', '/members', { brand, name: f.name, phone: mask(f.phone), homeBranch: f.branch, consent: { privacy: true, marketing: { [brand]: !!f.mkt } } }, '201 · ' + id + ' · +' + w + ' แต้ม ' + BRANDS[brand].short + ' · คูปอง ' + c.id, 'api');
      st.chats[brand].push({ from: 'oa', kind: 'welcome', memberId: id, pts: w, at: Date.now() });
      log('POST', 'LINE push (' + BRANDS[brand].short + ')', { to: st.demo.lineUserId, type: 'flex' }, 'ส่ง Flex ต้อนรับสมาชิก', 'push');
      audit('ลูกค้า (LIFF)', 'สมัครสมาชิก', id + ' ผ่าน OA ' + BRANDS[brand].short);
      emit(); return { member: m, linked: false };
    },
    setConsent(memberId, brand, val) {
      const m = R.member(memberId); m.consent.mkt[brand] = val;
      log('PATCH', '/members/' + memberId + '/consents', { brand, marketing: val }, '200', 'api');
      audit('ลูกค้า (LIFF)', 'เปลี่ยนความยินยอมการตลาด', memberId + ' · ' + BRANDS[brand].short + ' = ' + (val ? 'ยินยอม' : 'ไม่ยินยอม'));
      emit();
    },
    redeem(memberId, rewardId) {
      const r = st.rewards.find((x) => x.id === rewardId);
      const bal = R.balance(memberId, r.brand);
      if (bal < r.cost) { log('POST', '/members/' + memberId + '/redemptions', { rewardId }, '409 · แต้มไม่พอ', 'api'); emit(); return { ok: false, msg: 'แต้มไม่พอ' }; }
      if (r.stock <= 0) return { ok: false, msg: 'ของรางวัลหมด' };
      r.stock -= 1;
      const c = issueCoupon(st, { memberId, brand: r.brand, title: r.name, big: r.cat === 'discount' ? '-' + r.cp.value : 'ฟรี', small: r.cat === 'discount' ? 'บาท' : 'แลกแต้ม', cond: 'แลกด้วย ' + r.cost + ' แต้ม' + (r.cp.min ? ' · ขั้นต่ำ ' + r.cp.min + ' บาท' : ''), cp: r.cp, days: 30, source: 'redeem' });
      addLedger(st, { at: Date.now(), memberId, brand: r.brand, type: 'redeem', pts: -r.cost, note: 'แลก ' + r.name, ref: c.id, by: 'member' });
      log('POST', '/members/' + memberId + '/redemptions', { rewardId, idempotencyKey: 'rdm-' + Date.now() }, '201 · ตัด ' + r.cost + ' แต้ม (lock wallet) → คูปอง ' + c.id, 'api');
      emit(); return { ok: true, coupon: c };
    },
    addCode(memberId, brand, code) {
      code = String(code || '').trim().toUpperCase();
      if (code.length < 4) return { ok: false, msg: 'โค้ดต้องมีอย่างน้อย 4 ตัวอักษร' };
      const c = issueCoupon(st, { memberId, brand, title: 'ส่วนลด 15% จากโค้ด ' + code, big: '-15%', small: 'โค้ดพิเศษ', cond: 'ใช้ได้ 1 ครั้ง · ' + BRANDS[brand].short + ' ทุกสาขา', cp: { kind: 'pct', value: 15, min: 0 }, days: 30, source: 'code' });
      log('POST', '/members/' + memberId + '/coupons/claim', { code }, '201 · ' + c.id, 'api');
      emit(); return { ok: true, coupon: c };
    },
    // POS: สแกน QR สมาชิก
    resolve(q, ctx) {
      let m = null;
      if (String(q).startsWith('QR.')) {
        const id = 'MB-' + String(q).split('.')[1];
        const tok = R.qrToken(id).token;
        m = tok === q ? R.member(id) : null;
        log('POST', '/pos/members/resolve', { qrToken: q, branch: ctx.branch }, m ? '200 · ' + m.id : '410 · QR หมดอายุ', 'pos');
      } else {
        m = R.findMember(q);
        log('POST', '/pos/members/resolve', { query: q, branch: ctx.branch }, m ? '200 · ' + m.id : '404', 'pos');
      }
      emit(); return m;
    },
    couponDiscount(c, subtotal) {
      if (!c || c.status !== 'ready') return 0;
      if (subtotal < (c.cp.min || 0)) return 0;
      return c.cp.kind === 'pct' ? Math.floor(subtotal * c.cp.value / 100) : Math.min(c.cp.value, subtotal);
    },
    closeBill(o) {
      const br = R.branch(o.branch);
      const subtotal = o.items.reduce((s, x) => s + x.price * x.qty, 0);
      const usable = (o.couponIds || []).map((id) => st.coupons.find((c) => c.id === id)).filter((c) => c && c.status === 'ready');
      let discount = 0; usable.forEach((c) => { discount += API.couponDiscount(c, subtotal - discount); });
      const total = Math.max(0, subtotal - discount);
      const rule = st.rules[br.brand];
      const base = rule.base === 'gross' ? subtotal : (rule.base === 'exvat' ? total / 1.07 : total);
      const pts = o.memberId && br.earn ? calcPoints(rule, base, Date.now()) : 0;
      const billId = br.id + '-' + (++st.seq.bill);
      const bill = { id: billId, brand: br.brand, branch: br.id, memberId: o.memberId || null, items: o.items, subtotal, discount, total, pts, at: Date.now(), channel: o.channel || 'pos', status: 'paid', coupons: usable.map((c) => c.id), staff: o.staff };
      st.bills.push(bill);
      usable.forEach((c) => { c.status = 'used'; c.usedAt = Date.now(); c.usedBranch = br.id; });
      log('POST', '/pos/transactions', { posBillId: billId, branch: br.id, memberId: o.memberId, amount: total, coupons: bill.coupons, idempotencyKey: billId }, '201 · +' + pts + ' แต้ม ' + BRANDS[br.brand].short, 'pos');
      if (o.memberId && pts > 0) addLedger(st, { at: Date.now(), memberId: o.memberId, brand: br.brand, branch: br.id, type: 'earn', pts, note: 'ชำระบิล ' + billId, ref: billId, by: o.staff || 'pos' });
      if (o.memberId && o.memberId === st.demo.memberId) {
        st.chats[br.brand].push({ from: 'oa', kind: 'points', billId, bal: R.balance(o.memberId, br.brand), at: Date.now() });
        log('POST', 'LINE push (' + BRANDS[br.brand].short + ')', { to: st.demo.lineUserId, type: 'flex', alt: 'ได้รับ +' + pts + ' แต้ม' }, 'ส่ง Flex แจ้งแต้ม', 'push');
      }
      emit(); return bill;
    },
    retryBill(billId) {
      const b = st.bills.find((x) => x.id === billId);
      log('POST', '/pos/transactions', { posBillId: billId, idempotencyKey: billId, retry: true }, '200 · บิลนี้บันทึกแล้ว ไม่ให้แต้มซ้ำ', 'pos');
      emit(); return b;
    },
    refund(billId, by) {
      const b = st.bills.find((x) => x.id === billId);
      if (!b || b.status !== 'paid') return;
      b.status = 'refunded';
      if (b.memberId && b.pts) addLedger(st, { at: Date.now(), memberId: b.memberId, brand: b.brand, branch: b.branch, type: 'refund', pts: -b.pts, note: 'คืนเงินบิล ' + billId, ref: billId, by });
      b.coupons.forEach((id) => { const c = st.coupons.find((x) => x.id === id); if (c && c.expiresAt > Date.now()) { c.status = 'ready'; c.usedAt = null; } });
      log('POST', '/pos/refunds', { posBillId: billId }, '201 · หักแต้มคืน ' + b.pts + ' · คืนคูปอง ' + b.coupons.length, 'pos');
      audit(by, 'คืนเงินบิล', billId);
      emit();
    },
    requestAdjust(o) {
      const r = Object.assign({ id: 'REQ-' + (st.seq.req++), at: Date.now(), status: 'pending' }, o);
      st.requests.unshift(r);
      log('POST', '/admin/point-adjustments', o, '201 · รออนุมัติ ' + r.id, 'admin');
      audit(o.by, 'ขอปรับแต้ม', r.id + ' · ' + o.memberId + ' · ' + (o.pts > 0 ? '+' : '') + o.pts);
      emit();
    },
    decide(reqId, ok, by) {
      const r = st.requests.find((x) => x.id === reqId);
      r.status = ok ? 'approved' : 'rejected'; r.decidedBy = by;
      if (ok) addLedger(st, { at: Date.now(), memberId: r.memberId, brand: r.brand, branch: r.branch, type: 'adjust', pts: r.pts, note: r.reason, ref: r.id, by });
      log('POST', '/admin/point-adjustments/' + reqId + (ok ? '/approve' : '/reject'), null, '200', 'admin');
      audit(by, ok ? 'อนุมัติปรับแต้ม' : 'ปฏิเสธปรับแต้ม', reqId);
      emit();
    },
    saveRule(brand, rule, by) {
      st.rules[brand] = rule;
      log('PUT', '/admin/brands/' + brand + '/earn-rule', rule, '200', 'admin');
      audit(by, 'แก้กฎแต้ม', BRANDS[brand].short + ': ' + rule.baht + ' บาท = ' + rule.pts + ' แต้ม · หมดอายุ ' + rule.expiryMonths + ' เดือน' + (rule.promo.on ? ' · คูณ ' + rule.promo.mult : ''));
      emit();
    },
    saveReward(r, by) {
      const ex = st.rewards.find((x) => x.id === r.id);
      if (ex) Object.assign(ex, r); else { r.id = 'r-' + Date.now().toString(36); st.rewards.push(r); }
      log(ex ? 'PUT' : 'POST', '/admin/rewards' + (ex ? '/' + r.id : ''), r, '200', 'admin');
      audit(by, ex ? 'แก้ของรางวัล' : 'เพิ่มของรางวัล', BRANDS[r.brand].short + ' · ' + r.name);
      emit();
    },
    toggleBranchEarn(id, by) {
      const b = R.branch(id); b.earn = !b.earn;
      log('PATCH', '/admin/branches/' + id, { earnEnabled: b.earn }, '200', 'admin');
      audit(by, 'ตั้งค่าสาขา', b.name + ' สะสมแต้ม = ' + (b.earn ? 'เปิด' : 'ปิด'));
      emit();
    },
    audience(brand, segment) {
      const now = Date.now();
      return st.members.filter((m) => {
        if (m.follow[brand] !== 'follow' || !m.consent.mkt[brand]) return false;
        if (segment === 'gold') return R.tier(m.id, brand).name !== 'SILVER';
        if (segment === 'lapsed') { const last = R.bills(m.id, brand)[0]; return !last || now - last.at > 30 * DAY; }
        if (segment === 'new') return now - m.joinedAt < 30 * DAY;
        return true;
      });
    },
    crossAudience(brand) {
      // สมาชิกที่เคยซื้อแบรนด์อื่น แต่ยังไม่เคยซื้อแบรนด์นี้ และติดตาม OA นี้อยู่
      return st.members.filter((m) => m.follow[brand] === 'follow' && m.consent.mkt[brand] && R.bills(m.id, brand).length === 0 && R.bills(m.id).length > 0);
    },
    broadcast(o, by) {
      const list = o.segment === 'cross' ? API.crossAudience(o.brand) : API.audience(o.brand, o.segment);
      const bc = { id: 'BC-' + (st.seq.bc++), at: Date.now(), brand: o.brand, segment: o.segment, text: o.text, recipients: list.length, coupon: o.coupon ? o.couponTitle : null, by };
      st.broadcasts.unshift(bc);
      list.forEach((m) => {
        if (o.coupon) issueCoupon(st, { memberId: m.id, brand: o.brand, title: o.couponTitle, big: '-' + o.couponValue, small: 'บาท', cond: 'จากแคมเปญ ' + bc.id, cp: { kind: 'baht', value: Number(o.couponValue), min: 0 }, days: 14, source: 'campaign' });
        if (m.id === st.demo.memberId) st.chats[o.brand].push({ from: 'oa', kind: 'broadcast', text: o.text, coupon: o.coupon ? o.couponTitle : null, at: Date.now() });
      });
      log('POST', '/admin/campaigns/' + bc.id + '/send', { oa: BRANDS[o.brand].oa, segment: o.segment, recipients: list.length }, '202 · เข้าคิว multicast (500 คน/ครั้ง) ด้วย token ของ ' + BRANDS[o.brand].short, 'admin');
      audit(by, 'ส่งแคมเปญ', bc.id + ' · ' + BRANDS[o.brand].short + ' · ' + list.length + ' คน');
      emit(); return bc;
    },
    clearLog() { st.api = []; emit(); }
  };
  function mask(p) { p = String(p || ''); return p.length > 4 ? '***-***-' + p.slice(-4) : p; }

  // live.js ใช้ 2 ตัวนี้สลับไปใช้ข้อมูลจาก PostgreSQL ผ่าน server
  window.CRM = { R, API, DAY, mask, _setState: (s) => { st = s; }, _notify: () => listeners.forEach((f) => f()) };
})();
