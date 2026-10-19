/* หน้า LIFF สมาชิก (ใช้งานจริง)
 * - เปิดจาก Rich Menu: https://liff.line.me/{LIFF_ID}?brand=humlai (&tab=coupons|rewards|history)
 * - ยืนยันตัวตนด้วย LINE ID token ทุกคำขอ (server ตรวจกับ LINE เอง)
 * - ถ้ายังไม่ได้ตั้ง LIFF_ID และ server อยู่โหมดทดสอบ: ใช้ผู้ใช้ทดสอบประจำเบราว์เซอร์ เพื่อทดลองบนคอม/มือถือได้ก่อน */
(function () {
  'use strict';
  const $app = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const S = {
    cfg: null, brands: [], brand: null, tab: params.get('tab') || 'home', auth: {}, inClient: false, dev: false,
    me: null, coupons: [], rewards: [], bills: [], ledger: [], qr: null, qrAt: 0,
    couponTab: 'ready', showCode: null, pick: null, rcat: 'all', hist: 'bills', openBill: null, code: '', busy: false,
    reg: { name: '', phone: '', otp: '', otpSent: false, birthday: '', branchId: '', privacy: false, marketing: true, err: '' }
  };

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const baht = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const date = (t) => { const d = new Date(t); return d.getDate() + ' ' + TH_M[d.getMonth()] + ' ' + (d.getFullYear() + 543); };
  const left = (t) => { const d = Math.ceil((new Date(t) - Date.now()) / 864e5); return d <= 0 ? 'หมดอายุวันนี้' : d <= 7 ? 'เหลือ ' + d + ' วัน' : 'ใช้ได้ถึง ' + date(t); };
  const brand = () => S.brands.find((b) => b.id === S.brand) || S.brands[0];
  const brandOf = (id) => S.brands.find((b) => b.id === id);
  const branchName = (id) => { for (const b of S.brands) { const x = b.branches.find((y) => y.id === id); if (x) return x.name; } return id || '-'; };
  let toastT;
  function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2800); }
  const ic = (d) => '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const I = {
    close: ic('<path d="M6 6l12 12M18 6L6 18"/>'), user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
    card: ic('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>'), ticket: ic('<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/>'),
    gift: ic('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/>'), receipt: ic('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6"/>')
  };

  async function api(method, path, body, headers) {
    const res = await fetch(path, { method, headers: Object.assign({ 'content-type': 'application/json' }, S.auth, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) { const err = new Error((data && data.message) || 'เชื่อมต่อระบบไม่สำเร็จ'); err.status = res.status; throw err; }
    return data;
  }
  function loadScript(src) {
    return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => fail(new Error('โหลด ' + src + ' ไม่สำเร็จ')); document.head.appendChild(s); });
  }
  function applyTheme() {
    const b = brand(); const r = document.documentElement.style;
    r.setProperty('--a', b.theme_color); r.setProperty('--as', b.soft_color); r.setProperty('--ai', b.ink_color);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', b.theme_color);
    document.title = 'สมาชิก · ' + b.name;
    try { localStorage.setItem('crm-liff-brand', b.id); } catch (e) { /* ignore */ }
  }
  function fatal(title, detail, retry) {
    $app.innerHTML = '<div class="center"><h2>' + esc(title) + '</h2><p class="muted">' + esc(detail || '') + '</p>' + (retry ? '<button class="btn" data-a="reload">ลองอีกครั้ง</button>' : '') + '</div>';
  }

  // เปิดจากปุ่ม "สมัครสมาชิก" ที่หน้าลูกค้าสั่งเอง: ?branch= เลือกสาขาที่สมัครให้ (คูปองต้อนรับตามสาขา) · ?from=kiosk บอกให้กลับไปสั่งอาหารต่อหลังสมัคร
  function joinParams(p) {
    const br = p.get('branch'); const b = S.brands.find((x) => x.id === S.brand);
    if (br && b && b.branches.some((x) => x.id === br)) S.reg.branchId = br;
    if (p.get('from') === 'kiosk') S.fromKiosk = true;
  }

  /* ---------- เริ่มต้น + ยืนยันตัวตน ---------- */
  async function boot() {
    try {
      const [cfg, brands] = await Promise.all([api('GET', '/api/config'), api('GET', '/api/public/brands')]);
      S.cfg = cfg; S.brands = brands;
      let saved = null; try { saved = localStorage.getItem('crm-liff-brand'); } catch (e) { /* ignore */ }
      S.brand = [params.get('brand'), saved, brands[0] && brands[0].id].find((x) => x && brands.some((b) => b.id === x));
      applyTheme();

      if (cfg.liffId) {
        await loadScript('https://static.line-scdn.net/liff/edge/2/sdk.js');
        await window.liff.init({ liffId: cfg.liffId });
        if (!window.liff.isLoggedIn()) { window.liff.login({ redirectUri: location.href }); return; }
        const tok = window.liff.getIDToken();
        if (!tok) return fatal('ตั้งค่า LIFF ยังไม่ครบ', 'LIFF app ต้องเปิดสิทธิ์ (scope) openid และ profile');
        S.auth = { authorization: 'Bearer ' + tok };
        S.inClient = window.liff.isInClient();
        // เปิดผ่าน liff.line.me: LINE ส่ง ?brand= มาใน liff.state แล้ว liff.init() ค่อยใส่กลับเข้า URL จึงต้องอ่านใหม่หลัง init
        const p2 = new URLSearchParams(location.search);
        if (p2.get('brand') && brands.some((b) => b.id === p2.get('brand')) && p2.get('brand') !== S.brand) { S.brand = p2.get('brand'); applyTheme(); }
        if (p2.get('tab')) S.tab = p2.get('tab');
        joinParams(p2);
      } else if (cfg.dev) {
        // ผู้ใช้ทดสอบประจำเบราว์เซอร์ (ID ไม่ใช่รูปแบบ LINE จริง จึงสวมเป็นลูกค้าจริงไม่ได้)
        let id = null; try { id = localStorage.getItem('crm-liff-dev-user'); } catch (e) { /* ignore */ }
        if (!id) { id = 'Udev' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36); try { localStorage.setItem('crm-liff-dev-user', id); } catch (e) { /* ignore */ } }
        S.auth = { 'x-dev-line-user': id, 'x-dev-line-name': encodeURIComponent('ผู้ทดสอบ') };
        S.dev = true;
        joinParams(params);
      } else {
        return fatal('ยังไม่ได้ตั้งค่า LIFF', 'ผู้ดูแลต้องใส่ LIFF_ID ในไฟล์ .env ของ server');
      }
      await loadMe();
      await loadTab();
      render();
    } catch (e) {
      if (e.status === 401) return fatal('การเข้าสู่ระบบหมดอายุ', 'ปิดหน้านี้แล้วกดเมนู "สมาชิก" ใน LINE อีกครั้ง', true);
      fatal('เปิดบัตรสมาชิกไม่สำเร็จ', e.message, true);
    }
  }

  async function loadMe() { S.me = await api('GET', '/api/liff/me?brand=' + S.brand); }
  async function loadTab() {
    if (!S.me || !S.me.member) return;
    const b = S.brand;
    if (S.tab === 'home') { await Promise.all([loadQr(), api('GET', '/api/liff/coupons?brand=' + b).then((x) => { S.coupons = x; }), api('GET', '/api/liff/rewards?brand=' + b).then((x) => { S.rewards = x; })]); }
    if (S.tab === 'coupons') S.coupons = await api('GET', '/api/liff/coupons?brand=' + b);
    if (S.tab === 'rewards') S.rewards = await api('GET', '/api/liff/rewards?brand=' + b);
    if (S.tab === 'history') { const [bills, ledger] = await Promise.all([api('GET', '/api/liff/bills?brand=' + b), api('GET', '/api/liff/ledger?brand=' + b)]); S.bills = bills; S.ledger = ledger; }
  }
  async function loadQr() { S.qr = await api('GET', '/api/liff/qr'); S.qrAt = Date.now(); }

  /* ---------- หน้าจอ ---------- */
  function head(title) {
    return '<header class="head"><div class="head-row"><button class="icon-btn" data-a="close" aria-label="ปิด">' + I.close + '</button><div class="t">' + esc(title) + '</div>' +
      (S.me && S.me.member ? '<button class="icon-btn" data-a="tab" data-v="profile" aria-label="ข้อมูลของฉัน">' + I.user + '</button>' : '<span class="icon-btn"></span>') + '</div>' + '</header>';
  }
  function nav() {
    const t = [['home', 'บัตร', I.card], ['coupons', 'คูปอง', I.ticket], ['rewards', 'แลกแต้ม', I.gift], ['history', 'ประวัติ', I.receipt]];
    return '<nav class="nav" aria-label="เมนูสมาชิก"><div class="nav-in">' + t.map((x) => '<button data-a="tab" data-v="' + x[0] + '"' + (S.tab === x[0] ? ' aria-current="page"' : '') + '>' + x[2] + x[1] + '</button>').join('') + '</div></nav>';
  }
  function qrHtml() {
    if (!S.qr) return '<div class="qr-fallback">กำลังโหลด QR…</div>';
    if (window.qrcode) {
      const q = window.qrcode(0, 'M'); q.addData(S.qr.token); q.make();
      return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
    }
    return '<div class="qr-fallback">' + esc(S.qr.token) + '</div>';
  }
  function couponHtml(c, usable) {
    const notYet = usable && c.validFrom && c.validFrom > Date.now();
    const show = usable && !notYet && S.showCode === c.id;
    const head = c.image ? '<img class="cimg" alt="" loading="lazy" src="' + esc(c.image) + '">' : '<div class="tag"><b>' + esc(c.big) + '</b><small>' + esc(c.small) + '</small></div>';
    return '<div class="coupon' + (usable ? '' : ' off') + (c.image ? ' has-img' : '') + '">' + head + '<div class="in"><b>' + esc(c.title) + '</b>' +
      (c.desc ? '<small class="desc">' + esc(c.desc) + '</small>' : '') + '<small>' + esc(c.cond) + '</small>' +
      '<small style="color:' + (usable ? 'var(--ai)' : 'var(--muted)') + ';font-weight:600">' + (c.status === 'used' ? 'ใช้แล้ว ' + (c.usedAt ? date(c.usedAt) : '') : c.status === 'expired' ? 'หมดอายุแล้ว' : notYet ? 'เริ่มใช้ได้ ' + date(c.validFrom) + ' · ' + left(c.expiresAt) : left(c.expiresAt)) + '</small>' +
      (usable && !notYet ? '<button class="btn sm" style="align-self:flex-start;margin-top:6px" data-a="code" data-v="' + c.id + '">' + (show ? 'ซ่อน' : 'ใช้คูปอง') + '</button>' : '') +
      (show ? '<div class="code"><small>ยื่นรหัสนี้หรือ QR สมาชิกให้พนักงาน</small><br><b>' + esc(c.code) + '</b></div>' : '') + '</div></div>';
  }

  function homeView() {
    const m = S.me.member; const b = brand(); const w = S.me.wallets[b.id]; const t = w.tier;
    const pct = t.next ? Math.min(100, Math.round(t.at / t.max * 100)) : 100;
    const ready = S.coupons.filter((c) => c.status === 'ready').sort((x, y) => x.expiresAt - y.expiresAt);
    const canRedeem = S.rewards.filter((r) => r.points_cost <= w.balance).length;
    return (S.joined ? '<div class="card joined" role="status"><b>✅ สมัครเรียบร้อย</b><span>กลับไปหน้าสั่งอาหาร แล้วใส่เบอร์ <b class="num">' + esc(S.joined) + '</b> หรือเลขที่สมาชิกด้านล่าง เพื่อสะสมแต้มบิลนี้</span></div>' : '') +
      '<div class="card idcard"><span class="muted" style="font-size:13px">คุณ' + esc(m.name) + ' · สาขาที่สมัคร ' + esc(branchName(m.homeBranch)) + '</span>' +
      '<span style="font-size:12px;font-weight:600;color:var(--ai)">เลขที่สมาชิก</span><div class="row"><span class="id">' + esc(m.id) + '</span><button class="btn sm" data-a="copy" data-v="' + esc(m.id) + '">คัดลอก</button></div></div>' +
      '<div class="wallet"><div class="row" style="justify-content:flex-start"><span class="tier ' + t.name + '">' + t.name + '</span><small>' + esc(b.short_name) + ' · สมาชิกตั้งแต่ ' + date(m.joinedAt) + '</small></div>' +
      '<div><small>แต้ม ' + esc(b.short_name) + ' ที่ใช้ได้</small><div><span class="pts num">' + fmt(w.balance) + '</span> แต้ม</div></div>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><div class="bar"><i style="width:' + pct + '%"></i></div><div class="row"><small>' + (t.next ? 'อีก ' + fmt(t.need) + ' แต้ม ขึ้นระดับ ' + t.next : 'ระดับสูงสุดแล้ว') + '</small><small class="num">' + fmt(t.max) + '</small></div></div>' +
      (w.nextExpiry ? '<small style="color:#F6C9AF">แต้มชุดแรกจะหมดอายุ ' + date(w.nextExpiry) + '</small>' : '') + '</div>' +
      '<div class="card qr"><b style="font-family:var(--f-display)">ยื่น QR ให้พนักงานสแกนก่อนชำระเงิน</b><div class="qr-img" id="qr-img">' + qrHtml() + '</div>' +
      '<span class="muted" style="letter-spacing:1px">' + esc(m.id) + '</span><span class="muted" style="font-size:12px">QR เปลี่ยนใน <b id="qr-left" class="num">' + qrLeft() + '</b> วินาที เพื่อความปลอดภัย</span>' +
        (S.qr && S.qr.pin ? '<div class="pin"><small>รหัสยืนยันสำหรับสั่งอาหารเอง (ใช้คูปอง/แลกแต้ม)</small><b id="qr-pin" class="num">' + esc(S.qr.pin.slice(0, 3) + ' ' + S.qr.pin.slice(3)) + '</b></div>' : '') + '</div>' +
      '<div class="stats"><button data-a="tab" data-v="history"><b>' + I.receipt + '</b><span>บิลและแต้ม</span></button><button data-a="tab" data-v="coupons"><b style="color:var(--ai)">' + ready.length + '</b><span>คูปองพร้อมใช้</span></button><button data-a="tab" data-v="rewards"><b>' + canRedeem + '</b><span>รางวัลที่แลกได้</span></button></div>' +
      (ready.length ? '<div class="sec"><b>คูปองใกล้หมดอายุ</b><button class="link" data-a="tab" data-v="coupons">ดูทั้งหมด</button></div>' + couponHtml(ready[0], true) : '');
  }
  function qrLeft() { return S.qr ? Math.max(0, S.qr.expiresIn - Math.floor((Date.now() - S.qrAt) / 1000)) : 0; }

  function couponsView() {
    const by = { ready: [], used: [], expired: [] };
    S.coupons.forEach((c) => { (by[c.status] || by.expired).push(c); });
    const list = by[S.couponTab];
    return '<div class="seg">' + [['ready', 'พร้อมใช้ (' + by.ready.length + ')'], ['used', 'ใช้แล้ว'], ['expired', 'หมดอายุ']].map((t) => '<button data-a="ctab" data-v="' + t[0] + '" aria-pressed="' + (S.couponTab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' +
      '<div class="row2"><div class="field"><label for="code">กรอกโค้ดคูปอง</label><input id="code" data-m="code" value="' + esc(S.code) + '" autocapitalize="characters" autocomplete="off"></div><button class="btn" data-a="claim">เพิ่ม</button></div>' +
      (list.length ? list.map((c) => couponHtml(c, S.couponTab === 'ready')).join('') : '<div class="empty">ไม่มีคูปองในหมวดนี้</div>');
  }
  function rewardsView() {
    const b = brand(); const bal = S.me.wallets[b.id].balance;
    const cats = [['all', 'ทั้งหมด'], ['food', 'อาหาร'], ['side', 'ทานเล่น'], ['drink', 'เครื่องดื่ม'], ['discount', 'ส่วนลด']].filter((c) => c[0] === 'all' || S.rewards.some((r) => r.category === c[0]));
    const list = S.rewards.filter((r) => S.rcat === 'all' || r.category === S.rcat);
    return '<div class="hero row"><span><span style="font-size:13px">แต้ม ' + esc(b.short_name) + ' ที่ใช้ได้</span><b class="num">' + fmt(bal) + ' แต้ม</b></span>' + (b.baht_per_unit ? '<span style="font-size:12px;text-align:right">ทุก ' + fmt(b.baht_per_unit) + ' บาท<br>= ' + b.points_per_unit + ' แต้ม</span>' : '') + '</div>' +
      (cats.length > 2 ? '<div class="seg">' + cats.map((c) => '<button data-a="rcat" data-v="' + c[0] + '" aria-pressed="' + (S.rcat === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' : '') +
      (list.length ? '<div class="rgrid">' + list.map((r) => {
        const lack = r.points_cost - bal; const out = r.stock !== null && r.stock <= 0;
        return '<div class="reward"><div class="art">' + esc(r.name) + '</div><div class="in"><b style="font-size:14px">' + esc(r.name) + '</b><span class="c num">' + fmt(r.points_cost) + ' แต้ม</span>' +
          '<button class="btn sm" style="margin-top:auto" data-a="pick" data-v="' + r.id + '"' + (lack > 0 || out ? ' disabled' : '') + '>' + (out ? 'หมดแล้ว' : lack > 0 ? 'ขาดอีก ' + fmt(lack) : 'แลกเลย') + '</button></div></div>';
      }).join('') + '</div>' : '<div class="empty">ยังไม่มีของรางวัล</div>') +
      '<p class="muted" style="font-size:12px;margin:0">แลกแล้วได้เป็นคูปอง ใช้ได้ภายใน 30 วัน</p>';
  }
  function historyView() {
    const body = S.hist === 'bills'
      ? (S.bills.length ? S.bills.map((x) => {
        const open = S.openBill === x.pos_bill_id;
        return '<div class="card"><button style="all:unset;cursor:pointer" data-a="bill" data-v="' + esc(x.pos_bill_id) + '" aria-expanded="' + open + '"><div class="row"><span><b>' + date(x.paid_at) + '</b><br><small class="muted">' + esc(branchName(x.branch_id)) + ' · ' + x.items.length + ' รายการ</small></span>' +
          '<span style="text-align:right"><b class="num">' + baht(x.total) + ' ฿</b><br><small class="' + (x.status === 'refunded' ? 'minus' : 'plus') + '">' + (x.status === 'refunded' ? 'คืนเงินแล้ว' : '+' + fmt(x.points_earned) + ' แต้ม') + '</small></span></div></button>' +
          (open ? '<div style="border-top:1px solid var(--line);padding-top:6px">' + x.items.map((it) => '<div class="kv"><span>' + esc(it.name) + ' x' + it.qty + '</span><span class="num">' + baht(it.price * it.qty) + '</span></div>').join('') +
            (x.discount > 0 ? '<div class="kv"><span>ส่วนลด</span><span class="num">-' + baht(x.discount) + '</span></div>' : '') + '<small class="muted">เลขที่บิล ' + esc(x.pos_bill_id) + '</small>' +
            '<button class="btn ghost sm" style="width:100%;margin-top:6px" data-a="tax" data-v="' + esc(x.pos_bill_id) + '">ขอใบกำกับภาษีเต็มรูป</button></div>' : '') + '</div>';
      }).join('') : '<div class="empty">ยังไม่มีบิลที่ ' + esc(brand().short_name) + '</div>')
      : '<div class="card">' + (S.ledger.length ? S.ledger.map((l) => '<div class="ldg"><span>' + esc(l.note || l.entry_type) + '<br><small class="muted">' + date(l.created_at) + '</small></span><span class="p ' + (l.points >= 0 ? 'plus' : 'minus') + '">' + (l.points >= 0 ? '+' : '') + fmt(l.points) + '</span></div>').join('') : '<div class="empty">ยังไม่มีรายการแต้ม</div>') + '</div>';
    return '<div class="seg"><button data-a="hist" data-v="bills" aria-pressed="' + (S.hist === 'bills') + '">บิล</button><button data-a="hist" data-v="ledger" aria-pressed="' + (S.hist === 'ledger') + '">สมุดแต้ม</button></div>' + body;
  }
  function profileView() {
    const m = S.me.member; const links = S.me.links || [];
    return '<div class="card"><h3>ข้อมูลของฉัน</h3><div class="kv"><span>ชื่อ</span><span>' + esc(m.name) + '</span></div><div class="kv"><span>เบอร์โทร</span><span>***-***-' + esc(String(m.phone).slice(-4)) + '</span></div>' +
      '<div class="kv"><span>สาขาที่สมัคร</span><span>' + esc(branchName(m.homeBranch)) + '</span></div><div class="kv"><span>เลขที่สมาชิก</span><span>' + esc(m.id) + '</span></div></div>' +
      '<div class="card"><h3>รับข่าวสารและโปรโมชั่น</h3><small class="muted">เปิดหรือปิดได้ตลอด</small>' +
      [brand()].map((b) => { const l = links.find((x) => x.brand_id === b.id) || {};
        return '<label class="check" style="padding:10px 0;border-top:1px solid var(--line);align-items:center"><input type="checkbox" data-a="consent" data-v="' + b.id + '"' + (l.marketing_consent ? ' checked' : '') + ' style="accent-color:' + b.theme_color + '"><span style="flex:1"><b>' + esc(b.name) + '</b><br><small class="muted">' + (l.follow_status === 'follow' ? 'เป็นเพื่อนกับ OA แล้ว' : l.follow_status === 'blocked' ? 'บล็อก OA อยู่' : 'ยังไม่ได้เพิ่มเพื่อน OA นี้') + '</small></span></label>'; }).join('') +
      '</div><button class="btn ghost" data-a="tab" data-v="home">กลับไปที่บัตร</button>';
  }
  function registerView() {
    const b = brand(); const r = S.reg;
    if (!r.branchId && b.branches[0]) r.branchId = b.branches[0].id;
    return head('สมัครสมาชิก · ' + b.short_name) + '<main class="body" style="padding-bottom:24px">' +
      '<div class="hero"><b>' + (b.welcome_points > 0 ? 'สมัครวันนี้ รับ ' + fmt(b.welcome_points) + ' แต้มทันที' : 'สมัครสมาชิกฟรี สะสมแต้มทุกบิล') + '</b><span style="font-size:13px">+ คูปองส่วนลดสำหรับสมาชิกใหม่</span></div>' +
      '<div class="field"><label for="r-name">ชื่อ - นามสกุล</label><input id="r-name" data-m="reg.name" value="' + esc(r.name) + '" autocomplete="name"></div>' +
      (S.cfg && S.cfg.requireOtp
        ? '<div class="row2"><div class="field"><label for="r-phone">เบอร์โทรศัพท์</label><input id="r-phone" data-m="reg.phone" inputmode="tel" maxlength="10" value="' + esc(r.phone) + '" autocomplete="tel"></div><button class="btn' + (r.otpSent ? ' ghost' : '') + '" data-a="otp">' + (r.otpSent ? 'ส่งอีกครั้ง' : 'ขอ OTP') + '</button></div>' +
          (r.otpSent ? '<span class="ok">ส่งรหัส OTP ทาง SMS แล้ว</span><div class="field"><label for="r-otp">รหัส OTP 6 หลัก</label><input id="r-otp" data-m="reg.otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code" value="' + esc(r.otp) + '"></div>' : '<span class="muted" style="font-size:13px">เราจะส่งรหัสยืนยันทาง SMS · ถ้าเคยเป็นสมาชิกด้วยเบอร์นี้ ระบบจะใช้บัญชีเดิม</span>')
        : '<div class="field"><label for="r-phone">เบอร์โทรศัพท์</label><input id="r-phone" data-m="reg.phone" inputmode="tel" maxlength="10" value="' + esc(r.phone) + '" autocomplete="tel"></div>') +
      '<div class="row2"><div class="field"><label for="r-bd">วันเกิด (รับคูปองเดือนเกิด)</label><input id="r-bd" type="date" data-m="reg.birthday" value="' + esc(r.birthday) + '"></div></div>' +
      '<div class="field"><label for="r-br">สาขาที่สมัคร</label><select id="r-br" data-m="reg.branchId">' + b.branches.map((x) => '<option value="' + x.id + '"' + (r.branchId === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' +
      '<label class="check"><input type="checkbox" data-m="reg.privacy"' + (r.privacy ? ' checked' : '') + '><span>ยอมรับเงื่อนไขสมาชิกและนโยบายความเป็นส่วนตัวของเครือ</span></label>' +
      '<label class="check"><input type="checkbox" data-m="reg.marketing"' + (r.marketing ? ' checked' : '') + '><span>ยินดีรับข่าวสารและโปรโมชั่นจาก ' + esc(b.name) + ' ทาง LINE</span></label>' +
      (r.err ? '<div class="err" role="alert">' + esc(r.err) + '</div>' : '') +
      '<button class="btn" data-a="register">สมัครสมาชิก</button></main>';
  }

  function render() {
    if (!S.me) return;
    const dev = S.dev ? '<div class="devbar">โหมดทดสอบ: ยังไม่ได้ต่อ LINE Login · ข้อมูลผูกกับเบราว์เซอร์นี้</div>' : '';
    if (!S.me.member) { $app.innerHTML = dev + registerView(); return; }
    const titles = { home: 'บัตรสมาชิก', coupons: 'คูปองของฉัน', rewards: 'แลกแต้ม', history: 'ประวัติ', profile: 'ข้อมูลของฉัน' };
    const views = { home: homeView, coupons: couponsView, rewards: rewardsView, history: historyView, profile: profileView };
    let sheet = '';
    if (S.pick) {
      const r = S.rewards.find((x) => String(x.id) === String(S.pick)); const bal = S.me.wallets[S.brand].balance;
      sheet = '<div class="scrim" data-a="unpick"></div><div class="sheet" role="dialog" aria-label="ยืนยันการแลก"><h3>ยืนยันแลก ' + esc(r.name) + '?</h3><span class="muted">ใช้ ' + fmt(r.points_cost) + ' แต้ม · คงเหลือ ' + fmt(bal - r.points_cost) + ' แต้ม · ได้รับเป็นคูปองใช้ได้ 30 วัน</span>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="btn ghost" data-a="unpick">ยกเลิก</button><button class="btn" data-a="redeem">ยืนยันแลก</button></div></div>';
    }
    $app.innerHTML = dev + head(titles[S.tab] + ' · ' + brand().short_name) + '<main class="body">' + views[S.tab]() + '</main>' + (S.tab !== 'profile' ? nav() : '') + sheet;
  }
  async function refresh() { await loadMe(); await loadTab(); render(); }

  /* ---------- การกด ---------- */
  const A = {
    reload: () => location.reload(),
    close: () => { if (S.inClient && window.liff) window.liff.closeWindow(); else history.back(); },
    tab: async (v) => { S.tab = v; S.pick = null; S.showCode = null; await loadTab(); render(); window.scrollTo(0, 0); },
    copy: (v) => { (navigator.clipboard ? navigator.clipboard.writeText(v) : Promise.reject()).then(() => toast('คัดลอก ' + v + ' แล้ว'), () => toast('เลขสมาชิก ' + v)); },
    code: (v) => { S.showCode = S.showCode === v ? null : v; render(); },
    ctab: (v) => { S.couponTab = v; S.showCode = null; render(); },
    claim: async () => {
      if (S.code.trim().length < 4) return toast('กรอกโค้ดอย่างน้อย 4 ตัวอักษร');
      await api('POST', '/api/liff/coupons/claim', { brand: S.brand, code: S.code.trim() });
      S.code = ''; S.couponTab = 'ready'; toast('เพิ่มคูปองเข้ากระเป๋าแล้ว'); await refresh();
    },
    rcat: (v) => { S.rcat = v; render(); },
    pick: (v) => { S.pick = v; render(); },
    unpick: () => { S.pick = null; render(); },
    redeem: async () => {
      const id = S.pick; S.pick = null;
      const key = 'rdm-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const r = await api('POST', '/api/liff/redemptions', { rewardId: id }, { 'idempotency-key': key });
      S.tab = 'coupons'; S.couponTab = 'ready'; S.showCode = r.couponId; toast('แลกสำเร็จ ได้คูปองแล้ว'); await refresh();
    },
    hist: (v) => { S.hist = v; render(); },
    bill: (v) => { S.openBill = S.openBill === v ? null : v; render(); },
    tax: async (v) => { await api('POST', '/api/liff/tax-invoice-requests', { posBillId: v }); toast('ส่งคำขอใบกำกับภาษีแล้ว พนักงานจะติดต่อกลับ'); },
    consent: async (v, el) => { await api('PATCH', '/api/liff/consents', { brand: v, marketing: el.checked }); toast(el.checked ? 'เปิดรับข่าวสารแล้ว' : 'ปิดรับข่าวสารแล้ว'); await loadMe(); render(); },
    otp: async () => {
      const r = S.reg; r.err = '';
      if (!/^0\d{8,9}$/.test(r.phone)) { r.err = 'กรอกเบอร์โทร 10 หลักที่ขึ้นต้นด้วย 0'; return render(); }
      const res = await api('POST', '/api/liff/otp', { phone: r.phone });
      r.otpSent = true;
      if (res.devCode) { r.otp = res.devCode; toast('โหมดทดสอบ: กรอก OTP ' + res.devCode + ' ให้แล้ว'); }
      render();
    },
    register: async () => {
      const r = S.reg; r.err = '';
      if (!r.name.trim()) r.err = 'กรอกชื่อ - นามสกุล';
      else if (!/^0\d{8,9}$/.test(r.phone)) r.err = 'กรอกเบอร์โทร 10 หลักที่ขึ้นต้นด้วย 0';
      else if (S.cfg.requireOtp && (!r.otpSent || r.otp.length < 4)) r.err = 'กดขอ OTP แล้วกรอกรหัสที่ได้รับ';
      else if (!r.privacy) r.err = 'ต้องยอมรับเงื่อนไขสมาชิกและนโยบายความเป็นส่วนตัวก่อนสมัคร';
      if (r.err) return render();
      try {
        const res = await api('POST', '/api/liff/register', { brand: S.brand, name: r.name.trim(), phone: r.phone, otp: S.cfg.requireOtp ? r.otp : undefined, birthday: r.birthday || null, branchId: r.branchId, marketing: r.marketing, privacy: true });
        toast(res.linked ? 'พบบัญชีเดิมของคุณ ผูกกับ LINE แล้ว' : (res.welcomePoints > 0 ? 'สมัครสำเร็จ รับ ' + fmt(res.welcomePoints) + ' แต้ม' : 'สมัครสำเร็จ'));
        if (S.fromKiosk) S.joined = r.phone;
        S.tab = 'home'; await refresh();
      } catch (e) { r.err = e.message; render(); }
    }
  };

  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled || S.busy) return;
    const fn = A[el.dataset.a]; if (!fn) return;
    S.busy = true;
    try { await fn(el.dataset.v, el); } catch (err) {
      if (err.status === 401) fatal('การเข้าสู่ระบบหมดอายุ', 'ปิดหน้านี้แล้วกดเมนู "สมาชิก" ใน LINE อีกครั้ง', true);
      else { toast(err.message); try { await refresh(); } catch (e2) { /* ignore */ } }
    } finally { S.busy = false; }
  });
  document.addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.m; if (!k) return;
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    if (k === 'code') S.code = val;
    else { const f = k.split('.')[1]; S.reg[f] = (f === 'phone' || f === 'otp') ? String(val).replace(/\D/g, '') : val; }
  });
  document.addEventListener('change', (e) => { if (e.target.dataset && e.target.dataset.m && e.target.tagName === 'SELECT') S.reg.branchId = e.target.value; });

  // นับถอยหลัง QR และขอ QR ใหม่เมื่อหมดเวลา
  setInterval(async () => {
    if (S.tab !== 'home' || !S.me || !S.me.member || document.hidden) return;
    const el = document.getElementById('qr-left'); if (!el) return;
    const l = qrLeft(); el.textContent = l;
    if (l <= 0 && !S.busy) {
      try {
        await loadQr(); const box = document.getElementById('qr-img'); if (box) box.innerHTML = qrHtml();
        const pin = document.getElementById('qr-pin'); if (pin && S.qr.pin) pin.textContent = S.qr.pin.slice(0, 3) + ' ' + S.qr.pin.slice(3);
      } catch (e) { /* ลองใหม่รอบถัดไป */ }
    }
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me && S.me.member) refresh().catch(() => {}); });

  boot();
})();
