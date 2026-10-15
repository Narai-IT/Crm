/* มุมมองหน้าร้าน: เครื่องแคชเชียร์ (สแกน QR สมาชิก ใช้คูปอง ปิดบิล) + Kiosk สั่งเองที่โต๊ะ (ตามแคนวาส OrderMember) */
(function () {
  const { R, API } = window.CRM;
  const { esc, fmt, baht, dt, time, I, toast, brandVars } = window.U;

  const ui = {
    mode: 'cashier', branch: 'HL01', memberId: null, query: '', cart: [], picked: {}, last: null,
    adj: { pts: '', reason: '' },
    k: { step: 'start', dining: 'dine', mode: 'id', input: '', error: false, memberId: null, used: {}, cart: [] }
  };
  const br = () => R.branch(ui.branch);
  const brand = () => R.brands[br().brand];
  const staffName = () => { const s = R.state().staff.find((x) => x.role === 'cashier' && x.scope === ui.branch); return s ? s.name : 'แคชเชียร์ ' + br().name; };

  function cartTotals(cart, couponIds) {
    const subtotal = cart.reduce((s, x) => s + x.price * x.qty, 0);
    let discount = 0;
    couponIds.forEach((id) => { const c = R.state().coupons.find((x) => x.id === id); discount += API.couponDiscount(c, subtotal - discount); });
    const total = Math.max(0, subtotal - discount);
    return { subtotal, discount, total };
  }
  function addItem(cart, id) {
    const it = R.menus[br().brand].find((x) => x.id === id);
    const row = cart.find((x) => x.id === id);
    if (row) row.qty++; else cart.push({ id: it.id, name: it.name, price: it.price, qty: 1 });
  }

  function posStatus(b) {
    if (b.pos === 'online') return '<span class="pill good">POS เชื่อม API</span>';
    if (b.pos === 'delayed') return '<span class="pill warn">POS ส่งข้อมูลล่าช้า · เข้าคิว Retry</span>';
    return '<span class="pill">กรอกบิลมือ (ยังไม่มี API)</span>';
  }

  function cashier() {
    const b = br(); const bd = brand(); const m = ui.memberId ? R.member(ui.memberId) : null;
    const picked = Object.keys(ui.picked).filter((k) => ui.picked[k]);
    const t = cartTotals(ui.cart, picked);
    const rule = R.state().rules[b.brand];
    const base = rule.base === 'gross' ? t.subtotal : rule.base === 'exvat' ? t.total / 1.07 : t.total;
    const ptsPreview = m && b.earn ? R.calcPoints(b.brand, base) : 0;
    const coupons = m ? R.coupons(m.id, b.brand).filter((c) => c.status === 'ready') : [];
    const recent = R.state().bills.filter((x) => x.branch === b.id).slice(-8).reverse();

    const left = '<section class="panel"><div><div class="eyebrow">เครื่อง POS</div><h2>' + esc(b.name) + '</h2></div>' +
      '<div class="ff"><label for="p-branch">สาขา (สิทธิ์ของพนักงานผูกกับสาขา)</label><select id="p-branch" data-pmodel="branch">' +
      R.brandIds.map((id) => '<optgroup label="' + esc(R.brands[id].name) + '">' + R.state().branches.filter((x) => x.brand === id).map((x) => '<option value="' + x.id + '"' + (x.id === ui.branch ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</optgroup>').join('') +
      '</select></div><div class="chips">' + posStatus(b) + (b.earn ? '<span class="pill good">สะสมแต้มเปิด</span>' : '<span class="pill bad">สาขานี้ปิดสะสมแต้ม</span>') + '</div>' +
      '<span class="muted" style="font-size:13px">ผู้ใช้: ' + esc(staffName()) + '</span>' +
      '<hr style="border:0;border-top:1px solid var(--line);margin:0">' +
      '<div><div class="eyebrow">ระบุสมาชิก</div></div>' +
      (m ? '<div class="mcard" style="background:' + bd.accent + '"><span style="font-size:12px;opacity:.9">' + esc(m.name) + ' · ' + R.tier(m.id, b.brand).name + '</span><span class="id">' + esc(m.id) + '</span><span>แต้ม ' + esc(bd.short) + ' คงเหลือ <b class="num">' + fmt(R.balance(m.id, b.brand)) + '</b></span>' +
        '<span style="font-size:12px;opacity:.9">แต้มแบรนด์อื่น: ' + R.brandIds.filter((id) => id !== b.brand).map((id) => esc(R.brands[id].short) + ' ' + fmt(R.balance(m.id, id))).join(' · ') + ' (ใช้ที่นี่ไม่ได้)</span></div>' +
        (coupons.length ? '<div class="eyebrow">คูปองที่ใช้กับบิลนี้ได้</div>' + coupons.map((c) => {
          const ok = t.subtotal >= (c.cp.min || 0);
          return '<label class="cp-pick"><input type="checkbox" data-act="p.cp" data-id="' + c.id + '"' + (ui.picked[c.id] ? ' checked' : '') + (ok ? '' : ' disabled') + '><span style="flex:1;min-width:0"><b>' + esc(c.title) + '</b><br><span class="muted" style="font-size:12px">' + esc(c.code) + ' · ' + (ok ? esc(c.cond) : 'ยอดยังไม่ถึงขั้นต่ำ ' + c.cp.min + ' บาท') + '</span></span></label>';
        }).join('') : '<span class="muted" style="font-size:13px">ไม่มีคูปองของ ' + esc(bd.short) + '</span>') +
        '<button class="btn small" data-act="p.clearm">เปลี่ยนสมาชิก</button>'
        : '<div class="ff"><label for="p-q">เลขสมาชิก / เบอร์โทร / โค้ดจาก QR</label><input id="p-q" data-pmodel="query" value="' + esc(ui.query) + '" placeholder="MB-0012845 หรือ 0812345678"></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="p.find">ค้นหา</button><button class="btn" data-act="p.scan">' + I.scan + ' สแกน QR จากมือถือเดโม</button></div>' +
        '<span class="muted" style="font-size:12px">QR ในมือถือเปลี่ยนทุก 60 วินาที ถ้าใช้โค้ดเก่าระบบจะปฏิเสธ (กันคนส่งภาพ QR ต่อ)</span>') +
      '</section>';

    const center = '<section class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><div><div class="eyebrow">เมนู · ราคาตัวอย่าง</div><h2>' + esc(bd.name) + '</h2></div>' +
      (rule.promo.on ? '<span class="pill warn">แต้ม x' + rule.promo.mult + ' ' + ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'][rule.promo.day] + '</span>' : '') + '</div>' +
      '<div class="menu-grid">' + R.menus[b.brand].map((x) => '<button data-act="p.add" data-id="' + x.id + '" style="border-top:4px solid ' + bd.accent + '"><b>' + esc(x.name) + '</b><span class="num muted">' + baht(x.price) + '</span></button>').join('') + '</div>' +
      '<div><div class="eyebrow" style="margin-bottom:6px">บิลล่าสุดของสาขา</div><div class="tbl-wrap"><table class="t"><thead><tr><th>เวลา</th><th>บิล</th><th>สมาชิก</th><th class="r">ยอด</th><th class="r">แต้ม</th><th></th></tr></thead><tbody>' +
      (recent.length ? recent.map((x) => '<tr><td>' + time(x.at) + '<br><span class="muted" style="font-size:11px">' + dt(x.at).split(' ').slice(0, 2).join(' ') + '</span></td><td class="mono">' + esc(x.id) + '</td><td>' + (x.memberId ? esc(x.memberId) : '<span class="muted">ไม่ใช่สมาชิก</span>') + '</td><td class="r">' + baht(x.total) + '</td><td class="r">' + (x.status === 'refunded' ? '<span class="pill bad">คืนเงิน</span>' : '+' + x.pts) + '</td><td>' + (x.status === 'paid' ? '<button class="btn small danger" data-act="p.refund" data-id="' + x.id + '">คืนเงิน</button>' : '') + '</td></tr>').join('') : '<tr><td colspan="6" class="empty">ยังไม่มีบิล</td></tr>') +
      '</tbody></table></div></div></section>';

    const right = '<section class="panel cart"><div><div class="eyebrow">ตะกร้า</div><h2>บิลใหม่</h2></div>' +
      (ui.cart.length ? ui.cart.map((x) => '<div class="cart-row"><span class="n">' + esc(x.name) + '<br><span class="muted num" style="font-size:12px">' + baht(x.price) + '</span></span><span class="qty"><button data-act="p.dec" data-id="' + x.id + '" aria-label="ลด ' + esc(x.name) + '">−</button><b class="num" style="min-width:20px;text-align:center">' + x.qty + '</b><button data-act="p.add" data-id="' + x.id + '" aria-label="เพิ่ม ' + esc(x.name) + '">+</button></span></div>').join('') : '<div class="empty">แตะเมนูเพื่อเพิ่มรายการ</div>') +
      '<div class="totals"><div class="kv"><span>รวม</span><span class="num">' + baht(t.subtotal) + '</span></div><div class="kv"><span>ส่วนลดคูปอง</span><span class="num">-' + baht(t.discount) + '</span></div>' +
      '<div class="kv" style="align-items:baseline"><span>ยอดชำระ</span><span class="big-total num">' + baht(t.total) + '</span></div>' +
      '<div class="kv"><span>แต้มที่จะได้</span><b class="num">' + (m ? (b.earn ? '+' + fmt(ptsPreview) + ' ' + esc(bd.short) : 'สาขาปิดสะสม') : 'ไม่ระบุสมาชิก') + '</b></div>' +
      '<span class="muted" style="font-size:12px">กฎ ' + esc(bd.short) + ': ทุก ' + rule.baht + ' บาท = ' + rule.pts + ' แต้ม · คิดจาก' + (rule.base === 'gross' ? 'ยอดก่อนส่วนลด' : rule.base === 'exvat' ? 'ยอดหลังส่วนลดไม่รวม VAT' : 'ยอดหลังส่วนลด') + ' · ปัดลง</span></div>' +
      '<button class="btn primary" style="min-height:48px" data-act="p.close"' + (ui.cart.length ? '' : ' disabled') + '>ชำระเงินสำเร็จ · ปิดบิล</button>' +
      (ui.last ? '<div class="note" style="display:flex;flex-direction:column;gap:6px"><b style="color:var(--ink)">ปิดบิล ' + esc(ui.last) + ' แล้ว</b><span>POS ส่ง /pos/transactions พร้อม Idempotency Key = เลขบิล ถ้าเน็ตหลุดแล้วส่งซ้ำ แต้มไม่เพิ่มซ้ำ</span><button class="btn small" data-act="p.retry">ลองส่งบิลนี้ซ้ำ</button></div>' : '') +
      (m ? '<details><summary style="cursor:pointer;font-weight:600">ลูกค้าลืมแจ้งสมาชิก? ขอแต้มย้อนหลัง</summary><div style="display:flex;flex-direction:column;gap:8px;margin-top:8px"><div class="ff"><label for="p-adj">แต้มที่ขอ</label><input id="p-adj" inputmode="numeric" data-pmodel="adj.pts" value="' + esc(ui.adj.pts) + '"></div><div class="ff"><label for="p-adjr">เหตุผล / เลขบิลอ้างอิง</label><input id="p-adjr" data-pmodel="adj.reason" value="' + esc(ui.adj.reason) + '"></div><button class="btn" data-act="p.adj">ส่งให้ผู้จัดการอนุมัติ</button><span class="muted" style="font-size:12px">ขอย้อนหลังได้ ' + rule.backdays + ' วัน · ทุกคำขอเข้า Audit Log</span></div></details>' : '') +
      '</section>';
    return '<div class="pos">' + left + center + right + '</div>';
  }

  /* ---------- kiosk ---------- */
  function kiosk() {
    const k = ui.k; const b = br(); const bd = brand();
    const head = '<div class="ph-head" style="background:#fff"><button class="icon-btn" data-act="k.restart" aria-label="เริ่มใหม่">' + I.back + '</button><div class="t">' + esc(bd.name) + ' · โต๊ะ 7</div><span class="icon-btn"></span></div>';
    let body = '';
    if (k.step === 'start') {
      body = '<div class="liff-body" style="padding-top:28px"><h2 style="font-size:24px">สั่งอาหารด้วยตนเอง</h2><p class="muted" style="margin:0">ทานที่ร้าน หรือ ห่อกลับบ้าน? ราคาในเมนูจะแสดงตามที่เลือก</p>' +
        '<button class="pbtn" style="min-height:72px;font-size:18px" data-act="k.dining" data-d="dine">ทานที่ร้าน</button><button class="pbtn ghost" style="min-height:72px;font-size:18px" data-act="k.dining" data-d="take">ห่อกลับบ้าน</button></div>';
    } else if (k.step === 'member') {
      const max = k.mode === 'id' ? 7 : 10;
      const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'ล้าง', '0', '⌫'];
      body = '<div class="liff-body"><div style="display:flex;justify-content:space-between;align-items:center"><span class="pill">' + (k.dining === 'dine' ? 'ทานที่ร้าน' : 'ห่อกลับบ้าน') + '</span><button class="link" data-act="k.skip">ข้าม</button></div>' +
        '<h2 style="font-size:22px">เป็นสมาชิกไหม?</h2><p class="muted" style="margin:0;font-size:13px">ใส่เลขสมาชิกหรือเบอร์โทร เพื่อสะสมแต้มและใช้คูปองกับบิลนี้ · ใช้เลขเดียวกันได้ทุกแบรนด์</p>' +
        '<div class="seg" style="align-self:flex-start"><button data-act="k.mode" data-m="id" aria-pressed="' + (k.mode === 'id') + '">เลขสมาชิก</button><button data-act="k.mode" data-m="phone" aria-pressed="' + (k.mode === 'phone') + '">เบอร์โทร</button></div>' +
        '<div class="kbox' + (k.error ? ' bad' : '') + '"><span class="muted">' + (k.mode === 'id' ? 'MB-' : '') + '</span>' + esc(k.input) + '<span style="color:#CDBFB5">' + '•'.repeat(Math.max(0, max - k.input.length)) + '</span></div>' +
        (k.error ? '<div class="err">ไม่พบสมาชิกนี้ ลองตรวจเลขอีกครั้ง หรือกดข้าม</div>' : '') +
        '<div class="keypad">' + keys.map((x) => '<button data-act="k.key" data-k="' + x + '" aria-label="' + (x === '⌫' ? 'ลบตัวสุดท้าย' : x) + '">' + x + '</button>').join('') + '</div>' +
        '<button class="pbtn" data-act="k.lookup"' + (k.input.length === max ? '' : ' disabled') + '>ยืนยัน</button>' +
        '<span class="muted" style="font-size:12px;text-align:center">ลองเล่น: เลขสมาชิก 0012845 หรือเบอร์ 0812345678</span></div>';
    } else if (k.step === 'found') {
      const m = R.member(k.memberId);
      const cps = R.coupons(m.id, b.brand).filter((c) => c.status === 'ready');
      body = '<div class="liff-body"><h2 style="font-size:22px">สวัสดี คุณ' + esc(m.name) + '</h2><p class="muted" style="margin:0">ใช่คุณใช่ไหม? ตรวจสอบก่อนสั่ง</p>' +
        '<div class="card-id"><span style="font-size:12px;color:var(--ai);font-weight:600">เลขที่สมาชิก</span><span class="id">' + esc(m.id) + '</span><span style="font-size:13px"><span class="tier ' + R.tier(m.id, b.brand).name + '">' + R.tier(m.id, b.brand).name + '</span> ' + fmt(R.balance(m.id, b.brand)) + ' แต้ม ' + esc(bd.short) + ' · บิลนี้สะสมแต้มอัตโนมัติ</span></div>' +
        (cps.length ? '<b>คูปองที่ใช้กับบิลนี้ได้</b>' + cps.map((c) => '<label class="check" style="border:1px solid #EDE5DF;border-radius:12px;padding:10px;background:#fff"><input type="checkbox" data-act="k.cp" data-id="' + c.id + '"' + (k.used[c.id] ? ' checked' : '') + '><span><b>' + esc(c.title) + '</b><br><small class="muted">' + esc(c.cond) + '</small></span></label>').join('') : '') +
        '<button class="pbtn" data-act="k.menu">ไปเลือกเมนู</button><button class="pbtn ghost" data-act="k.notme">ไม่ใช่ฉัน ใส่เลขใหม่</button></div>';
    } else if (k.step === 'menu' || k.step === 'done') {
      const used = Object.keys(k.used).filter((x) => k.used[x]);
      const t = cartTotals(k.cart, k.memberId ? used : []);
      body = '<div class="liff-body">' + (k.memberId ? '<div class="order" style="flex-direction:row;justify-content:space-between;align-items:center;background:var(--as)"><span><b>สมาชิก ' + esc(k.memberId) + '</b><br><small>สะสมแต้มบิลนี้' + (used.length ? ' · ใช้คูปอง ' + used.length + ' ใบ' : '') + '</small></span><button class="link" data-act="k.notme">เปลี่ยน</button></div>' :
        '<div class="order" style="flex-direction:row;justify-content:space-between;align-items:center"><small>ไม่ได้ใช้สมาชิก · บิลนี้จะไม่ได้แต้ม</small><button class="link" data-act="k.notme">ใส่เลขสมาชิก</button></div>') +
        (k.step === 'done' ? '<div class="hero-reg"><b>ส่งออร์เดอร์แล้ว</b><span style="font-size:13px">ชำระที่เคาน์เตอร์ · บิลถูกผูกกับสมาชิกตั้งแต่ตอนสั่ง แต้มเข้าเมื่อชำระสำเร็จ</span></div><button class="pbtn" data-act="k.restart">ลูกค้าถัดไป</button>' :
          '<div class="rgrid">' + R.menus[b.brand].map((x) => '<div class="reward"><div class="art">' + esc(x.name) + '</div><div class="in"><b>' + esc(x.name) + '</b><span class="c num">' + baht(x.price) + '</span><button class="rbtn" data-act="k.add" data-id="' + x.id + '">เพิ่ม</button></div></div>').join('') + '</div>' +
          '<div class="order"><div class="kv"><span>ตะกร้า ' + k.cart.reduce((s, x) => s + x.qty, 0) + ' รายการ</span><b class="num">' + baht(t.total) + ' ฿</b></div>' + (t.discount ? '<small class="muted">ส่วนลดคูปอง -' + baht(t.discount) + '</small>' : '') + '</div>' +
          '<button class="pbtn" data-act="k.send"' + (k.cart.length ? '' : ' disabled') + '>ส่งออร์เดอร์ · ชำระแล้ว (เดโม)</button>') + '</div>';
    }
    return '<div class="cust" style="grid-template-columns:minmax(0,320px) 390px minmax(0,1fr)"><section class="panel"><div><div class="eyebrow">Kiosk / QR โต๊ะ</div><h2>หน้าสั่งอาหารเอง</h2></div>' +
      '<div class="ff"><label for="k-branch">สาขา</label><select id="k-branch" data-pmodel="branch">' + R.state().branches.map((x) => '<option value="' + x.id + '"' + (x.id === ui.branch ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' +
      '<ol class="steps"><li>เลือก ทานที่ร้าน / ห่อกลับบ้าน</li><li>ใส่เลขสมาชิกหรือเบอร์โทร (หรือข้าม)</li><li>พบ → เห็นชื่อ แต้ม และคูปองที่ใช้กับบิลนี้ได้</li><li>เลือกเมนู แถบสมาชิกอยู่ด้านบน</li><li>ส่งออร์เดอร์ → memberId ติดไปกับบิล → แต้มเข้าเมื่อชำระ</li></ol>' +
      '<div class="note">ถ้าเปิดลิงก์สั่งอาหารจากใน LINE (LIFF) ระบบรู้ตัวลูกค้าจาก LINE Login แล้ว ข้ามขั้นที่ 2 อัตโนมัติ</div></section>' +
      '<div class="phone-col"><div class="kiosk" style="' + brandVars(bd) + '">' + head + '<div class="liff" style="background:#FFF9F4">' + body + '</div></div></div>' +
      '<section class="panel"><div class="eyebrow">API ที่ Kiosk เรียก</div><div class="log">' + window.U.logRows(R.state().api.filter((x) => x.kind === 'pos'), 12) + '</div></section></div>';
  }

  function render(root) {
    root.innerHTML = '<div style="display:flex;flex-direction:column;gap:16px"><div class="subtabs" role="group" aria-label="อุปกรณ์หน้าร้าน"><button data-act="p.mode" data-m="cashier" aria-pressed="' + (ui.mode === 'cashier') + '">เครื่องแคชเชียร์</button><button data-act="p.mode" data-m="kiosk" aria-pressed="' + (ui.mode === 'kiosk') + '">Kiosk สั่งเองที่โต๊ะ</button></div>' +
      (ui.mode === 'cashier' ? cashier() : kiosk()) + '</div>';
  }

  function setModel(path, el) {
    if (path === 'branch') { ui.branch = el.value; ui.cart = []; ui.picked = {}; ui.last = null; ui.k.cart = []; ui.k.used = {}; return true; }
    if (path === 'query') { ui.query = el.value; return false; }
    if (path.startsWith('adj.')) { ui.adj[path.slice(4)] = el.value; return false; }
    return false;
  }

  const act = {
    'p.mode': (el) => { ui.mode = el.dataset.m; },
    'p.find': () => { const m = API.resolve(ui.query, { branch: ui.branch }); if (m) { ui.memberId = m.id; ui.picked = {}; toast('พบสมาชิก ' + m.id); } else toast('ไม่พบสมาชิก ลองเลขสมาชิกหรือเบอร์โทรอีกครั้ง'); },
    'p.scan': () => {
      const dm = R.demoMember();
      if (!dm) { toast('มือถือเดโมยังไม่ได้สมัครสมาชิก ไปแท็บ "ลูกค้า (LINE)" ก่อน'); return; }
      const m = API.resolve(R.qrToken(dm.id).token, { branch: ui.branch });
      if (m) { ui.memberId = m.id; ui.picked = {}; toast('สแกนสำเร็จ ' + m.id); }
    },
    'p.clearm': () => { ui.memberId = null; ui.picked = {}; ui.query = ''; },
    'p.cp': (el) => { ui.picked[el.dataset.id] = el.checked; },
    'p.add': (el) => addItem(ui.cart, el.dataset.id),
    'p.dec': (el) => { const r = ui.cart.find((x) => x.id === el.dataset.id); if (r) { r.qty--; if (!r.qty) ui.cart.splice(ui.cart.indexOf(r), 1); } },
    'p.close': () => {
      const ids = Object.keys(ui.picked).filter((k) => ui.picked[k]);
      const bill = API.closeBill({ branch: ui.branch, memberId: ui.memberId, items: ui.cart, couponIds: ids, staff: staffName(), channel: 'pos' });
      ui.last = bill.id; ui.cart = []; ui.picked = {};
      toast(bill.memberId ? 'ปิดบิลแล้ว +' + bill.pts + ' แต้ม · ส่ง Flex แจ้งลูกค้าทาง OA ' + brand().short : 'ปิดบิลแล้ว (ไม่ระบุสมาชิก)');
      if (bill.memberId) ui.memberId = null;
    },
    'p.retry': () => { API.retryBill(ui.last); toast('Server ตอบ 200: บิลนี้บันทึกแล้ว ไม่ให้แต้มซ้ำ'); },
    'p.refund': (el) => { API.refund(el.dataset.id, staffName()); toast('คืนเงินแล้ว · หักแต้มคืนและคืนคูปองให้ลูกค้า'); },
    'p.adj': () => {
      const pts = parseInt(ui.adj.pts, 10);
      if (!pts || !ui.adj.reason.trim()) { toast('ใส่จำนวนแต้มและเหตุผลก่อนส่ง'); return; }
      API.requestAdjust({ memberId: ui.memberId, brand: br().brand, branch: ui.branch, pts, reason: ui.adj.reason.trim(), by: staffName() });
      ui.adj = { pts: '', reason: '' }; toast('ส่งคำขอแล้ว รอผู้จัดการอนุมัติในหลังบ้าน');
    },
    'k.restart': () => { ui.k = { step: 'start', dining: 'dine', mode: 'id', input: '', error: false, memberId: null, used: {}, cart: [] }; },
    'k.dining': (el) => { ui.k.dining = el.dataset.d; ui.k.step = 'member'; },
    'k.skip': () => { ui.k.memberId = null; ui.k.step = 'menu'; },
    'k.mode': (el) => { ui.k.mode = el.dataset.m; ui.k.input = ''; ui.k.error = false; },
    'k.key': (el) => {
      const k = ui.k; const v = el.dataset.k; const max = k.mode === 'id' ? 7 : 10; k.error = false;
      if (v === 'ล้าง') k.input = ''; else if (v === '⌫') k.input = k.input.slice(0, -1); else if (k.input.length < max) k.input += v;
    },
    'k.lookup': () => {
      const k = ui.k; const m = API.resolve(k.mode === 'id' ? 'MB-' + k.input : k.input, { branch: ui.branch });
      if (m) { k.memberId = m.id; k.step = 'found'; k.used = {}; } else k.error = true;
    },
    'k.cp': (el) => { ui.k.used[el.dataset.id] = el.checked; },
    'k.menu': () => { ui.k.step = 'menu'; },
    'k.notme': () => { Object.assign(ui.k, { step: 'member', input: '', memberId: null, error: false, used: {} }); },
    'k.add': (el) => addItem(ui.k.cart, el.dataset.id),
    'k.send': () => {
      const k = ui.k; const ids = Object.keys(k.used).filter((x) => k.used[x]);
      const bill = API.closeBill({ branch: ui.branch, memberId: k.memberId, items: k.cart, couponIds: k.memberId ? ids : [], staff: 'kiosk', channel: 'kiosk' });
      k.step = 'done'; k.cart = [];
      toast(bill.memberId ? 'บิล ' + bill.id + ' +' + bill.pts + ' แต้ม' : 'บิล ' + bill.id + ' (ไม่ระบุสมาชิก)');
    }
  };

  window.VIEWS = window.VIEWS || {};
  window.VIEWS.pos = { render, act, setModel, ui };
})();
