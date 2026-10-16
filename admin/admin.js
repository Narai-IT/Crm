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
  function loginView(msg) {
    $app.innerHTML = '<div class="center"><form class="login" data-f="login"><h1>หลังบ้าน CRM</h1><span class="muted">เข้าสู่ระบบด้วยรหัสพนักงาน</span>' +
      '<div class="field"><label for="u">รหัสพนักงานหรืออีเมล</label><input id="u" name="username" autocomplete="username" required></div>' +
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
    if (S.page === 'coupons') d.coupons = await api('GET', '/api/admin/coupons');
    if (S.page === 'rules') d.rules = await api('GET', '/api/admin/earn-rules');
    if (S.page === 'members') { d.members = await api('GET', '/api/admin/members?brand=' + b + '&q=' + encodeURIComponent(S.q)); if (S.member) await openMember(S.member.member.id); }
    if (S.page === 'approvals') d.approvals = await api('GET', '/api/admin/point-adjustments');
    if (S.page === 'branches') d.branches = await api('GET', '/api/admin/branches');
    if (S.page === 'staff') d.staff = await api('GET', '/api/admin/staff');
    if (S.page === 'audit') d.audit = await api('GET', '/api/admin/audit-logs');
    render();
  }
  async function openMember(id) { S.member = await api('GET', '/api/admin/members/' + encodeURIComponent(id)); }

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
      '<div class="actions"><button class="btn">' + (isNew ? 'เพิ่มของรางวัล' : 'บันทึก') + '</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button></div></form>';
  }

  function couponsView() {
    const c = S.data.coupons; if (!c) return '';
    const w = c.welcome.find((x) => x.brand_id === S.brand) || {};
    const codes = c.codes.filter((x) => x.brand_id === S.brand || x.brand_id === null);
    const live = (x) => (!x.expires_at || new Date(x.expires_at) > new Date()) && (x.max_uses === null || x.used_count < x.max_uses);
    return '<div class="card"><div class="hd"><h2>คูปองต้อนรับสมาชิกใหม่</h2><button class="btn ghost" data-a="editWelcome">แก้ไข</button></div>' +
      (w.template_id ? '<p style="margin:0"><b>' + esc(w.title) + '</b><br><span class="muted">ลด ' + disc(w.discount_type, w.discount_value) + (Number(w.min_spend) ? ' · ซื้อครบ ' + fmt(w.min_spend) + ' บาท' : '') + ' · ใช้ได้ ' + w.valid_days + ' วันหลังสมัคร</span></p>' : '<p class="muted" style="margin:0">ปิดอยู่ (สมัครแล้วได้แต่แต้มต้อนรับ)</p>') +
      '<small class="muted">แต้มต้อนรับตั้งที่เมนู "กฎแต้ม"</small></div>' +
      '<div class="card"><div class="hd"><h2>โค้ดคูปอง</h2><button class="btn" data-a="editCode">+ สร้างโค้ด</button></div><small class="muted">ลูกค้ากรอกโค้ดในหน้าสมาชิก เมนู "คูปอง" แล้วได้คูปองเข้ากระเป๋า (คนละ 1 ครั้งต่อโค้ด)</small>' +
      (codes.length ? '<div class="wrap"><table class="tbl"><thead><tr><th>โค้ด</th><th>คูปองที่ได้</th><th>ใช้ที่</th><th class="r">ใช้ไป / สูงสุด</th><th>หมดเขต</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
        codes.map((x) => '<tr class="' + (live(x) ? '' : 'off') + '"><td><b>' + esc(x.code) + '</b></td><td>' + esc(x.title) + '<br><small class="muted">ลด ' + disc(x.discount_type, x.discount_value) + (Number(x.min_spend) ? ' · ขั้นต่ำ ' + fmt(x.min_spend) : '') + ' · ' + x.valid_days + ' วัน</small></td>' +
          '<td>' + esc(brandName(x.brand_id)) + '</td><td class="r num">' + fmt(x.used_count) + ' / ' + (x.max_uses === null ? 'ไม่จำกัด' : fmt(x.max_uses)) + '</td><td>' + (x.expires_at ? date(x.expires_at) : 'ไม่มี') + '</td>' +
          '<td>' + (live(x) ? '<span class="pill">ใช้ได้</span>' : '<span class="pill off">ปิด</span>') + '</td><td class="r">' +
          (x.brand_id || S.staff.role === 'super' ? '<button class="btn ghost sm" data-a="editCode" data-v="' + esc(x.code) + '">แก้ไข</button>' : '') + '</td></tr>').join('') + '</tbody></table></div>'
        : '<p class="muted">ยังไม่มีโค้ด</p>') + '</div>';
  }
  function discountFields(x, withTitle) {
    return (withTitle ? '<div class="field" style="grid-column:1/-1"><label for="f-title">ชื่อคูปอง</label><input id="f-title" name="title" value="' + esc(x.title || '') + '" placeholder="เว้นว่าง = ตั้งชื่อให้อัตโนมัติ"></div>' : '') +
      '<div class="field"><label for="f-type">แบบส่วนลด</label><select id="f-type" name="type"><option value="baht"' + (x.discount_type !== 'pct' ? ' selected' : '') + '>ลดเป็นบาท</option><option value="pct"' + (x.discount_type === 'pct' ? ' selected' : '') + '>ลดเป็น %</option></select></div>' +
      '<div class="field"><label for="f-val">มูลค่าส่วนลด</label><input id="f-val" name="value" type="number" min="1" step="0.01" value="' + esc(Number(x.discount_value) || '') + '" required></div>' +
      '<div class="field"><label for="f-min">ยอดซื้อขั้นต่ำ (บาท)</label><input id="f-min" name="min" type="number" min="0" value="' + esc(Number(x.min_spend) || 0) + '"></div>' +
      '<div class="field"><label for="f-days">ใช้ได้ (วัน)</label><input id="f-days" name="days" type="number" min="1" max="365" value="' + esc(x.valid_days || 30) + '"></div>';
  }
  function welcomeForm() {
    const w = S.data.coupons.welcome.find((x) => x.brand_id === S.brand) || {};
    return '<form class="grid" data-f="welcome"><label class="check" style="grid-column:1/-1"><input type="checkbox" name="on"' + (w.template_id ? ' checked' : '') + '>แจกคูปองเมื่อสมัครสมาชิก</label>' +
      discountFields(w.template_id ? w : { discount_type: 'pct', discount_value: 10, valid_days: 30 }, true) +
      '<p class="muted" style="grid-column:1/-1;margin:0;font-size:13px">มีผลกับสมาชิกที่สมัครหลังจากนี้ คูปองที่แจกไปแล้วไม่เปลี่ยน</p>' + errHtml() +
      '<div class="actions"><button class="btn">บันทึก</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button></div></form>';
  }
  function codeForm(code) {
    const x = code ? S.data.coupons.codes.find((c) => c.code === code) : null;
    if (x) {
      return '<form class="grid" data-f="code" data-v="' + esc(x.code) + '"><p style="grid-column:1/-1;margin:0"><b>' + esc(x.code) + '</b> · ' + esc(x.title) + '<br><small class="muted">ใช้ไปแล้ว ' + fmt(x.used_count) + ' ครั้ง · ส่วนลดแก้ไม่ได้ ถ้าต้องการเปลี่ยนให้ปิดโค้ดนี้แล้วสร้างใหม่</small></p>' +
        '<div class="field"><label for="f-max">ใช้ได้สูงสุด (ครั้ง)</label><input id="f-max" name="maxUses" type="number" min="0" placeholder="ไม่จำกัด" value="' + (x.max_uses === null ? '' : esc(x.max_uses)) + '"></div>' +
        '<div class="field"><label for="f-exp">หมดเขต</label><input id="f-exp" name="expiresAt" type="date" value="' + isoDay(x.expires_at) + '"></div>' + errHtml() +
        '<div class="actions"><button class="btn">บันทึก</button><button type="button" class="btn danger" data-a="closeCode" data-v="' + esc(x.code) + '">ปิดโค้ดทันที</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button></div></form>';
    }
    return '<form class="grid" data-f="code"><div class="field"><label for="f-code">โค้ด</label><input id="f-code" name="code" required pattern="[A-Za-z0-9]{4,20}" autocapitalize="characters" data-autofocus placeholder="เช่น HUMLAI50"><span class="hint">ตัวอังกฤษ/ตัวเลข 4-20 ตัว</span></div>' +
      (S.staff.role === 'super' ? '<div class="field"><label for="f-scope">ใช้ที่</label><select id="f-scope" name="brand"><option value="' + S.brand + '">' + esc(brand().name) + ' เท่านั้น</option><option value="">ทุกแบรนด์ในเครือ</option></select></div>' : '<input type="hidden" name="brand" value="' + S.brand + '">') +
      discountFields({ discount_type: 'baht', valid_days: 30 }, true) +
      '<div class="field"><label for="f-max">ใช้ได้สูงสุด (ครั้ง)</label><input id="f-max" name="maxUses" type="number" min="0" placeholder="ไม่จำกัด"></div>' +
      '<div class="field"><label for="f-exp">หมดเขตกรอกโค้ด</label><input id="f-exp" name="expiresAt" type="date"></div>' + errHtml() +
      '<div class="actions"><button class="btn">สร้างโค้ด</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button></div></form>';
  }
  const errHtml = () => (S.err ? '<div class="err" role="alert" style="grid-column:1/-1">' + esc(S.err) + '</div>' : '');

  function rulesView() {
    const r = (S.data.rules || []).find((x) => x.brand_id === S.brand);
    if (!r) return '<div class="card"><p class="muted">ยังไม่มีกฎแต้มของแบรนด์นี้</p></div>';
    return '<form class="card" data-f="rule"><h2>กฎแต้ม ' + esc(brand().name) + '</h2><div class="grid">' +
      '<div class="field"><label for="r-baht">ทุกกี่บาท</label><input id="r-baht" name="baht" type="number" min="1" step="0.01" value="' + Number(r.baht_per_unit) + '" required></div>' +
      '<div class="field"><label for="r-pts">ได้กี่แต้ม</label><input id="r-pts" name="pts" type="number" min="0" value="' + r.points_per_unit + '" required></div>' +
      '<div class="field"><label for="r-base">คิดจากยอด</label><select id="r-base" name="base">' + [['net', 'ยอดสุทธิหลังส่วนลด'], ['exvat', 'ยอดก่อน VAT'], ['gross', 'ยอดก่อนส่วนลด']].map((o) => '<option value="' + o[0] + '"' + (r.base_amount === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="r-round">เศษ</label><select id="r-round" name="rounding"><option value="floor"' + (r.rounding === 'floor' ? ' selected' : '') + '>ปัดทิ้ง</option><option value="round"' + (r.rounding === 'round' ? ' selected' : '') + '>ปัดครึ่งขึ้น</option></select></div>' +
      '<div class="field"><label for="r-wel">แต้มต้อนรับ</label><input id="r-wel" name="welcome" type="number" min="0" value="' + r.welcome_points + '"></div>' +
      '<div class="field"><label for="r-exp">แต้มหมดอายุ (เดือน)</label><input id="r-exp" name="expiryMonths" type="number" min="0" value="' + r.expiry_months + '"><span class="hint">0 = ไม่หมดอายุ</span></div>' +
      '<div class="field"><label for="r-back">ขอแต้มย้อนหลังได้ (วัน)</label><input id="r-back" name="backdays" type="number" min="0" value="' + r.backdate_days + '"></div>' +
      '<div class="field"><label for="r-gold">Gold เมื่อสะสมครบ (12 เดือน)</label><input id="r-gold" name="gold" type="number" min="0" value="' + r.gold_at + '"></div>' +
      '<div class="field"><label for="r-plat">Platinum เมื่อสะสมครบ</label><input id="r-plat" name="platinum" type="number" min="0" value="' + r.platinum_at + '"></div>' +
      '<label class="check"><input type="checkbox" name="promoOn"' + (r.promo_on ? ' checked' : '') + '>คูณแต้มประจำสัปดาห์</label>' +
      '<div class="field"><label for="r-day">วัน</label><select id="r-day" name="promoDay">' + DAYS.map((d, i) => '<option value="' + i + '"' + (r.promo_day === i ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></div>' +
      '<div class="field"><label for="r-mult">คูณ</label><input id="r-mult" name="promoMult" type="number" min="1" step="0.5" value="' + Number(r.promo_mult) + '"></div>' +
      '</div><small class="muted">มีผลกับบิลหลังบันทึก บิลเก่าคิดตามกฎเดิม · ใช้อยู่ตั้งแต่ ' + date(r.effective_from) + '</small>' + (S.err ? '<div class="err" role="alert">' + esc(S.err) + '</div>' : '') +
      '<div class="actions"><button class="btn">บันทึกกฎแต้ม</button></div></form>';
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
    return '<div class="card"><div class="hd"><h2>' + esc(m.full_name) + ' · ' + esc(m.id) + '</h2><button class="btn ghost sm" data-a="unmember">ปิด</button></div>' +
      '<div class="kpis"><div class="kpi"><small class="muted">แต้ม ' + esc(brand().short_name) + '</small><b class="num">' + fmt(w.balance) + '</b><small class="muted">ระดับ ' + esc(w.tier.name || '-') + '</small></div>' +
      '<div class="kpi"><small class="muted">เบอร์</small><b style="font-size:17px">' + esc(m.phone) + '</b><small class="muted">สมัคร ' + date(m.created_at) + '</small></div>' +
      '<div class="kpi"><small class="muted">คูปองพร้อมใช้</small><b class="num">' + coupons.length + '</b></div></div>' +
      '<form class="grid" data-f="adjust" data-v="' + esc(m.id) + '"><div class="field"><label for="a-pts">ปรับแต้ม (+ เพิ่ม / - ลด)</label><input id="a-pts" name="points" type="number" required></div>' +
      '<div class="field" style="grid-column:span 2"><label for="a-why">เหตุผล</label><input id="a-why" name="reason" required placeholder="เช่น ลืมสแกนบิล HL01-000123"></div><div class="actions" style="grid-column:auto"><button class="btn">ส่งขออนุมัติ</button></div></form>' +
      '<small class="muted">การปรับแต้มต้องให้อีกคนอนุมัติที่เมนู "อนุมัติแต้ม"</small>' +
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
    return '<div class="card"><h2>สาขา ' + esc(brand().name) + '</h2><div class="wrap"><table class="tbl"><thead><tr><th>รหัส</th><th>สาขา</th><th>เวลาเปิด</th><th>POS</th><th>สะสมแต้ม</th><th></th></tr></thead><tbody>' +
      list.map((b) => '<tr><td>' + esc(b.id) + '</td><td>' + esc(b.name) + '</td><td>' + esc(String(b.open_time || '').slice(0, 5)) + ' - ' + esc(String(b.close_time || '').slice(0, 5)) + '</td><td>' + (b.pos_last_seen ? 'ล่าสุด ' + date(b.pos_last_seen) : '<span class="pill off">ยังไม่เชื่อม</span>') + '</td>' +
        '<td>' + (b.earn_enabled ? '<span class="pill">เปิด</span>' : '<span class="pill off">ปิด</span>') + '</td><td class="r"><button class="btn ghost sm" data-a="toggleEarn" data-v="' + esc(b.id) + '">' + (b.earn_enabled ? 'ปิดสะสมแต้ม' : 'เปิดสะสมแต้ม') + '</button></td></tr>').join('') +
      '</tbody></table></div><small class="muted">เพิ่มสาขาหรือแก้ชื่อสาขา แจ้งผู้ดูแลระบบ</small></div>';
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
        '<td class="r" style="white-space:nowrap"><button class="btn ghost sm" data-a="editStaff" data-v="' + esc(x.id) + '">แก้ไข</button> <button class="btn ghost sm" data-a="staffPw" data-v="' + esc(x.id) + '">ตั้งรหัสผ่าน</button></td></tr>').join('') +
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
    if (e.kind === 'welcome') { title = 'คูปองต้อนรับ · ' + brand().name; body = welcomeForm(); }
    if (e.kind === 'code') { title = e.id ? 'แก้ไขโค้ด' : 'สร้างโค้ดคูปอง'; body = codeForm(e.id); }
    if (e.kind === 'staff') { title = e.id ? 'แก้ไขผู้ใช้ ' + e.id : 'เพิ่มผู้ใช้'; body = staffForm(e.id); }
    if (e.kind === 'staffpw') { title = 'ตั้งรหัสผ่านใหม่ให้ ' + e.id; body = staffPwForm(e.id); }
    return '<div class="scrim" data-a="close"></div><div class="dialog" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' + body + '</div>';
  }

  /* ---------- การกด ---------- */
  const A = {
    reload: () => location.reload(),
    logout: () => logout(),
    page: async (v) => { S.page = v; S.edit = null; S.err = ''; S.member = null; await load(); window.scrollTo(0, 0); },
    brand: async (v) => { S.brand = v; store.set('crm-admin-brand', v); S.member = null; applyTheme(); await load(); },
    close: () => { S.edit = null; S.err = ''; render(); },
    editReward: (v) => { S.edit = { kind: 'reward', id: v }; S.err = ''; render(); },
    editWelcome: () => { S.edit = { kind: 'welcome' }; S.err = ''; render(); },
    editCode: (v) => { S.edit = { kind: 'code', id: v || null }; S.err = ''; render(); },
    closeCode: async (v) => {
      if (!confirm('ปิดโค้ด ' + v + ' ทันที? ลูกค้าจะกรอกโค้ดนี้ไม่ได้อีก (คูปองที่รับไปแล้วยังใช้ได้)')) return;
      await api('PATCH', '/api/admin/promo-codes/' + encodeURIComponent(v), { active: false }); S.edit = null; toast('ปิดโค้ดแล้ว'); await load();
    },
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
    welcome: async (o) => {
      await api('PUT', '/api/admin/welcome-coupon/' + S.brand, o.on ? { title: o.title, type: o.type, value: o.value, min: o.min, days: o.days } : { off: true });
      S.edit = null; toast('บันทึกคูปองต้อนรับแล้ว'); await load();
    },
    code: async (o, code) => {
      if (code) await api('PATCH', '/api/admin/promo-codes/' + encodeURIComponent(code), { maxUses: o.maxUses, expiresAt: o.expiresAt || null });
      else await api('POST', '/api/admin/promo-codes', { code: o.code, brand: o.brand || null, title: o.title, type: o.type, value: o.value, min: o.min, days: o.days, maxUses: o.maxUses, expiresAt: o.expiresAt || null });
      S.edit = null; toast(code ? 'บันทึกโค้ดแล้ว' : 'สร้างโค้ดแล้ว'); await load();
    },
    rule: async (o) => {
      await api('PUT', '/api/admin/earn-rules/' + S.brand, { baht: o.baht, pts: o.pts, base: o.base, rounding: o.rounding, welcome: Number(o.welcome), expiryMonths: Number(o.expiryMonths), backdays: Number(o.backdays),
        tiers: { gold: Number(o.gold), platinum: Number(o.platinum) }, promo: { on: o.promoOn, day: Number(o.promoDay), mult: Number(o.promoMult) } });
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
      if (isForm && (S.edit || S.page === 'rules')) { S.err = e.message; render(); } else toast(e.message);
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
