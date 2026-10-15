/* มุมมองลูกค้า: แชท LINE OA + Rich Menu + LIFF สมาชิก (ตามแคนวาส HumLai LINE OA CRM แต่รองรับหลายแบรนด์) */
(function () {
  const { R, API } = window.CRM;
  const { esc, fmt, baht, date, left, I, qrSvg, toast, brandVars, logRows } = window.U;

  const ui = {
    brand: 'humlai', screen: 'chat', tab: 'home', menuOpen: true, qrMode: 'qr', couponTab: 'ready', showCode: null,
    pick: null, rcat: 'all', histMode: 'bills', openBill: null, regDone: null,
    reg: { name: '', phone: '', otpSent: false, otp: '', birthday: '', branch: '', privacy: false, mkt: true, err: '' }, code: ''
  };

  function brand() { return R.brands[ui.brand]; }

  /* ---------- chat ---------- */
  function chatMsg(m) {
    const b = brand();
    const ava = '<div class="ava" style="background:' + b.accent + '">' + esc(b.initial) + '</div>';
    if (m.from === 'me') return '<div class="msg me"><div class="bub">' + esc(m.text) + '</div></div>';
    let inner = '';
    if (m.kind === 'text') inner = '<div class="bub">' + esc(m.text) + '</div>';
    if (m.kind === 'welcome') {
      inner = '<div class="flex"><div class="flex-h"><small>สมัครสมาชิกสำเร็จ</small><b>ยินดีต้อนรับ</b></div><div class="flex-b">' +
        '<div class="kv"><span>เลขสมาชิก</span><b>' + esc(m.memberId) + '</b></div>' +
        '<div class="kv"><span>แต้มต้อนรับ</span><b>+' + fmt(m.pts) + ' แต้ม</b></div>' +
        '<div class="kv"><span>คูปอง</span><span>ส่วนลด 10% บิลแรก</span></div></div>' +
        '<div class="flex-f"><button class="fbtn" data-act="c.liff" data-tab="home">ดูบัตรสมาชิก</button></div></div>';
    }
    if (m.kind === 'points') {
      const bill = R.state().bills.find((x) => x.id === m.billId);
      if (!bill) return '';
      const mem = R.member(bill.memberId);
      inner = '<div class="flex"><div class="flex-h"><small>ขอบคุณที่อุดหนุน</small><b>ได้รับ +' + fmt(bill.pts) + ' แต้ม</b></div><div class="flex-b">' +
        '<div class="kv"><span>สมาชิก</span><b>' + esc(mem.id) + '</b></div>' +
        '<div class="kv"><span>สาขา</span><span>' + esc(R.branch(bill.branch).name) + '</span></div>' +
        '<div class="kv"><span>ยอดชำระ</span><b>' + baht(bill.total) + ' บาท</b></div>' +
        (bill.discount ? '<div class="kv"><span>ส่วนลดคูปอง</span><span>-' + baht(bill.discount) + '</span></div>' : '') +
        '<div class="kv" style="border-top:1px solid #EFE4DC;padding-top:6px"><span>แต้ม ' + esc(b.short) + ' คงเหลือ</span><b style="color:' + b.ink + '">' + fmt(m.bal != null ? m.bal : R.balance(mem.id, bill.brand)) + '</b></div></div>' +
        '<div class="flex-f"><button class="fbtn" data-act="c.liff" data-tab="home">ดูบัตรสมาชิก</button><button class="fbtn ghost" data-act="c.liff" data-tab="history">ดูใบเสร็จ / ขอใบกำกับภาษี</button></div></div>';
    }
    if (m.kind === 'promo') {
      inner = '<div class="carousel">' + [['โปรเดือนนี้', '[ชื่อโปรโมชั่น] · ถึง [วันที่]'], ['สมาชิกเท่านั้น', 'แสดงบัตรสมาชิกรับสิทธิ์เพิ่ม']].map((p) =>
        '<div class="flex"><div class="promo-art">' + esc(b.short) + '</div><div class="flex-b"><b>' + esc(p[0]) + '</b><span style="color:#6B5146">' + esc(p[1]) + '</span></div><div class="flex-f"><button class="fbtn" data-act="c.liff" data-tab="rewards">ดูรายละเอียด</button></div></div>').join('') + '</div>';
    }
    if (m.kind === 'branches') {
      inner = '<div class="flex"><div class="flex-h"><small>' + esc(b.name) + '</small><b>สาขา & เวลาเปิด-ปิด</b></div><div class="flex-b">' +
        R.state().branches.filter((x) => x.brand === ui.brand).map((x) =>
          '<div style="display:flex;flex-direction:column;gap:2px;padding:6px 0;border-bottom:1px solid #F0E8E2"><b>' + esc(x.name) + '</b><span style="color:#6B5146">เปิด ' + x.open + ' – ' + x.close + ' · โทร ' + esc(x.phone) + '</span></div>').join('') +
        '</div></div>';
    }
    if (m.kind === 'broadcast') {
      inner = '<div style="display:flex;flex-direction:column;gap:8px"><div class="bub">' + esc(m.text) + '</div>' +
        (m.coupon ? '<div class="flex"><div class="flex-h"><small>คูปองถูกเพิ่มเข้ากระเป๋าแล้ว</small><b>' + esc(m.coupon) + '</b></div><div class="flex-f" style="padding-top:12px"><button class="fbtn" data-act="c.liff" data-tab="coupons">ดูคูปองของฉัน</button></div></div>' : '') + '</div>';
    }
    let quick = '';
    if (m.quick) quick = '<div class="quick">' + m.quick.map((q) => '<button data-act="c.say" data-text="' + esc(q) + '">' + esc(q) + '</button>').join('') + '</div>';
    return '<div class="msg">' + ava + inner + '</div>' + quick;
  }

  function chatScreen() {
    const b = brand();
    const msgs = R.state().chats[ui.brand];
    return '<div class="ph-head"><span class="icon-btn">' + I.back + '</span><div class="t left">' + esc(b.name) + ' <small style="color:#6B7075;font-weight:400">' + esc(b.oa) + '</small></div></div>' +
      '<div class="chat" id="chat-scroll"><div class="day">วันนี้</div>' + msgs.map(chatMsg).join('') + '</div>' +
      (ui.menuOpen ? '<div class="rich">' +
        '<button class="big" data-act="c.liff" data-tab="home"><span class="logo-c">' + esc(b.initial) + '</span><span><b>สมาชิก</b><span style="font-size:12px">บัตร · แต้ม · คูปอง</span></span><span class="pill">เปิดบัตร / สมัคร</span></button>' +
        '<button class="dark" data-act="c.say" data-text="โปรโมชั่น"><span style="color:#F6C9AF">' + I.mega + '</span><b>โปรโมชั่น</b></button>' +
        '<div class="pair"><button class="lite" data-act="c.say" data-text="สาขา"><span style="color:' + b.accent + '">' + I.pin + '</span><b>สาขา<small>เวลาเปิด-ปิด</small></b></button>' +
        '<button class="lite" data-act="c.say" data-text="ติชม"><span style="color:' + b.accent + '">' + I.chat + '</span><b>ติชม<small>ติดต่อร้าน</small></b></button></div>' +
        '</div>' : '') +
      '<button class="menu-toggle" data-act="c.menu" aria-expanded="' + ui.menuOpen + '">เมนู ' + (ui.menuOpen ? '▾' : '▴') + '</button>';
  }

  /* ---------- LIFF ---------- */
  function liffHead(title) {
    return '<div class="ph-head"><button class="icon-btn" data-act="c.chat" aria-label="ปิด กลับไปแชท">' + I.close + '</button><div class="t">' + esc(title) + '</div>' +
      (R.demoMember() ? '<button class="icon-btn" data-act="c.tab" data-tab="profile" aria-label="ข้อมูลส่วนตัวและความยินยอม">' + I.user + '</button>' : '<span class="icon-btn"></span>') + '</div>';
  }
  function brandSwitch(m) {
    return '<div class="bswitch" role="group" aria-label="เลือกแบรนด์">' + R.brandIds.map((id) => {
      const b = R.brands[id];
      return '<button data-act="c.brand" data-brand="' + id + '" aria-pressed="' + (id === ui.brand) + '" style="' + (id === ui.brand ? 'background:' + b.accent + ';border-color:' + b.accent : '') + '"><b>' + esc(b.short) + '</b><span>' + fmt(R.balance(m.id, id)) + ' แต้ม</span></button>';
    }).join('') + '</div>';
  }
  function bnav() {
    const t = [['home', 'บัตร', I.card], ['coupons', 'คูปอง', I.ticket], ['rewards', 'แลกแต้ม', I.gift], ['history', 'ประวัติ', I.receipt]];
    return '<nav class="bnav" aria-label="เมนูสมาชิก">' + t.map((x) => '<button data-act="c.tab" data-tab="' + x[0] + '"' + (ui.tab === x[0] ? ' aria-current="page"' : '') + '>' + x[2] + x[1] + '</button>').join('') + '</nav>';
  }

  function couponHtml(c, usable) {
    const showing = usable && ui.showCode === c.id;
    return '<div class="coupon' + (usable ? '' : ' off') + '"><div class="tag"><b>' + esc(c.big) + '</b><small>' + esc(c.small) + '</small></div><div class="body"><b>' + esc(c.title) + '</b><small>' + esc(c.cond) + '</small>' +
      '<small style="color:' + (usable ? 'var(--ai)' : '#6B5146') + ';font-weight:600">' + (c.status === 'used' ? 'ใช้แล้วที่ ' + esc(R.branch(c.usedBranch) ? R.branch(c.usedBranch).name : '-') : c.status === 'expired' ? 'หมดอายุ ' + date(c.expiresAt) : left(c.expiresAt)) + '</small>' +
      (usable ? '<button class="rbtn" style="align-self:flex-start;padding:0 14px;margin-top:6px" data-act="c.code" data-id="' + c.id + '">' + (showing ? 'ซ่อน' : 'ใช้คูปอง') + '</button>' : '') +
      (showing ? '<div class="coupon-code" style="margin-top:6px"><small>ยื่นรหัสนี้ หรือ QR สมาชิกให้พนักงาน</small><br><b>' + esc(c.code) + '</b><br><small>POS ตรวจสถานะกับ Server ทุกครั้ง ใช้ซ้ำไม่ได้</small></div>' : '') +
      '</div></div>';
  }

  function homeTab(m) {
    const b = brand(); const bal = R.balance(m.id, ui.brand); const tier = R.tier(m.id, ui.brand);
    const qr = R.qrToken(m.id);
    const cps = R.coupons(m.id, ui.brand).filter((c) => c.status === 'ready').sort((a, c) => a.expiresAt - c.expiresAt);
    const rewardsOk = R.state().rewards.filter((r) => r.brand === ui.brand && r.active && r.cost <= bal).length;
    const visits = R.bills(m.id, ui.brand).filter((x) => x.status === 'paid').length;
    const pct = tier.next ? Math.min(100, Math.round(tier.at / tier.max * 100)) : 100;
    return '<div class="liff-body">' +
      '<div class="card-id"><span style="font-size:13px;color:#6B5146">คุณ' + esc(m.name) + ' · สาขาประจำ ' + esc(R.branch(m.homeBranch) ? R.branch(m.homeBranch).name : '-') + '</span>' +
      '<span style="font-size:12px;font-weight:600;color:var(--ai)">เลขที่สมาชิก · ใช้ได้ทุกแบรนด์ในเครือ</span>' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span class="id">' + esc(m.id) + '</span><button class="rbtn" style="padding:0 12px;margin:0" data-act="c.copy" data-text="' + esc(m.id) + '">คัดลอก</button></div></div>' +
      '<div class="wallet"><div style="display:flex;justify-content:space-between;align-items:center"><span style="display:flex;gap:8px;align-items:center"><span class="tier ' + tier.name + '">' + tier.name + '</span><span style="font-size:12px;color:#DCE3E5">' + esc(b.short) + ' · สมาชิกตั้งแต่ ' + date(m.joinedAt) + '</span></span></div>' +
      '<div><div style="font-size:13px;color:#DCE3E5">แต้ม ' + esc(b.short) + ' ที่ใช้ได้</div><div style="display:flex;align-items:baseline;gap:6px"><span style="font-family:var(--f-display);font-weight:700;font-size:42px;line-height:1.1" class="num">' + fmt(bal) + '</span><span>แต้ม</span></div></div>' +
      '<div style="display:flex;flex-direction:column;gap:6px"><div class="bar"><i style="width:' + pct + '%"></i></div><div style="display:flex;justify-content:space-between;font-size:12px;color:#DCE3E5"><span>' + (tier.next ? 'อีก ' + fmt(tier.need) + ' แต้ม ขึ้นระดับ ' + tier.next : 'ระดับสูงสุดแล้ว') + '</span><span>' + fmt(tier.max) + '</span></div></div>' +
      '<div style="font-size:12px;color:#F6C9AF">แต้มมีอายุ ' + R.state().rules[ui.brand].expiryMonths + ' เดือนนับจากวันที่ได้รับ</div></div>' +
      '<div class="qr-box"><b style="font-family:var(--f-display)">ยื่น QR ให้พนักงานสแกนก่อนชำระเงิน</b>' +
      '<div class="seg"><button data-act="c.qr" data-mode="qr" aria-pressed="' + (ui.qrMode === 'qr') + '">QR Code</button><button data-act="c.qr" data-mode="bar" aria-pressed="' + (ui.qrMode === 'bar') + '">บาร์โค้ด</button></div>' +
      '<div id="qr-img">' + (ui.qrMode === 'qr' ? qrSvg(qr.token, 172, 'QR สมาชิก ' + m.id) : barcode(m.id)) + '</div>' +
      '<div style="font-size:13px;color:#6B5146;letter-spacing:1px">' + esc(m.id) + ' · ' + esc(window.CRM.mask(m.phone)) + '</div>' +
      '<div style="font-size:12px;color:#6B5146">QR เปลี่ยนใน <b id="qr-left" class="num">' + qr.left + '</b> วินาที เพื่อความปลอดภัย</div></div>' +
      '<div class="allw"><div style="font-weight:600;font-size:13px">แต้มแยกตามแบรนด์ (ใช้ข้ามแบรนด์ไม่ได้)</div>' + R.brandIds.map((id) => {
        const x = R.brands[id];
        return '<div class="row"><span class="sw" style="background:' + x.accent + '"></span>' + esc(x.name) + '<b class="num">' + fmt(R.balance(m.id, id)) + '</b></div>';
      }).join('') + '</div>' +
      '<div class="stats3"><button data-act="c.tab" data-tab="history"><b>' + visits + '</b><span>ครั้งที่มาทาน</span></button><button data-act="c.tab" data-tab="coupons"><b style="color:var(--ai)">' + cps.length + '</b><span>คูปองพร้อมใช้</span></button><button data-act="c.tab" data-tab="rewards"><b>' + rewardsOk + '</b><span>รางวัลที่แลกได้</span></button></div>' +
      (cps.length ? '<div class="sec-t"><b>คูปองใกล้หมดอายุ</b><button class="link" data-act="c.tab" data-tab="coupons">ดูทั้งหมด</button></div>' + couponHtml(cps[0], true) : '') +
      '</div>';
  }
  function barcode(id) {
    let d = ''; let x = 0; const s = id.replace(/\D/g, '') + '7319';
    for (let i = 0; i < s.length * 2 && x < 68; i++) { const w = 1 + (Number(s[i % s.length]) % 3); d += 'M' + x + ' 0h' + w + 'v24h-' + w + 'z'; x += w + 1 + (i % 2); }
    return '<svg width="270" height="92" viewBox="0 0 70 24" role="img" aria-label="บาร์โค้ด ' + esc(id) + '"><rect width="70" height="24" fill="#fff"/><path fill="#22282B" d="' + d + '"/></svg>';
  }

  function rewardsTab(m) {
    const bal = R.balance(m.id, ui.brand); const rule = R.state().rules[ui.brand];
    const cats = [['all', 'ทั้งหมด'], ['food', 'อาหาร'], ['side', 'ของทานเล่น'], ['drink', 'เครื่องดื่ม'], ['discount', 'ส่วนลด']];
    const list = R.state().rewards.filter((r) => r.brand === ui.brand && r.active && (ui.rcat === 'all' || r.cat === ui.rcat));
    return '<div class="liff-body"><div class="hero-reg" style="display:flex;justify-content:space-between;align-items:center"><span><span style="font-size:13px">แต้ม ' + esc(brand().short) + ' ที่ใช้ได้</span><b class="num">' + fmt(bal) + ' แต้ม</b></span><span style="font-size:12px;text-align:right">ทุก ' + rule.baht + ' บาท<br>= ' + rule.pts + ' แต้ม</span></div>' +
      '<div class="seg" style="align-self:flex-start;flex-wrap:wrap">' + cats.map((c) => '<button data-act="c.rcat" data-cat="' + c[0] + '" aria-pressed="' + (ui.rcat === c[0]) + '">' + c[1] + '</button>').join('') + '</div>' +
      (list.length ? '<div class="rgrid">' + list.map((r) => {
        const lock = r.cost > bal;
        return '<div class="reward"><div class="art">' + esc(r.name) + '</div><div class="in"><b>' + esc(r.name) + '</b><span class="c num">' + fmt(r.cost) + ' แต้ม</span><span style="font-size:11px;color:#6B5146">เหลือ ' + fmt(r.stock) + ' สิทธิ์</span>' +
          '<button class="rbtn" data-act="c.pick" data-id="' + r.id + '"' + (lock || r.stock <= 0 ? ' disabled' : '') + '>' + (lock ? 'ขาดอีก ' + fmt(r.cost - bal) : r.stock <= 0 ? 'หมดแล้ว' : 'แลกเลย') + '</button></div></div>';
      }).join('') + '</div>' : '<div class="empty">ยังไม่มีรางวัลในหมวดนี้</div>') +
      '<p style="font-size:12px;color:#6B5146;margin:0">แลกแล้วได้เป็นคูปอง เก็บไว้ใช้ภายใน 30 วัน · แลกได้เฉพาะแต้มของแบรนด์นี้</p></div>';
  }
  function couponsTab(m) {
    const all = R.coupons(m.id, ui.brand);
    const by = { ready: all.filter((c) => c.status === 'ready'), used: all.filter((c) => c.status === 'used'), expired: all.filter((c) => c.status === 'expired') };
    const list = by[ui.couponTab];
    return '<div class="liff-body"><div class="seg" style="align-self:stretch;justify-content:space-between">' +
      [['ready', 'พร้อมใช้ (' + by.ready.length + ')'], ['used', 'ใช้แล้ว'], ['expired', 'หมดอายุ']].map((t) => '<button style="flex:1" data-act="c.ctab" data-t="' + t[0] + '" aria-pressed="' + (ui.couponTab === t[0]) + '">' + t[1] + '</button>').join('') + '</div>' +
      '<div class="row2"><div class="field"><label for="c-code">กรอกโค้ดคูปอง</label><input id="c-code" data-model="code" value="' + esc(ui.code) + '" placeholder="เช่น NEWMENU"></div><button class="pbtn" style="min-height:44px;padding:0 16px" data-act="c.addcode">เพิ่ม</button></div>' +
      (list.length ? list.sort((a, b) => a.expiresAt - b.expiresAt).map((c) => couponHtml(c, ui.couponTab === 'ready')).join('') : '<div class="empty">ไม่มีคูปองในหมวดนี้</div>') +
      '<p style="font-size:12px;color:#6B5146;margin:0">เห็นเฉพาะคูปองของ ' + esc(brand().name) + ' · สลับแบรนด์ด้านบนเพื่อดูของร้านอื่น</p></div>';
  }
  function historyTab(m) {
    const bills = R.bills(m.id, ui.brand);
    const yr = new Date().getFullYear();
    const spend = bills.filter((x) => x.status === 'paid' && new Date(x.at).getFullYear() === yr).reduce((s, x) => s + x.total, 0);
    const led = R.state().ledger.filter((l) => l.memberId === m.id && l.brand === ui.brand).slice().reverse();
    const earned = led.filter((l) => l.pts > 0 && new Date(l.at).getFullYear() === yr).reduce((s, l) => s + l.pts, 0);
    let body = '';
    if (ui.histMode === 'bills') {
      body = bills.length ? bills.map((x) => {
        const open = ui.openBill === x.id;
        return '<div class="order"><button style="all:unset;cursor:pointer;display:flex;justify-content:space-between;gap:8px" data-act="c.bill" data-id="' + x.id + '" aria-expanded="' + open + '"><span><b>' + date(x.at) + '</b><br><span style="font-size:12px;color:#6B5146">' + esc(R.branch(x.branch).name) + ' · ' + x.items.length + ' รายการ</span></span><span style="text-align:right"><b class="num">' + baht(x.total) + ' ฿</b><br><span style="font-size:12px;color:' + (x.status === 'refunded' ? '#B42318' : '#2F7D4F') + '">' + (x.status === 'refunded' ? 'คืนเงินแล้ว' : '+' + x.pts + ' แต้ม') + '</span></span></button>' +
          (open ? '<div style="font-size:13px;border-top:1px solid #F0E8E2;padding-top:6px">' + x.items.map((it) => '<div class="kv"><span>' + esc(it.name) + ' x' + it.qty + '</span><span class="num">' + baht(it.price * it.qty) + '</span></div>').join('') +
            (x.discount ? '<div class="kv"><span>ส่วนลดคูปอง</span><span>-' + baht(x.discount) + '</span></div>' : '') + '<div style="font-size:12px;color:#6B5146;margin-top:4px">เลขที่บิล ' + esc(x.id) + '</div>' +
            '<button class="pbtn ghost" style="min-height:40px;margin-top:6px;width:100%" data-act="c.tax">ขอใบกำกับภาษีเต็มรูป</button></div>' : '') + '</div>';
      }).join('') : '<div class="empty">ยังไม่มีบิลที่ ' + esc(brand().short) + '</div>';
    } else {
      body = '<div style="background:#fff;border:1px solid #EDE5DF;border-radius:14px;padding:4px 12px">' + (led.length ? led.map((l) => '<div class="ldg"><span>' + esc(l.note) + '<br><small style="color:#6B5146">' + date(l.at) + '</small></span><span class="p ' + (l.pts >= 0 ? 'plus' : 'minus') + '">' + (l.pts >= 0 ? '+' : '') + fmt(l.pts) + '</span></div>').join('') : '<div class="empty">ยังไม่มีรายการแต้ม</div>') + '</div>';
    }
    return '<div class="liff-body"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="order"><span style="font-size:12px;color:#6B5146">ยอดใช้จ่ายปีนี้</span><b class="num" style="font-family:var(--f-display);font-size:18px">' + fmt(spend) + ' บาท</b></div><div class="order"><span style="font-size:12px;color:#6B5146">แต้มที่ได้ปีนี้</span><b class="num" style="font-family:var(--f-display);font-size:18px;color:#2F7D4F">+' + fmt(earned) + '</b></div></div>' +
      '<div class="seg" style="align-self:flex-start"><button data-act="c.hmode" data-m="bills" aria-pressed="' + (ui.histMode === 'bills') + '">บิล</button><button data-act="c.hmode" data-m="ledger" aria-pressed="' + (ui.histMode === 'ledger') + '">สมุดแต้ม</button></div>' + body + '</div>';
  }
  function profileTab(m) {
    return '<div class="liff-body"><div class="order"><b style="font-family:var(--f-display);font-size:17px">ข้อมูลส่วนตัว</b>' +
      '<div class="kv"><span>ชื่อ</span><span>' + esc(m.name) + '</span></div><div class="kv"><span>เบอร์โทร</span><span>' + esc(window.CRM.mask(m.phone)) + '</span></div>' +
      '<div class="kv"><span>วันเกิด</span><span>' + esc(m.birthday || '-') + '</span></div><div class="kv"><span>สาขาประจำ</span><span>' + esc(R.branch(m.homeBranch) ? R.branch(m.homeBranch).name : '-') + '</span></div>' +
      '<div class="kv"><span>สมัครผ่าน</span><span>OA ' + esc(R.brands[m.joinedBrand].short) + '</span></div></div>' +
      '<div class="order"><b style="font-family:var(--f-display);font-size:17px">รับข่าวสารแยกตามแบรนด์</b><span style="font-size:12px;color:#6B5146">เลือกได้ว่าอยากรับโปรจากร้านไหน (PDPA) · ข้อมูลสมาชิกใช้ร่วมกันทั้งเครือตามนโยบายความเป็นส่วนตัว</span>' +
      R.brandIds.map((id) => { const b = R.brands[id]; const f = m.follow[id];
        return '<label class="check" style="padding:8px 0;border-top:1px solid #F0E8E2;align-items:center"><input type="checkbox" data-act="c.consent" data-brand="' + id + '"' + (m.consent.mkt[id] ? ' checked' : '') + ' style="accent-color:' + b.accent + '"><span style="flex:1"><b>' + esc(b.name) + '</b><br><small style="color:#6B5146">' + (f === 'follow' ? 'เป็นเพื่อนกับ OA แล้ว' : f === 'blocked' ? 'บล็อก OA อยู่ (ไม่ส่งข้อความ)' : 'ยังไม่ได้เพิ่มเพื่อน OA นี้') + '</small></span></label>'; }).join('') +
      '</div><button class="pbtn ghost" data-act="c.tab" data-tab="home">กลับไปที่บัตร</button></div>';
  }

  function registerScreen() {
    const b = brand(); const r = ui.reg; const rule = R.state().rules[ui.brand];
    if (ui.regDone) {
      const m = R.member(ui.regDone.id);
      return '<div class="liff-body" style="align-items:center;text-align:center;padding-top:40px"><div class="ava" style="background:' + b.accent + ';width:72px;height:72px;border-radius:36px;font-size:30px">✓</div>' +
        '<h2 style="font-size:22px">' + (ui.regDone.linked ? 'ผูกบัญชีสมาชิกเดิมแล้ว' : 'สมัครสมาชิกสำเร็จ') + '</h2><div style="color:#6B5146">เลขที่สมาชิกของคุณ</div><div class="card-id" style="align-self:stretch"><span class="id">' + esc(m.id) + '</span></div>' +
        '<div style="color:#6B5146;font-size:14px">' + (ui.regDone.linked ? 'ระบบพบบัญชีจากเบอร์ที่ยืนยันด้วย OTP แต้มและคูปองเดิมยังอยู่ครบ' : 'ได้รับ ' + rule.welcome + ' แต้มต้อนรับ ' + esc(b.short) + ' + คูปองบิลแรกแล้ว') + '<br>เลขนี้ใช้ได้ทุกแบรนด์ในเครือ</div>' +
        '<button class="pbtn" style="align-self:stretch" data-act="c.regdone">ไปที่บัตรสมาชิก</button></div>';
    }
    const brs = R.state().branches.filter((x) => x.brand === ui.brand);
    return '<div class="liff-body"><div class="hero-reg"><b>สมัครวันนี้ รับ ' + rule.welcome + ' แต้มทันที</b><span style="font-size:13px">+ คูปองส่วนลด 10% บิลแรก · สมัครครั้งเดียวใช้ได้ทุกแบรนด์ในเครือ</span></div>' +
      '<div class="order" style="flex-direction:row;align-items:center;gap:10px"><div class="ava" style="background:#06C755">L</div><span style="font-size:13px"><b>เชื่อมกับบัญชี LINE แล้ว</b><br><span style="color:#6B5146">' + esc(R.state().demo.displayName) + ' (LINE Login)</span></span></div>' +
      '<div class="field"><label for="r-name">ชื่อ - นามสกุล</label><input id="r-name" data-model="reg.name" value="' + esc(r.name) + '" autocomplete="name"></div>' +
      '<div class="row2"><div class="field"><label for="r-phone">เบอร์โทรศัพท์</label><input id="r-phone" data-model="reg.phone" inputmode="tel" maxlength="10" value="' + esc(r.phone) + '" placeholder="0812345678"></div><button class="pbtn' + (r.otpSent ? ' ghost' : '') + '" style="min-height:44px;padding:0 14px" data-act="c.otp">' + (r.otpSent ? 'ส่งอีกครั้ง' : 'ขอ OTP') + '</button></div>' +
      '<span class="' + (r.otpSent ? 'ok' : 'muted') + '" style="font-size:12px;margin-top:-8px">' + (r.otpSent ? 'ส่งรหัส OTP แล้ว (เดโม: ใส่เลขอะไรก็ได้ 4–6 หลัก)' : 'ลองใส่ 0812345678 เพื่อดูกรณีลูกค้ามีบัญชีเดิมอยู่แล้ว') + '</span>' +
      (r.otpSent ? '<div class="field"><label for="r-otp">รหัส OTP</label><input id="r-otp" data-model="reg.otp" inputmode="numeric" maxlength="6" value="' + esc(r.otp) + '"></div>' : '') +
      '<div class="row2"><div class="field"><label for="r-bd">วันเกิด</label><input id="r-bd" type="date" data-model="reg.birthday" value="' + esc(r.birthday) + '"></div><div class="field"><label for="r-br">สาขาประจำ</label><select id="r-br" data-model="reg.branch">' + brs.map((x) => '<option value="' + x.id + '"' + (r.branch === x.id ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div></div>' +
      '<label class="check"><input type="checkbox" data-model="reg.privacy"' + (r.privacy ? ' checked' : '') + '><span>ยอมรับ <u>เงื่อนไขสมาชิก</u> และ <u>นโยบายความเป็นส่วนตัว (PDPA)</u> ของเครือ</span></label>' +
      '<label class="check"><input type="checkbox" data-model="reg.mkt"' + (r.mkt ? ' checked' : '') + '><span>ยินดีรับข่าวสารและโปรโมชั่นจาก ' + esc(b.name) + ' ทาง LINE</span></label>' +
      (r.err ? '<div class="err">' + esc(r.err) + '</div>' : '') +
      '<button class="pbtn" data-act="c.register">สมัครสมาชิก</button>' +
      '<span class="muted" style="font-size:12px;text-align:center">กรอกชื่อ เบอร์ ขอ OTP และยอมรับเงื่อนไขก่อนสมัคร</span></div>';
  }

  function liffScreen() {
    const m = R.demoMember();
    if (!m || ui.regDone) return liffHead('สมัครสมาชิก · ' + brand().short) + '<div class="liff">' + registerScreen() + '</div>';
    const titles = { home: 'บัตรสมาชิก', coupons: 'คูปองของฉัน', rewards: 'แลกแต้ม', history: 'ประวัติ', profile: 'ข้อมูลของฉัน' };
    const tabs = { home: homeTab, coupons: couponsTab, rewards: rewardsTab, history: historyTab, profile: profileTab };
    let sheet = '';
    if (ui.pick) {
      const r = R.state().rewards.find((x) => x.id === ui.pick); const bal = R.balance(m.id, ui.brand);
      sheet = '<div class="scrim" data-act="c.unpick"></div><div class="sheet" role="dialog" aria-label="ยืนยันการแลก"><b style="font-family:var(--f-display);font-size:18px">ยืนยันแลก ' + esc(r.name) + '?</b><span style="color:#6B5146;font-size:14px">ใช้ ' + fmt(r.cost) + ' แต้ม · คงเหลือ ' + fmt(bal - r.cost) + ' แต้ม · ได้รับเป็นคูปอง ใช้ได้ 30 วัน</span>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><button class="pbtn ghost" data-act="c.unpick">ยกเลิก</button><button class="pbtn" data-act="c.redeem">ยืนยันแลก</button></div></div>';
    }
    return liffHead(titles[ui.tab] + ' · ' + brand().short) + '<div class="liff">' + (ui.tab !== 'profile' ? brandSwitch(m) : '') + tabs[ui.tab](m) + '</div>' + (ui.tab !== 'profile' ? bnav() : '') + sheet;
  }

  /* ---------- page ---------- */
  function guide() {
    const s = R.state(); const m = R.demoMember();
    const earned = m && s.ledger.some((l) => l.memberId === m.id && l.type === 'earn');
    const redeemed = m && s.ledger.some((l) => l.memberId === m.id && l.type === 'redeem');
    const cross = m && Object.keys(s.demo.followed).length > 1;
    const bc = R.brandIds.some((b) => s.chats[b].some((c) => c.kind === 'broadcast'));
    const steps = [
      [!!s.demo.followed.humlai || Object.keys(s.demo.followed).length > 0, 'เปิดแชท OA แบรนด์ใดก็ได้ (ระบบได้ follow event)'],
      [!!m, 'กด "สมาชิก" ใน Rich Menu แล้วสมัคร'],
      [earned, 'ไปแท็บ "หน้าร้าน POS" สแกน QR แล้วปิดบิล'],
      [redeemed, 'กลับมาแลกแต้มเป็นคูปอง'],
      [cross, 'เปิด OA แบรนด์อื่น ใช้เลขสมาชิกเดิมได้ทันที'],
      [bc, 'แท็บ "หลังบ้าน" ส่งแคมเปญ แล้วดูข้อความเข้าแชท']
    ];
    return '<aside class="panel"><div><div class="eyebrow">ลูกค้าเข้ามาจาก</div><h2>เลือก LINE OA</h2></div><div class="oa-pick">' + R.brandIds.map((id) => {
      const b = R.brands[id];
      return '<button data-act="c.oa" data-brand="' + id + '" aria-pressed="' + (ui.brand === id) + '"><span class="oa-dot" style="background:' + b.accent + '">' + esc(b.initial) + '</span><span><b>' + esc(b.name) + '</b><small>' + esc(b.oa) + ' · ' + esc(b.kind) + (s.demo.followed[id] ? ' · เพื่อนแล้ว' : '') + '</small></span></button>';
    }).join('') + '</div>' +
      '<div><div class="eyebrow">ลองทำตามนี้</div></div><ol class="steps">' + steps.map((x) => '<li class="' + (x[0] ? 'done' : '') + '">' + esc(x[1]) + '</li>').join('') + '</ol>' +
      '<div class="note">ทุก OA อยู่ใน LINE Provider เดียวกัน จึงได้ LINE userId เดียวกัน ระบบรู้ว่าเป็นลูกค้าคนเดิม แต่แต้มแยกกระเป๋าตามแบรนด์</div></aside>';
  }
  function backend() {
    const s = R.state(); const m = R.demoMember();
    return '<section class="panel backend"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px"><div><div class="eyebrow">ระบบหลังบ้านเห็นอะไร</div><h2>API & Webhook สด</h2></div><button class="btn small" data-act="c.clearlog">ล้าง</button></div>' +
      (m ? '<div class="note" style="display:flex;flex-direction:column;gap:4px"><b style="color:var(--ink)">members · ' + esc(m.id) + '</b><span>lineUserId ' + esc(m.lineUserId.slice(0, 14)) + '… · สมัครผ่าน ' + esc(R.brands[m.joinedBrand].short) + '</span><span>wallets: ' + R.brandIds.map((id) => esc(R.brands[id].short) + ' ' + fmt(R.balance(m.id, id))).join(' · ') + '</span></div>' : '<div class="note">ยังไม่มีแถวใน members สำหรับ LINE userId นี้</div>') +
      '<div class="log">' + logRows(s.api, 30) + '</div></section>';
  }

  function render(root) {
    const b = brand();
    root.innerHTML = '<div class="cust">' + guide() + '<div class="phone-col"><div class="phone" style="' + brandVars(b) + '">' + (ui.screen === 'chat' ? chatScreen() : liffScreen()) + '</div></div>' + backend() + '</div>';
    const cs = document.getElementById('chat-scroll'); if (cs) cs.scrollTop = cs.scrollHeight;
  }
  function enter() { API.openOa(ui.brand); }

  function setModel(path, el) {
    const val = el.type === 'checkbox' ? el.checked : el.value;
    if (path === 'code') { ui.code = val; return false; }
    const k = path.split('.')[1]; ui.reg[k] = k === 'phone' || k === 'otp' ? String(val).replace(/\D/g, '') : val; ui.reg.err = '';
    return el.type === 'checkbox' || el.tagName === 'SELECT';
  }

  const act = {
    'c.oa': (el) => { ui.brand = el.dataset.brand; ui.screen = 'chat'; ui.reg.branch = ''; API.openOa(ui.brand); },
    'c.brand': (el) => { ui.brand = el.dataset.brand; ui.showCode = null; API.openOa(ui.brand); API.liffOpen(ui.brand); },
    'c.menu': () => { ui.menuOpen = !ui.menuOpen; },
    'c.say': (el) => API.chat(ui.brand, el.dataset.text),
    'c.liff': (el) => { ui.screen = 'liff'; ui.tab = el.dataset.tab || 'home'; API.liffOpen(ui.brand); },
    'c.chat': () => { ui.screen = 'chat'; ui.pick = null; },
    'c.tab': (el) => { ui.tab = el.dataset.tab; ui.pick = null; },
    'c.qr': (el) => { ui.qrMode = el.dataset.mode; },
    'c.copy': (el) => { const t = el.dataset.text; try { navigator.clipboard.writeText(t).then(() => toast('คัดลอก ' + t + ' แล้ว'), () => toast('เลขสมาชิก ' + t)); } catch (e) { toast('เลขสมาชิก ' + t); } },
    'c.code': (el) => { ui.showCode = ui.showCode === el.dataset.id ? null : el.dataset.id; },
    'c.ctab': (el) => { ui.couponTab = el.dataset.t; ui.showCode = null; },
    'c.addcode': async () => { const r = await API.addCode(R.demoMember().id, ui.brand, ui.code); if (r.ok) { ui.code = ''; ui.couponTab = 'ready'; toast('เพิ่มคูปองเข้ากระเป๋าแล้ว'); } else toast(r.msg); },
    'c.rcat': (el) => { ui.rcat = el.dataset.cat; },
    'c.pick': (el) => { ui.pick = el.dataset.id; },
    'c.unpick': () => { ui.pick = null; },
    'c.redeem': async () => { const r = await API.redeem(R.demoMember().id, ui.pick); ui.pick = null; if (r.ok) { ui.tab = 'coupons'; ui.couponTab = 'ready'; ui.showCode = r.coupon.id; toast('แลกสำเร็จ ได้คูปอง ' + r.coupon.title); } else toast(r.msg); },
    'c.hmode': (el) => { ui.histMode = el.dataset.m; },
    'c.bill': (el) => { ui.openBill = ui.openBill === el.dataset.id ? null : el.dataset.id; },
    'c.tax': () => toast('ส่งคำขอใบกำกับภาษีแล้ว (เดโม) · จริง: ดึงข้อมูลจาก TaxCustomers แล้วส่ง PDF ทางแชท'),
    'c.consent': async (el) => API.setConsent(R.demoMember().id, el.dataset.brand, el.checked),
    'c.otp': async () => { if (!/^0\d{8,9}$/.test(ui.reg.phone)) { ui.reg.err = 'กรอกเบอร์โทร 10 หลักที่ขึ้นต้นด้วย 0'; return; } ui.reg.otpSent = true; const o = await API.sendOtp(ui.reg.phone); if (o && o.devCode) { ui.reg.otp = o.devCode; toast('โหมดทดสอบ: ระบบกรอก OTP ' + o.devCode + ' ให้แล้ว (ใช้จริงจะส่ง SMS)'); } },
    'c.register': async () => {
      const r = ui.reg; const brs = R.state().branches.filter((x) => x.brand === ui.brand);
      if (!r.name.trim()) { r.err = 'กรอกชื่อ - นามสกุล'; return; }
      if (!/^0\d{8,9}$/.test(r.phone)) { r.err = 'กรอกเบอร์โทร 10 หลักที่ขึ้นต้นด้วย 0'; return; }
      if (!r.otpSent || r.otp.length < 4) { r.err = 'กดขอ OTP แล้วใส่รหัสที่ได้รับ'; return; }
      if (!r.privacy) { r.err = 'ต้องยอมรับเงื่อนไขสมาชิกและนโยบายความเป็นส่วนตัวก่อนสมัคร'; return; }
      const res = await API.register(ui.brand, { name: r.name.trim(), phone: r.phone, otp: r.otp, birthday: r.birthday, branch: r.branch || brs[0].id, mkt: r.mkt });
      ui.regDone = { id: res.member.id, linked: res.linked };
    },
    'c.regdone': () => { ui.regDone = null; ui.tab = 'home'; },
    'c.clearlog': () => API.clearLog()
  };

  let lastQr = null;
  // นับถอยหลัง QR ทุกวินาที โดยไม่ render ทั้งหน้า
  setInterval(() => {
    const el = document.getElementById('qr-left'); const m = R.demoMember();
    if (!el || !m) return;
    const q = R.qrToken(m.id); el.textContent = q.left;
    if (q.token !== lastQr && ui.qrMode === 'qr') { lastQr = q.token; const box = document.getElementById('qr-img'); if (box) box.innerHTML = qrSvg(q.token, 172, 'QR สมาชิก ' + m.id); }
  }, 1000);

  window.VIEWS = window.VIEWS || {};
  window.VIEWS.customer = { render, enter, act, setModel, ui };
})();
