/* ตัวสลับมุมมอง + event delegation ของทั้งเดโม */
(function () {
  const { API } = window.CRM;
  const V = window.VIEWS;
  const root = document.getElementById('view');
  const views = ['customer', 'pos', 'admin'];
  let cur = 'customer';
  const prefix = { c: 'customer', p: 'pos', k: 'pos', a: 'admin' };

  function render() {
    const a = document.activeElement; const id = a && a.id; let sel = null;
    try { sel = id && a.selectionStart != null ? [a.selectionStart, a.selectionEnd] : null; } catch (e) { sel = null; }
    V[cur].render(root);
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === cur)));
    if (id) { const el = document.getElementById(id); if (el) { el.focus({ preventScroll: true }); if (sel) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not text */ } } }
  }
  function go(v) {
    if (!views.includes(v)) v = 'customer';
    cur = v;
    try { localStorage.setItem('crm-demo-view', v); } catch (e) { /* ignore */ }
    if (V[v].enter) V[v].enter();
    render(); window.scrollTo(0, 0);
  }

  let busy = false;
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-view]');
    if (t) { go(t.dataset.view); return; }
    if (e.target.closest('#reset')) { try { await API.reset(); } catch (err) { window.U.toast(err.message); return; } Object.assign(V.customer.ui, { screen: 'chat', tab: 'home', regDone: null, pick: null, reg: { name: '', phone: '', otpSent: false, otp: '', birthday: '', branch: '', privacy: false, mkt: true, err: '' } }); V.pos.ui.memberId = null; V.pos.ui.cart = []; V.pos.ui.last = null; V.admin.ui.member = null; if (V[cur].enter) V[cur].enter(); render(); window.U.toast('รีเซ็ตข้อมูลเดโมแล้ว'); return; }
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const name = el.dataset.act; const view = V[prefix[name.split('.')[0]]];
    if (view && view.act[name]) {
      if (busy) return;
      busy = true;
      try { await view.act[name](el, e); } catch (err) { window.U.toast(err.message || 'เกิดข้อผิดพลาด'); } finally { busy = false; }
      render();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    const el = e.target.closest('tr[data-act]'); if (el) { el.click(); return; }
    if (e.target.id === 'p-q') { Promise.resolve(V.pos.act['p.find']()).catch((err) => window.U.toast(err.message)).then(render); }
  });
  function onModel(e) {
    const el = e.target;
    const map = [['model', 'customer'], ['pmodel', 'pos'], ['amodel', 'admin']];
    for (const [k, v] of map) {
      if (el.dataset && el.dataset[k] !== undefined) {
        const isText = el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && !['checkbox', 'radio'].includes(el.type));
        if (e.type === 'change' && isText) return;
        if (V[v].setModel(el.dataset[k], el)) render();
        return;
      }
    }
  }
  document.addEventListener('input', onModel);
  document.addEventListener('change', onModel);
  API.onChange(() => render());

  let start = 'customer';
  const h = location.hash.replace('#', '');
  if (views.includes(h)) start = h; else { try { start = localStorage.getItem('crm-demo-view') || 'customer'; } catch (e) { /* ignore */ } }
  (window.CRM.ready || Promise.resolve()).then(() => go(start));
})();
