/* หลังบ้าน CRM (ใช้งานจริง) · เสิร์ฟที่ /admin/
 * - ล็อกอินด้วยรหัสพนักงาน (POST /api/admin/login) ได้ token อายุ 12 ชม. เก็บไว้ในแท็บนี้เท่านั้น
 * - เมนูที่เห็นขึ้นกับตำแหน่ง และ server ตรวจสิทธิ์แบรนด์/สาขาซ้ำทุกคำขอ */
(function () {
  'use strict';
  const $app = document.getElementById('app');
  const S = {
    token: null, staff: null, brands: [], brand: null, page: 'rewards',
    data: {}, edit: null, err: '', q: '', member: null, busy: false
  };
  const MENU = [
    ['dash', 'dash', 'ภาพรวม'], ['rewards', 'rewards', 'ของรางวัล'], ['coupons', 'rewards', 'คูปอง'], ['rules', 'rules', 'กฎแต้ม'],
    ['members', 'members', 'สมาชิก'], ['approvals', 'approvals', 'อนุมัติแต้ม'], ['branches', 'branches', 'สาขา'],
    ['staff', 'staff', 'ผู้ใช้และสิทธิ์'], ['audit', 'audit', 'ประวัติการแก้ไข']
  ];
  const NO_BRAND = ['staff', 'audit'];
  const PAGE_NAMES = { dash: 'ภาพรวม', members: 'สมาชิก', approvals: 'อนุมัติแต้ม', rules: 'กฎแต้ม', rewards: 'ของรางวัล/คูปอง', branches: 'สาขา', staff: 'ผู้ใช้และสิทธิ์', audit: 'ประวัติการแก้ไข' };
  const CATS = { food: 'อาหาร', side: 'ทานเล่น', drink: 'เครื่องดื่ม', discount: 'ส่วนลด' };
  const DAYS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  /* ---------- helpers ---------- */
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const date = (t) => { if (!t) return '-'; const d = new Date(t); return d.getDate() + ' ' + TH_M[d.getMonth()] + ' ' + (d.getFullYear() + 543); };
  const isoDay = (t) => { if (!t) return ''; const d = new Date(new Date(t).getTime() + 7 * 3600e3); return d.toISOString().slice(0, 10); };
  const brand = () => S.brands.find((b) => b.id === S.brand) || S.brands[0];
  const brandName = (id) => (S.brands.find((b) => b.id === id) || {}).name || (id ? id : 'ทุกแบรนด์');
  const can = (p) => S.staff && S.staff.pages.includes(p);
  const disc = (type, v) => (type === 'pct' ? fmt(v) + '%' : fmt(v) + ' บาท');
  let toastT;
  function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 3000); }
  const store = {
    get: (k) => { try { return sessionStorage.getItem(k); } catch (e) { return null; } },
    set: (k, v) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  async function api(method, path, body) {
    const h = { 'content-type': 'application/json' };
    if (S.token) h.authorization = 'Bearer ' + S.token;
    const res = await fetch(path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null; try { data = await res.json(); } catch (e) { data = null; }
    if (res.status === 401 && S.token) { logout('หมดเวลาเข้าสู่ระบบ กรุณาล็อกอินใหม่'); throw Object.assign(new Error('หมดเวลาเข้าสู่ระบบ'), { silent: true }); }
    if (!res.ok) throw Object.assign(new Error((data && data.message) || 'เชื่อมต่อระบบไม่สำเร็จ'), { status: res.status });
    return data;
  }
  function form(el) {
    const o = {};
    for (const x of el.elements) {
      if (!x.name) continue;
      o[x.name] = x.type === 'checkbox' ? x.checked : x.value.trim();
    }
    return o;
  }
  function applyTheme() {
    const b = brand(); if (!b) return;
    const r = document.documentElement.style;
    r.setProperty('--a', b.theme_color); r.setProperty('--as', b.soft_color); r.setProperty('--ai', b.ink_color);
  }

  /* ---------- เริ่มต้น ---------- */
  async function boot() {
    try {
      const brands = await api('GET', '/api/public/brands');
      S.token = store.get('crm-admin-token');
      if (S.token) {
        try { S.staff = await api('GET', '/api/admin/me'); } catch (e) { S.token = null; store.set('crm-admin-token', null); }
      }
      S.allBrands = brands;
      if (!S.staff) return loginView();
      await enter();
    } catch (e) { if (!e.silent) $app.innerHTML = '<div class="center"><div class="login"><h2>เปิดหลังบ้านไม่สำเร็จ</h2><p class="muted">' + esc(e.message) + '</p><button class="btn" data-a="reload">ลองอีกครั้ง</button></div></div>'; }
  }
  async function enter() {
    if (S.staff.mustChange) return passwordView(true);
    S.brands = S.allBrands.filter((b) => S.staff.brands.includes(b.id));
    const saved = store.get('crm-admin-brand');
    S.brand = [saved, 'humlai', S.brands[0] && S.brands[0].id].find((x) => x && S.brands.some((b) => b.id === x));
    const first = MENU.find((m) => can(m[1]));
    if (!MENU.some((m) => m[0] === S.page && can(m[1]))) S.page = first ? first[0] : 'dash';
    applyTheme();
    await load();
  }
  // รายชื่อสาขา (ใช้ในฟอร์มคูปอง/ผู้ใช้) โหลดใหม่หลังเพิ่ม/ลบสาขา
  async function reloadBrands() { S.allBrands = await api('GET', '/api/public/brands'); S.brands = S.allBrands.filter((b) => S.staff.brands.includes(b.id)); }
  function loginView(msg) {
    $app.innerHTML = '<div class="center"><form class="login" data-f="login"><h1>หลังบ้าน CRM</h1><span class="muted">เข้าสู่ระบบด้วยรหัสพนักงาน</span>' +
      '<div class="field"><label for="u">รหัสพนักงานหรืออีเมล</label><input id="u" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" required></div>' +
      '<div class="field"><label for="p">รหัสผ่าน</label><input id="p" name="password" type="password" autocomplete="current-password" required></div>' +
      (msg ? '<div class="err" role="alert">' + esc(msg) + '</div>' : '') + '<button class="btn">เข้าสู่ระบบ</button></form></div>';
    const u = document.getElementById('u'); if (u) u.focus();
  }
  function passwordView(forced, msg) {
    $app.innerHTML = '<div class="center"><form class="login" data-f="password"><h1>' + (forced ? 'ตั้งรหัสผ่านใหม่' : 'เปลี่ยนรหัสผ่าน') + '</h1>' +
      '<span class="muted">' + (forced ? 'บัญชี ' + esc(S.staff.id) + ' ใช้รหัสผ่านเริ่มต้นหรือรหัสชั่วคราวอยู่ ต้องตั้งรหัสใหม่ก่อนใช้งาน' : esc(S.staff.name) + ' · ' + esc(S.staff.id)) + '</span>' +
      '<div class="field"><label for="pc">รหัสผ่านปัจจุบัน</label><input id="pc" name="current" type="password" autocomplete="current-password" required></div>' +
      '<div class="field"><label for="pn">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</label><input id="pn" name="password" type="password" autocomplete="new-password" minlength="8" required></div>' +
      '<div class="field"><label for="pn2">พิมพ์รหัสผ่านใหม่อีกครั้ง</label><input id="pn2" name="confirm" type="password" autocomplete="new-password" minlength="8" required></div>' +
      (msg ? '<div class="err" role="alert">' + esc(msg) + '</div>' : '') +
      '<button class="btn">บันทึกรหัสผ่าน</button>' + (forced ? '<button type="button" class="btn ghost" data-a="logout">ออกจากระบบ</button>' : '<button type="button" class="btn ghost" data-a="backHome">ยกเลิก</button>') + '</form></div>';
    const f = document.getElementById('pc'); if (f) f.focus();
  }
  function logout(msg) { S.token = null; S.staff = null; store.set('crm-admin-token', null); loginView(msg); }

  /* ---------- โหลดข้อมูลของแต่ละหน้า ---------- */
  async function load() {
    const b = S.brand; const d = S.data;
    if (S.page === 'dash') d.dash = await api('GET', '/api/admin/dashboard?brand=' + b);
    if (S.page === 'rewards') d.rewards = await api('GET', '/api/admin/rewards');
    if (S.page === 'coupons') d.coupons = await api('GET', '/api/admin/coupon-templates?brand=' + b);
    if (S.page === 'rules') d.rules = await api('GET', '/api/admin/earn-rules');
    if (S.page === 'members') { d.members = await api('GET', '/api/admin/members?brand=' + b + '&q=' + encodeURIComponent(S.q)); if (S.member) await openMember(S.member.member.id); }
    if (S.page === 'approvals') d.approvals = await api('GET', '/api/admin/point-adjustments');
    if (S.page === 'branches') d.branches = await api('GET', '/api/admin/branches');
    if (S.page === 'staff') d.staff = await api('GET', '/api/admin/staff');
    if (S.page === 'audit') d.audit = await api('GET', '/api/admin/audit-logs');
    render();
  }
  async function openMember(id) {
    const [m, tpls] = await Promise.all([api('GET', '/api/admin/members/' + encodeURIComponent(id)), can('rewards') ? api('GET', '/api/admin/coupon-templates?brand=' + S.brand) : Promise.resolve([])]);
    S.member = m;
    // คูปองที่มอบได้: ยังเปิด และอยู่ในช่วงแจก (ของขวัญขึ้นก่อน)
    S.giftable = tpls.filter((t) => couponState(t)[0] === 'เปิดใช้งาน' && t.brand_id === S.brand).sort((a, b) => (a.kind === 'gift' ? 0 : 1) - (b.kind === 'gift' ? 0 : 1));
  }

  /* ---------- หน้าจอ ---------- */
  function render() {
    const menu = MENU.filter((m) => can(m[1]));
    const title = (MENU.find((m) => m[0] === S.page) || [])[2] || '';
    const views = { dash: dashView, rewards: rewardsView, coupons: couponsView, rules: rulesView, members: membersView, approvals: approvalsView, branches: branchesView, staff: staffView, audit: auditView };
    $app.innerHTML = '<div class="shell"><nav class="side" aria-label="เมนูหลังบ้าน"><div class="logo">หลังบ้าน CRM</div>' +
      menu.map((m) => '<button data-a="page" data-v="' + m[0] + '"' + (S.page === m[0] ? ' aria-current="page"' : '') + '>' + m[2] + '</button>').join('') +
      '<div class="who">' + esc(S.staff.name) + ' · ' + esc(S.staff.id) + '<br><button data-a="myPassword">เปลี่ยนรหัสผ่าน</button><button data-a="logout">ออกจากระบบ</button></div></nav>' +
      '<main class="main"><div class="top"><h1>' + esc(title) + '</h1>' +
      (NO_BRAND.includes(S.page) ? '' : S.brands.length > 1 ? '<div class="bpick" role="group" aria-label="เลือกแบรนด์">' + S.brands.map((b) => '<button data-a="brand" data-v="' + b.id + '" aria-pressed="' + (b.id === S.brand) + '">' + esc(b.short_name) + '</button>').join('') + '</div>' : '<b>' + esc(brand().name) + '</b>') +
      '</div>' + views[S.page]() + '</main></div>' + (S.edit ? dialog() : '');
    const auto = document.querySelector('[data-autofocus]'); if (auto) auto.focus();
    const cf = document.querySelector('form[data-f="coupon"]'); if (cf) syncCoupon(cf);
  }

  function dashView() {
    const d = S.data.dash; if (!d) return '';
    const k = d.kpi;
    const box = (label, v, sub) => '<div class="kpi"><small class="muted">' + label + '</small><b class="num">' + v + '</b>' + (sub ? '<small class="muted">' + sub + '</small>' : '') + '</div>';
    return '<div class="kpis">' + box('สมาชิกทั้งหมด', fmt(k.total), '+' + fmt(k.new30) + ' ใน 30 วัน') + box('ซื้อใน 30 วัน', fmt(k.active30)) +
      box('ซื้อซ้ำ', fmt(k.repeaters), 'จากผู้ซื้อ ' + fmt(k.buyers) + ' คน') + box('ยอดขายสมาชิก', fmt(k.member_sales) + ' ฿', 'จากทั้งหมด ' + fmt(k.all_sales) + ' ฿') +
      box('แต้มที่แจก', fmt(k.issued)) + box('แต้มที่แลก', fmt(k.redeemed)) + box('แต้มคงค้าง', fmt(k.outstanding)) + '</div>' +
      '<div class="card"><h2>รายสาขา</h2><div class="wrap"><table class="tbl"><thead><tr><th>สาขา</th><th class="r">สมาชิกประจำ</th><th class="r">บิลสมาชิก / ทั้งหมด</th><th class="r">ยอดขายสมาชิก</th><th>POS ล่าสุด</th></tr></thead><tbody>' +
      d.branches.map((b) => '<tr><td>' + esc(b.name) + '</td><td class="r num">' + fmt(b.home_members) + '</td><td class="r num">' + fmt(b.member_bills) + ' / ' + fmt(b.bills) + '</td><td class="r num">' + fmt(b.member_sales) + '</td><td>' + (b.pos_last_seen ? date(b.pos_last_seen) : '<span class="pill off">ยังไม่เชื่อม</span>') + '</td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function rewardsView() {
    const list = (S.data.rewards || []).filter((r) => r.brand_id === S.brand);
    return '<div class="note">ลูกค้ากดแลกในหน้าสมาชิก (เมนู "แลกแต้ม") แล้วได้คูปองไปยื่นที่ร้าน · แก้ชื่อหรือส่วนลดแล้ว คูปองที่ลูกค้าแลกไปก่อนหน้ายังใช้ตามเงื่อนไขเดิม</div>' +
      '<div class="card"><div class="hd"><h2>ของรางวัล ' + esc(brand().name) + '</h2><button class="btn" data-a="editReward" data-v="new">+ เพิ่มของรางวัล</button></div>' +
      (list.length ? '<div class="wrap"><table class="tbl"><thead><tr><th>ของรางวัล</th><th>หมวด</th><th class="r">ใช้แต้ม</th><th class="r">มูลค่า</th><th class="r">คงเหลือ</th><th class="r">แลกแล้ว</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
        list.map((r) => '<tr class="' + (r.is_active ? '' : 'off') + '"><td><b>' + esc(r.name) + '</b></td><td>' + (CATS[r.category] || esc(r.category)) + '</td><td class="r num">' + fmt(r.points_cost) + '</td>' +
          '<td class="r num">' + (Number(r.discount_value) ? disc(r.discount_type, r.discount_value) : '-') + '</td><td class="r num">' + (r.stock === null ? 'ไม่จำกัด' : fmt(r.stock)) + '</td><td class="r num">' + fmt(r.redeemed) + '</td>' +
          '<td>' + (r.is_active ? (r.stock !== null && r.stock <= 0 ? '<span class="pill warn">หมด</span>' : '<span class="pill">เปิดแลก</span>') : '<span class="pill off">ปิด</span>') + '</td>' +
          '<td class="r"><button class="btn ghost sm" data-a="editReward" data-v="' + r.id + '">แก้ไข</button></td></tr>').join('') + '</tbody></table></div>'
        : '<p class="muted">ยังไม่มีของรางวัล กด "เพิ่มของรางวัล"</p>') + '</div>';
  }
  function rewardForm(r) {
    const isNew = !r; r = r || { name: '', category: 'food', points_cost: '', discount_type: 'baht', discount_value: '', min_spend: 0, valid_days: 30, stock: null, is_active: true };
    return '<form class="grid" data-f="reward" data-v="' + (isNew ? 'new' : r.id) + '">' +
      '<div class="field" style="grid-column:1/-1"><label for="f-name">ชื่อของรางวัล</label><input id="f-name" name="name" value="' + esc(r.name) + '" required data-autofocus></div>' +
      '<div class="field"><label for="f-cat">หมวด</label><select id="f-cat" name="cat">' + Object.entries(CATS).map(([k, v]) => '<option value="' + k + '"' + (r.category === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="f-cost">ใช้แต้ม</label><input id="f-cost" name="cost" type="number" min="1" inputmode="numeric" value="' + esc(r.points_cost) + '" required></div>' +
      '<div class="field"><label for="f-type">แบบส่วนลด</label><select id="f-type" name="type"><option value="baht"' + (r.discount_type !== 'pct' ? ' selected' : '') + '>ลดเป็นบาท</option><option value="pct"' + (r.discount_type === 'pct' ? ' selected' : '') + '>ลดเป็น %</option></select></div>' +
      '<div class="field"><label for="f-val">มูลค่า</label><input id="f-val" name="value" type="number" min="0" step="0.01" value="' + esc(Number(r.discount_value) || '') + '"><span class="hint">ของฟรี: ใส่ราคาของชิ้นนั้น (ใช้เป็นส่วนลดตอนปิดบิล)</span></div>' +
      '<div class="field"><label for="f-min">ยอดซื้อขั้นต่ำ (บาท)</label><input id="f-min" name="min" type="number" min="0" value="' + esc(Number(r.min_spend) || 0) + '"></div>' +
      '<div class="field"><label for="f-days">คูปองใช้ได้ (วัน)</label><input id="f-days" name="days" type="number" min="1" max="365" value="' + esc(r.valid_days || 30) + '"></div>' +
      '<div class="field"><label for="f-stock">จำนวนคงเหลือ</label><input id="f-stock" name="stock" type="number" min="0" placeholder="ไม่จำกัด" value="' + (r.stock === null ? '' : esc(r.stock)) + '"><span class="hint">เว้นว่าง = ไม่จำกัด</span></div>' +
      '<label class="check"><input type="checkbox" name="active"' + (r.is_active ? ' checked' : '') + '>เปิดให้แลก</label>' +
      (S.err ? '<div class="err" role="alert" style="grid-column:1/-1">' + esc(S.err) + '</div>' : '') +
      '<div class="actions"><button class="btn">' + (isNew ? 'เพิ่มของรางวัล' : 'บันทึก') + '</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button>' + (isNew ? '' : '<button type="button" class="btn danger" style="margin-left:auto" data-a="delReward" data-v="' + r.id + '">ลบของรางวัล</button>') + '</div></form>';
  }

  const KINDS = [
    ['general', 'ทั่วไป', 'แจกให้สมาชิกเดิมและสมาชิกใหม่ที่ตรงเงื่อนไขโดยอัตโนมัติ (ได้ตอนเปิดหน้าสมาชิกหรือตอนพนักงานสแกน QR)'],
    ['code', 'กรอกโค้ด', 'ลูกค้าได้คูปองเมื่อกรอกโค้ดในหน้าสมาชิก เมนู "คูปอง" (คนละ 1 ครั้ง)'],
    ['birthday', 'วันเกิด', 'แจกอัตโนมัติในเดือนเกิดของสมาชิก ปีละ 1 ครั้ง'],
    ['welcome', 'ต้อนรับ', 'แจกทันทีเมื่อสมัครสมาชิกผ่าน OA ของแบรนด์นี้'],
    ['gift', 'ของขวัญ', 'พนักงานมอบให้รายคนจากเมนู "สมาชิก" เช่น ชดเชยลูกค้า หรือรางวัลพิเศษ']
  ];
  const KIND_NAME = Object.fromEntries(KINDS.map((k) => [k[0], k[1]]));
  const TIER_NAME = { all: 'ทุกระดับ', SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Platinum' };
  const DAY_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
  const daysText = (mask) => (mask === 127 ? 'ทุกวัน' : DAY_SHORT.filter((_, i) => mask & (1 << i)).join(' '));
  const couponStyle = (t) => (t.badge_big === 'ฟรี' ? 'free' : t.discount_type);
  const valueText = (t) => (couponStyle(t) === 'free' ? 'ของฟรี (มูลค่า ' + fmt(t.discount_value) + ' บาท)' : disc(t.discount_type, t.discount_value) + (t.max_discount ? ' สูงสุด ' + fmt(t.max_discount) + ' บาท' : ''));
  function couponState(t) {
    const now = Date.now();
    if (!t.is_active) return ['ปิด', 'pill off'];
    if (t.valid_to && new Date(t.valid_to) < now) return ['หมดอายุ', 'pill off'];
    if (t.issue_to && new Date(t.issue_to) < now) return ['หมดช่วงแจก', 'pill off'];
    if (t.max_issue && t.issued >= t.max_issue) return ['แจกครบแล้ว', 'pill warn'];
    if (t.issue_from && new Date(t.issue_from) > now) return ['รอเริ่มแจก', 'pill warn'];
    return ['เปิดใช้งาน', 'pill'];
  }
  function couponsView() {
    const all = (S.data.coupons || []).filter((t) => t.brand_id === S.brand || t.brand_id === null);
    const f = S.cfilter || 'all';
    const list = all.filter((t) => f === 'all' || t.kind === f);
    return '<div class="card"><div class="hd"><h2>คูปอง ' + esc(brand().name) + '</h2><button class="btn" data-a="editCoupon">+ สร้างคูปอง</button></div>' +
      '<div class="bpick" role="group" aria-label="กรองประเภท">' + [['all', 'ทั้งหมด']].concat(KINDS).map((k) => '<button data-a="cfilter" data-v="' + k[0] + '" aria-pressed="' + (f === k[0]) + '">' + k[1] + ' <span class="num">(' + all.filter((t) => k[0] === 'all' || t.kind === k[0]).length + ')</span></button>').join('') + '</div>' +
      (list.length ? '<div class="wrap"><table class="tbl"><thead><tr><th></th><th>คูปอง</th><th>ประเภท</th><th>ส่วนลด</th><th>ใช้ได้</th><th class="r">แจก / ใช้แล้ว</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
        list.map((t) => {
          const st = couponState(t);
          return '<tr class="' + (st[1] === 'pill' ? '' : 'off') + '"><td>' + (t.image_id ? '<img class="thumb" alt="" src="/api/public/coupon-images/' + t.image_id + '">' : '<span class="thumb badge">' + esc(t.badge_big) + '</span>') + '</td>' +
            '<td><b>' + esc(t.title) + '</b>' + (t.code ? '<br><small>โค้ด <b>' + esc(t.code) + '</b></small>' : '') + (t.brand_id ? '' : '<br><small class="muted">ทุกแบรนด์</small>') + '</td>' +
            '<td>' + esc(KIND_NAME[t.kind] || t.kind) + (t.branch_ids ? '<br><small class="muted">สมัครที่ ' + esc(t.branch_ids.map(branchLabel).join(', ')) + '</small>' : '') + (t.audience_tier !== 'all' ? '<br><small class="muted">' + TIER_NAME[t.audience_tier] + '</small>' : '') + '</td>' +
            '<td>' + esc(valueText(t)) + (Number(t.min_spend) ? '<br><small class="muted">ขั้นต่ำ ' + fmt(t.min_spend) + ' บาท</small>' : '') + '</td>' +
            '<td><small>' + (t.validity === 'dates' ? date(t.valid_from) + ' - ' + date(t.valid_to) : t.valid_days + ' วันหลังได้รับ') + '<br>' + daysText(t.use_days) + '</small></td>' +
            '<td class="r num">' + fmt(t.issued) + (t.max_issue ? ' / ' + fmt(t.max_issue) : '') + '<br><small class="muted">ใช้แล้ว ' + fmt(t.used) + '</small></td>' +
            '<td><span class="' + st[1] + '">' + st[0] + '</span></td>' +
            '<td class="r" style="white-space:nowrap">' + (t.brand_id || S.staff.role === 'super' ? '<button class="btn ghost sm" data-a="editCoupon" data-v="' + t.id + '">แก้ไข</button> <button class="btn ghost sm" data-a="toggleCoupon" data-v="' + t.id + '">' + (t.is_active ? 'ปิด' : 'เปิด') + '</button> <button class="btn danger sm" data-a="delCoupon" data-v="' + t.id + '">ลบ</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">ยังไม่มีคูปองประเภทนี้</p>') + '</div>';
  }
  function couponForm(id) {
    const t = id ? S.data.coupons.find((x) => String(x.id) === String(id)) : null;
    const x = t || { kind: 'general', title: '', description: '', discount_type: 'baht', badge_big: '', discount_value: '', min_spend: 0, max_discount: null, validity: 'days', valid_days: 30, valid_from: null, valid_to: null,
      issue_from: null, issue_to: null, branch_ids: null, audience_tier: 'all', followers_only: false, use_days: 127, max_issue: null, is_active: true, code: '', issued: 0 };
    const style = t ? couponStyle(t) : 'baht'; const locked = t && t.issued > 0;
    const lockAttr = locked ? ' disabled' : '';
    const radio = (name, val, cur, label, extra) => '<label class="check"><input type="radio" name="' + name + '" value="' + val + '"' + (String(cur) === String(val) ? ' checked' : '') + (extra || '') + '>' + label + '</label>';
    return '<form class="coupon-ed" data-f="coupon" data-v="' + (id || '') + '"><div class="ed-form">' +
      (locked ? '<div class="note">แจกไปแล้ว ' + fmt(t.issued) + ' ใบ จึงเปลี่ยนประเภท มูลค่าส่วนลด และโค้ดไม่ได้ (คูปองที่ลูกค้าถืออยู่ต้องไม่เปลี่ยน) ถ้าจะเปลี่ยนให้ปิดใบนี้แล้วสร้างใหม่</div>' : '') +
      '<fieldset class="field"><legend>ประเภท</legend><div class="segr">' + KINDS.map((k) => '<label><input type="radio" name="kind" value="' + k[0] + '"' + (x.kind === k[0] ? ' checked' : '') + lockAttr + '><span>' + k[1] + '</span></label>').join('') + '</div><span class="hint" id="kind-hint"></span></fieldset>' +
      '<div class="field"><label for="c-title">ชื่อคูปอง</label><input id="c-title" name="title" maxlength="60" required value="' + esc(x.title) + '" data-autofocus></div>' +
      '<div class="field"><label for="c-desc">รายละเอียด</label><textarea id="c-desc" name="description" maxlength="1000" placeholder="เช่น ใช้ได้กับเมนูข้าวมันไก่ทุกจาน ไม่ร่วมกับโปรโมชั่นอื่น">' + esc(x.description) + '</textarea></div>' +
      '<div class="field"><span class="lbl">รูปคูปอง</span><div class="upl"><div class="upl-img" id="c-img">' + (S.edit.imageUrl ? '<img alt="" src="' + esc(S.edit.imageUrl) + '">' : '<span>ยังไม่มีรูป</span>') + '</div>' +
        '<div class="upl-side"><label class="btn ghost sm" for="c-file">เลือกรูป</label><input id="c-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="sr">' + (S.edit.imageUrl ? '<button type="button" class="btn ghost sm" data-a="dropImage">ลบรูป</button>' : '') +
        '<span class="hint">แนะนำ 810 × 270 px (3:1) · PNG, JPG, GIF · ไม่เกิน 2 MB · ระบบย่อรูปให้อัตโนมัติ</span></div></div></div>' +
      '<div class="grid">' +
        '<div class="field"><label for="c-type">ส่วนลด</label><select id="c-type" name="type"' + lockAttr + '><option value="baht"' + (style === 'baht' ? ' selected' : '') + '>ลดเป็นบาท</option><option value="pct"' + (style === 'pct' ? ' selected' : '') + '>ลดเป็น %</option><option value="free"' + (style === 'free' ? ' selected' : '') + '>ของฟรี</option></select></div>' +
        '<div class="field"><label for="c-val" id="c-val-l">มูลค่า</label><input id="c-val" name="value" type="number" min="1" step="0.01" required value="' + esc(Number(x.discount_value) || '') + '"' + lockAttr + '></div>' +
        '<div class="field" data-show="pct"><label for="c-max">ลดสูงสุด (บาท)</label><input id="c-max" name="maxDiscount" type="number" min="0" placeholder="ไม่จำกัด" value="' + esc(x.max_discount ? Number(x.max_discount) : '') + '"' + lockAttr + '></div>' +
        '<div class="field"><label for="c-min">ยอดซื้อขั้นต่ำ (บาท)</label><input id="c-min" name="min" type="number" min="0" value="' + esc(Number(x.min_spend) || 0) + '"' + lockAttr + '></div>' +
        '<div class="field" data-show="code"><label for="c-code">โค้ดที่ลูกค้ากรอก</label><input id="c-code" name="code" maxlength="20" autocapitalize="characters" placeholder="เช่น HUMLAI50" value="' + esc(x.code || '') + '"' + lockAttr + '></div>' +
      '</div>' +
      '<fieldset class="field" data-show="welcome"><legend>ให้กับสมาชิกที่สมัครที่สาขา</legend><div class="row-in">' + radio('wscope', 'all', x.branch_ids ? 'some' : 'all', 'ทุกสาขา') + radio('wscope', 'some', x.branch_ids ? 'some' : 'all', 'เฉพาะสาขาที่เลือก') + '</div>' +
        '<div class="row-in" data-show="wbr">' + brand().branches.map((br) => '<label class="check"><input type="checkbox" name="wb" value="' + esc(br.id) + '"' + ((x.branch_ids || []).includes(br.id) ? ' checked' : '') + '>' + esc(br.name) + '</label>').join('') + '</div>' +
        '<span class="hint">ใช้สาขาที่สมัครที่ลูกค้าเลือกในหน้าสมัคร · ตั้งคูปองต้อนรับหลายใบให้แต่ละสาขาต่างกันได้</span></fieldset>' +
      '<fieldset class="field"><legend>วันที่ใช้ได้</legend><div class="row-in">' + radio('validity', 'dates', x.validity, 'ตามวันที่') + radio('validity', 'days', x.validity, 'ตามระยะเวลาหลังได้รับ') + '</div>' +
        '<div class="row-in" data-show="dates"><input type="date" name="validFrom" aria-label="วันเริ่มใช้" value="' + isoDay(x.valid_from) + '"> ถึง <input type="date" name="validTo" aria-label="วันสุดท้ายที่ใช้" value="' + isoDay(x.valid_to) + '"></div>' +
        '<div class="row-in" data-show="days"><input type="number" name="days" min="1" max="365" style="width:90px" aria-label="จำนวนวัน" value="' + esc(x.valid_days || 30) + '"> วัน นับจากวันที่ลูกค้าได้รับคูปอง</div></fieldset>' +
      '<details class="adv"' + (t && (t.issue_from || t.issue_to || t.audience_tier !== 'all' || t.followers_only || t.use_days !== 127 || t.max_issue) ? ' open' : '') + '><summary>ขั้นสูง</summary>' +
        '<div class="field"><span class="lbl">ช่วงวันที่แจก</span><div class="row-in"><input type="date" name="issueFrom" aria-label="เริ่มแจก" value="' + isoDay(x.issue_from) + '"> ถึง <input type="date" name="issueTo" aria-label="สิ้นสุดการแจก" value="' + isoDay(x.issue_to) + '"></div><span class="hint">เว้นว่าง = แจกตั้งแต่บันทึกจนกว่าจะปิดคูปอง</span></div>' +
        '<div class="grid"><div class="field"><label for="c-tier">ส่งให้ระดับ</label><select id="c-tier" name="tier">' + Object.entries(TIER_NAME).map(([k, v]) => '<option value="' + k + '"' + (x.audience_tier === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div>' +
          '<div class="field"><label for="c-fol">และ</label><select id="c-fol" name="followersOnly"><option value="">สมาชิกทุกคน</option><option value="1"' + (x.followers_only ? ' selected' : '') + '>เฉพาะคนที่ยังเป็นเพื่อนกับ OA</option></select></div></div>' +
        '<fieldset class="field"><legend>ใช้ได้ในวัน</legend><div class="row-in">' + DAY_SHORT.map((d, i) => '<label class="check day"><input type="checkbox" name="d' + i + '"' + (x.use_days & (1 << i) ? ' checked' : '') + '>' + d + '</label>').join('') + '</div></fieldset>' +
        '<fieldset class="field"><legend>จำนวนคูปองทั้งหมด</legend><div class="row-in">' + radio('limit', '0', x.max_issue ? 1 : 0, 'ไม่จำกัด') + radio('limit', '1', x.max_issue ? 1 : 0, 'จำกัด') +
          '<input type="number" name="maxIssue" min="1" style="width:110px" aria-label="จำนวนใบ" value="' + esc(x.max_issue || '') + '" data-show="limit"> <span data-show="limit">ใบ (ใครได้ก่อนได้ก่อน)</span></div></fieldset>' +
      '</details>' +
      '<label class="check"><input type="checkbox" name="active"' + (x.is_active ? ' checked' : '') + '>เปิดใช้งาน</label>' +
      '<div class="err" id="c-err" role="alert" hidden></div>' +
      '<div class="actions"><button type="button" class="btn ghost" data-a="close">ยกเลิก</button><button class="btn">' + (t ? 'บันทึก' : 'สร้างคูปอง') + '</button></div></div>' +
      '<aside class="ed-prev" aria-label="ภาพตัวอย่าง"><b>ภาพตัวอย่างในหน้าสมาชิก</b><div class="phone"><div class="phone-top">คูปองของฉัน · ' + esc(brand().short_name) + '</div><div id="c-prev"></div></div></aside></form>';
  }
  // อ่านค่าจากฟอร์มคูปอง (ใช้ทั้งตอนบันทึกและตอนวาดภาพตัวอย่าง)
  function couponBody(el) {
    const v = (n) => { const x = el.elements[n]; return x ? (x.type === 'checkbox' ? x.checked : x.value.trim()) : ''; };
    let mask = 0; for (let i = 0; i < 7; i++) if (v('d' + i)) mask |= 1 << i;
    return { brand: S.brand, kind: v('kind'), title: v('title'), description: v('description'), imageId: S.edit.imageId || null, type: v('type'), value: v('value'), maxDiscount: v('maxDiscount'),
      min: v('min'), code: v('code'), validity: v('validity'), validFrom: v('validFrom'), validTo: v('validTo'), days: v('days'), issueFrom: v('issueFrom'), issueTo: v('issueTo'),
      tier: v('tier'), followersOnly: v('followersOnly') === '1', useDays: mask,
      branchIds: v('kind') === 'welcome' && v('wscope') === 'some' ? [...el.querySelectorAll('input[name="wb"]:checked')].map((x) => x.value) : null, maxIssue: v('limit') === '1' ? v('maxIssue') : '', active: v('active') };
  }
  function syncCoupon(el) {
    const b = couponBody(el);
    const show = { pct: b.type === 'pct', code: b.kind === 'code', welcome: b.kind === 'welcome', wbr: b.kind === 'welcome' && el.elements.wscope && el.elements.wscope.value === 'some', dates: b.validity === 'dates', days: b.validity !== 'dates', limit: el.elements.limit && el.elements.limit.value === '1' };
    el.querySelectorAll('[data-show]').forEach((x) => { x.hidden = !show[x.dataset.show]; });
    const k = KINDS.find((x) => x[0] === b.kind); document.getElementById('kind-hint').textContent = k ? k[2] : '';
    document.getElementById('c-val-l').textContent = b.type === 'free' ? 'ราคาของที่แจก (บาท)' : b.type === 'pct' ? 'ลดกี่ %' : 'ลดกี่บาท';
    const big = b.type === 'free' ? 'ฟรี' : b.type === 'pct' ? '-' + (b.value || 0) + '%' : '-' + (b.value || 0);
    const exp = b.validity === 'dates' ? (b.validTo ? date(b.validTo + 'T12:00:00+07:00') : '-') : (b.days || 30) + ' วันหลังได้รับ';
    const row = (k2, v2) => '<div class="kv"><span>' + k2 + '</span><span>' + esc(v2) + '</span></div>';
    document.getElementById('c-prev').innerHTML =
      (S.edit.imageUrl ? '<img class="prev-img" alt="" src="' + esc(S.edit.imageUrl) + '">' : '<div class="prev-img ph"><b>' + esc(big) + '</b></div>') +
      '<div class="prev-body"><b>' + esc(b.title || 'ชื่อคูปอง') + '</b>' + (b.description ? '<p>' + esc(b.description) + '</p>' : '') + '<span class="prev-btn">ใช้คูปอง</span></div>' +
      '<div class="prev-sec"><b>การใช้งาน</b>' + (b.validity === 'dates' ? row('วันที่เริ่มต้น', b.validFrom ? date(b.validFrom + 'T12:00:00+07:00') : '-') : '') + row('วันหมดอายุ', exp) + row('ใช้ได้', '1 ครั้ง') + (b.kind === 'code' ? row('โค้ด', (b.code || '-').toUpperCase()) : '') + '</div>' +
      (b.kind === 'welcome' ? '<div class="prev-sec"><b>ได้เมื่อ</b>' + row('สมัครที่สาขา', b.branchIds ? (b.branchIds.length ? b.branchIds.map(branchLabel).join(', ') : 'ยังไม่ได้เลือก') : 'ทุกสาขา') + '</div>' : '') +
      '<div class="prev-sec"><b>เงื่อนไข</b>' + row('ขั้นต่ำ', Number(b.min) ? fmt(b.min) + ' บาท' : 'ไม่มี') + (b.type === 'pct' && Number(b.maxDiscount) ? row('ลดสูงสุด', fmt(b.maxDiscount) + ' บาท') : '') + row('ใช้ได้เมื่อ', daysText(b.useDays || 0) || '-') + row('จำกัด', b.maxIssue ? fmt(b.maxIssue) + ' ใบ' : 'ไม่จำกัด') + '</div>';
  }
  function rerenderCoupon() {
    const el = document.querySelector('form[data-f="coupon"]'); if (!el) return;
    const box = document.getElementById('c-img');
    box.innerHTML = S.edit.imageUrl ? '<img alt="" src="' + esc(S.edit.imageUrl) + '">' : '<span>ยังไม่มีรูป</span>';
    const side = el.querySelector('.upl-side'); const drop = side.querySelector('[data-a="dropImage"]');
    if (S.edit.imageUrl && !drop) side.querySelector('label').insertAdjacentHTML('afterend', '<button type="button" class="btn ghost sm" data-a="dropImage">ลบรูป</button>');
    if (!S.edit.imageUrl && drop) drop.remove();
    syncCoupon(el);
  }
  // ย่อรูปในเบราว์เซอร์ก่อนอัปโหลด (กว้างไม่เกิน 1080 px) · GIF ส่งไฟล์เดิมเพื่อไม่ให้ภาพเคลื่อนไหวหาย
  function shrinkImage(file) {
    return new Promise((ok, fail) => {
      if (file.size > 10 * 1024 * 1024) return fail(new Error('ไฟล์ใหญ่เกินไป'));
      const rd = new FileReader();
      rd.onerror = () => fail(new Error('อ่านไฟล์ไม่สำเร็จ'));
      rd.onload = () => {
        if (file.type === 'image/gif') return ok(rd.result);
        const img = new Image();
        img.onerror = () => fail(new Error('ไฟล์นี้ไม่ใช่รูปภาพ'));
        img.onload = () => {
          const w = Math.min(1080, img.naturalWidth); const h = Math.round(img.naturalHeight * w / img.naturalWidth);
          const c = document.createElement('canvas'); c.width = w; c.height = h;
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); g.drawImage(img, 0, 0, w, h);
          ok(c.toDataURL('image/jpeg', 0.88));
        };
        img.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }
  const errHtml = () => (S.err ? '<div class="err" role="alert" style="grid-column:1/-1">' + esc(S.err) + '</div>' : '');

  function rulesView() {
    const r = (S.data.rules || []).find((x) => x.brand_id === S.brand);
    if (!r) return '<div class="card"><p class="muted">ยังไม่มีกฎแต้มของแบรนด์นี้</p></div>';
    const opt = (list, cur) => list.map((o) => '<option value="' + o[0] + '"' + (cur === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('');
    const fld = (id, label, input, hint) => '<div class="field"><label for="' + id + '">' + label + '</label>' + input + (hint ? '<span class="hint">' + hint + '</span>' : '') + '</div>';
    const num = (id, name, val, extra) => '<input id="' + id + '" name="' + name + '" type="number" value="' + val + '"' + (extra || ' min="0"') + '>';
    const sec = (title, desc, body) => '<section class="rsec"><div class="rsec-h"><h3>' + title + '</h3><small class="muted">' + desc + '</small></div><div class="rgrid">' + body + '</div></section>';
    // ตัวอย่างจากค่าที่บันทึกไว้ ให้เห็นภาพว่าลูกค้าได้กี่แต้ม
    const ex = Math.floor(500 / Number(r.baht_per_unit) + 1e-9) * r.points_per_unit;
    return '<form class="card rules" data-f="rule"><h2>กฎแต้ม ' + esc(brand().name) + '</h2>' +
      sec('แต้มจากยอดซื้อ', 'ตัวอย่างตามที่บันทึกไว้: บิล 500 บาท ได้ ' + fmt(ex) + ' แต้ม',
        fld('r-baht', 'ทุกกี่บาท', num('r-baht', 'baht', Number(r.baht_per_unit), ' min="1" step="0.01" required')) +
        fld('r-pts', 'ได้กี่แต้ม', num('r-pts', 'pts', r.points_per_unit, ' min="0" required')) +
        fld('r-base', 'คิดจากยอด', '<select id="r-base" name="base">' + opt([['net', 'ยอดสุทธิหลังส่วนลด'], ['exvat', 'ยอดก่อน VAT'], ['gross', 'ยอดก่อนส่วนลด']], r.base_amount) + '</select>') +
        fld('r-round', 'เศษ', '<select id="r-round" name="rounding">' + opt([['floor', 'ปัดทิ้ง'], ['round', 'ปัดครึ่งขึ้น']], r.rounding) + '</select>')) +
      sec('วันแต้มคูณ', 'คูณแต้มจากยอดซื้อทุกสัปดาห์ในวันที่เลือก',
        '<label class="check"><input type="checkbox" name="promoOn"' + (r.promo_on ? ' checked' : '') + '>เปิดใช้วันแต้มคูณ</label>' +
        fld('r-day', 'วัน', '<select id="r-day" name="promoDay">' + DAYS.map((d, i) => '<option value="' + i + '"' + (r.promo_day === i ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>') +
        fld('r-mult', 'คูณ (เท่า)', num('r-mult', 'promoMult', Number(r.promo_mult), ' min="1" step="0.5"'))) +
      sec('สมาชิกใหม่และอายุแต้ม', 'แต้มต้อนรับให้ครั้งเดียวต่อสมาชิกต่อแบรนด์',
        fld('r-wel', 'แต้มต้อนรับ', num('r-wel', 'welcome', r.welcome_points), '0 = ไม่แจก') +
        fld('r-exp', 'แต้มหมดอายุ (เดือน)', num('r-exp', 'expiryMonths', r.expiry_months), '0 = ไม่หมดอายุ') +
        fld('r-back', 'ขอแต้มย้อนหลังได้ (วัน)', num('r-back', 'backdays', r.backdate_days))) +
      sec('ระดับสมาชิก', 'คิดจากแต้มที่ได้ใน 12 เดือนล่าสุด',
        fld('r-gold', 'Gold เมื่อสะสมครบ', num('r-gold', 'gold', r.gold_at), 'แต้ม') +
        fld('r-plat', 'Platinum เมื่อสะสมครบ', num('r-plat', 'platinum', r.platinum_at), 'แต้ม')) +
      sec('LINE', 'ข้อความแจ้งแต้มนับโควต้าข้อความของ LINE OA · ข้อความตอบรีวิวไม่นับ',
        fld('r-notify', 'แจ้งแต้มหลังชำระบิล', '<select id="r-notify" name="pointsNotify">' + opt([['off', 'ไม่แจ้ง'], ['all', 'แจ้งทุกบิล'], ['min', 'แจ้งเมื่อยอดบิลถึง…']], r.points_notify || 'off') + '</select>', 'ลูกค้าดูแต้มในบัตรสมาชิกได้ตลอด') +
        fld('r-nmin', 'ยอดบิลขั้นต่ำที่แจ้ง (บาท)', '<input id="r-nmin" name="pointsNotifyMin" type="number" min="0" value="' + (Number(r.points_notify_min) || '') + '">', 'ใช้เมื่อเลือก "แจ้งเมื่อยอดบิลถึง…"') +
        fld('r-review', 'แต้มรีวิวร้านในแชท', num('r-review', 'reviewPoints', r.review_points == null ? 5 : r.review_points, ' min="0" max="1000" step="1"'), 'ลูกค้าพิมพ์ "ติชม" แล้วเลือกคะแนน · เฉพาะวันที่มีบิล วันละครั้ง · 0 = ปิด')) +
      (S.err ? '<div class="err" role="alert">' + esc(S.err) + '</div>' : '') +
      '<div class="actions rules-foot"><button class="btn">บันทึกกฎแต้ม</button><small class="muted">มีผลกับบิลหลังบันทึก บิลเก่าคิดตามกฎเดิม · กฎนี้ใช้อยู่ตั้งแต่ ' + date(r.effective_from) + '</small></div></form>';
  }

  function membersView() {
    const list = S.data.members || [];
    const m = S.member;
    return '<form class="card" data-f="search"><div class="grid"><div class="field" style="grid-column:span 2"><label for="q">ค้นหา (ชื่อ เบอร์ หรือเลขสมาชิก)</label><input id="q" name="q" value="' + esc(S.q) + '" type="search"></div><div class="actions" style="grid-column:auto"><button class="btn">ค้นหา</button></div></div></form>' +
      (m ? memberDetail(m) : '') +
      '<div class="card"><h2>สมาชิก ' + esc(brand().name) + ' (' + fmt(list.length) + (list.length >= 200 ? '+' : '') + ')</h2>' +
      (list.length ? '<div class="wrap"><table class="tbl"><thead><tr><th>เลขสมาชิก</th><th>ชื่อ</th><th>เบอร์</th><th class="r">แต้ม ' + esc(brand().short_name) + '</th><th>สมัคร</th><th></th></tr></thead><tbody>' +
        list.map((x) => '<tr><td>' + esc(x.id) + '</td><td>' + esc(x.full_name) + '</td><td>' + esc(x.phone) + '</td><td class="r num">' + fmt((x.wallets || {})[S.brand]) + '</td><td>' + date(x.created_at) + '</td><td class="r"><button class="btn ghost sm" data-a="member" data-v="' + esc(x.id) + '">ดู</button></td></tr>').join('') + '</tbody></table></div>'
        : '<p class="muted">ไม่พบสมาชิก</p>') + '</div>';
  }
  function memberDetail(d) {
    const m = d.member; const w = d.wallets[S.brand] || { balance: 0, tier: {} };
    const coupons = d.coupons.filter((c) => c.status === 'ready' && (c.brand === 'all' || c.brand === S.brand));
    return '<div class="card"><div class="hd"><h2>' + esc(m.full_name) + ' · ' + esc(m.id) + '</h2>' + (S.staff.role === 'super' ? '<button class="btn danger sm" data-a="delMember" data-v="' + esc(m.id) + '">ลบสมาชิก</button>' : '') + '<button class="btn ghost sm" data-a="unmember">ปิด</button></div>' +
      '<div class="kpis"><div class="kpi"><small class="muted">แต้ม ' + esc(brand().short_name) + '</small><b class="num">' + fmt(w.balance) + '</b><small class="muted">ระดับ ' + esc(w.tier.name || '-') + '</small></div>' +
      '<div class="kpi"><small class="muted">เบอร์</small><b style="font-size:17px">' + esc(m.phone) + '</b><small class="muted">สมัคร ' + date(m.created_at) + '</small></div>' +
      '<div class="kpi"><small class="muted">คูปองพร้อมใช้</small><b class="num">' + coupons.length + '</b></div></div>' +
      '<form class="grid" data-f="adjust" data-v="' + esc(m.id) + '"><div class="field"><label for="a-pts">ปรับแต้ม (+ เพิ่ม / - ลด)</label><input id="a-pts" name="points" type="number" required></div>' +
      '<div class="field" style="grid-column:span 2"><label for="a-why">เหตุผล</label><input id="a-why" name="reason" required placeholder="เช่น ลืมสแกนบิล HL01-000123"></div><div class="actions" style="grid-column:auto"><button class="btn">ส่งขออนุมัติ</button></div></form>' +
      '<small class="muted">การปรับแต้มต้องให้อีกคนอนุมัติที่เมนู "อนุมัติแต้ม"</small>' +
      (S.giftable && S.giftable.length ? '<form class="grid" data-f="gift" data-v="' + esc(m.id) + '"><div class="field" style="grid-column:span 2"><label for="g-tpl">มอบคูปองให้สมาชิกคนนี้</label><select id="g-tpl" name="templateId"><option value="">เลือกคูปอง</option>' +
        S.giftable.map((t) => '<option value="' + t.id + '">' + esc((KIND_NAME[t.kind] || '') + ' · ' + t.title) + '</option>').join('') + '</select></div><div class="actions" style="grid-column:auto"><button class="btn">มอบคูปอง</button></div></form>' : '') +
      (coupons.length ? '<small class="muted">คูปองพร้อมใช้: ' + coupons.map((c) => esc(c.title) + ' (' + esc(c.code) + ')').join(', ') + '</small>' : '') +
      '<h3 style="font-size:15px">ประวัติแต้มล่าสุด</h3><div class="wrap"><table class="tbl"><tbody>' +
      d.ledger.filter((l) => l.brand_id === S.brand).slice(0, 15).map((l) => '<tr><td>' + date(l.created_at) + '</td><td>' + esc(l.note || l.entry_type) + '</td><td class="r num" style="color:' + (l.points >= 0 ? 'var(--good)' : 'var(--bad)') + '">' + (l.points >= 0 ? '+' : '') + fmt(l.points) + '</td><td class="r num">' + fmt(l.balance_after) + '</td></tr>').join('') +
      '</tbody></table></div></div>';
  }

  function approvalsView() {
    const list = (S.data.approvals || []).filter((x) => x.brand_id === S.brand);
    const st = { pending: '<span class="pill warn">รออนุมัติ</span>', approved: '<span class="pill">อนุมัติแล้ว</span>', rejected: '<span class="pill off">ไม่อนุมัติ</span>' };
    return '<div class="card"><h2>คำขอปรับแต้ม ' + esc(brand().name) + '</h2>' +
      (list.length ? '<div class="wrap"><table class="tbl"><thead><tr><th>วันที่</th><th>สมาชิก</th><th class="r">แต้ม</th><th>เหตุผล</th><th>ผู้ขอ</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
        list.map((x) => '<tr><td>' + date(x.created_at) + '</td><td>' + esc(x.member_id) + '</td><td class="r num">' + (x.points > 0 ? '+' : '') + fmt(x.points) + '</td><td>' + esc(x.reason) + '</td><td>' + esc(x.requested_by_name || x.requested_by) + '</td><td>' + (st[x.status] || esc(x.status)) + '</td>' +
          '<td class="r">' + (x.status === 'pending' && x.requested_by !== S.staff.id ? '<button class="btn good sm" data-a="decide" data-v="' + x.id + ':approve">อนุมัติ</button> <button class="btn danger sm" data-a="decide" data-v="' + x.id + ':reject">ไม่อนุมัติ</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="muted">ยังไม่มีคำขอ</p>') + '</div>';
  }

  function branchesView() {
    const list = (S.data.branches || []).filter((x) => x.brand_id === S.brand);
    return '<div class="card"><div class="hd"><h2>สาขา ' + esc(brand().name) + '</h2><button class="btn" data-a="editBranch">+ เพิ่มสาขา</button></div><div class="wrap"><table class="tbl"><thead><tr><th>รหัส</th><th>สาขา</th><th>โทร</th><th>เวลาเปิด</th><th>POS</th><th>สะสมแต้ม</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
      list.map((b) => '<tr class="' + (b.is_active ? '' : 'off') + '"><td>' + esc(b.id) + '</td><td>' + esc(b.name) + '</td><td>' + esc(b.phone || '-') + '</td><td>' + esc(String(b.open_time || '').slice(0, 5)) + ' - ' + esc(String(b.close_time || '').slice(0, 5)) + '</td><td>' + (b.pos_mode === 'manual' ? 'กรอกเอง' : b.pos_last_seen ? 'ล่าสุด ' + date(b.pos_last_seen) : '<span class="pill off">ยังไม่เชื่อม</span>') + '</td>' +
        '<td>' + (b.earn_enabled ? '<span class="pill">เปิด</span>' : '<span class="pill off">ปิด</span>') + '</td><td>' + (b.is_active ? '<span class="pill">เปิดอยู่</span>' : '<span class="pill off">ปิดสาขา</span>') + '</td>' +
        '<td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-a="toggleEarn" data-v="' + esc(b.id) + '">' + (b.earn_enabled ? 'ปิดสะสมแต้ม' : 'เปิดสะสมแต้ม') + '</button> <button class="btn ghost sm" data-a="editBranch" data-v="' + esc(b.id) + '">แก้ไข</button></td></tr>').join('') +
      '</tbody></table></div><small class="muted">ลบสาขาได้เฉพาะสาขาที่ยังไม่มีบิลหรือสมาชิก ถ้ามีประวัติแล้วให้ "ปิดสาขา" (ลูกค้าจะไม่เห็นในหน้าสมัคร แต่ข้อมูลเก่ายังอยู่ครบ)</small></div>';
  }
  function branchForm(id) {
    const b = id ? S.data.branches.find((x) => x.id === id) : { id: '', name: '', phone: '', open_time: '', close_time: '', pos_mode: 'api', earn_enabled: true, is_active: true };
    return '<form class="grid" data-f="branch" data-v="' + esc(id || '') + '">' +
      (id ? '' : '<div class="field"><label for="b-id">รหัสสาขา</label><input id="b-id" name="id" required pattern="[A-Za-z0-9]{2,10}" autocapitalize="characters" placeholder="เช่น HL04" data-autofocus><span class="hint">ใช้ผูกกับเครื่อง POS แก้ภายหลังไม่ได้</span></div>') +
      '<div class="field"><label for="b-name">ชื่อสาขา</label><input id="b-name" name="name" required value="' + esc(b.name) + '"' + (id ? ' data-autofocus' : '') + '></div>' +
      '<div class="field"><label for="b-phone">เบอร์โทร</label><input id="b-phone" name="phone" type="tel" value="' + esc(b.phone || '') + '"></div>' +
      '<div class="field"><label for="b-open">เปิด</label><input id="b-open" name="open" type="time" value="' + esc(String(b.open_time || '').slice(0, 5)) + '"></div>' +
      '<div class="field"><label for="b-close">ปิด</label><input id="b-close" name="close" type="time" value="' + esc(String(b.close_time || '').slice(0, 5)) + '"></div>' +
      '<div class="field"><label for="b-pos">การส่งบิล</label><select id="b-pos" name="posMode"><option value="api"' + (b.pos_mode !== 'manual' ? ' selected' : '') + '>เครื่อง POS ส่งอัตโนมัติ</option><option value="manual"' + (b.pos_mode === 'manual' ? ' selected' : '') + '>พนักงานกรอกเอง</option></select></div>' +
      '<label class="check"><input type="checkbox" name="earnEnabled"' + (b.earn_enabled ? ' checked' : '') + '>สะสมแต้มได้</label>' +
      '<label class="check"><input type="checkbox" name="active"' + (b.is_active ? ' checked' : '') + '>เปิดสาขา (แสดงในหน้าสมัคร)</label>' +
      errHtml() + '<div class="actions"><button class="btn">' + (id ? 'บันทึก' : 'เพิ่มสาขา') + '</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button>' +
      (id ? '<button type="button" class="btn danger" style="margin-left:auto" data-a="delBranch" data-v="' + esc(id) + '">ลบสาขา</button>' : '') + '</div></form>';
  }


  const ROLE_PILL = { super: 'pill', marketing: 'pill', brand: 'pill', branchmgr: 'pill warn', cashier: 'pill off' };
  function scopeText(x) {
    const sc = x.scopes || [];
    if (!sc.length) return '-';
    if (sc.some((c) => c.type === 'group')) return 'ทุกแบรนด์';
    return sc.map((c) => (c.type === 'brand' ? brandName(c.id) : branchLabel(c.id)) + (c.limit ? ' (อนุมัติได้ ' + fmt(c.limit) + ' แต้ม)' : '')).join(', ');
  }
  function branchLabel(id) { for (const b of S.allBrands) { const x = b.branches.find((y) => y.id === id); if (x) return x.name; } return id; }
  function staffView() {
    const d = S.data.staff; if (!d) return '';
    const roleName = (id) => (d.roles.find((r) => r.id === id) || {}).name || id;
    return '<div class="card"><div class="hd"><h2>ผู้ใช้หลังบ้าน</h2><button class="btn" data-a="editStaff">+ เพิ่มผู้ใช้</button></div>' +
      '<div class="wrap"><table class="tbl"><thead><tr><th>ชื่อผู้ใช้</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>ดูแล</th><th>เข้าล่าสุด</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
      d.staff.map((x) => '<tr class="' + (x.is_active ? '' : 'off') + '"><td><b>' + esc(x.id) + '</b>' + (x.email ? '<br><small class="muted">' + esc(x.email) + '</small>' : '') + '</td><td>' + esc(x.name) + '</td>' +
        '<td><span class="' + (ROLE_PILL[x.role] || 'pill') + '">' + esc(roleName(x.role)) + '</span></td><td>' + esc(scopeText(x)) + '</td><td>' + (x.last_login_at ? date(x.last_login_at) : '<span class="muted">ยังไม่เคย</span>') + '</td>' +
        '<td>' + (!x.is_active ? '<span class="pill off">ปิดใช้งาน</span>' : x.must_change_password ? '<span class="pill warn">รอเปลี่ยนรหัส</span>' : '<span class="pill">ใช้งาน</span>') + '</td>' +
        '<td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-a="editStaff" data-v="' + esc(x.id) + '">แก้ไข</button> <button class="btn ghost sm" data-a="staffPw" data-v="' + esc(x.id) + '">ตั้งรหัสผ่าน</button>' + (x.id !== S.staff.id ? ' <button class="btn danger sm" data-a="delStaff" data-v="' + esc(x.id) + '">ลบ</button>' : '') + '</td></tr>').join('') +
      '</tbody></table></div></div>' +
      '<div class="card"><h2>สิทธิ์ของแต่ละตำแหน่ง</h2><div class="wrap"><table class="tbl"><thead><tr><th>เมนู</th>' + d.roles.map((r) => '<th>' + esc(r.name) + '</th>').join('') + '</tr></thead><tbody>' +
      Object.keys(PAGE_NAMES).filter((p) => d.roles.some((r) => r.pages.includes(p))).map((p) => '<tr><td>' + PAGE_NAMES[p] + '</td>' + d.roles.map((r) => '<td>' + (r.pages.includes(p) ? '✓' : '<span class="muted">-</span>') + '</td>').join('') + '</tr>').join('') +
      '<tr><td>ขอบเขตข้อมูล</td>' + d.roles.map((r) => '<td>' + ({ group: 'ทุกแบรนด์', brand: 'แบรนด์ที่เลือก', branch: 'สาขาที่เลือก' }[r.scope]) + '</td>').join('') + '</tr>' +
      '</tbody></table></div><small class="muted">แคชเชียร์ไม่มีสิทธิ์เข้าหลังบ้าน (ใช้เฉพาะเครื่อง POS) · ผู้จัดการสาขาอนุมัติแต้มได้ไม่เกินวงเงินที่ตั้ง · เห็นเบอร์โทรเต็มเฉพาะผู้ดูแลระบบ</small></div>';
  }
  function staffForm(id) {
    const d = S.data.staff; const x = id ? d.staff.find((y) => y.id === id) : null;
    const role = (S.edit.role) || (x ? x.role : 'brand');
    const scope = (d.roles.find((r) => r.id === role) || {}).scope;
    const cur = new Set(S.edit.scopes || (x && x.role === role ? x.scopes.map((c) => c.id) : []));
    const limit = x && x.scopes[0] && x.scopes[0].limit;
    let scopeHtml = '';
    if (scope === 'brand') scopeHtml = '<fieldset class="field" style="grid-column:1/-1;border:0;padding:0;margin:0"><legend style="font-size:13px;font-weight:600;color:var(--muted)">แบรนด์ที่ดูแล</legend>' + S.allBrands.map((b) => '<label class="check"><input type="checkbox" name="scope" value="' + b.id + '"' + (cur.has(b.id) ? ' checked' : '') + '>' + esc(b.name) + '</label>').join('') + '</fieldset>';
    if (scope === 'branch') scopeHtml = '<fieldset class="field" style="grid-column:1/-1;border:0;padding:0;margin:0"><legend style="font-size:13px;font-weight:600;color:var(--muted)">สาขาที่ดูแล</legend>' + S.allBrands.map((b) => b.branches.map((br) => '<label class="check"><input type="checkbox" name="scope" value="' + br.id + '"' + (cur.has(br.id) ? ' checked' : '') + '>' + esc(br.name) + ' <small class="muted">(' + esc(b.short_name) + ')</small></label>').join('')).join('') + '</fieldset>' +
      (role === 'branchmgr' ? '<div class="field"><label for="s-lim">อนุมัติแต้มได้ไม่เกิน (แต้มต่อครั้ง)</label><input id="s-lim" name="approveLimit" type="number" min="0" value="' + esc(limit || 200) + '"></div>' : '');
    if (scope === 'group') scopeHtml = '<p class="muted" style="grid-column:1/-1;margin:0;font-size:14px">ตำแหน่งนี้ดูแลทุกแบรนด์ทุกสาขา</p>';
    return '<form class="grid" data-f="staff" data-v="' + esc(id || '') + '">' +
      (x ? '' : '<div class="field"><label for="s-id">ชื่อผู้ใช้ (ใช้ล็อกอิน)</label><input id="s-id" name="id" required pattern="[A-Za-z0-9._\-]{3,30}" autocomplete="off" data-autofocus></div>') +
      '<div class="field"><label for="s-name">ชื่อ - นามสกุล</label><input id="s-name" name="name" required value="' + esc(S.edit.name != null ? S.edit.name : x ? x.name : '') + '"' + (x ? ' data-autofocus' : '') + '></div>' +
      '<div class="field"><label for="s-email">อีเมล (ล็อกอินแทนชื่อผู้ใช้ได้)</label><input id="s-email" name="email" type="email" value="' + esc(x ? x.email || '' : '') + '"></div>' +
      '<div class="field"><label for="s-role">ตำแหน่ง</label><select id="s-role" name="role">' + d.roles.map((r) => '<option value="' + r.id + '"' + (r.id === role ? ' selected' : '') + '>' + esc(r.name) + '</option>').join('') + '</select></div>' +
      scopeHtml +
      (x ? '' : '<div class="field"><label for="s-pw">รหัสผ่านชั่วคราว</label><input id="s-pw" name="password" type="text" minlength="8" required autocomplete="off"><span class="hint">พนักงานต้องเปลี่ยนเองตอนเข้าครั้งแรก</span></div>') +
      (x && x.id !== S.staff.id ? '<label class="check"><input type="checkbox" name="active"' + (x.is_active ? ' checked' : '') + '>เปิดใช้งาน</label>' : '') +
      errHtml() + '<div class="actions"><button class="btn">' + (x ? 'บันทึก' : 'เพิ่มผู้ใช้') + '</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button></div></form>';
  }
  function staffPwForm(id) {
    return '<form class="grid" data-f="staffpw" data-v="' + esc(id) + '"><div class="field" style="grid-column:1/-1"><label for="s-pw">รหัสผ่านใหม่ (อย่างน้อย 8 ตัว)</label><input id="s-pw" name="password" type="text" minlength="8" required autocomplete="off" data-autofocus>' +
      '<span class="hint">' + (id === S.staff.id ? 'ใช้กับบัญชีของคุณเองได้ทันที' : 'เป็นรหัสชั่วคราว พนักงานต้องเปลี่ยนเองตอนเข้าครั้งถัดไป') + '</span></div>' +
      errHtml() + '<div class="actions"><button class="btn">ตั้งรหัสผ่าน</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button></div></form>';
  }
  function auditView() {
    const list = S.data.audit || [];
    return '<div class="card"><h2>ประวัติการแก้ไขล่าสุด</h2>' + (list.length ? '<div class="wrap"><table class="tbl"><thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>รายการ</th><th>รายละเอียด</th></tr></thead><tbody>' +
      list.map((x) => '<tr><td style="white-space:nowrap">' + date(x.at) + ' ' + new Date(x.at).toTimeString().slice(0, 5) + '</td><td>' + esc(x.actor_name || x.actor_id || x.actor_type) + '</td><td>' + esc(x.action) + '</td><td>' + esc(x.detail || '') + '</td></tr>').join('') + '</tbody></table></div>' : '<p class="muted">ยังไม่มีรายการ</p>') + '</div>';
  }

  function dialog() {
    const e = S.edit; let title = ''; let body = '';
    if (e.kind === 'reward') { const r = e.id === 'new' ? null : S.data.rewards.find((x) => String(x.id) === String(e.id)); title = r ? 'แก้ไขของรางวัล' : 'เพิ่มของรางวัล · ' + brand().name; body = rewardForm(r); }
    if (e.kind === 'coupon') { title = e.id ? 'แก้ไขคูปอง' : 'สร้างคูปอง · ' + brand().name; body = couponForm(e.id); }
    if (e.kind === 'staff') { title = e.id ? 'แก้ไขผู้ใช้ ' + e.id : 'เพิ่มผู้ใช้'; body = staffForm(e.id); }
    if (e.kind === 'branch') { title = e.id ? 'แก้ไขสาขา ' + e.id : 'เพิ่มสาขา · ' + brand().name; body = branchForm(e.id); }
    if (e.kind === 'staffpw') { title = 'ตั้งรหัสผ่านใหม่ให้ ' + e.id; body = staffPwForm(e.id); }
    return '<div class="scrim" data-a="close"></div><div class="dialog' + (e.kind === 'coupon' ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' + body + '</div>';
  }

  /* ---------- การกด ---------- */
  const A = {
    reload: () => location.reload(),
    logout: () => logout(),
    page: async (v) => { S.page = v; S.edit = null; S.err = ''; S.member = null; await load(); window.scrollTo(0, 0); },
    brand: async (v) => { S.brand = v; store.set('crm-admin-brand', v); S.member = null; applyTheme(); await load(); },
    close: () => { S.edit = null; S.err = ''; render(); },
    editReward: (v) => { S.edit = { kind: 'reward', id: v }; S.err = ''; render(); },
    editBranch: (v) => { S.edit = { kind: 'branch', id: v || null }; S.err = ''; render(); },
    delBranch: async (v) => {
      if (!confirm('ลบสาขา ' + v + ' ถาวร?')) return;
      await api('DELETE', '/api/admin/branches/' + encodeURIComponent(v)); S.edit = null; toast('ลบสาขาแล้ว'); await reloadBrands(); await load();
    },
    delCoupon: async (v) => {
      const t = S.data.coupons.find((x) => String(x.id) === String(v));
      const msg = 'ลบคูปอง "' + t.title + '" ถาวร?' + (t.issued ? '\n\nคูปองที่แจกไปแล้ว ' + t.issued + ' ใบ (ใช้แล้ว ' + t.used + ') จะหายจากบัญชีลูกค้าด้วย ถ้าแค่อยากหยุดแจกให้กด "ปิด" แทน\n\nพิมพ์คำว่า ลบ เพื่อยืนยัน' : '');
      if (t.issued ? prompt(msg) !== 'ลบ' : !confirm(msg)) return;
      const r = await api('DELETE', '/api/admin/coupon-templates/' + v); toast('ลบคูปองแล้ว' + (r.removedCoupons ? ' (รวม ' + r.removedCoupons + ' ใบที่แจกไป)' : '')); await load();
    },
    delReward: async (v) => {
      const r = S.data.rewards.find((x) => String(x.id) === String(v));
      if (!confirm('ลบของรางวัล "' + r.name + '" ถาวร? คูปองที่ลูกค้าแลกไปแล้วยังใช้ได้ตามเดิม')) return;
      await api('DELETE', '/api/admin/rewards/' + v); S.edit = null; toast('ลบของรางวัลแล้ว'); await load();
    },
    delMember: async (v) => {
      const ans = prompt('ลบสมาชิก ' + v + ' ถาวร?\n\nข้อมูลส่วนตัว แต้มทุกแบรนด์ คูปอง และประวัติแต้มจะถูกลบและกู้คืนไม่ได้ บิลขายยังเก็บไว้แบบไม่ระบุตัวตน\n\nพิมพ์เลขสมาชิก ' + v + ' เพื่อยืนยัน');
      if (ans === null) return;
      if (ans.trim().toUpperCase() !== v) return toast('เลขสมาชิกไม่ตรง ยังไม่ได้ลบ');
      await api('DELETE', '/api/admin/members/' + encodeURIComponent(v)); S.member = null; toast('ลบสมาชิกแล้ว'); await load();
    },
    delStaff: async (v) => {
      if (!confirm('ลบผู้ใช้ ' + v + ' ถาวร? ถ้าแค่ลาออกชั่วคราวให้ใช้ "แก้ไข" แล้วปิดใช้งานแทน (ประวัติการทำงานยังอยู่ทั้งสองแบบ)')) return;
      await api('DELETE', '/api/admin/staff/' + encodeURIComponent(v)); toast('ลบผู้ใช้แล้ว'); await load();
    },
    cfilter: (v) => { S.cfilter = v; render(); },
    editCoupon: (v) => {
      const t = v ? S.data.coupons.find((x) => String(x.id) === String(v)) : null;
      S.edit = { kind: 'coupon', id: v || null, imageId: t ? t.image_id : null, imageUrl: t && t.image_id ? '/api/public/coupon-images/' + t.image_id : null }; S.err = ''; render();
    },
    toggleCoupon: async (v) => {
      const t = S.data.coupons.find((x) => String(x.id) === String(v));
      if (t.is_active && !confirm('ปิดคูปอง "' + t.title + '"? จะหยุดแจกทันที (คูปองที่ลูกค้าได้ไปแล้วยังใช้ได้จนหมดอายุ)')) return;
      await api('PATCH', '/api/admin/coupon-templates/' + v, { active: !t.is_active }); toast(t.is_active ? 'ปิดคูปองแล้ว' : 'เปิดคูปองแล้ว'); await load();
    },
    dropImage: () => { S.edit.imageId = null; S.edit.imageUrl = null; rerenderCoupon(); },
    myPassword: () => passwordView(false),
    backHome: () => render(),
    editStaff: (v) => { S.edit = { kind: 'staff', id: v || null }; S.err = ''; render(); },
    staffPw: (v) => { S.edit = { kind: 'staffpw', id: v }; S.err = ''; render(); },
    member: async (v) => { await openMember(v); render(); window.scrollTo(0, 0); },
    unmember: () => { S.member = null; render(); },
    decide: async (v) => {
      const [id, d] = v.split(':');
      await api('POST', '/api/admin/point-adjustments/' + id + '/' + d, {}); toast(d === 'approve' ? 'อนุมัติแล้ว' : 'ไม่อนุมัติแล้ว'); await load();
    },
    toggleEarn: async (v) => {
      const b = S.data.branches.find((x) => x.id === v);
      await api('PATCH', '/api/admin/branches/' + encodeURIComponent(v), { earnEnabled: !b.earn_enabled }); toast('บันทึกแล้ว'); await load();
    }
  };
  const F = {
    login: async (o) => {
      try {
        const r = await api('POST', '/api/admin/login', o);
        S.token = r.token; S.staff = r.staff; store.set('crm-admin-token', r.token); await enter();
      } catch (e) { loginView(e.message); }
    },
    reward: async (o, id) => {
      const body = { brand: S.brand, name: o.name, cat: o.cat, cost: o.cost, type: o.type, value: o.value || 0, min: o.min || 0, days: o.days, stock: o.stock === '' ? null : o.stock, active: o.active };
      if (id === 'new') await api('POST', '/api/admin/rewards', body); else await api('PATCH', '/api/admin/rewards/' + id, body);
      S.edit = null; toast('บันทึกของรางวัลแล้ว'); await load();
    },
    coupon: async (_o, id, el) => {
      const body = couponBody(el);
      if (id) await api('PATCH', '/api/admin/coupon-templates/' + id, body); else await api('POST', '/api/admin/coupon-templates', body);
      S.edit = null; toast(id ? 'บันทึกคูปองแล้ว' : 'สร้างคูปองแล้ว'); await load();
    },
    gift: async (o, id) => {
      if (!o.templateId) throw new Error('เลือกคูปองที่จะมอบ');
      const r = await api('POST', '/api/admin/members/' + encodeURIComponent(id) + '/coupons', { templateId: o.templateId });
      toast('มอบคูปองแล้ว (' + r.code + ')'); await openMember(id); render();
    },
    rule: async (o) => {
      await api('PUT', '/api/admin/earn-rules/' + S.brand, { baht: o.baht, pts: o.pts, base: o.base, rounding: o.rounding, welcome: Number(o.welcome), expiryMonths: Number(o.expiryMonths), backdays: Number(o.backdays),
        tiers: { gold: Number(o.gold), platinum: Number(o.platinum) }, promo: { on: o.promoOn, day: Number(o.promoDay), mult: Number(o.promoMult) } });
      await api('PATCH', '/api/admin/brands/' + S.brand + '/notify', { pointsNotify: o.pointsNotify, pointsNotifyMin: o.pointsNotifyMin });
      await api('PATCH', '/api/admin/brands/' + S.brand + '/review', { reviewPoints: Number(o.reviewPoints) });
      S.err = ''; toast('บันทึกกฎแต้มแล้ว'); await load();
    },
    password: async (o) => {
      const forced = S.staff.mustChange;
      if (o.password !== o.confirm) return passwordView(forced, 'รหัสผ่านใหม่สองช่องไม่ตรงกัน');
      try {
        const r = await api('POST', '/api/admin/password', { current: o.current, password: o.password });
        S.staff = r.staff; toast('เปลี่ยนรหัสผ่านแล้ว');
        if (forced) await enter(); else render();
      } catch (e) { if (!e.silent) passwordView(forced, e.message); }
    },
    staff: async (o, id, el) => {
      const scopeIds = [...el.querySelectorAll('input[name="scope"]:checked')].map((x) => x.value);
      const body = { name: o.name, email: o.email, role: o.role, scopeIds, approveLimit: o.approveLimit };
      if ('active' in o) body.active = o.active;
      if (id) await api('PATCH', '/api/admin/staff/' + encodeURIComponent(id), body);
      else await api('POST', '/api/admin/staff', Object.assign(body, { id: o.id, password: o.password }));
      S.edit = null; toast(id ? 'บันทึกแล้ว' : 'เพิ่มผู้ใช้แล้ว แจ้งชื่อผู้ใช้และรหัสชั่วคราวให้พนักงาน'); await load();
    },
    branch: async (o, id) => {
      const body = { brand: S.brand, id: o.id, name: o.name, phone: o.phone, open: o.open, close: o.close, posMode: o.posMode, earnEnabled: o.earnEnabled, active: o.active };
      if (id) await api('PATCH', '/api/admin/branches/' + encodeURIComponent(id), body); else await api('POST', '/api/admin/branches', body);
      S.edit = null; toast(id ? 'บันทึกสาขาแล้ว' : 'เพิ่มสาขาแล้ว'); await reloadBrands(); await load();
    },
    staffpw: async (o, id) => {
      await api('POST', '/api/admin/staff/' + encodeURIComponent(id) + '/password', { password: o.password });
      S.edit = null; toast('ตั้งรหัสผ่านแล้ว'); await load();
    },
    search: async (o) => { S.q = o.q; S.member = null; await load(); },
    adjust: async (o, id) => {
      await api('POST', '/api/admin/point-adjustments', { memberId: id, brand: S.brand, points: o.points, reason: o.reason });
      toast('ส่งคำขอปรับแต้มแล้ว รออีกคนอนุมัติ'); await openMember(id); render();
    }
  };

  async function guard(fn, isForm) {
    if (S.busy) return; S.busy = true;
    try { await fn(); } catch (e) {
      if (e.silent) return;
      const ce = document.getElementById('c-err');
      if (isForm && ce) { ce.textContent = e.message; ce.hidden = false; ce.scrollIntoView({ block: 'nearest' }); }
      else if (isForm && (S.edit || S.page === 'rules')) { S.err = e.message; render(); } else toast(e.message);
    } finally { S.busy = false; }
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-a]');
    if (!el || el.disabled) return;
    const fn = A[el.dataset.a]; if (!fn) return;
    e.preventDefault();
    guard(() => fn(el.dataset.v, el));
  });
  document.addEventListener('submit', (e) => {
    const el = e.target.closest('form[data-f]'); if (!el) return;
    e.preventDefault();
    const fn = F[el.dataset.f]; if (!fn) return;
    if (el.dataset.f === 'login' || el.dataset.f === 'password') { fn(form(el)); return; }
    guard(() => fn(form(el), el.dataset.v, el), true);
  });
  document.addEventListener('input', (e) => { const f = e.target.closest && e.target.closest('form[data-f="coupon"]'); if (f) syncCoupon(f); });
  document.addEventListener('change', async (e) => {
    const f = e.target.closest && e.target.closest('form[data-f="coupon"]');
    if (f) syncCoupon(f);
    if (e.target.id !== 'c-file' || !e.target.files[0]) return;
    const box = document.getElementById('c-img'); box.innerHTML = '<span>กำลังอัปโหลด…</span>';
    try {
      const dataUrl = await shrinkImage(e.target.files[0]);
      const r = await api('POST', '/api/admin/coupon-images', { dataUrl, brand: S.brand });
      S.edit.imageId = r.id; S.edit.imageUrl = r.url;
    } catch (err) { if (!err.silent) toast(err.message); }
    e.target.value = ''; rerenderCoupon();
  });
  document.addEventListener('change', (e) => {
    if (e.target.id !== 's-role' || !S.edit) return;
    const f = e.target.form;
    S.edit.role = e.target.value; S.edit.scopes = null;
    const n = f.querySelector('#s-name'); if (n) S.edit.name = n.value;
    const keep = {}; for (const k of ['s-id', 's-email', 's-pw']) { const x = f.querySelector('#' + k); if (x) keep[k] = x.value; }
    render();
    for (const k in keep) { const x = document.getElementById(k); if (x) x.value = keep[k]; }
    document.getElementById('s-role').focus();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.edit) A.close(); });

  boot();
})();
