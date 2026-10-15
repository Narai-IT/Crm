/* โหมดเชื่อมฐานข้อมูลจริง: ถ้าหน้านี้เปิดจาก server ของโปรเจกต์ (server/ ที่ DEV_MODE=1)
 * จะสลับ API.* ทั้งหมดไปเรียก REST API จริงบน PostgreSQL แทน mock ในเบราว์เซอร์
 * เปิดไฟล์ตรง ๆ หรือเปิดจาก artifact ยังทำงานแบบเดโมเหมือนเดิม */
(function () {
  const CRM = window.CRM;
  const { R, API } = CRM;
  let snap = null;
  let qrAt = 0;

  async function http(method, path, body, headers) {
    const res = await fetch(path, { method, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}), body: body === undefined ? undefined : JSON.stringify(body) });
    let data = null;
    try { data = await res.json(); } catch (e) { data = null; }
    if (!res.ok) { const err = new Error((data && data.message) || ('HTTP ' + res.status)); err.status = res.status; err.code = data && data.error; throw err; }
    return data;
  }
  const lineUser = () => ({ 'x-dev-line-user': snap.demo.lineUserId });
  const atBranch = (b) => ({ 'x-dev-branch': b });
  const asStaff = () => ({ 'x-dev-staff': (window.VIEWS && window.VIEWS.admin && window.VIEWS.admin.ui.user) || 'S002' });

  async function refresh() {
    const s = await http('GET', '/api/dev/snapshot');
    s.live = true;
    snap = s; qrAt = Date.now();
    CRM._setState(s);
    CRM._notify();
    return s;
  }

  function install() {
    const realQr = R.qrToken;
    R.qrToken = (memberId) => {
      if (!snap || !snap.qr || memberId !== snap.demo.memberId) return realQr(memberId);
      const left = Math.max(0, snap.qr.expiresIn - Math.floor((Date.now() - qrAt) / 1000));
      if (left <= 1) http('GET', '/api/liff/qr', undefined, lineUser()).then((q) => { snap.qr = q; qrAt = Date.now(); }).catch(() => {});
      return { token: snap.qr.token, left };
    };

    Object.assign(API, {
      reset: async () => { await http('POST', '/api/dev/reset'); await refresh(); },
      openOa: async (brand) => { await http('POST', '/api/dev/line-event', { brand, type: 'follow', onlyIfNew: true }); await refresh(); },
      chat: async (brand, text) => { await http('POST', '/api/dev/line-event', { brand, type: 'message', text }); await refresh(); },
      liffOpen: async (brand) => { await http('GET', '/api/liff/me?brand=' + brand, undefined, lineUser()).catch(() => {}); await refresh(); },
      sendOtp: async (phone) => { const r = await http('POST', '/api/liff/otp', { phone }, lineUser()); await refresh(); return r; },
      register: async (brand, f) => {
        const r = await http('POST', '/api/liff/register', { brand, name: f.name, phone: f.phone, otp: f.otp, birthday: f.birthday || null, branchId: f.branch, marketing: !!f.mkt, privacy: true }, lineUser());
        await refresh();
        return { member: R.member(r.memberId), linked: r.linked };
      },
      setConsent: async (memberId, brand, val) => { await http('PATCH', '/api/liff/consents', { brand, marketing: val }, lineUser()); await refresh(); },
      redeem: async (memberId, rewardId) => {
        try {
          const r = await http('POST', '/api/liff/redemptions', { rewardId }, Object.assign(lineUser(), { 'idempotency-key': 'rdm-' + Date.now() + '-' + Math.random().toString(36).slice(2) }));
          await refresh();
          return { ok: true, coupon: R.state().coupons.find((c) => c.id === r.couponId) };
        } catch (e) { await refresh(); return { ok: false, msg: e.message }; }
      },
      addCode: async (memberId, brand, code) => {
        try { const r = await http('POST', '/api/liff/coupons/claim', { brand, code }, lineUser()); await refresh(); return { ok: true, coupon: R.state().coupons.find((c) => c.id === r.couponId) }; }
        catch (e) { return { ok: false, msg: e.message }; }
      },
      resolve: async (q, ctx) => {
        try {
          const body = String(q).startsWith('QR.') ? { qrToken: q } : { query: q };
          const r = await http('POST', '/api/pos/members/resolve', body, atBranch(ctx.branch));
          await refresh();
          return R.member(r.member.id);
        } catch (e) {
          await refresh();
          if (e.status === 404) return null;
          throw e;
        }
      },
      closeBill: async (o) => {
        const posBillId = o.branch + '-' + Date.now().toString(36).toUpperCase();
        await http('POST', '/api/pos/transactions', { posBillId, memberId: o.memberId || null, items: o.items, couponIds: o.couponIds || [], channel: o.channel || 'pos' }, atBranch(o.branch));
        await refresh();
        return R.state().bills.find((b) => b.id === posBillId);
      },
      retryBill: async (billId) => {
        const b = R.state().bills.find((x) => x.id === billId);
        await http('POST', '/api/pos/transactions', { posBillId: billId, memberId: b.memberId, items: b.items, channel: b.channel }, atBranch(b.branch));
        await refresh();
        return b;
      },
      refund: async (billId) => {
        const b = R.state().bills.find((x) => x.id === billId);
        await http('POST', '/api/pos/refunds', { posBillId: billId }, atBranch(b.branch));
        await refresh();
      },
      requestAdjust: async (o) => {
        if (o.branch) await http('POST', '/api/pos/point-requests', { memberId: o.memberId, points: o.pts, reason: o.reason }, atBranch(o.branch));
        else await http('POST', '/api/admin/point-adjustments', { memberId: o.memberId, brand: o.brand, points: o.pts, reason: o.reason }, asStaff());
        await refresh();
      },
      decide: async (reqId, ok) => { await http('POST', '/api/admin/point-adjustments/' + String(reqId).replace(/\D/g, '') + (ok ? '/approve' : '/reject'), {}, asStaff()); await refresh(); },
      saveRule: async (brand, rule) => { await http('PUT', '/api/admin/earn-rules/' + brand, rule, asStaff()); await refresh(); },
      saveReward: async (r) => {
        const ex = r.id && R.state().rewards.find((x) => x.id === r.id);
        if (ex) await http('PATCH', '/api/admin/rewards/' + r.id, { active: r.active }, asStaff());
        else await http('POST', '/api/admin/rewards', { brand: r.brand, name: r.name, cost: r.cost, cat: r.cat, value: r.cp.value, stock: r.stock }, asStaff());
        await refresh();
      },
      toggleBranchEarn: async (id) => { const b = R.branch(id); await http('PATCH', '/api/admin/branches/' + id, { earnEnabled: !b.earn }, asStaff()); await refresh(); },
      broadcast: async (o) => {
        const r = await http('POST', '/api/admin/campaigns', { brand: o.brand, segment: o.segment, text: o.text, coupon: !!o.coupon, couponTitle: o.couponTitle, couponValue: o.couponValue }, asStaff());
        await refresh();
        return { id: 'BC-' + r.id, recipients: r.recipients };
      },
      clearLog: async () => { await http('POST', '/api/dev/clear-log'); await refresh(); }
    });

    // ข้อมูลอาจถูกเปลี่ยนจากอีกเครื่อง (เช่น เปิดมือถือลูกค้าบนโทรศัพท์ และ POS บนโน้ตบุ๊ก) → ดึงใหม่ทุก 4 วินาที
    setInterval(() => { if (!document.hidden) refresh().catch(() => {}); }, 4000);

    const sub = document.querySelector('.logo small');
    if (sub) sub.textContent = 'เชื่อมฐานข้อมูล PostgreSQL จริง · โหมดทดสอบ';
    const reset = document.getElementById('reset');
    if (reset) reset.textContent = 'ล้างข้อมูลทดสอบ';
  }

  CRM.ready = (async () => {
    if (location.protocol === 'file:') return;
    try {
      const cfg = await http('GET', '/api/config');
      if (!cfg || !cfg.dev) return;
      await refresh();
      install();
      CRM.live = true;
    } catch (e) { /* ไม่มี server: ใช้โหมดเดโม */ }
  })();
})();
