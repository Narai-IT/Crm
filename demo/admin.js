/* มุมมองหลังบ้าน: Admin Dashboard ส่วนกลาง (ภาพรวม สมาชิก อนุมัติ กฎแต้ม รางวัล แคมเปญ LINE OA สาขา สิทธิ์ Audit) */
(function () {
  const { R, API, DAY, mask } = window.CRM;
  const { esc, fmt, baht, date, dt, ago, toast, logRows } = window.U;

  const ROLES = {
    super: { name: 'Super Admin / IT', pages: ['dash', 'members', 'approvals', 'rules', 'rewards', 'campaigns', 'line', 'branches', 'staff', 'audit', 'events'] },
    marketing: { name: 'Marketing ส่วนกลาง', pages: ['dash', 'members', 'rules', 'rewards', 'campaigns', 'line', 'audit'] },
    brand: { name: 'Brand Manager', pages: ['dash', 'members', 'approvals', 'rules', 'rewards', 'campaigns'] },
    branchmgr: { name: 'Branch Manager', pages: ['dash', 'members', 'approvals'] },
    cashier: { name: 'Cashier / Staff', pages: [] }
  };
  const PAGES = {
    dash: 'ภาพรวม', members: 'สมาชิก', approvals: 'คำขออนุมัติแต้ม', rules: 'กฎแต้ม & ระดับ', rewards: 'ของรางวัล', campaigns: 'แคมเปญ / บรอดแคสต์',
    line: 'LINE OA & Rich Menu', branches: 'แบรนด์ & สาขา', staff: 'พนักงาน & สิทธิ์', audit: 'Audit Log', events: 'API & Webhook'
  };
  const GROUPS = [['ข้อมูล', ['dash', 'members', 'approvals']], ['ตั้งค่า Loyalty', ['rules', 'rewards']], ['การตลาด', ['campaigns', 'line']], ['ระบบ', ['branches', 'staff', 'audit', 'events']]];

  const ui = { page: 'dash', scope: 'all', user: 'S002', search: '', member: null, ruleBrand: 'humlai',
    bc: { brand: 'humlai', segment: 'all', text: 'โปรสมาชิกสัปดาห์นี้ (ตัวอย่าง): รับส่วนลดเมื่อแสดงบัตรสมาชิก', coupon: true, couponTitle: 'ส่วนลด 30 บาท', couponValue: 30 },
    rw: { brand: 'humlai', name: '', cost: '', cat: 'food', value: '', stock: '100' }, adj: { brand: 'humlai', pts: '', reason: '' } };

  const user = () => R.state().staff.find((s) => s.id === ui.user);
  const role = () => ROLES[user().role];
  const lockedBrand = () => { const u = user(); if (u.scope === 'ทั้งเครือ') return null; const b = R.branch(u.scope); return b ? b.brand : u.scope; };
  const scopeBrands = () => { const lb = lockedBrand(); if (lb) return [lb]; return ui.scope === 'all' ? R.brandIds : [ui.scope]; };
  const inScope = (b) => scopeBrands().includes(b);

  /* ---------- metrics ---------- */
  function metrics() {
    const s = R.state(); const now = Date.now(); const sb = scopeBrands();
    const paid = s.bills.filter((b) => b.status === 'paid' && sb.includes(b.brand));
    const memberIds = new Set(s.ledger.filter((l) => sb.includes(l.brand)).map((l) => l.memberId));
    const members = s.members.filter((m) => memberIds.has(m.id));
    const byM = {}; paid.forEach((b) => { if (b.memberId) (byM[b.memberId] = byM[b.memberId] || []).push(b); });
    const buyers = Object.keys(byM);
    const active = buyers.filter((id) => byM[id].some((b) => now - b.at < 30 * DAY));
    const repeat = buyers.filter((id) => byM[id].length >= 2);
    const allPaid = s.bills.filter((b) => b.status === 'paid');
    const brandsOf = {}; allPaid.forEach((b) => { if (b.memberId) (brandsOf[b.memberId] = brandsOf[b.memberId] || new Set()).add(b.brand); });
    const cross = members.filter((m) => brandsOf[m.id] && brandsOf[m.id].size > 1);
    const outstanding = s.ledger.filter((l) => sb.includes(l.brand)).reduce((a, l) => a + l.pts, 0);
    const issued = s.ledger.filter((l) => sb.includes(l.brand) && l.pts > 0).reduce((a, l) => a + l.pts, 0);
    const redeemed = -s.ledger.filter((l) => sb.includes(l.brand) && l.type === 'redeem').reduce((a, l) => a + l.pts, 0);
    const memberSales = paid.filter((b) => b.memberId).reduce((a, b) => a + b.total, 0);
    const allSales = paid.reduce((a, b) => a + b.total, 0);
    return {
      total: members.length, new30: members.filter((m) => now - m.joinedAt < 30 * DAY).length, active: active.length,
      repeat: buyers.length ? Math.round(repeat.length / buyers.length * 100) : 0, freq: buyers.length ? (paid.filter((b) => b.memberId).length / buyers.length).toFixed(1) : '0',
      avg: buyers.length ? memberSales / paid.filter((b) => b.memberId).length : 0, outstanding, issued, redeemed, cross: cross.length,
      share: allSales ? Math.round(memberSales / allSales * 100) : 0, paid, members
    };
  }

  /* ---------- pages ---------- */
  function scopeBar() {
    const lb = lockedBrand();
    if (lb) return '<div class="scope"><button aria-pressed="true"><i style="background:' + R.brands[lb].accent + '"></i>' + esc(R.brands[lb].name) + ' (สิทธิ์ของคุณ)</button></div>';
    return '<div class="scope" role="group" aria-label="ขอบเขตข้อมูล"><button data-act="a.scope" data-s="all" aria-pressed="' + (ui.scope === 'all') + '">ทั้งเครือ</button>' +
      R.brandIds.map((id) => '<button data-act="a.scope" data-s="' + id + '" aria-pressed="' + (ui.scope === id) + '"><i style="background:' + R.brands[id].accent + '"></i>' + esc(R.brands[id].short) + '</button>').join('') + '</div>';
  }

  function dash() {
    const M = metrics(); const s = R.state();
    const kpi = (v, l) => '<div class="kpi"><b>' + v + '</b><span>' + l + '</span></div>';
    const byBrand = R.brandIds.filter(inScope).map((id) => {
      const ids = new Set(s.ledger.filter((l) => l.brand === id).map((l) => l.memberId));
      const paid = s.bills.filter((b) => b.brand === id && b.status === 'paid');
      return { id, members: ids.size, mSales: paid.filter((b) => b.memberId).reduce((a, b) => a + b.total, 0), nSales: paid.filter((b) => !b.memberId).reduce((a, b) => a + b.total, 0) };
    });
    const maxM = Math.max(1, ...byBrand.map((x) => x.members));
    const maxS = Math.max(1, ...byBrand.map((x) => x.mSales + x.nSales));
    const brs = s.branches.filter((b) => inScope(b.brand));
    const pend = s.requests.filter((r) => r.status === 'pending' && inScope(r.brand)).length;
    return '<div class="kpis">' + kpi(fmt(M.total), 'สมาชิก (ไม่ซ้ำคน)') + kpi(fmt(M.new30), 'สมาชิกใหม่ 30 วัน') + kpi(fmt(M.active), 'Active 30 วัน') + kpi(M.repeat + '%', 'Repeat rate') +
      kpi(M.freq, 'ซื้อเฉลี่ย ครั้ง/คน') + kpi(baht(M.avg).replace('.00', ''), 'ยอดเฉลี่ยต่อบิลสมาชิก') + kpi(fmt(M.cross), 'ลูกค้าข้ามแบรนด์') + kpi(M.share + '%', 'ยอดขายจากสมาชิก') + '</div>' +
      (pend && role().pages.includes('approvals') ? '<div class="note" style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><span><span class="pill warn">รออนุมัติ ' + pend + '</span> คำขอปรับแต้มจากหน้าร้าน</span><button class="btn small" data-act="a.page" data-p="approvals">ไปอนุมัติ</button></div>' : '') +
      '<div class="grid2"><section class="panel"><h2>สมาชิกตามแบรนด์</h2><div class="hbar">' + byBrand.map((x) => '<div class="row"><span>' + esc(R.brands[x.id].short) + '</span><span class="track"><i style="width:' + (x.members / maxM * 100) + '%;background:' + R.brands[x.id].accent + '"></i></span><span class="v">' + fmt(x.members) + '</span></div>').join('') + '</div>' +
      '<span class="muted" style="font-size:12px">นับจาก Member ID ที่มีธุรกรรมกับแบรนด์ ไม่ใช่จำนวนเพื่อนใน OA · คนเดียวนับได้หลายแบรนด์</span></section>' +
      '<section class="panel"><h2>ยอดขาย สมาชิก vs ไม่ใช่สมาชิก</h2><div class="hbar">' + byBrand.map((x) => {
        const tot = x.mSales + x.nSales;
        return '<div class="row"><span>' + esc(R.brands[x.id].short) + '</span><span class="track" style="display:flex"><i style="width:' + (x.mSales / maxS * 100) + '%;background:' + R.brands[x.id].accent + ';border-radius:4px 0 0 4px"></i><i style="width:' + (x.nSales / maxS * 100) + '%;background:var(--line);border-radius:0 4px 4px 0"></i></span><span class="v">' + fmt(Math.round(tot)) + '</span></div>';
      }).join('') + '</div><span class="muted" style="font-size:12px">สีเข้ม = บิลที่ผูกสมาชิก · สีอ่อน = ไม่ระบุสมาชิก · หน่วยบาท</span></section></div>' +
      '<div class="grid2"><section class="panel"><h2>แต้ม</h2><div class="kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">' + kpi(fmt(M.issued), 'แจกแล้ว') + kpi(fmt(M.redeemed), 'ถูกแลก') + kpi(fmt(M.outstanding), 'แต้มค้าง (ภาระต้นทุน)') + '</div></section>' +
      '<section class="panel"><h2>ความเคลื่อนไหวล่าสุด</h2><div class="tbl-wrap"><table class="t"><tbody>' + s.ledger.filter((l) => inScope(l.brand)).slice(-6).reverse().map((l) => '<tr><td>' + ago(l.at) + '</td><td class="mono">' + esc(l.memberId) + '</td><td>' + esc(l.note) + '</td><td class="r"><b>' + (l.pts > 0 ? '+' : '') + fmt(l.pts) + '</b> ' + esc(R.brands[l.brand].short) + '</td></tr>').join('') + '</tbody></table></div></section></div>' +
      '<section class="panel"><h2>ผลงานรายสาขา</h2><div class="tbl-wrap"><table class="t"><thead><tr><th>สาขา</th><th>POS</th><th class="r">สมาชิกที่สมัคร (สาขาประจำ)</th><th class="r">บิลสมาชิก</th><th class="r">ยอดขายสมาชิก</th><th class="r">สัดส่วนบิลสมาชิก</th></tr></thead><tbody>' +
      brs.map((b) => {
        const bills = s.bills.filter((x) => x.branch === b.id && x.status === 'paid'); const mb = bills.filter((x) => x.memberId);
        return '<tr><td><b>' + esc(b.name) + '</b></td><td>' + (b.pos === 'online' ? '<span class="pill good">ออนไลน์</span>' : b.pos === 'delayed' ? '<span class="pill warn">ล่าช้า</span>' : '<span class="pill">กรอกมือ</span>') + '</td><td class="r">' + s.members.filter((m) => m.homeBranch === b.id).length + '</td><td class="r">' + mb.length + '</td><td class="r">' + fmt(mb.reduce((a, x) => a + x.total, 0)) + '</td><td class="r">' + (bills.length ? Math.round(mb.length / bills.length * 100) : 0) + '%</td></tr>';
      }).join('') + '</tbody></table></div></section>';
  }

  function members() {
    const s = R.state(); const q = ui.search.trim().toLowerCase();
    const ids = new Set(s.ledger.filter((l) => inScope(l.brand)).map((l) => l.memberId));
    const list = s.members.filter((m) => ids.has(m.id) && (!q || m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q) || m.phone.includes(q))).slice().sort((a, b) => b.joinedAt - a.joinedAt);
    const full = user().role === 'super';
    let html = '<section class="panel"><div style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap"><div class="ff" style="flex:1;min-width:200px"><label for="a-search">ค้นหา เลขสมาชิก / ชื่อ / เบอร์</label><input id="a-search" data-amodel="search" value="' + esc(ui.search) + '"></div><span class="muted">' + list.length + ' คน</span></div>' +
      '<div class="tbl-wrap"><table class="t"><thead><tr><th>เลขสมาชิก</th><th>ชื่อ</th><th>เบอร์</th><th>แบรนด์ที่ใช้</th>' + scopeBrands().map((b) => '<th class="r">แต้ม ' + esc(R.brands[b].short) + '</th>').join('') + '<th>สมัคร</th></tr></thead><tbody>' +
      list.map((m) => {
        const bs = R.brandIds.filter((b) => s.ledger.some((l) => l.memberId === m.id && l.brand === b));
        return '<tr class="click" data-act="a.member" data-id="' + m.id + '" tabindex="0"><td class="mono">' + esc(m.id) + (m.id === s.demo.memberId ? ' <span class="pill good">มือถือเดโม</span>' : '') + '</td><td>' + esc(m.name) + '</td><td class="num">' + esc(full ? m.phone : mask(m.phone)) + '</td><td><div class="chips">' + bs.map((b) => '<span class="pill" style="background:' + R.brands[b].soft + ';color:' + R.brands[b].ink + '">' + esc(R.brands[b].short) + '</span>').join('') + '</div></td>' +
          scopeBrands().map((b) => '<td class="r">' + fmt(R.balance(m.id, b)) + '</td>').join('') + '<td>' + date(m.joinedAt) + '</td></tr>';
      }).join('') + '</tbody></table></div>' + (full ? '' : '<span class="muted" style="font-size:12px">เบอร์โทรถูกปิดบังตามสิทธิ์ของคุณ (PDPA) · Super Admin เห็นเต็ม</span>') + '</section>';
    const m = ui.member ? R.member(ui.member) : null;
    if (m) html += memberDetail(m);
    return html;
  }
  function memberDetail(m) {
    const s = R.state();
    const led = s.ledger.filter((l) => l.memberId === m.id && inScope(l.brand)).slice().reverse().slice(0, 15);
    const cps = s.coupons.filter((c) => c.memberId === m.id && inScope(c.brand)).slice().reverse();
    return '<section class="drawer" id="member-detail"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;flex-wrap:wrap"><div><div class="eyebrow">มุมมองลูกค้า 360°</div><h2 style="font-size:22px">' + esc(m.name) + ' · <span class="mono" style="font-size:16px">' + esc(m.id) + '</span></h2>' +
      '<span class="muted">สมัคร ' + date(m.joinedAt) + ' ผ่าน OA ' + esc(R.brands[m.joinedBrand].short) + ' · สาขาประจำ ' + esc(R.branch(m.homeBranch).name) + ' · วันเกิด ' + esc(m.birthday || '-') + '</span></div><button class="btn small" data-act="a.member" data-id="">ปิด</button></div>' +
      '<div class="grid3">' + R.brandIds.filter(inScope).map((b) => {
        const B = R.brands[b]; const t = R.tier(m.id, b); const f = m.follow[b];
        return '<div class="bcard"><div class="h" style="background:' + B.accent + '"><b>' + esc(B.short) + '</b><span class="tier ' + t.name + '">' + t.name + '</span></div><div class="b"><div class="kv"><span class="muted">แต้มคงเหลือ</span><b class="num">' + fmt(R.balance(m.id, b)) + '</b></div>' +
          '<div class="kv"><span class="muted">บิล</span><span>' + R.bills(m.id, b).length + '</span></div><div class="kv"><span class="muted">OA</span><span>' + (f === 'follow' ? '<span class="pill good">ติดตาม</span>' : f === 'blocked' ? '<span class="pill bad">บล็อก</span>' : '<span class="pill">ยังไม่เพิ่มเพื่อน</span>') + '</span></div>' +
          '<div class="kv"><span class="muted">ยินยอมรับโปร</span><span>' + (m.consent.mkt[b] ? 'ใช่' : 'ไม่') + '</span></div></div></div>';
      }).join('') + '</div>' +
      '<div class="grid2"><div><h3 style="margin-bottom:6px">สมุดแต้ม (ledger)</h3><div class="tbl-wrap"><table class="t"><thead><tr><th>เวลา</th><th>แบรนด์</th><th>รายการ</th><th>โดย</th><th class="r">แต้ม</th></tr></thead><tbody>' +
      led.map((l) => '<tr><td>' + dt(l.at) + '</td><td>' + esc(R.brands[l.brand].short) + '</td><td>' + esc(l.note) + '</td><td class="muted">' + esc(l.by) + '</td><td class="r"><b>' + (l.pts > 0 ? '+' : '') + fmt(l.pts) + '</b></td></tr>').join('') + '</tbody></table></div></div>' +
      '<div style="display:flex;flex-direction:column;gap:12px"><div><h3 style="margin-bottom:6px">คูปอง</h3><div class="tbl-wrap"><table class="t"><tbody>' + (cps.length ? cps.map((c) => '<tr><td>' + esc(c.title) + '<br><span class="muted mono">' + esc(c.code) + '</span></td><td>' + esc(R.brands[c.brand].short) + '</td><td>' + (c.status === 'ready' ? '<span class="pill good">พร้อมใช้</span>' : c.status === 'used' ? '<span class="pill">ใช้แล้ว</span>' : '<span class="pill bad">หมดอายุ</span>') + '</td></tr>').join('') : '<tr><td class="empty">ไม่มีคูปอง</td></tr>') + '</tbody></table></div></div>' +
      '<div class="panel" style="padding:14px"><h3>ขอปรับแต้มด้วยมือ</h3><div class="form-grid"><div class="ff"><label for="a-adjb">แบรนด์</label><select id="a-adjb" data-amodel="adj.brand">' + scopeBrands().map((b) => '<option value="' + b + '"' + (ui.adj.brand === b ? ' selected' : '') + '>' + esc(R.brands[b].short) + '</option>').join('') + '</select></div><div class="ff"><label for="a-adjp">แต้ม (+/−)</label><input id="a-adjp" data-amodel="adj.pts" value="' + esc(ui.adj.pts) + '"></div></div>' +
      '<div class="ff"><label for="a-adjr">เหตุผล</label><input id="a-adjr" data-amodel="adj.reason" value="' + esc(ui.adj.reason) + '"></div><button class="btn" data-act="a.adj">ส่งคำขอ (ต้องมีผู้อนุมัติ)</button></div></div></div></section>';
  }

  function approvals() {
    const s = R.state(); const list = s.requests.filter((r) => inScope(r.brand));
    return '<section class="panel"><h2>คำขอปรับแต้ม</h2><p class="muted" style="margin:0">ผู้ขอกับผู้อนุมัติต้องเป็นคนละคน ทุกการตัดสินเข้า Audit Log และสร้างรายการใน ledger (ไม่แก้ยอดตรง)</p><div class="tbl-wrap"><table class="t"><thead><tr><th>คำขอ</th><th>สมาชิก</th><th>แบรนด์ / สาขา</th><th class="r">แต้ม</th><th>เหตุผล</th><th>ผู้ขอ</th><th>สถานะ</th></tr></thead><tbody>' +
      (list.length ? list.map((r) => '<tr><td class="mono">' + esc(r.id) + '<br><span class="muted">' + ago(r.at) + '</span></td><td class="mono">' + esc(r.memberId) + '</td><td>' + esc(R.brands[r.brand].short) + '<br><span class="muted">' + esc(r.branch ? R.branch(r.branch).name : '-') + '</span></td><td class="r"><b>' + (r.pts > 0 ? '+' : '') + r.pts + '</b></td><td>' + esc(r.reason) + '</td><td>' + esc(r.by) + '</td><td>' +
        (r.status === 'pending' ? (r.by === user().name ? '<span class="pill warn">รอคนอื่นอนุมัติ</span>' : '<div class="chips"><button class="btn small" data-act="a.decide" data-id="' + r.id + '" data-ok="1">อนุมัติ</button><button class="btn small danger" data-act="a.decide" data-id="' + r.id + '" data-ok="0">ปฏิเสธ</button></div>') : r.status === 'approved' ? '<span class="pill good">อนุมัติโดย ' + esc(r.decidedBy) + '</span>' : '<span class="pill bad">ปฏิเสธ</span>') + '</td></tr>').join('') : '<tr><td colspan="7" class="empty">ไม่มีคำขอ</td></tr>') + '</tbody></table></div></section>';
  }

  function rules() {
    const bs = scopeBrands(); if (!bs.includes(ui.ruleBrand)) ui.ruleBrand = bs[0];
    const b = ui.ruleBrand; const r = R.state().rules[b]; const B = R.brands[b];
    const days = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์'];
    const ex = (amt) => { const base = r.base === 'exvat' ? amt / 1.07 : amt; return Math.floor(base / r.baht) * r.pts; };
    return '<div class="subtabs" role="group" aria-label="แบรนด์">' + bs.map((id) => '<button data-act="a.rb" data-b="' + id + '" aria-pressed="' + (id === b) + '">' + esc(R.brands[id].name) + '</button>').join('') + '</div>' +
      '<section class="panel"><div style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap"><div><div class="eyebrow">กฎของ ' + esc(B.name) + '</div><h2>ฝ่ายการตลาดตั้งเองได้ ไม่ต้องแก้โค้ด</h2></div><span class="pill" style="background:' + B.soft + ';color:' + B.ink + '">มีผลกับ POS ทันทีที่บันทึก</span></div>' +
      '<div class="form-grid"><div class="ff"><label for="r-baht">ทุก (บาท)</label><input id="r-baht" type="number" min="1" value="' + r.baht + '"></div><div class="ff"><label for="r-pts">ได้ (แต้ม)</label><input id="r-pts" type="number" min="0" value="' + r.pts + '"></div>' +
      '<div class="ff"><label for="r-base">ฐานคำนวณ</label><select id="r-base"><option value="net"' + (r.base === 'net' ? ' selected' : '') + '>ยอดหลังส่วนลด (รวม VAT)</option><option value="exvat"' + (r.base === 'exvat' ? ' selected' : '') + '>ยอดหลังส่วนลด ไม่รวม VAT</option><option value="gross"' + (r.base === 'gross' ? ' selected' : '') + '>ยอดก่อนส่วนลด</option></select></div>' +
      '<div class="ff"><label for="r-round">การปัดเศษ</label><select id="r-round"><option value="floor"' + (r.rounding === 'floor' ? ' selected' : '') + '>ปัดลง</option><option value="round"' + (r.rounding === 'round' ? ' selected' : '') + '>ปัดตามหลักคณิต</option></select></div>' +
      '<div class="ff"><label for="r-exp">แต้มหมดอายุ (เดือน)</label><input id="r-exp" type="number" min="0" value="' + r.expiryMonths + '"></div><div class="ff"><label for="r-wel">แต้มต้อนรับ</label><input id="r-wel" type="number" min="0" value="' + r.welcome + '"></div>' +
      '<div class="ff"><label for="r-back">ขอแต้มย้อนหลังได้ (วัน)</label><input id="r-back" type="number" min="0" value="' + r.backdays + '"></div>' +
      '<div class="ff"><label for="r-gold">Gold เมื่อสะสมครบ (แต้ม/ปี)</label><input id="r-gold" type="number" value="' + r.tiers.gold + '"></div><div class="ff"><label for="r-plat">Platinum เมื่อครบ</label><input id="r-plat" type="number" value="' + r.tiers.platinum + '"></div></div>' +
      '<div class="panel" style="padding:14px;background:var(--surface2)"><label class="check" style="font-size:14px"><input type="checkbox" id="r-promo"' + (r.promo.on ? ' checked' : '') + '><span><b>แคมเปญคูณแต้ม</b> ตามวันในสัปดาห์</span></label><div class="form-grid"><div class="ff"><label for="r-mult">คูณ</label><input id="r-mult" type="number" min="1" value="' + r.promo.mult + '"></div><div class="ff"><label for="r-day">ทุกวัน</label><select id="r-day">' + days.map((d, i) => '<option value="' + i + '"' + (Number(r.promo.day) === i ? ' selected' : '') + '>' + d + '</option>').join('') + '</select></div></div>' +
      '<span class="muted" style="font-size:12px">วันนี้วัน' + days[new Date().getDay()] + ' · ตั้งเป็นวันนี้เพื่อลองที่หน้าร้าน</span></div>' +
      '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn primary" data-act="a.saverule">บันทึกกฎ</button><span class="muted">ตัวอย่างตามกฎปัจจุบัน: บิล 650 บาท → ' + ex(650) + ' แต้ม · บิล 245 บาท → ' + ex(245) + ' แต้ม</span></div></section>';
  }

  function rewards() {
    const s = R.state(); const list = s.rewards.filter((r) => inScope(r.brand));
    const bs = scopeBrands(); if (!bs.includes(ui.rw.brand)) ui.rw.brand = bs[0];
    return '<section class="panel"><h2>ของรางวัล</h2><div class="tbl-wrap"><table class="t"><thead><tr><th>แบรนด์</th><th>รางวัล</th><th>หมวด</th><th class="r">ใช้แต้ม</th><th class="r">มูลค่าคูปอง</th><th class="r">คงเหลือ</th><th class="r">แลกแล้ว</th><th>สถานะ</th></tr></thead><tbody>' +
      list.map((r) => '<tr><td>' + esc(R.brands[r.brand].short) + '</td><td><b>' + esc(r.name) + '</b></td><td>' + esc(r.cat) + '</td><td class="r">' + fmt(r.cost) + '</td><td class="r">' + fmt(r.cp.value) + ' ฿</td><td class="r">' + fmt(r.stock) + '</td><td class="r">' + s.ledger.filter((l) => l.type === 'redeem' && l.note === 'แลก ' + r.name).length + '</td><td><button class="btn small" data-act="a.rwtoggle" data-id="' + r.id + '">' + (r.active ? 'เปิดอยู่ · ปิด' : 'ปิดอยู่ · เปิด') + '</button></td></tr>').join('') + '</tbody></table></div></section>' +
      '<section class="panel"><h2>เพิ่มของรางวัล</h2><div class="form-grid"><div class="ff"><label for="w-b">แบรนด์</label><select id="w-b" data-amodel="rw.brand">' + bs.map((b) => '<option value="' + b + '"' + (ui.rw.brand === b ? ' selected' : '') + '>' + esc(R.brands[b].short) + '</option>').join('') + '</select></div>' +
      '<div class="ff"><label for="w-n">ชื่อรางวัล</label><input id="w-n" data-amodel="rw.name" value="' + esc(ui.rw.name) + '"></div><div class="ff"><label for="w-c">ใช้แต้ม</label><input id="w-c" type="number" data-amodel="rw.cost" value="' + esc(ui.rw.cost) + '"></div>' +
      '<div class="ff"><label for="w-cat">หมวด</label><select id="w-cat" data-amodel="rw.cat">' + ['food', 'side', 'drink', 'discount'].map((c) => '<option' + (ui.rw.cat === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select></div>' +
      '<div class="ff"><label for="w-v">มูลค่าคูปอง (บาท)</label><input id="w-v" type="number" data-amodel="rw.value" value="' + esc(ui.rw.value) + '"></div><div class="ff"><label for="w-s">จำนวนสิทธิ์</label><input id="w-s" type="number" data-amodel="rw.stock" value="' + esc(ui.rw.stock) + '"></div></div>' +
      '<button class="btn primary" style="align-self:flex-start" data-act="a.addreward">เพิ่มรางวัล</button></section>';
  }

  function campaigns() {
    const s = R.state(); const bs = scopeBrands(); if (!bs.includes(ui.bc.brand)) ui.bc.brand = bs[0];
    const B = R.brands[ui.bc.brand];
    const segs = [['all', 'ทุกคนที่ติดตาม OA และยินยอม'], ['new', 'สมาชิกใหม่ 30 วัน'], ['gold', 'ระดับ Gold ขึ้นไป'], ['lapsed', 'ไม่มาเกิน 30 วัน'], ['cross', 'ลูกค้าแบรนด์อื่นที่ยังไม่เคยมาแบรนด์นี้']];
    const aud = ui.bc.segment === 'cross' ? API.crossAudience(ui.bc.brand) : API.audience(ui.bc.brand, ui.bc.segment);
    const followers = s.members.filter((m) => m.follow[ui.bc.brand] === 'follow').length;
    return '<div class="grid2"><section class="panel"><h2>สร้างแคมเปญ</h2>' +
      '<div class="ff"><label for="b-oa">ส่งจาก LINE OA</label><select id="b-oa" data-amodel="bc.brand">' + bs.map((b) => '<option value="' + b + '"' + (ui.bc.brand === b ? ' selected' : '') + '>' + esc(R.brands[b].name) + ' (' + esc(R.brands[b].oa) + ')</option>').join('') + '</select></div>' +
      '<fieldset style="border:1px solid var(--line);border-radius:12px;padding:10px 12px;display:flex;flex-direction:column;gap:6px"><legend class="eyebrow" style="padding:0 4px">กลุ่มเป้าหมาย</legend>' + segs.map((x) => '<label class="check"><input type="radio" name="seg" data-amodel="bc.segment" value="' + x[0] + '"' + (ui.bc.segment === x[0] ? ' checked' : '') + '><span>' + esc(x[1]) + '</span></label>').join('') + '</fieldset>' +
      '<div class="ff"><label for="b-text">ข้อความ</label><textarea id="b-text" data-amodel="bc.text">' + esc(ui.bc.text) + '</textarea></div>' +
      '<label class="check"><input type="checkbox" data-amodel="bc.coupon"' + (ui.bc.coupon ? ' checked' : '') + '><span>แนบคูปองเข้ากระเป๋าผู้รับทุกคน</span></label>' +
      (ui.bc.coupon ? '<div class="form-grid"><div class="ff"><label for="b-ct">ชื่อคูปอง</label><input id="b-ct" data-amodel="bc.couponTitle" value="' + esc(ui.bc.couponTitle) + '"></div><div class="ff"><label for="b-cv">ส่วนลด (บาท)</label><input id="b-cv" type="number" data-amodel="bc.couponValue" value="' + esc(ui.bc.couponValue) + '"></div></div>' : '') +
      '<div class="note"><b style="color:var(--ink)">ผู้รับ ' + aud.length + ' คน</b> จากผู้ติดตาม OA ' + followers + ' คน · ตัดคนที่บล็อก OA หรือไม่ยินยอมรับข่าวสารของแบรนด์นี้ออกแล้ว · ใช้โควตาข้อความของ OA ' + esc(B.short) + ' ' + aud.length + ' ข้อความ</div>' +
      '<button class="btn primary" data-act="a.send"' + (aud.length && ui.bc.text.trim() ? '' : ' disabled') + '>ส่งแคมเปญ</button></section>' +
      '<section class="panel"><h2>ตัวอย่างที่ลูกค้าเห็น</h2><div class="phone" style="height:auto;min-height:0;' + window.U.brandVars(B) + '"><div class="chat" style="flex:none"><div class="msg"><div class="ava" style="background:' + B.accent + '">' + esc(B.initial) + '</div><div style="display:flex;flex-direction:column;gap:8px"><div class="bub">' + esc(ui.bc.text) + '</div>' +
      (ui.bc.coupon ? '<div class="flex"><div class="flex-h"><small>คูปองถูกเพิ่มเข้ากระเป๋าแล้ว</small><b>' + esc(ui.bc.couponTitle) + '</b></div><div class="flex-f" style="padding-top:12px"><span class="fbtn">ดูคูปองของฉัน</span></div></div>' : '') + '</div></div></div></div>' +
      '<span class="muted" style="font-size:12px">ถ้ามือถือเดโมอยู่ในกลุ่มผู้รับ ข้อความจะเข้าแชทในแท็บ "ลูกค้า (LINE)"</span></section></div>' +
      '<section class="panel"><h2>ประวัติการส่ง</h2><div class="tbl-wrap"><table class="t"><thead><tr><th>เวลา</th><th>OA</th><th>กลุ่ม</th><th>ข้อความ</th><th>คูปอง</th><th class="r">ผู้รับ</th><th>ส่งโดย</th></tr></thead><tbody>' +
      s.broadcasts.filter((x) => inScope(x.brand)).map((x) => '<tr><td>' + dt(x.at) + '</td><td>' + esc(R.brands[x.brand].short) + '</td><td>' + esc((segs.find((g) => g[0] === x.segment) || ['', x.segment])[1]) + '</td><td>' + esc(x.text) + '</td><td>' + esc(x.coupon || '-') + '</td><td class="r">' + x.recipients + '</td><td>' + esc(x.by) + '</td></tr>').join('') + '</tbody></table></div></section>';
  }

  function line() {
    const s = R.state();
    return '<section class="panel"><h2>LINE Provider เดียว: "[ชื่อบริษัท] Group"</h2><p style="margin:0">OA ทุกแบรนด์ + LINE Login channel ต้องอยู่ Provider เดียวกัน ลูกค้าคนเดิมจึงได้ <b>userId เดียวกัน</b> ทุก OA · LIFF app มีตัวเดียว ส่ง <span class="mono">?brand=</span> ไปเพื่อเปิดหน้าแบรนด์นั้น</p>' +
      '<div class="form-grid"><div class="note"><b style="color:var(--ink)">LINE Login channel</b><br>ใช้กับ LIFF สมาชิก + เว็บพนักงาน</div><div class="note"><b style="color:var(--ink)">LIFF app (1 ตัว)</b><br><span class="mono">https://liff.line.me/[LIFF_ID]</span></div><div class="note"><b style="color:var(--ink)">Messaging API</b><br>1 channel ต่อ 1 OA · secret/token แยกกัน</div></div></section>' +
      '<div class="grid3">' + R.brandIds.filter(inScope).map((id) => {
        const B = R.brands[id]; const fol = s.members.filter((m) => m.follow[id] === 'follow').length; const blk = s.members.filter((m) => m.follow[id] === 'blocked').length;
        const sent = s.broadcasts.filter((x) => x.brand === id).reduce((a, x) => a + x.recipients, 0);
        return '<div class="bcard"><div class="h" style="background:' + B.accent + '"><b>' + esc(B.name) + '</b><span class="pill good">Webhook OK</span></div><div class="b">' +
          '<div class="kv"><span class="muted">OA</span><span class="mono">' + esc(B.oa) + '</span></div>' +
          '<div class="ff"><label>Webhook URL</label><span class="mono">https://crm.example.com/webhooks/line/' + id + '</span></div>' +
          '<div class="ff"><label>Rich Menu ปุ่ม "สมาชิก"</label><span class="mono">https://liff.line.me/[LIFF_ID]?brand=' + id + '</span></div>' +
          '<div class="mini-rich"><i style="grid-row:span 2;background:' + B.accent + '">สมาชิก</i><i style="background:#22282B">โปรโมชั่น</i><i style="background:' + B.ink + '">สาขา · ติชม</i></div>' +
          '<div class="kv"><span class="muted">ผู้ติดตามที่เป็นสมาชิก</span><b>' + fol + '</b></div><div class="kv"><span class="muted">บล็อก</span><b>' + blk + '</b></div>' +
          '<div class="kv"><span class="muted">ข้อความ push/multicast เดือนนี้</span><b>' + sent + ' / [โควตาแพ็กเกจ]</b></div></div></div>';
      }).join('') + '</div>';
  }

  function branches() {
    const s = R.state();
    return '<section class="panel"><h2>แบรนด์</h2><div class="grid3">' + R.brandIds.map((id) => { const B = R.brands[id];
      return '<div class="bcard"><div class="h" style="background:' + B.accent + '"><b>' + esc(B.name) + '</b><span>' + esc(B.kind) + '</span></div><div class="b"><div class="kv"><span class="muted">สาขา</span><b>' + s.branches.filter((b) => b.brand === id).length + '</b></div><div class="kv"><span class="muted">กฎแต้ม</span><span>' + s.rules[id].baht + ' บาท = ' + s.rules[id].pts + ' แต้ม</span></div></div></div>'; }).join('') + '</div></section>' +
      '<section class="panel"><h2>สาขา</h2><div class="tbl-wrap"><table class="t"><thead><tr><th>รหัส</th><th>สาขา</th><th>แบรนด์</th><th>เวลา</th><th>การเชื่อม POS</th><th>สะสมแต้ม</th></tr></thead><tbody>' +
      s.branches.filter((b) => inScope(b.brand)).map((b) => '<tr><td class="mono">' + b.id + '</td><td><b>' + esc(b.name) + '</b><br><span class="muted">' + esc(b.phone) + '</span></td><td>' + esc(R.brands[b.brand].short) + '</td><td>' + b.open + '–' + b.close + '</td><td>' + (b.pos === 'online' ? '<span class="pill good">API ออนไลน์</span>' : b.pos === 'delayed' ? '<span class="pill warn">ล่าช้า · คิว Retry</span>' : '<span class="pill">กรอกบิลมือ + กระทบยอดรายวัน</span>') + '</td><td><button class="btn small" data-act="a.earn" data-id="' + b.id + '">' + (b.earn ? 'เปิด · กดเพื่อปิด' : 'ปิด · กดเพื่อเปิด') + '</button></td></tr>').join('') + '</tbody></table></div></section>';
  }

  function staff() {
    const s = R.state();
    const perms = [['ตั้งค่าระบบ / การเชื่อมต่อ', 1, 0, 0, 0, 0], ['แคมเปญ / รางวัล / กฎแต้ม', 1, 1, 'แบรนด์ตัวเอง', 0, 0], ['ดูข้อมูลสมาชิก', 1, 1, 'แบรนด์ตัวเอง', 'สาขาตัวเอง', 'ค้นหาตอนขาย'], ['อนุมัติปรับแต้ม', 1, 0, 1, 'ตามวงเงิน', 0], ['ระบุสมาชิก / ใช้คูปอง / ขอแต้ม', 1, 0, 0, 1, 1], ['ดู Audit Log', 1, 1, 0, 0, 0]];
    const cell = (v) => v === 1 ? '<span class="pill good">ได้</span>' : v === 0 ? '<span class="muted">—</span>' : '<span class="pill">' + esc(v) + '</span>';
    return '<section class="panel"><h2>ผู้ใช้หลังบ้าน</h2><div class="tbl-wrap"><table class="t"><thead><tr><th>รหัส</th><th>ชื่อ</th><th>ตำแหน่ง</th><th>ขอบเขต</th></tr></thead><tbody>' +
      s.staff.map((x) => '<tr><td class="mono">' + x.id + '</td><td>' + esc(x.name) + '</td><td>' + esc(ROLES[x.role].name) + '</td><td>' + esc(R.brands[x.scope] ? R.brands[x.scope].name : R.branch(x.scope) ? R.branch(x.scope).name : x.scope) + '</td></tr>').join('') + '</tbody></table></div></section>' +
      '<section class="panel"><h2>สิทธิ์ตามตำแหน่ง</h2><div class="tbl-wrap"><table class="t matrix"><thead><tr><th>สิทธิ์</th>' + Object.values(ROLES).map((r) => '<th>' + esc(r.name) + '</th>').join('') + '</tr></thead><tbody>' +
      perms.map((p) => '<tr><td>' + esc(p[0]) + '</td>' + p.slice(1).map(cell).join('') + '</tr>').join('') + '</tbody></table></div><span class="muted" style="font-size:12px">ทุก API ตรวจสิทธิ์ฝั่ง Server (role + brand/branch scope) ไม่ใช่แค่ซ่อนปุ่ม · ลองสลับ "เข้าใช้ในฐานะ" ด้านซ้ายเพื่อดูเมนูที่เปลี่ยนไป</span></section>';
  }

  function audit() {
    const s = R.state();
    return '<section class="panel"><h2>Audit Log</h2><p class="muted" style="margin:0">บันทึกแบบเพิ่มอย่างเดียว ผู้ใช้ทั่วไปแก้หรือลบย้อนหลังไม่ได้</p><div class="tbl-wrap"><table class="t"><thead><tr><th>เวลา</th><th>ผู้ทำ</th><th>การกระทำ</th><th>รายละเอียด</th></tr></thead><tbody>' +
      (s.audit.length ? s.audit.map((a) => '<tr><td>' + dt(a.at) + '</td><td>' + esc(a.actor) + '</td><td><b>' + esc(a.action) + '</b></td><td>' + esc(a.detail) + '</td></tr>').join('') : '<tr><td colspan="4" class="empty">ยังไม่มีรายการ ลองแก้กฎแต้ม อนุมัติคำขอ หรือส่งแคมเปญ</td></tr>') + '</tbody></table></div></section>';
  }
  function events() { return '<section class="panel"><h2>API & Webhook ล่าสุด</h2><div class="log" style="max-height:none">' + logRows(R.state().api, 80) + '</div></section>'; }

  function render(root) {
    const r = role();
    if (!r.pages.includes(ui.page)) ui.page = r.pages[0] || 'dash';
    const s = R.state(); const pend = s.requests.filter((x) => x.status === 'pending' && inScope(x.brand)).length;
    const side = '<nav class="side" aria-label="เมนูหลังบ้าน"><div class="ff" style="padding:4px 4px 8px"><label for="a-user">เข้าใช้ในฐานะ</label><select id="a-user" data-amodel="user">' + s.staff.map((x) => '<option value="' + x.id + '"' + (x.id === ui.user ? ' selected' : '') + '>' + esc(x.name) + '</option>').join('') + '</select></div>' +
      GROUPS.map((g) => { const items = g[1].filter((p) => r.pages.includes(p)); if (!items.length) return '';
        return '<div class="grp">' + g[0] + '</div>' + items.map((p) => '<button data-act="a.page" data-p="' + p + '"' + (ui.page === p ? ' aria-current="page"' : '') + '><span>' + PAGES[p] + '</span>' + (p === 'approvals' && pend ? '<span class="pill warn">' + pend + '</span>' : '') + '</button>').join(''); }).join('') + '</nav>';
    const pages = { dash, members, approvals, rules, rewards, campaigns, line, branches, staff, audit, events };
    const main = !r.pages.length ? '<section class="panel"><h2>ตำแหน่งแคชเชียร์ไม่มีสิทธิ์เข้าหลังบ้าน</h2><p class="muted" style="margin:0">ใช้งานผ่านเครื่อง POS / เว็บพนักงานของสาขาเท่านั้น ลองเลือกผู้ใช้อื่นจากเมนูด้านซ้าย</p></section>' :
      '<div class="adm-head"><div><div class="eyebrow">' + esc(role().name) + ' · ' + esc(user().name) + '</div><h1>' + PAGES[ui.page] + '</h1></div>' + scopeBar() + '</div>' + pages[ui.page]();
    root.innerHTML = '<div class="admin">' + side + '<div class="adm-main">' + main + '</div></div>';
  }

  function setModel(path, el) {
    const val = el.type === 'checkbox' ? el.checked : el.value;
    if (path === 'user') { ui.user = val; ui.member = null; return true; }
    if (path === 'search') { ui.search = val; return true; }
    const [o, k] = path.split('.'); ui[o][k] = val;
    return o === 'bc' || (o === 'rw' && k === 'brand') || (o === 'adj' && k === 'brand');
  }

  const by = () => user().name;
  const num = (id) => Number(document.getElementById(id).value);
  const act = {
    'a.page': (el) => { ui.page = el.dataset.p; ui.member = null; },
    'a.scope': (el) => { ui.scope = el.dataset.s; ui.member = null; },
    'a.member': (el) => { ui.member = el.dataset.id || null; setTimeout(() => { const d = document.getElementById('member-detail'); if (d) d.scrollIntoView({ block: 'start' }); }, 0); },
    'a.adj': () => {
      const pts = parseInt(ui.adj.pts, 10);
      if (!pts || !ui.adj.reason.trim()) { toast('ใส่จำนวนแต้มและเหตุผลก่อนส่ง'); return; }
      API.requestAdjust({ memberId: ui.member, brand: ui.adj.brand, branch: null, pts, reason: ui.adj.reason.trim(), by: by() });
      ui.adj.pts = ''; ui.adj.reason = ''; toast('ส่งคำขอแล้ว ต้องให้ผู้ใช้อีกคนอนุมัติ');
    },
    'a.decide': (el) => { API.decide(el.dataset.id, el.dataset.ok === '1', by()); toast(el.dataset.ok === '1' ? 'อนุมัติแล้ว แต้มเข้า ledger' : 'ปฏิเสธคำขอแล้ว'); },
    'a.rb': (el) => { ui.ruleBrand = el.dataset.b; },
    'a.saverule': () => {
      const r = { baht: num('r-baht'), pts: num('r-pts'), base: document.getElementById('r-base').value, rounding: document.getElementById('r-round').value, expiryMonths: num('r-exp'), welcome: num('r-wel'), backdays: num('r-back'),
        tiers: { gold: num('r-gold'), platinum: num('r-plat') }, promo: { on: document.getElementById('r-promo').checked, mult: num('r-mult'), day: num('r-day') } };
      if (r.baht < 1 || r.pts < 0) { toast('อัตราแต้มไม่ถูกต้อง'); return; }
      API.saveRule(ui.ruleBrand, r, by()); toast('บันทึกกฎแต้ม ' + R.brands[ui.ruleBrand].short + ' แล้ว');
    },
    'a.rwtoggle': (el) => { const r = R.state().rewards.find((x) => x.id === el.dataset.id); API.saveReward(Object.assign({}, r, { active: !r.active }), by()); },
    'a.addreward': () => {
      const w = ui.rw;
      if (!w.name.trim() || !(Number(w.cost) > 0)) { toast('ใส่ชื่อรางวัลและจำนวนแต้มที่ใช้'); return; }
      API.saveReward({ brand: w.brand, name: w.name.trim(), cost: Number(w.cost), cat: w.cat, stock: Number(w.stock) || 0, active: true, cp: { kind: 'baht', value: Number(w.value) || 0, min: 0 } }, by());
      ui.rw = { brand: w.brand, name: '', cost: '', cat: 'food', value: '', stock: '100' }; toast('เพิ่มรางวัลแล้ว ลูกค้าเห็นในหน้าแลกแต้มทันที');
    },
    'a.send': () => { const bc = API.broadcast(Object.assign({}, ui.bc), by()); toast('ส่งแคมเปญ ' + bc.id + ' ถึง ' + bc.recipients + ' คน'); },
    'a.earn': (el) => API.toggleBranchEarn(el.dataset.id, by())
  };

  window.VIEWS = window.VIEWS || {};
  window.VIEWS.admin = { render, act, setModel, ui };
})();
