/* หลังบ้าน CRM (ใช้งานจริง) · เสิร์ฟที่ /admin/
 * - ล็อกอินด้วยรหัสพนักงาน (POST /api/admin/login) ได้ token อายุ 12 ชม. เก็บไว้ในแท็บนี้เท่านั้น
 * - เมนูที่เห็นขึ้นกับตำแหน่ง และ server ตรวจสิทธิ์แบรนด์/สาขาซ้ำทุกคำขอ */
(function () {
  'use strict';
  const $app = document.getElementById('app');
  const S = {
    token: null, staff: null, brands: [], brand: null, page: 'rewards',
    data: {}, edit: null, err: '', q: '', member: null, busy: false,
    mf: { q: '', tier: '', branch: '', tag: '', page: 1 }, mtab: 'm', actf: 'all', tagPick: false
  };
  const MENU = [
    ['dash', 'dash', 'ภาพรวม'], ['rewards', 'rewards', 'ของรางวัล'], ['coupons', 'rewards', 'คูปอง'], ['rules', 'rules', 'กฎแต้ม'],
    ['members', 'members', 'สมาชิก'], ['approvals', 'approvals', 'อนุมัติแต้ม'], ['branches', 'branches', 'สาขา'], ['richmenu', 'line', 'ริชเมนู LINE'],
    ['staff', 'staff', 'ผู้ใช้และสิทธิ์'], ['audit', 'audit', 'ประวัติการแก้ไข']
  ];
  const NO_BRAND = ['staff', 'audit'];
  const PAGE_NAMES = { dash: 'ภาพรวม', members: 'สมาชิก', approvals: 'อนุมัติแต้ม', rules: 'กฎแต้ม', rewards: 'ของรางวัล/คูปอง', branches: 'สาขา', line: 'LINE / ริชเมนู', staff: 'ผู้ใช้และสิทธิ์', audit: 'ประวัติการแก้ไข' };
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
    if (S.page === 'rewards') [d.rewards, d.tpls] = await Promise.all([api('GET', '/api/admin/rewards'), api('GET', '/api/admin/coupon-templates?brand=' + b)]);
    if (S.page === 'coupons') d.coupons = await api('GET', '/api/admin/coupon-templates?brand=' + b);
    if (S.page === 'rules') d.rules = await api('GET', '/api/admin/earn-rules');
    if (S.page === 'members') {
      [d.members, d.tags] = await Promise.all([api('GET', '/api/admin/members?' + memberQs()), api('GET', '/api/admin/tags?brand=' + b)]);
      if (S.member) await openMember(S.member.member.id);
    }
    if (S.page === 'approvals') d.approvals = await api('GET', '/api/admin/point-adjustments');
    if (S.page === 'branches') d.branches = await api('GET', '/api/admin/branches');
    if (S.page === 'staff') d.staff = await api('GET', '/api/admin/staff');
    if (S.page === 'audit') d.audit = await api('GET', '/api/admin/audit-logs');
    if (S.page === 'richmenu') { d.rm = await api('GET', '/api/admin/richmenus?brand=' + b); if (!S.rm || S.rm.brand !== b) rmReset(); }
    render();
  }
  async function openMember(id) {
    const [m, tpls] = await Promise.all([api('GET', '/api/admin/members/' + encodeURIComponent(id) + '?brand=' + S.brand), can('rewards') ? api('GET', '/api/admin/coupon-templates?brand=' + S.brand) : Promise.resolve([])]);
    S.member = m;
    // คูปองที่มอบได้: ยังเปิด และอยู่ในช่วงแจก (ของขวัญขึ้นก่อน)
    S.giftable = tpls.filter((t) => couponState(t)[0] === 'เปิดใช้งาน' && t.brand_id === S.brand).sort((a, b) => (a.kind === 'gift' ? 0 : 1) - (b.kind === 'gift' ? 0 : 1));
  }

  /* ---------- หน้าจอ ---------- */
  function render() {
    const menu = MENU.filter((m) => can(m[1]));
    const title = (MENU.find((m) => m[0] === S.page) || [])[2] || '';
    const views = { dash: dashView, rewards: rewardsView, coupons: couponsView, rules: rulesView, members: membersView, approvals: approvalsView, branches: branchesView, staff: staffView, audit: auditView, richmenu: richmenuView };
    $app.innerHTML = '<div class="shell"><nav class="side" aria-label="เมนูหลังบ้าน"><div class="logo">หลังบ้าน CRM</div>' +
      menu.map((m) => '<button data-a="page" data-v="' + m[0] + '"' + (S.page === m[0] ? ' aria-current="page"' : '') + '>' + m[2] + '</button>').join('') +
      '<div class="who">' + esc(S.staff.name) + ' · ' + esc(S.staff.id) + '<br><button data-a="myPassword">เปลี่ยนรหัสผ่าน</button><button data-a="logout">ออกจากระบบ</button></div></nav>' +
      '<main class="main"><div class="top"><h1>' + esc(title) + '</h1>' +
      (NO_BRAND.includes(S.page) ? '' : S.brands.length > 1 ? '<div class="bpick" role="group" aria-label="เลือกแบรนด์">' + S.brands.map((b) => '<button data-a="brand" data-v="' + b.id + '" aria-pressed="' + (b.id === S.brand) + '">' + esc(b.short_name) + '</button>').join('') + '</div>' : '<b>' + esc(brand().name) + '</b>') +
      '</div>' + views[S.page]() + '</main></div>' + (S.edit ? dialog() : '');
    const auto = document.querySelector('[data-autofocus]'); if (auto) auto.focus();
    const cf = document.querySelector('form[data-f="coupon"]'); if (cf) { drawPick('free'); drawPick('cond'); syncCoupon(cf); }
    const rf = document.querySelector('form[data-f="reward"]'); if (rf) { drawPick('free'); drawPick('cond'); syncReward(rf); }
    const tf = document.querySelector('form[data-f="tag"]'); if (tf) syncTagForm(tf);
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

  const TIERS = [['SILVER', 'Silver'], ['GOLD', 'Gold'], ['PLATINUM', 'Platinum'], ['DIAMOND', 'Diamond']];
  const PERIODS = [['day', 'วัน'], ['week', 'สัปดาห์'], ['month', 'เดือน'], ['year', 'ปี'], ['all', 'ตลอดรายการ']];
  const today = () => new Date(Date.now() + 7 * 36e5).toISOString().slice(0, 10);
  function rewardState(r) {
    if (!r.is_active) return '<span class="pill off">ปิด</span>';
    if (r.stock !== null && r.stock <= 0) return '<span class="pill warn">หมด</span>';
    if (r.start_day && r.start_day > today()) return '<span class="pill warn">เริ่ม ' + date(r.start_day + 'T12:00:00+07:00') + '</span>';
    if (r.end_day && r.end_day < today()) return '<span class="pill off">หมดเวลา</span>';
    return '<span class="pill">เปิดแลก</span>';
  }
  function rewardsView() {
    const list = (S.data.rewards || []).filter((r) => r.brand_id === S.brand);
    return '<div class="note">ลูกค้ากดแลกในหน้าสมาชิก (เมนู "แลกแต้ม") หรือที่หน้าร้าน แล้วได้คูปองไปใช้ · แบบ "คูปอง" แลกเป็นคูปองที่สร้างไว้ในเมนูคูปอง</div>' +
      '<div class="card"><div class="hd"><h2>ของรางวัล ' + esc(brand().name) + '</h2><button class="btn" data-a="editReward" data-v="new">+ เพิ่มของรางวัล</button></div>' +
      (list.length ? '<div class="wrap"><table class="tbl"><thead><tr><th>ของรางวัล</th><th>ประเภท</th><th class="r">ใช้แต้ม</th><th>ระดับ</th><th class="r">คงเหลือ</th><th>จำกัดต่อคน</th><th class="r">แลกแล้ว</th><th>สถานะ</th><th></th></tr></thead><tbody>' +
        list.map((r) => '<tr class="' + (r.is_active ? '' : 'off') + '"><td><div class="rw-name">' + (r.image_id ? '<img alt="" src="/api/public/coupon-images/' + r.image_id + '">' : '') + '<b>' + esc(r.name) + '</b></div></td>' +
          '<td>' + (r.kind === 'coupon' ? 'คูปอง · ' + esc(r.coupon_title || '') : (CATS[r.category] || esc(r.category)) + (Number(r.discount_value) ? ' · ' + disc(r.discount_type, r.discount_value) : '')) + '</td>' +
          '<td class="r num">' + fmt(r.points_cost) + '</td><td>' + (r.tiers && r.tiers.length ? r.tiers.map((t) => (TIERS.find((x) => x[0] === t) || [t, t])[1]).join(', ') : 'ทุกระดับ') + '</td>' +
          '<td class="r num">' + (r.stock === null ? 'ไม่จำกัด' : fmt(r.stock)) + '</td><td>' + (r.limit_count ? r.limit_count + ' ครั้ง / ' + PERIODS.find((x) => x[0] === r.limit_period)[1] : 'ไม่จำกัด') + '</td>' +
          '<td class="r num">' + fmt(r.redeemed) + '</td><td>' + rewardState(r) + '</td>' +
          '<td class="r"><button class="btn ghost sm" data-a="editReward" data-v="' + r.id + '">แก้ไข</button></td></tr>').join('') + '</tbody></table></div>'
        : '<p class="muted">ยังไม่มีของรางวัล กด "เพิ่มของรางวัล"</p>') + '</div>';
  }
  function rewardForm(r) {
    const isNew = !r;
    r = r || { name: '', kind: 'general', category: 'food', points_cost: '', description: '', discount_type: 'baht', discount_value: '', min_spend: 0, valid_days: 30, stock: null, is_active: true, tiers: null, limit_count: null, limit_period: 'day', start_day: '', end_day: '' };
    const tpls = (S.data.tpls || []).filter((t) => t.is_active && t.kind !== 'internal');
    const row = (label, html, forId) => '<div class="rw-row"><label' + (forId ? ' for="' + forId + '"' : '') + '>' + label + '</label><div>' + html + '</div></div>';
    const radio = (name, val, cur, text) => '<label class="check"><input type="radio" name="' + name + '" value="' + val + '"' + (cur === val ? ' checked' : '') + '>' + text + '</label>';
    const tiers = r.tiers && r.tiers.length ? r.tiers : TIERS.map((t) => t[0]);
    return '<form class="rw-ed" data-f="reward" data-v="' + (isNew ? 'new' : r.id) + '">' +
      '<div class="rw-img"><div class="upl-img sq" id="rw-img">' + (S.edit.imageUrl ? '<img alt="" src="' + esc(S.edit.imageUrl) + '">' : '<span>+ เพิ่มรูป</span>') + '</div>' +
        '<div class="upl-side"><label class="btn ghost sm" for="rw-file">เลือกรูป</label><input id="rw-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="sr">' +
        (S.edit.imageUrl ? '<button type="button" class="btn ghost sm" data-a="dropRewardImage">ลบรูป</button>' : '') +
        '<span class="hint">ขนาดรูปที่แนะนำ 960 × 960 px · PNG, JPG, GIF · ระบบย่อรูปให้อัตโนมัติ</span></div></div>' +
      '<div class="rw-fields">' +
        row('ชื่อ*', '<input id="rw-name" name="name" value="' + esc(r.name) + '" required maxlength="80" data-autofocus>', 'rw-name') +
        row('จำนวนแต้ม*', '<input id="rw-cost" name="cost" type="number" min="1" inputmode="numeric" value="' + esc(r.points_cost) + '" required>', 'rw-cost') +
        row('รายละเอียด', '<textarea id="rw-desc" name="description" maxlength="1000" placeholder="เช่น เลือกเมนูข้าวมันไก่ได้ 1 จาน ไม่ร่วมกับโปรโมชั่นอื่น">' + esc(r.description || '') + '</textarea>', 'rw-desc') +
        row('ระดับ', '<div class="rw-inline">' + TIERS.map((t) => '<label class="check"><input type="checkbox" name="tier_' + t[0] + '"' + (tiers.includes(t[0]) ? ' checked' : '') + '>' + t[1] + '</label>').join('') + '</div>') +
        row('จำนวนในคลัง', '<div class="rw-inline">' + radio('stockMode', 'none', r.stock === null ? 'none' : 'set', 'ไม่ตั้งค่าจำนวน') + radio('stockMode', 'set', r.stock === null ? 'none' : 'set', 'ตั้งค่าจำนวน') +
          '<input name="stock" type="number" min="0" class="sm-in" aria-label="จำนวนในคลัง" value="' + (r.stock === null ? '' : esc(r.stock)) + '"></div>') +
        row('จำกัดต่อผู้ใช้', '<div class="rw-inline">' + radio('limitMode', 'none', r.limit_count ? 'set' : 'none', 'ไม่จำกัดจำนวน') + radio('limitMode', 'set', r.limit_count ? 'set' : 'none', '') +
          '<input name="limitCount" type="number" min="1" class="sm-in" aria-label="จำนวนครั้งต่อคน" value="' + esc(r.limit_count || '') + '"> ครั้ง / <select name="limitPeriod" aria-label="ต่อช่วงเวลา">' +
          PERIODS.map((x) => '<option value="' + x[0] + '"' + ((r.limit_period || 'day') === x[0] ? ' selected' : '') + '>' + x[1] + '</option>').join('') + '</select></div>') +
        row('ประเภท', '<div class="segr">' + [['general', 'ทั่วไป'], ['coupon', 'คูปอง']].map((k) => '<label><input type="radio" name="kind" value="' + k[0] + '"' + ((r.kind || 'general') === k[0] ? ' checked' : '') + '><span>' + k[1] + '</span></label>').join('') + '</div>') +
        '<div data-rk="general">' +
          row('หมวด', '<select id="rw-cat" name="cat">' + Object.entries(CATS).map(([k, v]) => '<option value="' + k + '"' + (r.category === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select>', 'rw-cat') +
          '<div data-show="val">' + row('มูลค่า (บาท/%)', '<div class="rw-inline"><input id="rw-val" name="value" type="number" min="0" step="0.01" class="sm-in" value="' + esc(Number(r.discount_value) || '') + '"><select name="type" aria-label="แบบส่วนลด"><option value="baht"' + (r.discount_type !== 'pct' ? ' selected' : '') + '>บาท</option><option value="pct"' + (r.discount_type === 'pct' ? ' selected' : '') + '>%</option></select></div><span class="hint">ของฟรี: ใส่ราคาของชิ้นนั้น (ใช้เป็นส่วนลดตอนปิดบิล) · % ใช้กับหมวดส่วนลด</span>', 'rw-val') + '</div>' +
          '<div class="rw-items">' + itemSections(false, r) + '</div>' +
          row('ยอดซื้อขั้นต่ำ', '<input id="rw-min" name="min" type="number" min="0" class="sm-in" value="' + esc(Number(r.min_spend) || 0) + '"> บาท', 'rw-min') +
          row('คูปองใช้ได้', '<input id="rw-days" name="days" type="number" min="1" max="365" class="sm-in" value="' + esc(r.valid_days || 30) + '"> วันหลังแลก', 'rw-days') +
        '</div>' +
        '<div data-rk="coupon">' +
          row('คูปองที่ได้', tpls.length ? '<select id="rw-tpl" name="templateId"><option value="">— เลือกคูปอง —</option>' + tpls.map((t) => '<option value="' + t.id + '"' + (r.kind === 'coupon' && String(r.coupon_template_id) === String(t.id) ? ' selected' : '') + '>' + esc(t.title) + ' (' + esc(t.badge_big) + ')</option>').join('') + '</select><span class="hint">แลกแล้วลูกค้าได้คูปองนี้ ใช้ตามเงื่อนไขที่ตั้งในเมนูคูปอง</span>'
            : '<span class="hint">ยังไม่มีคูปองที่เปิดอยู่ สร้างในเมนู "คูปอง" ก่อน</span>', 'rw-tpl') +
        '</div>' +
        row('เริ่ม', '<input id="rw-start" name="startDate" type="date" value="' + esc(r.start_day || '') + '">', 'rw-start') +
        row('หมดอายุ', '<input id="rw-end" name="endDate" type="date" value="' + esc(r.end_day || '') + '"><span class="hint">ไม่ต้องระบุ หากรางวัลไม่มีวันหมดอายุ</span>', 'rw-end') +
        row('', '<label class="check"><input type="checkbox" name="active"' + (r.is_active ? ' checked' : '') + '>เปิดให้แลก</label>') +
        '<div class="err" id="c-err" role="alert"' + (S.err ? '>' + esc(S.err) : ' hidden>') + '</div>' +
        '<div class="actions"><button class="btn">' + (isNew ? 'เพิ่มของรางวัล' : 'บันทึก') + '</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button>' + (isNew ? '' : '<button type="button" class="btn danger" style="margin-left:auto" data-a="delReward" data-v="' + r.id + '">ลบของรางวัล</button>') + '</div>' +
      '</div></form>';
  }
  // ซ่อน/แสดงช่องตามประเภท และช่องจำนวนตามตัวเลือก
  function syncReward(el) {
    const kind = (el.querySelector('input[name="kind"]:checked') || {}).value || 'general';
    el.querySelectorAll('[data-rk]').forEach((x) => { x.hidden = x.dataset.rk !== kind; });
    const stockSet = (el.querySelector('input[name="stockMode"]:checked') || {}).value === 'set';
    const limSet = (el.querySelector('input[name="limitMode"]:checked') || {}).value === 'set';
    el.elements.stock.disabled = !stockSet; el.elements.limitCount.disabled = !limSet; el.elements.limitPeriod.disabled = !limSet;
    // ของฟรีจากเมนู POS (ไม่ใช่หมวดส่วนลด) + เงื่อนไขสินค้า
    const cat = el.elements.cat ? el.elements.cat.value : 'food'; const pick = (n) => (el.querySelector('input[name="' + n + '"]:checked') || {}).value;
    const free = S.edit.free || [];
    const show = { free: cat !== 'discount', val: cat === 'discount' || !free.length, fmenu: cat !== 'discount' && free.length > 1, fall: pick('freeMode') === 'all', cond: !!pick('condMode'), notfree: cat === 'discount' || !free.length };
    el.querySelectorAll('[data-show]').forEach((x) => { x.hidden = !show[x.dataset.show]; });
  }
  function rerenderRewardImage() {
    const box = document.getElementById('rw-img'); if (!box) return;
    box.innerHTML = S.edit.imageUrl ? '<img alt="" src="' + esc(S.edit.imageUrl) + '">' : '<span>+ เพิ่มรูป</span>';
    const side = box.parentNode.querySelector('.upl-side'); const drop = side.querySelector('[data-a="dropRewardImage"]');
    if (S.edit.imageUrl && !drop) side.querySelector('label').insertAdjacentHTML('afterend', '<button type="button" class="btn ghost sm" data-a="dropRewardImage">ลบรูป</button>');
    if (!S.edit.imageUrl && drop) drop.remove();
  }

  const KINDS = [
    ['general', 'ทั่วไป', 'แจกให้สมาชิกเดิมและสมาชิกใหม่ที่ตรงเงื่อนไขโดยอัตโนมัติ (ได้ตอนเปิดหน้าสมาชิกหรือตอนพนักงานสแกน QR)'],
    ['code', 'กรอกโค้ด', 'ลูกค้าได้คูปองเมื่อกรอกโค้ดในหน้าสมาชิก เมนู "คูปอง" (คนละ 1 ครั้ง)'],
    ['birthday', 'วันเกิด', 'แจกอัตโนมัติในเดือนเกิดของสมาชิก ปีละ 1 ครั้ง'],
    ['welcome', 'ต้อนรับ', 'แจกทันทีเมื่อสมัครสมาชิกผ่าน OA ของแบรนด์นี้'],
    ['gift', 'ของขวัญ', 'พนักงานมอบให้รายคนจากเมนู "สมาชิก" หรือตั้งให้ระบบส่งอัตโนมัติตามรอบ เช่น ทุกวันที่ 1 ของเดือน']
  ];
  const KIND_NAME = Object.fromEntries(KINDS.map((k) => [k[0], k[1]]));
  const TIER_NAME = { all: 'ทุกระดับ', SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Platinum', DIAMOND: 'Diamond' };
  const TIER_KEYS = ['SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];
  const tiersText = (list) => (list && list.length ? list.map((x) => TIER_NAME[x] || x).join(', ') : 'ทุกระดับ');
  const DAY_FULL = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
  const PICK_NAME = { points: 'เลือกคนที่แต้มสะสมสูงสุดก่อน', recent: 'เลือกคนที่มาล่าสุดก่อน', random: 'สุ่ม' };
  // ข้อความรอบส่ง เช่น "ทุกวันที่ 1 ของเดือน เวลา 09:00"
  function schedText(x) {
    if (!x || !x.kind) return '';
    const tm = ' เวลา ' + (x.time || '09:00');
    if (x.kind === 'monthly') return 'ทุกวันที่ ' + x.day + ' ของเดือน' + tm;
    if (x.kind === 'weekly') return 'ทุกวัน' + DAY_FULL[x.day] + tm;
    return 'ครั้งเดียว ' + (x.date ? date(x.date + 'T12:00:00+07:00') : '-') + tm;
  }
  const dt = (t) => (t ? date(t) + ' ' + new Date(t).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }) : '-');
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
            '<td>' + esc(KIND_NAME[t.kind] || t.kind) + (t.branch_ids ? '<br><small class="muted">สมัครที่ ' + esc(t.branch_ids.map(branchLabel).join(', ')) + '</small>' : '') + (t.audience_tiers && t.audience_tiers.length ? '<br><small class="muted">' + esc(tiersText(t.audience_tiers)) + '</small>' : '') +
              (t.auto_send ? '<br><small class="muted">ส่ง' + esc(schedText({ kind: t.sched_kind, day: t.sched_day, date: t.sched_date, time: t.sched_time })) + '</small><br><small class="muted">รอบถัดไป ' + (t.next_round && t.is_active ? esc(dt(t.next_round)) : '-') + '</small>' : '') + '</td>' +
            '<td>' + esc(valueText(t)) + (Number(t.min_spend) ? '<br><small class="muted">ขั้นต่ำ ' + fmt(t.min_spend) + ' บาท</small>' : '') + '</td>' +
            '<td><small>' + (t.validity === 'dates' ? date(t.valid_from) + ' - ' + date(t.valid_to) : t.valid_days + ' วันหลังได้รับ') + '<br>' + daysText(t.use_days) + '</small></td>' +
            '<td class="r num">' + fmt(t.issued) + (t.max_issue ? ' / ' + fmt(t.max_issue) : '') + '<br><small class="muted">ใช้แล้ว ' + fmt(t.used) + '</small></td>' +
            '<td><span class="' + st[1] + '">' + st[0] + '</span></td>' +
            '<td class="r" style="white-space:nowrap">' + (t.brand_id || S.staff.role === 'super' ? '<button class="btn ghost sm" data-a="editCoupon" data-v="' + t.id + '">แก้ไข</button> <button class="btn ghost sm" data-a="toggleCoupon" data-v="' + t.id + '">' + (t.is_active ? 'ปิด' : 'เปิด') + '</button> <button class="btn danger sm" data-a="delCoupon" data-v="' + t.id + '">ลบ</button>' : '') + '</td></tr>';
        }).join('') + '</tbody></table></div>' : '<p class="muted">ยังไม่มีคูปองประเภทนี้</p>') + '</div>';
  }
  // ของขวัญ: พนักงานมอบรายคน หรือส่งอัตโนมัติตามรอบ
  function giftSection(x) {
    const radio = (name, val, cur, label) => '<label class="check"><input type="radio" name="' + name + '" value="' + val + '"' + (String(cur) === String(val) ? ' checked' : '') + '>' + label + '</label>';
    const rounds = (S.edit && S.edit.rounds) || [];
    return '<fieldset class="field gift-sec" data-show="gift"><legend>วิธีส่ง</legend><div class="row-in">' + radio('autoSend', '0', x.auto_send ? 1 : 0, 'พนักงานมอบรายคน (เมนูสมาชิก)') + radio('autoSend', '1', x.auto_send ? 1 : 0, 'ส่งอัตโนมัติตามรอบ') + '</div>' +
      '<div class="gift-auto" data-show="auto">' +
        '<div class="row-in"><span>รอบส่ง</span><select name="schedKind" aria-label="รอบส่ง">' + [['monthly', 'ทุกเดือน'], ['weekly', 'ทุกสัปดาห์'], ['once', 'ครั้งเดียว']].map((o) => '<option value="' + o[0] + '"' + (x.sched_kind === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select>' +
          '<span data-show="sm">วันที่</span><select name="schedDayM" data-show="sm" aria-label="วันที่ของเดือน">' + Array.from({ length: 31 }, (_, i) => '<option value="' + (i + 1) + '"' + (x.sched_kind === 'monthly' && Number(x.sched_day) === i + 1 ? ' selected' : '') + '>' + (i + 1) + '</option>').join('') + '</select>' +
          '<span data-show="sw">วัน</span><select name="schedDayW" data-show="sw" aria-label="วันในสัปดาห์">' + DAY_FULL.map((d, i) => '<option value="' + i + '"' + (x.sched_kind === 'weekly' && Number(x.sched_day) === i ? ' selected' : '') + '>' + d + '</option>').join('') + '</select>' +
          '<input type="date" name="schedDate" data-show="so" aria-label="วันที่ส่ง" value="' + esc(x.sched_date || '') + '">' +
          '<span>เวลา</span><input type="time" name="schedTime" aria-label="เวลาส่ง" value="' + esc(x.sched_time || '09:00') + '"></div>' +
        '<span class="hint" data-show="sm">ถ้าเดือนไหนไม่มีวันที่นี้ (เช่น 31) จะส่งวันสุดท้ายของเดือนนั้น</span>' +
        '<div class="row-in"><span>จำนวนคนต่อรอบ</span>' + radio('rlim', '0', x.round_limit ? 1 : 0, 'ไม่จำกัด') + radio('rlim', '1', x.round_limit ? 1 : 0, 'จำกัด') +
          '<input type="number" name="roundLimit" min="1" style="width:100px" aria-label="จำนวนคนต่อรอบ" value="' + esc(x.round_limit || '') + '" data-show="rlim"><span data-show="rlim">คน</span>' +
          '<select name="roundPick" data-show="rlim" aria-label="วิธีเลือกคน">' + Object.entries(PICK_NAME).map(([k, v]) => '<option value="' + k + '"' + (x.round_pick === k ? ' selected' : '') + '>' + v + '</option>').join('') + '</select></div>' +
        '<div class="row-in"><span>แต่ละคนได้</span><input type="number" name="perMember" min="1" max="10" style="width:80px" aria-label="ใบต่อคนต่อรอบ" value="' + esc(x.per_member || 1) + '"><span>ใบต่อรอบ</span>' +
          '<small class="muted">ใบเก่าที่ยังไม่ใช้หมดอายุตามวันที่ตั้งไว้ ไม่ถูกยกเลิก</small></div>' +
        '<label class="check"><input type="checkbox" name="notifyLine"' + (x.notify_line ? ' checked' : '') + '>แจ้งลูกค้าทาง LINE เมื่อได้รับคูปอง (นับโควต้าข้อความ OA · ส่งเฉพาะคนที่เป็นเพื่อนกับ OA)</label>' +
        '<div class="round-box" id="c-round">กำลังคำนวณ…</div>' +
        (rounds.length ? '<details class="rounds"><summary>ประวัติรอบส่ง (' + rounds.length + ')</summary><table class="tbl"><thead><tr><th>รอบ</th><th>ส่งเมื่อ</th><th class="r">ตรงเงื่อนไข</th><th class="r">ได้รับ</th><th class="r">ใบ</th><th class="r">ใช้แล้ว</th></tr></thead><tbody>' +
          rounds.map((r) => '<tr><td>' + esc(r.round_key) + '</td><td>' + esc(dt(r.run_at)) + '</td><td class="r num">' + fmt(r.eligible) + '</td><td class="r num">' + fmt(r.members) + '</td><td class="r num">' + fmt(r.issued) + '</td><td class="r num">' + fmt(r.used) + '</td></tr>').join('') + '</tbody></table></details>' : '') +
      '</div></fieldset>';
  }
  // รอบถัดไป + จำนวนคนที่ตรงเงื่อนไขตอนนี้ (ถามเซิร์ฟเวอร์เมื่อค่าที่เกี่ยวข้องเปลี่ยน)
  let roundT = null; let roundKey = '';
  function previewRound(b) {
    const box = document.getElementById('c-round'); if (!box) return;
    const key = JSON.stringify([b.tiers, b.followersOnly, b.schedKind, b.schedDay, b.schedDate, b.schedTime, b.roundLimit, b.perMember]);
    if (key === roundKey) return;
    roundKey = key; clearTimeout(roundT);
    roundT = setTimeout(async () => {
      try {
        const r = await api('POST', '/api/admin/coupon-rounds/preview', { brand: S.brand, tiers: b.tiers, followersOnly: b.followersOnly, schedKind: b.schedKind, schedDay: b.schedDay, schedDate: b.schedDate, schedTime: b.schedTime, roundLimit: b.roundLimit, perMember: b.perMember });
        if (roundKey !== key) return;
        box.innerHTML = (r.next ? 'รอบถัดไป: <b>' + esc(dt(r.next)) + '</b>' : '<b>ไม่มีรอบถัดไป</b> (วันเวลาที่ตั้งผ่านไปแล้ว)') +
          ' · ตอนนี้ตรงเงื่อนไข <b>' + fmt(r.eligible) + ' คน</b> → ส่ง <b>' + fmt(r.members) + ' คน × ' + fmt(r.perMember) + ' ใบ</b>' +
          '<br><small class="muted">ระดับคิด ณ วันที่ส่ง · เปิดใช้งานหรือเปลี่ยนรอบแล้ว ระบบเริ่มนับจากรอบที่ยังไม่ถึงเวลา (ไม่ส่งย้อนหลัง)</small>';
      } catch (e) { if (!e.silent) box.textContent = e.message; }
    }, 350);
  }
  // ของฟรี (เลือกเมนูจาก POS) + เงื่อนไขสินค้าในบิล · ค่าที่เลือกเก็บใน S.edit.free / S.edit.cond แล้ววาดเฉพาะส่วนนี้ใหม่ (ฟอร์มที่กรอกไว้ไม่หาย)
  function itemSections(locked, x) {
    const e = S.edit; const menu = e.menu || { items: [], categories: [] }; const c = e.cond;
    const radio = (name, val, cur, label) => '<label class="check"><input type="radio" name="' + name + '" value="' + val + '"' + (String(cur) === String(val) ? ' checked' : '') + '>' + label + '</label>';
    const sync = menu.syncedAt ? 'เมนูจาก POS อัปเดตล่าสุด ' + dt(menu.syncedAt) + ' · ' + fmt(menu.items.length) + ' รายการ' : 'ยังไม่มีเมนูจาก POS (อัปเดตเครื่อง POS API แล้วรอสักครู่)';
    return '<div class="field" data-show="free"><span class="lbl">ของที่ได้ฟรี (เลือกจากเมนู POS)</span>' +
        '<div class="mpick"><div class="chips" id="pick-free-chips"></div>' + (locked ? '' : '<input class="mp-q" data-pick="free" placeholder="ค้นหาเมนู…" aria-label="ค้นหาเมนูของฟรี" autocomplete="off"><div class="mp-list" id="pick-free-list"></div>') + '</div>' +
        '<div class="free-mode" data-show="fmenu"><span class="lbl">ฟรีกี่ชิ้น</span>' +
          '<label class="fopt"><input type="radio" name="freeMode" value="one"' + (x.free_mode === 'qty' || x.free_mode === 'all' ? '' : ' checked') + '><span><b>ฟรี 1 ชิ้น</b><small>เลือกได้ 1 อย่างจากรายการ · บิลมีหลายอย่าง ลดชิ้นที่ราคาถูกที่สุด</small></span></label>' +
          '<label class="fopt"><input type="radio" name="freeMode" value="qty"' + (x.free_mode === 'qty' ? ' checked' : '') + '><span><b>ฟรีรวม <input type="number" name="freeQty" min="1" max="20" value="' + esc(x.free_qty || 2) + '" aria-label="จำนวนชิ้นที่ฟรี"> ชิ้น</b><small>นับรวมทุกเมนูในรายการ · ลดชิ้นที่ถูกที่สุดก่อน</small></span></label>' +
          '<label class="fopt"><input type="radio" name="freeMode" value="all"' + (x.free_mode === 'all' ? ' checked' : '') + '><span><b>ฟรีทุกเมนูในรายการ (อย่างละ 1 ชิ้น)</b><small>เมนูไหนอยู่ในบิล ลดให้เมนูละ 1 ชิ้น</small></span></label>' +
          '<label class="check" data-show="fall"><input type="checkbox" name="freeNeedAll"' + (x.free_need_all ? ' checked' : '') + '>ต้องมีครบทุกเมนูในรายการถึงจะใช้ได้</label></div>' +
        '<span class="hint">ใช้ได้เมื่อบิลมีเมนูของฟรีอยู่แล้ว · ส่วนลด = ราคาเมนูที่ฟรี (ราคาในบิลตอนชำระ) · ไม่เลือกเมนู = ใส่ราคาของเองแบบเดิม</span><span class="hint">' + esc(sync) + '</span></div>' +
      '<fieldset class="field cond-sec"><legend>เงื่อนไขสินค้าในบิล</legend><div class="row-in">' + radio('condMode', '', c.mode || '', 'ไม่มีเงื่อนไข') + radio('condMode', 'any', c.mode || '', 'ต้องมีอย่างใดอย่างหนึ่ง') + radio('condMode', 'all', c.mode || '', 'ต้องมีครบทุกรายการ') + '</div>' +
        '<div class="cond-body" data-show="cond"><div class="mpick"><div class="chips" id="pick-cond-chips"></div><input class="mp-q" data-pick="cond" placeholder="ค้นหาเมนูหรือหมวด…" aria-label="ค้นหาเมนูหรือหมวดที่ต้องมี" autocomplete="off"><div class="mp-list" id="pick-cond-list"></div></div>' +
        '<div class="row-in"><span>รวมกันอย่างน้อย</span><input type="number" name="condQty" min="1" max="99" style="width:80px" aria-label="จำนวนชิ้นขั้นต่ำ" value="' + esc(c.qty || 1) + '"><span>ชิ้น</span></div>' +
        '<div class="row-in" data-show="notfree"><span>คิดส่วนลดจาก</span>' + radio('condScope', 'bill', c.scope || 'bill', 'ทั้งบิล') + radio('condScope', 'items', c.scope || 'bill', 'เฉพาะเมนูที่ตรงเงื่อนไข') + '</div>' +
        (menu.items.length ? '' : '<span class="hint">' + esc(sync) + '</span>') + '</div></fieldset>';
  }
  const chipHtml = (kind, x, i, locked) => '<span class="chip' + (x.type === 'cat' ? ' cat' : '') + '">' + (x.type === 'cat' ? 'หมวด: ' : '') + esc(x.name) + (x.price !== undefined ? ' · ฿' + fmt(x.price) : '') +
    (locked ? '' : '<button type="button" class="x" data-a="pickDel" data-v="' + kind + ':' + i + '" aria-label="เอาออก">×</button>') + '</span>';
  function drawPick(kind) {
    const e = S.edit; if (!e || (e.kind !== 'coupon' && e.kind !== 'reward')) return;
    const list = kind === 'free' ? e.free : e.cond.items; const locked = kind === 'free' && e.locked;
    const box = document.getElementById('pick-' + kind + '-chips');
    if (box) box.innerHTML = list.length ? list.map((x, i) => chipHtml(kind, x, i, locked)).join('') : '<span class="muted" style="font-size:13px">' + (kind === 'free' ? 'ยังไม่ได้เลือกเมนู' : 'ยังไม่ได้เลือก') + '</span>';
    const q = document.querySelector('.mp-q[data-pick="' + kind + '"]'); const out = document.getElementById('pick-' + kind + '-list');
    if (!q || !out) return;
    const term = q.value.trim().toLowerCase(); const menu = e.menu || { items: [], categories: [] };
    if (!term) { out.innerHTML = ''; return; }
    const has = (t, id) => list.some((x) => (x.type || 'item') === t && x.id === id);
    const cats = kind === 'cond' ? menu.categories.filter((x) => x.name.toLowerCase().includes(term) && !has('cat', x.id)).slice(0, 4) : [];
    const items = menu.items.filter((x) => (x.name.toLowerCase().includes(term) || String(x.category_name || '').toLowerCase().includes(term)) && !has('item', x.id)).slice(0, 10);
    out.innerHTML = cats.map((x) => '<button type="button" class="mi" data-a="pickAdd" data-v="' + kind + ':cat:' + esc(x.id) + '"><b>หมวด: ' + esc(x.name) + '</b></button>').join('') +
      items.map((x) => '<button type="button" class="mi" data-a="pickAdd" data-v="' + kind + ':item:' + esc(x.id) + '"><span>' + esc(x.name) + '</span><span class="p">' + esc(x.category_name || '') + ' · ฿' + fmt(x.price) + '</span></button>').join('') ||
      '<div class="muted" style="padding:8px 12px;font-size:13px">' + (menu.items.length ? 'ไม่พบเมนู "' + esc(q.value.trim()) + '"' : 'ยังไม่มีเมนูจาก POS') + '</div>';
  }
  // ส่วนที่กระทบคูปองที่ลูกค้าถืออยู่ (ใช้เทียบก่อน/หลังแก้)
  // ข้อความของฟรีตามจำนวนที่ฟรี (ภาพตัวอย่าง)
  const freeText = (b, list) => (list.length < 2 ? list[0].name + ' 1 ชิ้น'
    : b.freeMode === 'all' ? list.map((x) => x.name).join(' + ') + ' อย่างละ 1' + (b.freeNeedAll ? ' (ต้องมีครบ)' : '')
      : list.map((x) => x.name).join(' / ') + (b.freeMode === 'qty' ? ' รวม ' + (Number(b.freeQty) || 1) + ' ชิ้น' : ' 1 ชิ้น'));
  const discountKey = (b) => JSON.stringify([b.kind, b.type, Number(b.value) || 0, Number(b.maxDiscount) || 0, Number(b.min) || 0, b.useDays, String(b.code || '').toUpperCase(),
    (b.freeItems || []).map((x) => x.id), b.freeMode, b.freeMode === 'qty' ? Number(b.freeQty) || 1 : 1, !!b.freeNeedAll, b.condMode || '', (b.condItems || []).map((x) => (x.type || 'item') + ':' + x.id), Number(b.condQty) || 1, b.condScope || 'bill']);
  function couponForm(id) {
    const t = id ? S.data.coupons.find((x) => String(x.id) === String(id)) : null;
    const x = t || { kind: 'general', title: '', description: '', discount_type: 'baht', badge_big: '', discount_value: '', min_spend: 0, max_discount: null, validity: 'days', valid_days: 30, valid_from: null, valid_to: null,
      issue_from: null, issue_to: null, branch_ids: null, audience_tiers: null, followers_only: false, use_days: 127, max_issue: null, is_active: true, code: '', issued: 0,
      auto_send: false, sched_kind: 'monthly', sched_day: 1, sched_date: null, sched_time: '09:00', round_limit: null, round_pick: 'points', per_member: 1, notify_line: false };
    const style = t ? couponStyle(t) : 'baht'; const locked = false; const lockAttr = '';
    const radio = (name, val, cur, label, extra) => '<label class="check"><input type="radio" name="' + name + '" value="' + val + '"' + (String(cur) === String(val) ? ' checked' : '') + (extra || '') + '>' + label + '</label>';
    return '<form class="coupon-ed" data-f="coupon" data-v="' + (id || '') + '"><div class="ed-form">' +
      (t && t.issued > 0 ? '<div class="note">แจกไปแล้ว ' + fmt(t.issued) + ' ใบ (ใช้แล้ว ' + fmt(t.used) + ') · ถ้าแก้ส่วนลดหรือเงื่อนไข จะมีผลกับคูปองที่ลูกค้าถืออยู่และยังไม่ได้ใช้ทันที · วันหมดอายุของใบที่แจกไปแล้วไม่เปลี่ยน · บิลที่ใช้ไปแล้วไม่เปลี่ยน</div>' : '') +
      '<fieldset class="field"><legend>ประเภท</legend><div class="segr">' + KINDS.map((k) => '<label><input type="radio" name="kind" value="' + k[0] + '"' + (x.kind === k[0] ? ' checked' : '') + lockAttr + '><span>' + k[1] + '</span></label>').join('') + '</div><span class="hint" id="kind-hint"></span></fieldset>' +
      giftSection(x) +
      '<fieldset class="field" data-show="aud"><legend>ส่งให้ระดับ</legend><div class="row-in">' + TIER_KEYS.map((k) => '<label class="check tierc"><input type="checkbox" name="tiers" value="' + k + '"' + (!x.audience_tiers || !x.audience_tiers.length || x.audience_tiers.includes(k) ? ' checked' : '') + '>' + TIER_NAME[k] + '</label>').join('') + '</div>' +
        '<div class="row-in"><span>และ</span><select id="c-fol" name="followersOnly" aria-label="เงื่อนไขเพื่อน OA"><option value="">สมาชิกทุกคน</option><option value="1"' + (x.followers_only ? ' selected' : '') + '>เฉพาะคนที่ยังเป็นเพื่อนกับ OA</option></select></div></fieldset>' +
      '<div class="field"><label for="c-title">ชื่อคูปอง</label><input id="c-title" name="title" maxlength="60" required value="' + esc(x.title) + '" data-autofocus></div>' +
      '<div class="field"><label for="c-desc">รายละเอียด</label><textarea id="c-desc" name="description" maxlength="1000" placeholder="เช่น ใช้ได้กับเมนูข้าวมันไก่ทุกจาน ไม่ร่วมกับโปรโมชั่นอื่น">' + esc(x.description) + '</textarea></div>' +
      '<div class="field"><span class="lbl">รูปคูปอง</span><div class="upl"><div class="upl-img" id="c-img">' + (S.edit.imageUrl ? '<img alt="" src="' + esc(S.edit.imageUrl) + '">' : '<span>ยังไม่มีรูป</span>') + '</div>' +
        '<div class="upl-side"><label class="btn ghost sm" for="c-file">เลือกรูป</label><input id="c-file" type="file" accept="image/png,image/jpeg,image/gif,image/webp" class="sr">' + (S.edit.imageUrl ? '<button type="button" class="btn ghost sm" data-a="dropImage">ลบรูป</button>' : '') +
        '<span class="hint">แนะนำ 810 × 270 px (3:1) · PNG, JPG, GIF · ไม่เกิน 2 MB · ระบบย่อรูปให้อัตโนมัติ</span></div></div></div>' +
      '<div class="grid">' +
        '<div class="field"><label for="c-type">ส่วนลด</label><select id="c-type" name="type"' + lockAttr + '><option value="baht"' + (style === 'baht' ? ' selected' : '') + '>ลดเป็นบาท</option><option value="pct"' + (style === 'pct' ? ' selected' : '') + '>ลดเป็น %</option><option value="free"' + (style === 'free' ? ' selected' : '') + '>ของฟรี</option></select></div>' +
        '<div class="field" data-show="val"><label for="c-val" id="c-val-l">มูลค่า</label><input id="c-val" name="value" type="number" min="1" step="0.01" required value="' + esc(Number(x.discount_value) || '') + '"' + lockAttr + '></div>' +
        '<div class="field" data-show="pct"><label for="c-max">ลดสูงสุด (บาท)</label><input id="c-max" name="maxDiscount" type="number" min="0" placeholder="ไม่จำกัด" value="' + esc(x.max_discount ? Number(x.max_discount) : '') + '"' + lockAttr + '></div>' +
        '<div class="field"><label for="c-min">ยอดซื้อขั้นต่ำ (บาท)</label><input id="c-min" name="min" type="number" min="0" value="' + esc(Number(x.min_spend) || 0) + '"' + lockAttr + '></div>' +
        '<div class="field" data-show="code"><label for="c-code">โค้ดที่ลูกค้ากรอก</label><input id="c-code" name="code" maxlength="20" autocapitalize="characters" placeholder="เช่น HUMLAI50" value="' + esc(x.code || '') + '"' + lockAttr + '></div>' +
      '</div>' +
      itemSections(locked, x) +
      '<fieldset class="field" data-show="welcome"><legend>ให้กับสมาชิกที่สมัครที่สาขา</legend><div class="row-in">' + radio('wscope', 'all', x.branch_ids ? 'some' : 'all', 'ทุกสาขา') + radio('wscope', 'some', x.branch_ids ? 'some' : 'all', 'เฉพาะสาขาที่เลือก') + '</div>' +
        '<div class="row-in" data-show="wbr">' + brand().branches.map((br) => '<label class="check"><input type="checkbox" name="wb" value="' + esc(br.id) + '"' + ((x.branch_ids || []).includes(br.id) ? ' checked' : '') + '>' + esc(br.name) + '</label>').join('') + '</div>' +
        '<span class="hint">ใช้สาขาที่สมัครที่ลูกค้าเลือกในหน้าสมัคร · ตั้งคูปองต้อนรับหลายใบให้แต่ละสาขาต่างกันได้</span></fieldset>' +
      '<fieldset class="field"><legend>วันที่ใช้ได้</legend><div class="row-in">' + radio('validity', 'dates', x.validity, 'ตามวันที่') + radio('validity', 'days', x.validity, 'ตามระยะเวลาหลังได้รับ') + '</div>' +
        '<div class="row-in" data-show="dates"><input type="date" name="validFrom" aria-label="วันเริ่มใช้" value="' + isoDay(x.valid_from) + '"> ถึง <input type="date" name="validTo" aria-label="วันสุดท้ายที่ใช้" value="' + isoDay(x.valid_to) + '"></div>' +
        '<div class="row-in" data-show="days"><input type="number" name="days" min="1" max="365" style="width:90px" aria-label="จำนวนวัน" value="' + esc(x.valid_days || 30) + '"> วัน นับจากวันที่ลูกค้าได้รับคูปอง</div></fieldset>' +
      '<details class="adv"' + (t && (t.issue_from || t.issue_to || t.use_days !== 127 || t.max_issue) ? ' open' : '') + '><summary>ขั้นสูง</summary>' +
        '<div class="field"><span class="lbl">ช่วงวันที่แจก</span><div class="row-in"><input type="date" name="issueFrom" aria-label="เริ่มแจก" value="' + isoDay(x.issue_from) + '"> ถึง <input type="date" name="issueTo" aria-label="สิ้นสุดการแจก" value="' + isoDay(x.issue_to) + '"></div><span class="hint">เว้นว่าง = แจกตั้งแต่บันทึกจนกว่าจะปิดคูปอง</span></div>' +
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
      tiers: [...el.querySelectorAll('input[name="tiers"]:checked')].map((x) => x.value), followersOnly: v('followersOnly') === '1', useDays: mask,
      autoSend: v('kind') === 'gift' && v('autoSend') === '1', schedKind: v('schedKind'), schedDay: v('schedKind') === 'weekly' ? v('schedDayW') : v('schedDayM'), schedDate: v('schedDate'), schedTime: v('schedTime'),
      roundLimit: v('rlim') === '1' ? v('roundLimit') : '', roundPick: v('roundPick'), perMember: v('perMember'), notifyLine: v('notifyLine'),
      freeItems: v('type') === 'free' ? S.edit.free : [], freeMode: v('freeMode') || 'one', freeQty: v('freeQty'), freeNeedAll: v('freeNeedAll'), condMode: v('condMode'), condItems: v('condMode') ? S.edit.cond.items : [], condQty: v('condQty'), condScope: v('condScope'),
      branchIds: v('kind') === 'welcome' && v('wscope') === 'some' ? [...el.querySelectorAll('input[name="wb"]:checked')].map((x) => x.value) : null, maxIssue: v('limit') === '1' ? v('maxIssue') : '', active: v('active') };
  }
  function syncCoupon(el) {
    const b = couponBody(el);
    const show = { pct: b.type === 'pct', code: b.kind === 'code', welcome: b.kind === 'welcome', wbr: b.kind === 'welcome' && el.elements.wscope && el.elements.wscope.value === 'some', dates: b.validity === 'dates', days: b.validity !== 'dates', limit: el.elements.limit && el.elements.limit.value === '1',
      gift: b.kind === 'gift', auto: b.autoSend, sm: b.schedKind === 'monthly', sw: b.schedKind === 'weekly', so: b.schedKind === 'once', rlim: el.elements.rlim && el.elements.rlim.value === '1',
      aud: b.kind === 'general' || b.kind === 'birthday' || b.autoSend,
      free: b.type === 'free', val: !(b.type === 'free' && S.edit.free.length), fmenu: S.edit.free.length > 1, fall: b.freeMode === 'all', cond: !!b.condMode, notfree: b.type !== 'free' };
    if (el.elements.value) { el.elements.value.required = show.val; el.elements.value.disabled = !show.val || !!S.edit.locked; }
    el.querySelectorAll('[data-show]').forEach((x) => { x.hidden = !show[x.dataset.show]; });
    const k = KINDS.find((x) => x[0] === b.kind); document.getElementById('kind-hint').textContent = k ? k[2] : '';
    if (b.autoSend) previewRound(b);
    document.getElementById('c-val-l').textContent = b.type === 'free' ? 'ราคาของที่แจก (บาท)' : b.type === 'pct' ? 'ลดกี่ %' : 'ลดกี่บาท';
    const big = b.type === 'free' ? 'ฟรี' : b.type === 'pct' ? '-' + (b.value || 0) + '%' : '-' + (b.value || 0);
    const exp = b.validity === 'dates' ? (b.validTo ? date(b.validTo + 'T12:00:00+07:00') : '-') : (b.days || 30) + ' วันหลังได้รับ';
    const row = (k2, v2) => '<div class="kv"><span>' + k2 + '</span><span>' + esc(v2) + '</span></div>';
    document.getElementById('c-prev').innerHTML =
      (S.edit.imageUrl ? '<img class="prev-img" alt="" src="' + esc(S.edit.imageUrl) + '">' : '<div class="prev-img ph"><b>' + esc(big) + '</b></div>') +
      '<div class="prev-body"><b>' + esc(b.title || 'ชื่อคูปอง') + '</b>' + (b.description ? '<p>' + esc(b.description) + '</p>' : '') + '<span class="prev-btn">ใช้คูปอง</span></div>' +
      '<div class="prev-sec"><b>การใช้งาน</b>' + (b.validity === 'dates' ? row('วันที่เริ่มต้น', b.validFrom ? date(b.validFrom + 'T12:00:00+07:00') : '-') : '') + row('วันหมดอายุ', exp) + row('ใช้ได้', '1 ครั้ง') + (b.kind === 'code' ? row('โค้ด', (b.code || '-').toUpperCase()) : '') + '</div>' +
      (b.kind === 'welcome' ? '<div class="prev-sec"><b>ได้เมื่อ</b>' + row('สมัครที่สาขา', b.branchIds ? (b.branchIds.length ? b.branchIds.map(branchLabel).join(', ') : 'ยังไม่ได้เลือก') : 'ทุกสาขา') + '</div>' : '') +
      '<div class="prev-sec"><b>เงื่อนไข</b>' + row('ขั้นต่ำ', Number(b.min) ? fmt(b.min) + ' บาท' : 'ไม่มี') + (b.type === 'pct' && Number(b.maxDiscount) ? row('ลดสูงสุด', fmt(b.maxDiscount) + ' บาท') : '') + row('ใช้ได้เมื่อ', daysText(b.useDays || 0) || '-') +
        ((b.kind === 'general' || b.kind === 'birthday' || b.autoSend) && b.tiers.length < TIER_KEYS.length ? row('ระดับ', tiersText(b.tiers)) : '') +
        (b.type === 'free' && S.edit.free.length ? row('ได้ฟรี', freeText(b, S.edit.free)) : '') +
        (b.condMode && S.edit.cond.items.length ? row('ต้องมีในบิล', S.edit.cond.items.map((x) => (x.type === 'cat' ? 'หมวด' : '') + x.name).join(b.condMode === 'all' ? ' และ ' : ' หรือ ') + (Number(b.condQty) > 1 ? ' รวม ' + b.condQty + ' ชิ้น' : '')) : '') +
        (b.autoSend ? row('รับได้', (Number(b.perMember) || 1) + ' ใบ ' + schedText({ kind: b.schedKind, day: Number(b.schedDay), date: b.schedDate, time: b.schedTime }).replace(/ เวลา .*/, '')) : '') +
        row('จำกัด', b.maxIssue ? fmt(b.maxIssue) + ' ใบ' : 'ไม่จำกัด') + '</div>';
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
  /* ---------- ริชเมนู LINE: เลือกแบบช่อง → อัปโหลดรูป → ตั้งปุ่ม → ติดตั้ง · ย้อนกลับเมนูเดิมได้ ---------- */
  const ZL = (i) => String.fromCharCode(65 + i);
  function rmReset() {
    const d = S.data.rm; const cur = d.list.find((x) => x.is_active);
    S.rm = cur ? { brand: S.brand, layout: cur.layout, actions: cur.actions.map((a) => ({ ...a })), chatBar: cur.chat_bar, fromId: cur.id, img: null, sel: 0, err: '' }
      : { brand: S.brand, layout: 'l4', actions: d.defaults.map((a) => ({ ...a })), chatBar: 'เมนู', fromId: null, img: null, sel: 0, err: '' };
  }
  const rmLay = () => S.data.rm.layouts[S.rm.layout];
  const rmFrom = () => S.data.rm.list.find((x) => x.id === S.rm.fromId);
  const rmActs = () => S.rm.actions.slice(0, rmLay().areas.length);
  const rmImgUrl = () => (S.rm.img ? S.rm.img.dataUrl : rmFrom() ? rmFrom().image : null);
  function rmZones(lay, cls) {
    return lay.areas.map((a, i) => '<button type="button" class="rm-z' + (cls && S.rm.sel === i ? ' sel' : '') + '" data-a="rmZone" data-v="' + i + '" style="left:' + (a[0] / lay.width * 100) + '%;top:' + (a[1] / lay.height * 100) + '%;width:' + (a[2] / lay.width * 100) + '%;height:' + (a[3] / lay.height * 100) + '%" aria-label="ช่อง ' + ZL(i) + '"><b>' + ZL(i) + '</b>' + (cls ? '<em>' + a[2] + '×' + a[3] + '</em>' : '') + '</button>').join('');
  }
  function rmThumb(lay) {
    return '<span class="rm-g" style="aspect-ratio:' + lay.width + '/' + lay.height + '">' + lay.areas.map((a, i) => '<i style="left:' + (a[0] / lay.width * 100) + '%;top:' + (a[1] / lay.height * 100) + '%;width:' + (a[2] / lay.width * 100) + '%;height:' + (a[3] / lay.height * 100) + '%">' + ZL(i) + '</i>').join('') + '</span>';
  }
  function actionLabel(a, acts) { const k = acts[a.kind]; return k ? k.name + (a.value ? ' · ' + a.value : '') : '-'; }
  function richmenuView() {
    const d = S.data.rm; const r = S.rm; const lay = rmLay(); const img = rmImgUrl(); const from = rmFrom();
    const ready = d.configured && img && !r.err;
    return '<div class="note">' + (d.oa ? 'OA <b>' + esc(d.oa) + '</b> · ' : '') + (d.list.find((x) => x.is_active)
      ? (() => { const c = d.list.find((x) => x.is_active); return 'เมนูที่ใช้อยู่: ' + esc(d.layouts[c.layout] ? d.layouts[c.layout].name : c.layout) + (c.created_by === 'LINE' ? ' · ดึงมาจาก LINE เมื่อ ' : ' · ติดตั้งเมื่อ ') + date(c.installed_at) + ' ' + new Date(c.installed_at).toTimeString().slice(0, 5) + (c.created_by && c.created_by !== 'LINE' ? ' โดย ' + esc(c.created_by) : ''); })()
      : ({ none: 'OA นี้ยังไม่มีเมนูที่ติดตั้งผ่านระบบ · ถ้าตั้งเมนูไว้ใน OA Manager ระบบดึงรูปมาแสดงไม่ได้ (LINE ไม่เปิดให้ดึง) ให้อัปโหลดรูปเดิมแล้วกดติดตั้ง เพื่อจัดการจากหน้านี้ต่อ',
        other: 'เมนูที่ใช้อยู่ใน LINE ตอนนี้มีจุดกดไม่ตรงกับแบบในหน้านี้ แสดงให้ดูด้านล่าง · ติดตั้งเมนูใหม่จากหน้านี้เพื่อจัดการต่อ',
        unknown: 'ดึงข้อมูลเมนูจาก LINE ไม่สำเร็จ ลองโหลดหน้าใหม่อีกครั้ง' }[d.live] || 'ยังไม่เคยติดตั้งเมนูจากหน้านี้')) + '</div>' +
      (d.liveView ? '<div class="card"><div class="hd"><h2>เมนูที่ใช้อยู่ใน LINE ตอนนี้</h2><small class="muted">' + d.liveView.width + ' × ' + d.liveView.height + ' · ' + d.liveView.areas.length + ' ช่อง</small></div>' +
        '<div class="rm-pv rm-live" style="aspect-ratio:' + d.liveView.width + '/' + d.liveView.height + '"><img src="' + esc(d.liveView.image) + '" alt="">' +
        d.liveView.areas.map((a, i) => '<span class="rm-z" style="left:' + (a.bounds[0] / d.liveView.width * 100) + '%;top:' + (a.bounds[1] / d.liveView.height * 100) + '%;width:' + (a.bounds[2] / d.liveView.width * 100) + '%;height:' + (a.bounds[3] / d.liveView.height * 100) + '%"><b>' + ZL(i) + '</b><em>' + esc(String(a.label).slice(0, 40)) + '</em></span>').join('') + '</div></div>' : '') +
      (d.configured ? '' : '<div class="err" role="alert">ยังติดตั้งไม่ได้: ต้องตั้ง LINE_' + esc(S.brand.toUpperCase()) + '_TOKEN และ LIFF_ID ในไฟล์ .env ของ server ก่อน</div>') +
      '<div class="rm"><div class="rm-col">' +
      '<div class="card"><div class="rm-step"><i>1</i><h2>เลือกแบบช่อง</h2><small class="muted">รูปต้องมีขนาดตามแบบที่เลือก</small></div><div class="rm-lays">' +
        Object.entries(d.layouts).map(([k, l]) => '<button type="button" class="rm-lay' + (k === r.layout ? ' on' : '') + '" data-a="rmLayout" data-v="' + k + '" aria-pressed="' + (k === r.layout) + '">' + rmThumb(l) + '<b>' + esc(l.name) + '</b><small>' + l.width + ' × ' + l.height + '</small></button>').join('') +
        '</div><button type="button" class="btn ghost sm" data-a="rmGuide" style="align-self:flex-start">ดาวน์โหลดแผนผังขนาดของแบบนี้ (PNG)</button></div>' +
      '<div class="card"><div class="rm-step"><i>2</i><h2>รูปเมนู</h2></div><div class="rm-drop">' +
        (img ? '<img src="' + esc(img) + '" alt="">' : '<span class="rm-empty">ยังไม่มีรูป</span>') +
        '<div class="rm-info">' + (r.img ? '<span class="ok">✓ ' + esc(r.img.name) + '</span><span class="ok">✓ ' + lay.width + ' × ' + lay.height + ' px' + (r.img.resized ? ' (ปรับขนาด/บีบอัดให้แล้ว)' : '') + '</span><span class="ok">✓ ' + Math.round(r.img.size / 1024) + ' KB (ไม่เกิน 1 MB)</span>'
          : from ? '<span>ใช้รูปของเมนูที่ใช้อยู่</span><small class="muted">อัปโหลดรูปใหม่ถ้าต้องการเปลี่ยนภาพ</small>' : '<span>เลือกไฟล์ JPG หรือ PNG ขนาด ' + lay.width + ' × ' + lay.height + ' px</span><small class="muted">รูปสัดส่วนเดียวกันแต่ขนาดอื่น หรือไฟล์ใหญ่เกิน 1 MB ระบบปรับให้เอง</small>') + '</div>' +
        '<label class="btn ghost sm rm-file">' + (img ? 'เปลี่ยนรูป' : 'เลือกรูป') + '<input id="rm-file" type="file" accept="image/png,image/jpeg" hidden></label></div>' +
        (r.err ? '<div class="err" role="alert">' + esc(r.err) + '</div>' : '') + '</div>' +
      '<div class="card"><div class="rm-step"><i>3</i><h2>ตั้งค่าปุ่มแต่ละช่อง</h2></div><div class="rm-acts">' +
        rmActs().map((a, i) => '<div class="rm-act' + (S.rm.sel === i ? ' sel' : '') + '"><span class="rm-zl">' + ZL(i) + '</span><select id="rm-k-' + i + '" data-rm="kind" data-i="' + i + '" aria-label="ปุ่มช่อง ' + ZL(i) + '">' +
          Object.entries(d.actions).map(([k, x]) => '<option value="' + k + '"' + (a.kind === k ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select>' +
          (d.actions[a.kind] && d.actions[a.kind].value ? '<input id="rm-v-' + i + '" data-rm="value" data-i="' + i + '" value="' + esc(a.value || '') + '" placeholder="' + (a.kind === 'uri' ? 'https://…' : 'ข้อความที่ส่งในแชท') + '" aria-label="ค่าของช่อง ' + ZL(i) + '">'
            : '<span class="muted rm-auto">' + (a.kind === 'card' ? 'เปิดบัตรสมาชิก ' + esc(brand().short_name) + ' · ยังไม่เป็นสมาชิกจะเข้าหน้าสมัคร' : 'เปิดหน้า' + esc(d.actions[a.kind] ? d.actions[a.kind].name.split(' /')[0] : '') + ' ในบัตรสมาชิก') + '</span>') + '</div>').join('') +
        '</div><div class="field" style="max-width:260px"><label for="rm-bar">ข้อความบนแถบเมนู (ไม่เกิน 14 ตัว)</label><input id="rm-bar" data-rm="bar" maxlength="14" value="' + esc(r.chatBar) + '"></div></div>' +
      '</div><div class="rm-col rm-side">' +
      '<div class="card"><div class="rm-step"><i>4</i><h2>ตรวจตำแหน่งปุ่ม</h2></div>' +
        '<div class="rm-pv" style="aspect-ratio:' + lay.width + '/' + lay.height + '">' + (img ? '<img src="' + esc(img) + '" alt="">' : '') + rmZones(lay, true) + '</div>' +
        '<small class="muted">กดช่องในภาพเพื่อไปแก้ปุ่มของช่องนั้น · ช่อง ' + ZL(r.sel) + ': ' + esc(actionLabel(r.actions[r.sel] || {}, d.actions)) + '</small>' +
        '<div class="rm-phone"><div class="rm-chat"><span>สวัสดีครับ ยินดีต้อนรับสู่ ' + esc(brand().name) + '</span></div>' + (img ? '<img src="' + esc(img) + '" alt="">' : '<div class="rm-noimg" style="aspect-ratio:' + lay.width + '/' + lay.height + '"></div>') + '<div class="rm-bar">' + esc(r.chatBar || 'เมนู') + ' ▾</div></div>' +
        '<div class="rm-foot"><button type="button" class="btn" data-a="rmInstall"' + (ready ? '' : ' disabled') + '>ติดตั้งให้ OA ' + esc(brand().short_name) + '</button><button type="button" class="btn ghost" data-a="rmUndo">ล้างการแก้ไข</button></div>' +
        '<small class="muted">ติดตั้งแล้วลูกค้าทุกคนใน OA นี้เห็นเมนูใหม่ภายในไม่กี่นาที (บางคนต้องปิดแล้วเปิดแชทใหม่)</small></div>' +
      '</div></div>' +
      '<div class="card"><div class="hd"><h2>ประวัติเมนู</h2><small class="muted">กด "ใช้เมนูนี้อีกครั้ง" เพื่อย้อนกลับไปใช้รูปและปุ่มของเมนูนั้น</small></div>' +
        (d.list.length ? '<div class="rm-hist">' + d.list.map((x) => '<div class="rm-h' + (x.is_active ? ' on' : '') + '"><img src="' + esc(x.image) + '" alt="" loading="lazy"><div><b>#' + x.id + ' · ' + esc(d.layouts[x.layout] ? d.layouts[x.layout].name : x.layout) + '</b>' + (x.is_active ? ' <span class="pill">ใช้อยู่</span>' : '') +
          '<small class="muted">ติดตั้ง ' + date(x.installed_at) + ' ' + new Date(x.installed_at).toTimeString().slice(0, 5) + (x.created_by ? ' · สร้างโดย ' + esc(x.created_by) : '') + '</small>' +
          '<small class="muted">' + x.actions.map((a, i) => ZL(i) + ': ' + esc(actionLabel(a, d.actions))).join(' · ') + '</small></div>' +
          (x.is_active ? '' : '<button type="button" class="btn ghost sm" data-a="rmRestore" data-v="' + x.id + '"' + (d.configured ? '' : ' disabled') + '>ใช้เมนูนี้อีกครั้ง</button>') + '</div>').join('') + '</div>'
          : '<p class="muted">ยังไม่มีเมนูที่ติดตั้งจากหน้านี้</p>') + '</div>';
  }
  // รูปที่เลือก: สัดส่วนต้องตรงกับแบบ · ขนาดอื่นหรือไฟล์เกิน 1 MB ย่อ/บีบอัดเป็น JPG ให้
  function rmPrepare(file, lay) {
    return new Promise((ok, fail) => {
      if (!/^image\/(png|jpeg)$/.test(file.type)) return fail(new Error('รองรับเฉพาะรูป JPG หรือ PNG'));
      if (file.size > 15 * 1024 * 1024) return fail(new Error('ไฟล์ใหญ่เกินไป'));
      const rd = new FileReader();
      rd.onerror = () => fail(new Error('อ่านไฟล์ไม่สำเร็จ'));
      rd.onload = () => {
        const im = new Image();
        im.onerror = () => fail(new Error('ไฟล์นี้ไม่ใช่รูปภาพ'));
        im.onload = () => {
          const w = im.naturalWidth; const h = im.naturalHeight;
          if (Math.abs(w / h - lay.width / lay.height) > 0.01) return fail(new Error('สัดส่วนรูปไม่ตรงกับแบบ ' + lay.name + ' · ต้องเป็น ' + lay.width + ' × ' + lay.height + ' px (รูปนี้ ' + w + ' × ' + h + ')'));
          if (w === lay.width && h === lay.height && file.size <= 1024 * 1024) return ok({ dataUrl: rd.result, size: file.size, name: file.name, resized: false });
          const c = document.createElement('canvas'); c.width = lay.width; c.height = lay.height;
          const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0, c.width, c.height);
          let qv = 0.92; let url = c.toDataURL('image/jpeg', qv);
          while ((url.length - 23) * 0.75 > 1000 * 1000 && qv > 0.4) { qv -= 0.08; url = c.toDataURL('image/jpeg', qv); }
          const size = Math.round((url.length - 23) * 0.75);
          if (size > 1024 * 1024) return fail(new Error('บีบอัดรูปให้ไม่เกิน 1 MB ไม่ได้ ลองใช้รูปที่รายละเอียดน้อยลง'));
          ok({ dataUrl: url, size, name: file.name, resized: true });
        };
        im.src = rd.result;
      };
      rd.readAsDataURL(file);
    });
  }
  // แผนผังขนาดของแบบที่เลือก ไว้ส่งให้คนออกแบบ
  function rmGuide(lay) {
    const c = document.createElement('canvas'); c.width = lay.width; c.height = lay.height; const g = c.getContext('2d');
    const cols = ['#C7481A', '#2A1E1A', '#8A3A16', '#A9532B', '#5B3424', '#D0693C'];
    g.fillStyle = '#FDF3EC'; g.fillRect(0, 0, c.width, c.height);
    lay.areas.forEach(([x, y, w, h], i) => {
      g.fillStyle = cols[i % cols.length]; g.fillRect(x + 6, y + 6, w - 12, h - 12);
      const cx = x + w / 2; const cy = y + h / 2; const f = Math.min(w, h) / 7;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = '#06C755'; g.beginPath(); g.arc(cx, cy - f * 1.6, f * 0.75, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#fff'; g.font = '700 ' + f + 'px sans-serif'; g.fillText(ZL(i), cx, cy - f * 1.55);
      g.fillStyle = '#FFE16B'; g.font = '700 ' + f * 1.1 + 'px sans-serif'; g.fillText(w + ' × ' + h, cx, cy + f * 0.3);
      g.fillStyle = '#fff'; g.font = f * 0.55 + 'px sans-serif'; g.fillText('x ' + x + ' · y ' + y, cx, cy + f * 1.5);
    });
    g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = '40px sans-serif'; g.fillText(lay.name + ' · ทั้งภาพ ' + lay.width + ' × ' + lay.height + ' px · JPG/PNG ≤ 1 MB', 40, lay.height - 44);
    c.toBlob((b) => { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'richmenu-' + S.rm.layout + '-sizes.png'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); }, 'image/png');
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
        fld('r-plat', 'Platinum เมื่อสะสมครบ', num('r-plat', 'platinum', r.platinum_at), 'แต้ม') +
        fld('r-dia', 'Diamond เมื่อสะสมครบ', '<input id="r-dia" name="diamond" type="number" min="1" placeholder="ไม่ใช้" value="' + (r.diamond_at || '') + '">', 'แต้ม · เว้นว่าง = ไม่ใช้ระดับ Diamond')) +
      sec('LINE', 'ข้อความแจ้งแต้มนับโควต้าข้อความของ LINE OA · ข้อความตอบรีวิวไม่นับ',
        fld('r-notify', 'แจ้งแต้มหลังชำระบิล', '<select id="r-notify" name="pointsNotify">' + opt([['off', 'ไม่แจ้ง'], ['all', 'แจ้งทุกบิล'], ['min', 'แจ้งเมื่อยอดบิลถึง…']], r.points_notify || 'off') + '</select>', 'ลูกค้าดูแต้มในบัตรสมาชิกได้ตลอด') +
        fld('r-nmin', 'ยอดบิลขั้นต่ำที่แจ้ง (บาท)', '<input id="r-nmin" name="pointsNotifyMin" type="number" min="0" value="' + (Number(r.points_notify_min) || '') + '">', 'ใช้เมื่อเลือก "แจ้งเมื่อยอดบิลถึง…"') +
        fld('r-review', 'แต้มรีวิวร้านในแชท', num('r-review', 'reviewPoints', r.review_points == null ? 5 : r.review_points, ' min="0" max="1000" step="1"'), 'ลูกค้าพิมพ์ "ติชม" แล้วเลือกคะแนน · เฉพาะวันที่มีบิล วันละครั้ง · 0 = ปิด') +
        fld('r-oa', 'LINE OA ID ของแบรนด์', '<input id="r-oa" name="oaBasicId" placeholder="@xxxx" value="' + esc(r.oa_basic_id || '') + '">', 'ใช้ทำปุ่มเพิ่มเพื่อนในหน้าสมัคร') +
        fld('r-follow', 'สมัครสมาชิก', '<select id="r-follow" name="requireFollow">' + opt([['1', 'ต้องเพิ่มเพื่อน OA ก่อน'], ['0', 'ไม่บังคับ']], r.require_follow === false ? '0' : '1') + '</select>', 'ต้องใส่ LINE OA ID และตั้ง token ของ OA แล้วจึงมีผล')) +
      (S.err ? '<div class="err" role="alert">' + esc(S.err) + '</div>' : '') +
      '<div class="actions rules-foot"><button class="btn">บันทึกกฎแต้ม</button><small class="muted">มีผลกับบิลหลังบันทึก บิลเก่าคิดตามกฎเดิม · กฎนี้ใช้อยู่ตั้งแต่ ' + date(r.effective_from) + '</small></div></form>';
  }

  /* ---------- สมาชิก: รายการซ้าย รายละเอียดขวา ---------- */
  const TIER_LABEL = { SILVER: 'Silver', GOLD: 'Gold', PLATINUM: 'Platinum', DIAMOND: 'Diamond' };
  const TAG_COLORS = [['blue', 'ฟ้า'], ['green', 'เขียว'], ['orange', 'ส้ม'], ['red', 'แดง'], ['purple', 'ม่วง'], ['gray', 'เทา']];
  const AUTO_RULES = [['new', 'สมาชิกใหม่ (สมัครภายใน N วัน)'], ['inactive', 'หายไป (เคยซื้อ แต่ไม่มา N วัน)'], ['visits', 'มาบ่อย (≥ N บิล ใน D วัน)'],
    ['spend', 'ยอดซื้อสูง (≥ X บาท ใน D วัน)'], ['birthday', 'เกิดเดือนนี้'], ['no_line', 'ยังไม่ผูก LINE']];
  function memberQs(extra) {
    const o = { brand: S.brand, page: S.mf.page, size: 10 }; ['q', 'tier', 'branch', 'tag'].forEach((k) => { if (S.mf[k]) o[k] = S.mf[k]; });
    return new URLSearchParams(Object.assign(o, extra || {})).toString();
  }
  const ruleText = (r) => {
    if (!r) return '';
    return { new: 'สมัครภายใน ' + r.days + ' วัน', inactive: 'ไม่มา ' + r.days + ' วัน', visits: '≥ ' + r.count + ' บิล ใน ' + r.days + ' วัน', spend: 'ยอด ≥ ' + fmt(r.amount) + ' บาท ใน ' + r.days + ' วัน', birthday: 'เกิดเดือนนี้', no_line: 'ยังไม่ผูก LINE' }[r.type] || '';
  };
  const tagChip = (t, removable) => '<span class="tagc ' + esc(t.color) + '">' + (t.kind === 'auto' ? '<span aria-label="อัตโนมัติ" title="ระบบติดให้ตามเงื่อนไข">⚡</span>' : '') + esc(t.name) +
    (removable && t.kind === 'manual' ? '<button type="button" aria-label="ถอดแท็ก ' + esc(t.name) + '" data-a="untag" data-v="' + t.id + '">×</button>' : '') + '</span>';
  const avatar = (pic, name, big) => pic ? '<img class="av' + (big ? ' big' : '') + '" alt="" src="' + esc(pic) + '">' : '<span class="av' + (big ? ' big' : '') + '" aria-hidden="true">' + esc(Array.from(String(name || '?'))[0]) + '</span>';
  const tierPill = (t) => '<span class="tierp ' + t + '">' + (TIER_LABEL[t] || t) + '</span>';
  const ago = (t) => { if (!t) return '-'; const d = Math.floor((Date.now() - new Date(t)) / 864e5); return d < 1 ? 'น้อยกว่า 1 วัน' : d < 30 ? d + ' วัน' : d < 365 ? Math.floor(d / 30) + ' เดือน' : Math.floor(d / 365) + ' ปี ' + Math.floor((d % 365) / 30) + ' เดือน'; };
  const when = (t) => (t ? date(t) + ' ' + new Date(t).toTimeString().slice(0, 5) : '-');
  function membersView() {
    const res = S.data.members || { rows: [], total: 0, page: 1, size: 10 };
    const tags = S.data.tags || []; const pages = Math.max(1, Math.ceil(res.total / res.size));
    const sel = S.member ? S.member.member.id : null;
    const opt = (list, cur, all) => '<option value="">' + all + '</option>' + list.map((o) => '<option value="' + esc(o[0]) + '"' + (String(cur) === String(o[0]) ? ' selected' : '') + '>' + esc(o[1]) + '</option>').join('');
    return '<form class="mtop" data-f="msearch" role="search"><div class="srch"><label class="sr" for="mq">ค้นหาสมาชิก</label><input id="mq" name="q" type="search" placeholder="ชื่อ, เบอร์โทร, เลขสมาชิก" value="' + esc(S.mf.q) + '"><button class="btn" aria-label="ค้นหา">ค้นหา</button></div>' +
        '<select name="tier" aria-label="ระดับ">' + opt(Object.entries(TIER_LABEL), S.mf.tier, 'ทุกระดับ') + '</select>' +
        '<select name="branch" aria-label="สาขาที่สมัคร">' + opt(brand().branches.map((x) => [x.id, x.name]), S.mf.branch, 'ทุกสาขาที่สมัคร') + '</select>' +
        '<select name="tag" aria-label="แท็ก">' + opt(tags.map((t) => [t.id, (t.kind === 'auto' ? '⚡ ' : '') + t.name + ' (' + fmt(t.members) + ')']), S.mf.tag, 'แท็กทั้งหมด') + '</select>' +
        '<span class="sp"></span><button type="button" class="btn ghost" data-a="tagMgr">จัดการแท็ก</button><button type="button" class="btn ghost" data-a="exportMembers">ดาวน์โหลด</button><button type="button" class="btn" data-a="addMember">+ เพิ่มสมาชิก</button></form>' +
      '<div class="mwrap"><div class="mlist"><div class="wrap"><table class="tbl mtbl"><thead><tr><th>#</th><th>ชื่อ</th><th>เลขสมาชิก</th><th>หมายเหตุ</th><th class="r">แต้ม</th><th>ระดับ</th></tr></thead><tbody>' +
        (res.rows.length ? res.rows.map((m, i) => '<tr class="' + (m.id === sel ? 'sel' : '') + '" data-a="member" data-v="' + esc(m.id) + '" tabindex="0"><td class="muted">' + ((res.page - 1) * res.size + i + 1) + '</td>' +
          '<td><div class="mname">' + avatar(m.picture, m.full_name) + '<span><b>' + esc(m.full_name) + '</b>' + (m.tags.length ? '<span class="mtags">' + m.tags.slice(0, 3).map((t) => tagChip(t)).join('') + (m.tags.length > 3 ? '<small class="muted">+' + (m.tags.length - 3) + '</small>' : '') + '</span>' : '') + '</span></div></td>' +
          '<td class="nowrap muted">' + esc(m.id) + '</td><td class="mnote">' + esc(m.note || '-') + '</td><td class="r num">' + fmt(m.points) + '</td><td>' + tierPill(m.tier) + '</td></tr>').join('')
          : '<tr><td colspan="6" class="muted" style="text-align:center;padding:24px">ไม่พบสมาชิก</td></tr>') +
        '</tbody></table></div><div class="pager"><button class="btn ghost sm" data-a="mpage" data-v="1"' + (res.page <= 1 ? ' disabled' : '') + ' aria-label="หน้าแรก">«</button><button class="btn ghost sm" data-a="mpage" data-v="' + (res.page - 1) + '"' + (res.page <= 1 ? ' disabled' : '') + ' aria-label="ก่อนหน้า">‹</button>' +
        '<span>หน้า <b>' + res.page + '</b> / ' + pages + ' · ทั้งหมด ' + fmt(res.total) + ' คน</span><button class="btn ghost sm" data-a="mpage" data-v="' + (res.page + 1) + '"' + (res.page >= pages ? ' disabled' : '') + ' aria-label="ถัดไป">›</button><button class="btn ghost sm" data-a="mpage" data-v="' + pages + '"' + (res.page >= pages ? ' disabled' : '') + ' aria-label="หน้าสุดท้าย">»</button></div></div>' +
      '<aside class="mdet" aria-label="รายละเอียดสมาชิก">' + (S.member ? memberPanel(S.member) : '<p class="muted" style="text-align:center;padding:40px 0">เลือกสมาชิกจากรายการเพื่อดูรายละเอียด</p>') + '</aside></div>';
  }
  function memberPanel(d) {
    const m = d.member; const x = d.extra || {}; const w = d.wallets[S.brand] || { balance: 0, tier: {} }; const t = w.tier || {};
    const coupons = d.coupons.filter((c) => c.status === 'ready' && (c.brand === 'all' || c.brand === S.brand));
    const link = (d.links || []).find((l) => l.brand_id === S.brand) || {};
    const branchName = (id) => (brand().branches.find((b) => b.id === id) || {}).name || id || '-';
    const manualTags = (S.data.tags || []).filter((tg) => tg.kind === 'manual' && !(x.tags || []).some((y) => y.id === tg.id));
    const tab = (k, label) => '<button type="button" role="tab" aria-selected="' + (S.mtab === k) + '" data-a="mtab" data-v="' + k + '">' + label + '</button>';
    const kv = (k, v) => '<span>' + k + '</span><span>' + v + '</span>';
    let body = '';
    if (S.mtab === 'm') {
      body = '<div class="kvx">' +
        kv('หมายเหตุ', '<form data-f="mnote" class="mnote-f"><label class="sr" for="m-note">หมายเหตุ</label><textarea id="m-note" name="note" maxlength="500" rows="2" placeholder="เช่น แพ้ถั่ว · ชอบนั่งริมหน้าต่าง">' + esc(x.note || '') + '</textarea><button class="btn ghost sm">บันทึก</button></form>') +
        kv('คูปองคงเหลือ', '<b class="n">' + coupons.length + '</b> คูปอง' + (coupons.length ? '<small class="muted"> · ' + coupons.slice(0, 3).map((c) => esc(c.title)).join(', ') + (coupons.length > 3 ? ' …' : '') + '</small>' : '')) +
        kv('แต้มคงเหลือ', '<b class="n">' + fmt(w.balance) + '</b> แต้ม') +
        kv('แต้มใกล้หมดอายุ', '<b class="n">' + fmt(x.expiring30 || 0) + '</b> แต้ม <small class="muted">(ภายใน 30 วัน)</small>') +
        kv('สะสม 12 เดือน', fmt(t.at || 0) + ' / ' + fmt(t.max || 0) + ' แต้ม' + (t.next ? ' <small class="muted">(อีก ' + fmt(t.need) + ' ขึ้น ' + esc(t.next) + ')</small>' : '')) +
        kv('มาซื้อทั้งหมด', fmt(x.visits || 0) + ' บิล · ' + fmt(x.spend || 0) + ' บาท') +
        kv('เป็นสมาชิกมา', ago(m.created_at)) + kv('สาขาที่สมัคร', esc(branchName(m.home_branch_id))) + kv('ใช้งานล่าสุด', when(x.last_active)) + '</div>' +
        (S.giftable && S.giftable.length ? '<form class="minline" data-f="gift" data-v="' + esc(m.id) + '"><label for="g-tpl">มอบคูปอง</label><select id="g-tpl" name="templateId"><option value="">เลือกคูปอง</option>' +
          S.giftable.map((tp) => '<option value="' + tp.id + '">' + esc((KIND_NAME[tp.kind] || '') + ' · ' + tp.title) + '</option>').join('') + '</select><button class="btn sm">มอบ</button></form>' : '') +
        '<form class="minline" data-f="adjust" data-v="' + esc(m.id) + '"><label for="a-pts">ปรับแต้ม</label><input id="a-pts" name="points" type="number" required placeholder="+50 / -20" style="width:96px"><input name="reason" required placeholder="เหตุผล" aria-label="เหตุผล" style="flex:1;min-width:120px"><button class="btn sm">ส่งขออนุมัติ</button></form>';
    } else if (S.mtab === 'i') {
      body = '<div class="kvx">' + kv('ชื่อ - นามสกุล', esc(m.full_name)) + kv('เบอร์โทร', esc(m.phone)) + kv('วันเกิด', m.birth_date ? date(String(m.birth_date).slice(0, 10) + 'T12:00:00+07:00') : '-') +
        kv('LINE', x.has_line ? 'ผูกแล้ว' + (link.follow_status === 'follow' ? ' · เป็นเพื่อน OA' : link.follow_status === 'blocked' ? ' · บล็อก OA' : '') : '<span class="pill warn">ยังไม่ผูก</span>') +
        kv('รับข่าวสาร', link.marketing_consent ? 'ยินยอม' : 'ไม่ยินยอม') + kv('สมัครเมื่อ', when(m.created_at)) + kv('เลขสมาชิก', esc(m.id)) + '</div>' +
        (S.staff.role === 'super' ? '<div style="margin-top:14px"><button class="btn danger sm" data-a="delMember" data-v="' + esc(m.id) + '">ลบสมาชิก</button></div>' : '');
    } else {
      const items = [];
      d.bills.filter((b) => b.brand_id === S.brand).forEach((b) => items.push({ t: b.paid_at, k: 'bills', title: 'บิล ' + b.pos_bill_id + ' · ' + branchName(b.branch_id), sub: fmt(b.total) + ' บาท' + (Number(b.discount) ? ' · ส่วนลด ' + fmt(b.discount) : '') + (b.status !== 'paid' ? ' · ' + b.status : ''), v: '<span class="plus">+' + fmt(b.points_earned) + '</span>' }));
      d.ledger.filter((l) => l.brand_id === S.brand && l.entry_type !== 'earn').forEach((l) => items.push({ t: l.created_at, k: 'points', title: l.note || l.entry_type, sub: 'แต้ม', v: '<span class="' + (l.points >= 0 ? 'plus' : 'minus') + '">' + (l.points > 0 ? '+' : '') + fmt(l.points) + '</span>' }));
      d.coupons.filter((c) => c.brand === S.brand || c.brand === 'all').forEach((c) => {
        items.push({ t: c.issuedAt, k: 'coupons', title: 'ได้คูปอง ' + c.title, sub: c.code, v: '<span class="muted">คูปอง</span>' });
        if (c.usedAt) items.push({ t: c.usedAt, k: 'coupons', title: 'ใช้คูปอง ' + c.title, sub: c.code, v: '<span class="muted">ใช้แล้ว</span>' });
      });
      items.sort((a, b) => new Date(b.t) - new Date(a.t));
      const list = items.filter((it) => S.actf === 'all' || it.k === S.actf).slice(0, 60);
      body = '<div class="chips" role="group" aria-label="กรองกิจกรรม">' + [['all', 'ทั้งหมด'], ['bills', 'บิล'], ['points', 'แต้ม'], ['coupons', 'คูปอง']].map((f) => '<button type="button" data-a="actf" data-v="' + f[0] + '" aria-pressed="' + (S.actf === f[0]) + '">' + f[1] + '</button>').join('') + '</div>' +
        (list.length ? '<div class="act">' + list.map((it) => '<div class="r"><span>' + esc(it.title) + '<small>' + when(it.t) + ' · ' + esc(it.sub) + '</small></span>' + it.v + '</div>').join('') + '</div>' : '<p class="muted">ยังไม่มีกิจกรรม</p>');
    }
    return '<div class="mhd">' + avatar(x.picture, m.full_name, true) + '<div style="flex:1;min-width:0"><div class="nm">' + esc(m.full_name) + '</div><div class="sub">' + esc(m.id) + ' · ' + esc(m.phone) + '</div></div>' + tierPill(t.name || 'SILVER') + '</div>' +
      '<div class="mtagrow">' + (x.tags || []).map((tg) => tagChip(tg, true)).join('') +
        (S.tagPick ? '<form class="tagpick" data-f="mtag"><label class="sr" for="tp-sel">เลือกแท็ก</label><select id="tp-sel" name="tagId"><option value="">' + (manualTags.length ? 'เลือกแท็ก…' : 'ยังไม่มีแท็กให้เลือก') + '</option>' + manualTags.map((tg) => '<option value="' + tg.id + '">' + esc(tg.name) + '</option>').join('') + '</select>' +
          '<input name="newName" maxlength="40" placeholder="หรือพิมพ์แท็กใหม่" aria-label="ชื่อแท็กใหม่"><button class="btn sm">ติดแท็ก</button><button type="button" class="btn ghost sm" data-a="tagPick">ยกเลิก</button></form>'
          : '<button type="button" class="tagadd" data-a="tagPick">+ เพิ่มแท็ก</button>') + '</div>' +
      '<div class="tabs3" role="tablist">' + tab('m', 'การเป็นสมาชิก') + tab('i', 'ข้อมูล') + tab('a', 'กิจกรรม') + '</div>' + body;
  }
  function addMemberForm() {
    return '<form class="grid" data-f="newMember">' +
      '<div class="field" style="grid-column:1/-1"><label for="nm-name">ชื่อ - นามสกุล</label><input id="nm-name" name="name" required maxlength="100" data-autofocus></div>' +
      '<div class="field"><label for="nm-phone">เบอร์โทร</label><input id="nm-phone" name="phone" required inputmode="tel" maxlength="12" placeholder="0812345678"></div>' +
      '<div class="field"><label for="nm-bd">วันเกิด</label><input id="nm-bd" name="birthday" type="date"></div>' +
      '<div class="field" style="grid-column:1/-1"><label for="nm-br">สาขาที่สมัคร</label><select id="nm-br" name="branchId">' + brand().branches.map((b) => '<option value="' + esc(b.id) + '">' + esc(b.name) + '</option>').join('') + '</select></div>' +
      '<label class="check" style="grid-column:1/-1"><input type="checkbox" name="marketing">ลูกค้ายินดีรับข่าวสารและโปรโมชั่นทาง LINE</label>' +
      '<label class="check" style="grid-column:1/-1"><input type="checkbox" name="consent" required>ลูกค้ายอมรับเงื่อนไขสมาชิกและนโยบายความเป็นส่วนตัวแล้ว</label>' +
      '<small class="muted" style="grid-column:1/-1">ได้แต้มและคูปองต้อนรับเหมือนสมัครผ่าน LINE · ลูกค้าสะสมแต้มที่ร้านด้วยเบอร์โทรได้ทันที</small>' +
      '<div class="err" id="c-err" role="alert" hidden></div><div class="actions"><button class="btn">เพิ่มสมาชิก</button><button type="button" class="btn ghost" data-a="close">ยกเลิก</button></div></form>';
  }
  function tagManager() {
    const tags = S.data.tags || []; const e = S.edit.tag || { kind: 'manual', color: 'blue', rule: { type: 'new', days: 30 } };
    const r = e.rule || { type: 'new', days: 30 };
    return '<div class="tagmgr"><div><h3 class="h3">แท็กทั้งหมด (' + tags.length + ')</h3>' +
      (tags.length ? '<div class="wrap"><table class="tbl"><thead><tr><th>แท็ก</th><th>เงื่อนไข</th><th class="r">สมาชิก</th><th></th></tr></thead><tbody>' + tags.map((t) => '<tr><td>' + tagChip(t) + (t.description ? '<br><small class="muted">' + esc(t.description) + '</small>' : '') + '</td>' +
        '<td>' + (t.kind === 'auto' ? '⚡ ' + esc(ruleText(t.rule)) : 'พนักงานติดเอง') + '</td><td class="r num"><button class="linkb" data-a="tagFilter" data-v="' + t.id + '">' + fmt(t.members) + '</button></td>' +
        '<td class="r nowrap"><button class="btn ghost sm" data-a="tagEdit" data-v="' + t.id + '">แก้ไข</button> <button class="btn ghost sm" data-a="tagDel" data-v="' + t.id + '">ลบ</button></td></tr>').join('') + '</tbody></table></div>'
        : '<p class="muted">ยังไม่มีแท็ก สร้างแท็กแรกทางขวา</p>') + '</div>' +
      '<form class="grid tagform" data-f="tag" data-v="' + (e.id || '') + '"><h3 class="h3" style="grid-column:1/-1">' + (e.id ? 'แก้ไขแท็ก' : 'สร้างแท็กใหม่') + '</h3>' +
        '<div class="field" style="grid-column:1/-1"><label for="tg-name">ชื่อแท็ก</label><input id="tg-name" name="name" required maxlength="40" value="' + esc(e.name || '') + '" placeholder="เช่น ลูกค้าประจำ, สายไก่ทอด, ลูกค้าองค์กร"></div>' +
        '<fieldset class="field" style="grid-column:1/-1"><legend>สี</legend><div class="rw-inline">' + TAG_COLORS.map((c) => '<label class="check"><input type="radio" name="color" value="' + c[0] + '"' + (e.color === c[0] ? ' checked' : '') + '><span class="tagc ' + c[0] + '">' + c[1] + '</span></label>').join('') + '</div></fieldset>' +
        '<fieldset class="field" style="grid-column:1/-1"><legend>ประเภท</legend><div class="segr">' + [['manual', 'พนักงานติดเอง'], ['auto', '⚡ อัตโนมัติตามเงื่อนไข']].map((k) => '<label><input type="radio" name="kind" value="' + k[0] + '"' + (e.kind === k[0] ? ' checked' : '') + (e.id ? ' disabled' : '') + '><span>' + k[1] + '</span></label>').join('') + '</div></fieldset>' +
        '<div class="field" data-tk="auto" style="grid-column:1/-1"><label for="tg-rule">เงื่อนไข</label><select id="tg-rule" name="ruleType">' + AUTO_RULES.map((o) => '<option value="' + o[0] + '"' + (r.type === o[0] ? ' selected' : '') + '>' + o[1] + '</option>').join('') + '</select></div>' +
        '<div class="field" data-tk="auto" data-rt="count"><label for="tg-count">จำนวนบิล (N)</label><input id="tg-count" name="count" type="number" min="1" value="' + esc(r.count || 4) + '"></div>' +
        '<div class="field" data-tk="auto" data-rt="amount"><label for="tg-amt">ยอดซื้อ (บาท)</label><input id="tg-amt" name="amount" type="number" min="1" value="' + esc(r.amount || 2000) + '"></div>' +
        '<div class="field" data-tk="auto" data-rt="days"><label for="tg-days">ช่วงเวลา (วัน)</label><input id="tg-days" name="days" type="number" min="1" value="' + esc(r.days || 30) + '"></div>' +
        '<div class="field" style="grid-column:1/-1"><label for="tg-desc">คำอธิบาย (ไม่บังคับ)</label><input id="tg-desc" name="description" maxlength="200" value="' + esc(e.description || '') + '" placeholder="ใช้ทำอะไร เช่น กลุ่มส่งโปรวันเกิด"></div>' +
        '<small class="muted" style="grid-column:1/-1">แท็กอัตโนมัติ: ระบบคำนวณใหม่ทุกครั้งที่เปิดดู ใช้กรองรายชื่อและดาวน์โหลดไปทำข้อมูลได้</small>' +
        '<div class="err" id="c-err" role="alert" hidden></div><div class="actions"><button class="btn">' + (e.id ? 'บันทึก' : 'สร้างแท็ก') + '</button>' + (e.id ? '<button type="button" class="btn ghost" data-a="tagNew">สร้างใหม่แทน</button>' : '') + '<button type="button" class="btn ghost" data-a="close">ปิด</button></div></form></div>';
  }
  function syncTagForm(el) {
    const kind = (el.querySelector('input[name="kind"]:checked') || {}).value || 'manual';
    const rt = el.elements.ruleType ? el.elements.ruleType.value : '';
    const need = { new: ['days'], inactive: ['days'], visits: ['count', 'days'], spend: ['amount', 'days'], birthday: [], no_line: [] }[rt] || [];
    el.querySelectorAll('[data-tk]').forEach((x) => { x.hidden = kind !== 'auto' || (x.dataset.rt && !need.includes(x.dataset.rt)); });
  }
  async function exportMembers() {
    const res = await api('GET', '/api/admin/members?' + memberQs({ all: 1 }));
    const cols = ['เลขสมาชิก', 'ชื่อ', 'เบอร์โทร', 'ระดับ', 'แต้มคงเหลือ', 'แต้มสะสม 12 เดือน', 'แท็ก', 'หมายเหตุ', 'สาขาที่สมัคร', 'วันเกิด', 'สมัครเมื่อ', 'ใช้งานล่าสุด'];
    const cell = (v) => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };
    const day = (t) => (t ? new Date(t).toISOString().slice(0, 10) : '');
    const rows = res.rows.map((m) => [m.id, m.full_name, m.phone, TIER_LABEL[m.tier], m.points, m.earned, m.tags.map((t) => t.name).join('; '), m.note || '', (brand().branches.find((b) => b.id === m.home_branch_id) || {}).name || '', m.birth_date ? String(m.birth_date).slice(0, 10) : '', day(m.created_at), day(m.last_active)]);
    const csv = '﻿' + [cols, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'members-' + S.brand + '-' + new Date().toISOString().slice(0, 10) + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    toast('ดาวน์โหลด ' + fmt(res.rows.length) + ' คน' + (res.total > res.rows.length ? ' (สูงสุด 5,000 คน)' : ''));
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
    if (e.kind === 'newMember') { title = 'เพิ่มสมาชิก · ' + brand().name; body = addMemberForm(); }
    if (e.kind === 'tags') { title = 'จัดการแท็กสมาชิก · ' + brand().name; body = tagManager(); }
    return '<div class="scrim" data-a="close"></div><div class="dialog' + (e.kind === 'coupon' || e.kind === 'reward' || e.kind === 'tags' ? ' wide' : '') + '" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><h2>' + esc(title) + '</h2>' + body + '</div>';
  }

  /* ---------- การกด ---------- */
  const A = {
    pickAdd: (v) => {
      const [kind, type, ...rest] = v.split(':'); const id = rest.join(':'); const e = S.edit; const menu = e.menu;
      const src = type === 'cat' ? menu.categories.find((x) => x.id === id) : menu.items.find((x) => x.id === id); if (!src) return;
      if (kind === 'free') e.free.push({ id: src.id, name: src.name, price: src.price });
      else e.cond.items.push({ type, id: src.id, name: src.name });
      const q = document.querySelector('.mp-q[data-pick="' + kind + '"]'); if (q) { q.value = ''; q.focus(); }
      drawPick(kind); const f = document.querySelector('form[data-f="coupon"]'); if (f) syncCoupon(f); const rf = document.querySelector('form[data-f="reward"]'); if (rf) syncReward(rf);
    },
    pickDel: (v) => {
      const [kind, i] = v.split(':'); const list = kind === 'free' ? S.edit.free : S.edit.cond.items; list.splice(Number(i), 1);
      drawPick(kind); const f = document.querySelector('form[data-f="coupon"]'); if (f) syncCoupon(f); const rf = document.querySelector('form[data-f="reward"]'); if (rf) syncReward(rf);
    },
    rmLayout: (v) => {
      const r = S.rm; if (r.layout === v) return;
      const n = S.data.rm.layouts[v].areas.length;
      r.layout = v; while (r.actions.length < n) r.actions.push({ kind: 'message', value: '' }); r.sel = 0; r.err = '';     // เก็บปุ่มช่องท้ายไว้ เผื่อสลับกลับแบบเดิม
      if (r.img) { r.img = null; toast('เปลี่ยนแบบแล้ว อัปโหลดรูปที่มีขนาดตามแบบใหม่'); }
      const f = rmFrom(); if (f && f.layout !== v) r.fromId = null;
      if (!r.fromId) { const cur = S.data.rm.list.find((x) => x.is_active && x.layout === v); if (cur) r.fromId = cur.id; }
      render();
    },
    rmZone: (v) => { S.rm.sel = Number(v); render(); const el = document.getElementById('rm-k-' + v); if (el) { el.focus(); el.scrollIntoView({ block: 'center' }); } },
    rmGuide: () => rmGuide(rmLay()),
    rmUndo: () => { rmReset(); render(); },
    rmInstall: async () => {
      const r = S.rm;
      if (!confirm('ติดตั้งเมนูนี้ให้ลูกค้าทุกคนใน OA ' + brand().name + ' ตอนนี้เลยไหม?')) return;
      await api('POST', '/api/admin/richmenus', { brand: S.brand, layout: r.layout, actions: rmActs(), chatBar: r.chatBar, dataUrl: r.img ? r.img.dataUrl : undefined, fromId: r.img ? undefined : r.fromId });
      toast('ติดตั้งเมนูให้ OA แล้ว'); S.rm = null; await load();
    },
    rmRestore: async (v) => {
      if (!confirm('ย้อนกลับไปใช้เมนู #' + v + ' ให้ลูกค้าทุกคนใน OA ' + brand().name + ' ไหม?')) return;
      await api('POST', '/api/admin/richmenus/' + v + '/restore', {});
      toast('กลับไปใช้เมนู #' + v + ' แล้ว'); S.rm = null; await load();
    },
    reload: () => location.reload(),
    logout: () => logout(),
    page: async (v) => { S.page = v; S.edit = null; S.err = ''; S.member = null; await load(); window.scrollTo(0, 0); },
    brand: async (v) => { S.brand = v; store.set('crm-admin-brand', v); S.member = null; applyTheme(); await load(); },
    close: () => { S.edit = null; S.err = ''; render(); },
    editReward: async (v) => {
      const r = v === 'new' ? null : S.data.rewards.find((x) => String(x.id) === String(v));
      const menu = await api('GET', '/api/admin/pos-menu?brand=' + S.brand);
      const g = r && r.kind === 'general';
      S.edit = { kind: 'reward', id: v, imageId: r ? r.image_id : null, imageUrl: r && r.image_id ? '/api/public/coupon-images/' + r.image_id : null, menu,
        free: (g && r.free_items) || [], cond: { mode: (g && r.cond_mode) || '', items: (g && r.cond_items) || [], qty: (g && r.cond_qty) || 1, scope: (g && r.cond_scope) || 'bill' } };
      S.err = ''; render();
    },
    dropRewardImage: () => { S.edit.imageId = null; S.edit.imageUrl = null; rerenderRewardImage(); },
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
    editCoupon: async (v) => {
      const t = v ? S.data.coupons.find((x) => String(x.id) === String(v)) : null;
      const [rounds, menu] = await Promise.all([t && t.kind === 'gift' ? api('GET', '/api/admin/coupon-templates/' + t.id + '/rounds') : [], api('GET', '/api/admin/pos-menu?brand=' + S.brand)]);
      roundKey = '';
      S.edit = { kind: 'coupon', id: v || null, imageId: t ? t.image_id : null, imageUrl: t && t.image_id ? '/api/public/coupon-images/' + t.image_id : null, rounds, menu, locked: false, issued: t ? t.issued - t.used : 0, before: null,
        free: (t && t.free_items) || [], cond: { mode: (t && t.cond_mode) || '', items: (t && t.cond_items) || [], qty: (t && t.cond_qty) || 1, scope: (t && t.cond_scope) || 'bill' } };
      S.err = ''; render(); drawPick('free'); drawPick('cond');
      const cf = document.querySelector('form[data-f="coupon"]'); if (cf && t) S.edit.before = discountKey(couponBody(cf));
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
    member: async (v) => { await openMember(v); S.tagPick = false; render(); },
    mpage: async (v) => { S.mf.page = Math.max(1, parseInt(v, 10) || 1); await load(); },
    mtab: (v) => { S.mtab = v; render(); },
    actf: (v) => { S.actf = v; render(); },
    tagPick: () => { S.tagPick = !S.tagPick; render(); const f = document.querySelector('form[data-f="mtag"] select'); if (f) f.focus(); },
    untag: async (v) => { await api('DELETE', '/api/admin/members/' + encodeURIComponent(S.member.member.id) + '/tags/' + v); await load(); },
    addMember: () => { S.edit = { kind: 'newMember' }; S.err = ''; render(); },
    tagMgr: () => { S.edit = { kind: 'tags' }; S.err = ''; render(); },
    tagNew: () => { S.edit = { kind: 'tags' }; render(); },
    tagEdit: (v) => { S.edit = { kind: 'tags', tag: (S.data.tags || []).find((t) => String(t.id) === String(v)) }; render(); },
    tagDel: async (v) => {
      const t = (S.data.tags || []).find((x) => String(x.id) === String(v));
      if (!confirm('ลบแท็ก "' + t.name + '"?' + (t.kind === 'manual' && t.members ? '\nแท็กนี้จะถูกถอดออกจากสมาชิก ' + t.members + ' คน' : ''))) return;
      await api('DELETE', '/api/admin/tags/' + v); if (String(S.mf.tag) === String(v)) S.mf.tag = ''; S.edit = { kind: 'tags' }; toast('ลบแท็กแล้ว'); await load();
    },
    tagFilter: async (v) => { S.mf = { q: '', tier: '', branch: '', tag: String(v), page: 1 }; S.edit = null; await load(); },
    exportMembers: () => exportMembers(),
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
      const el = document.querySelector('form[data-f="reward"]');
      const pick = (n) => (el.querySelector('input[name="' + n + '"]:checked') || {}).value;
      const stockSet = pick('stockMode') === 'set'; const limSet = pick('limitMode') === 'set';
      if (stockSet && o.stock === '') throw new Error('ใส่จำนวนในคลัง หรือเลือก "ไม่ตั้งค่าจำนวน"');
      if (limSet && !(Number(o.limitCount) > 0)) throw new Error('ใส่จำนวนครั้งที่แลกได้ต่อคน หรือเลือก "ไม่จำกัดจำนวน"');
      const body = { brand: S.brand, kind: pick('kind') || 'general', name: o.name, description: o.description, imageId: S.edit.imageId || null, cat: o.cat, cost: o.cost, type: o.type, value: o.value || 0, min: o.min || 0, days: o.days,
        templateId: o.templateId || null, stock: stockSet ? o.stock : null, limitCount: limSet ? o.limitCount : null, limitPeriod: limSet ? o.limitPeriod : 'all',
        tiers: TIERS.map((t) => t[0]).filter((t) => o['tier_' + t]), startDate: o.startDate || null, endDate: o.endDate || null, active: o.active,
        freeItems: o.cat !== 'discount' ? S.edit.free : [], freeMode: pick('freeMode') || 'one', freeQty: o.freeQty, freeNeedAll: !!o.freeNeedAll,
        condMode: pick('condMode') || '', condItems: pick('condMode') ? S.edit.cond.items : [], condQty: o.condQty, condScope: pick('condScope') || 'bill' };
      if (id === 'new') await api('POST', '/api/admin/rewards', body); else await api('PATCH', '/api/admin/rewards/' + id, body);
      S.edit = null; toast('บันทึกของรางวัลแล้ว'); await load();
    },
    coupon: async (_o, id, el) => {
      const body = couponBody(el);
      // แก้ส่วนลด/เงื่อนไขของคูปองที่ลูกค้าถืออยู่ → ถามก่อน
      if (id && S.edit.issued > 0 && S.edit.before && discountKey(body) !== S.edit.before &&
        !confirm('คูปองนี้อยู่ในกระเป๋าลูกค้า ' + fmt(S.edit.issued) + ' ใบที่ยังไม่ได้ใช้\nส่วนลดและเงื่อนไขใหม่จะมีผลกับทุกใบทันที (วันหมดอายุเดิม)\n\nบันทึกการเปลี่ยนแปลงไหม?')) return;
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
        tiers: { gold: Number(o.gold), platinum: Number(o.platinum), diamond: o.diamond === '' ? null : Number(o.diamond) }, promo: { on: o.promoOn, day: Number(o.promoDay), mult: Number(o.promoMult) } });
      await api('PATCH', '/api/admin/brands/' + S.brand + '/notify', { pointsNotify: o.pointsNotify, pointsNotifyMin: o.pointsNotifyMin });
      await api('PATCH', '/api/admin/brands/' + S.brand + '/review', { reviewPoints: Number(o.reviewPoints) });
      await api('PATCH', '/api/admin/brands/' + S.brand + '/join', { oaBasicId: o.oaBasicId, requireFollow: o.requireFollow === '1' });
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
    msearch: async (o) => { S.mf = { q: o.q, tier: o.tier, branch: o.branch, tag: o.tag, page: 1 }; await load(); },
    mnote: async (o) => { await api('PUT', '/api/admin/members/' + encodeURIComponent(S.member.member.id) + '/note', { brand: S.brand, note: o.note }); toast('บันทึกหมายเหตุแล้ว'); await load(); },
    mtag: async (o) => {
      let id = o.tagId;
      if (!id && o.newName) id = (await api('POST', '/api/admin/tags', { brand: S.brand, name: o.newName })).id;
      if (!id) throw new Error('เลือกแท็ก หรือพิมพ์ชื่อแท็กใหม่');
      await api('POST', '/api/admin/members/' + encodeURIComponent(S.member.member.id) + '/tags', { tagId: id }); S.tagPick = false; await load();
    },
    newMember: async (o) => {
      if (!o.consent) throw new Error('ต้องได้รับความยินยอมจากลูกค้าก่อน');
      const r = await api('POST', '/api/admin/members', { brand: S.brand, name: o.name, phone: o.phone, birthday: o.birthday || null, branchId: o.branchId, marketing: o.marketing, consent: true });
      S.edit = null; toast('เพิ่มสมาชิก ' + r.id + ' แล้ว' + (r.welcomePoints ? ' · ได้ ' + r.welcomePoints + ' แต้มต้อนรับ' : ''));
      S.mf = { q: r.id, tier: '', branch: '', tag: '', page: 1 }; await openMember(r.id); await load();
    },
    tag: async (o, id, el) => {
      const kind = (el.querySelector('input[name="kind"]:checked') || {}).value || 'manual';
      const body = { brand: S.brand, name: o.name, color: (el.querySelector('input[name="color"]:checked') || {}).value, kind, description: o.description,
        rule: kind === 'auto' ? { type: o.ruleType, days: o.days, count: o.count, amount: o.amount } : null };
      if (id) await api('PATCH', '/api/admin/tags/' + id, body); else await api('POST', '/api/admin/tags', body);
      toast(id ? 'บันทึกแท็กแล้ว' : 'สร้างแท็กแล้ว'); S.edit = { kind: 'tags' }; await load();
    },
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
  document.addEventListener('input', (e) => {
    if (e.target.classList && e.target.classList.contains('mp-q')) { drawPick(e.target.dataset.pick); return; }
    const f = e.target.closest && e.target.closest('form[data-f="coupon"]'); if (f) syncCoupon(f);
  });
  document.addEventListener('change', (e) => {
    const ms = e.target.closest && e.target.closest('form[data-f="msearch"]');
    if (ms && e.target.tagName === 'SELECT') ms.requestSubmit();
    const tf = e.target.closest && e.target.closest('form[data-f="tag"]'); if (tf) syncTagForm(tf);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.matches && e.target.matches('tr[data-a="member"]')) e.target.click(); });
  document.addEventListener('change', async (e) => {
    const f = e.target.closest && e.target.closest('form[data-f="reward"]'); if (!f) return;
    syncReward(f);
    if (e.target.id !== 'rw-file' || !e.target.files[0]) return;
    const box = document.getElementById('rw-img'); box.innerHTML = '<span>กำลังอัปโหลด…</span>';
    try {
      const dataUrl = await shrinkImage(e.target.files[0]);
      const r = await api('POST', '/api/admin/coupon-images', { dataUrl, brand: S.brand });
      S.edit.imageId = r.id; S.edit.imageUrl = r.url;
    } catch (err) { if (!err.silent) toast(err.message); }
    e.target.value = ''; rerenderRewardImage();
  });
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
  // ริชเมนู: ช่องกรอกปุ่ม/แถบเมนู และไฟล์รูป
  document.addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.rm; if (!k || !S.rm) return;
    if (k === 'value') S.rm.actions[Number(e.target.dataset.i)].value = e.target.value;
    if (k === 'bar') { S.rm.chatBar = e.target.value; document.querySelectorAll('.rm-bar').forEach((x) => { x.textContent = (e.target.value || 'เมนู') + ' ▾'; }); }
  });
  document.addEventListener('change', async (e) => {
    if (!S.rm || S.page !== 'richmenu') return;
    if (e.target.dataset && e.target.dataset.rm === 'kind') {
      const i = Number(e.target.dataset.i); S.rm.actions[i] = { kind: e.target.value, value: '' }; S.rm.sel = i; render();
      const el = document.getElementById(S.data.rm.actions[e.target.value].value ? 'rm-v-' + i : 'rm-k-' + i); if (el) el.focus();
      return;
    }
    if (e.target.id !== 'rm-file' || !e.target.files[0]) return;
    try { S.rm.img = await rmPrepare(e.target.files[0], rmLay()); S.rm.err = ''; } catch (err) { S.rm.img = null; S.rm.err = err.message; }
    e.target.value = ''; render();
  });
  // Enter ในช่องค้นหาเมนู = เลือกรายการแรก (ไม่ส่งฟอร์ม)
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.classList || !e.target.classList.contains('mp-q')) return;
    e.preventDefault();
    const first = document.querySelector('#pick-' + e.target.dataset.pick + '-list [data-a="pickAdd"]'); if (first) first.click();
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.edit) A.close(); });

  boot();
})();
