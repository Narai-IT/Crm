/* ตัวช่วยที่ทุกมุมมองใช้ร่วมกัน */
(function () {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n) => Number(n || 0).toLocaleString('en-US');
  const baht = (n) => Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const TH_M = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  const date = (t) => { const d = new Date(t); return d.getDate() + ' ' + TH_M[d.getMonth()] + ' ' + d.getFullYear(); };
  const time = (t) => { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); };
  const dt = (t) => date(t) + ' ' + time(t);
  const ago = (t) => {
    const s = Math.floor((Date.now() - t) / 1000);
    if (s < 60) return 'เมื่อสักครู่'; if (s < 3600) return Math.floor(s / 60) + ' นาทีที่แล้ว';
    if (s < 86400) return Math.floor(s / 3600) + ' ชม.ที่แล้ว'; return Math.floor(s / 86400) + ' วันที่แล้ว';
  };
  const left = (t) => { const d = Math.ceil((t - Date.now()) / 86400000); return d <= 0 ? 'หมดอายุวันนี้' : d <= 7 ? 'เหลือ ' + d + ' วัน' : 'ถึง ' + date(t); };

  const ic = (d, s) => '<svg width="' + (s || 20) + '" height="' + (s || 20) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const I = {
    close: ic('<path d="M6 6l12 12M18 6L6 18"/>'),
    back: ic('<path d="M15 6l-6 6 6 6"/>'),
    user: ic('<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>'),
    card: ic('<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20M6 15h4"/>', 22),
    ticket: ic('<path d="M3 7h18v3a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4z"/>', 22),
    gift: ic('<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M5 12v9h14v-9M12 8v13"/>', 22),
    receipt: ic('<path d="M6 2h12v20l-3-2-3 2-3-2-3 2z"/><path d="M9 7h6M9 11h6"/>', 22),
    mega: ic('<path d="M3 11l15-6v14L3 13z"/><path d="M7 13v5a2 2 0 0 0 4 0v-3"/>', 24),
    pin: ic('<path d="M12 22s7-6.5 7-12a7 7 0 0 0-14 0c0 5.5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/>', 22),
    chat: ic('<path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/>', 22),
    scan: ic('<path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10"/>'),
    shield: ic('<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>')
  };

  // QR จำลอง: วาดจาก hash ของ token (QR จริงใช้ไลบรารี qrcode ฝั่ง LIFF)
  function qrSvg(token, size, label) {
    const N = 25; let h = 2166136261;
    for (let i = 0; i < token.length; i++) { h ^= token.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    const rnd = () => { h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0; return h / 4294967296; };
    const finder = (x, y) => 'M' + x + ' ' + y + 'h7v7h-7zM' + (x + 1) + ' ' + (y + 1) + 'v5h5v-5zM' + (x + 2) + ' ' + (y + 2) + 'h3v3h-3z';
    const inF = (x, y) => (x < 8 && y < 8) || (x > 16 && y < 8) || (x < 8 && y > 16);
    let d = finder(0, 0) + finder(18, 0) + finder(0, 18);
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (!inF(x, y) && rnd() < 0.48) d += 'M' + x + ' ' + y + 'h1v1h-1z';
    return '<svg width="' + size + '" height="' + size + '" viewBox="-1 -1 27 27" role="img" aria-label="' + esc(label) + '"><rect x="-1" y="-1" width="27" height="27" fill="#FFFFFF"/><path fill="#22282B" fill-rule="evenodd" d="' + d + '"/></svg>';
  }

  let toastTimer;
  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
  }

  function brandVars(b) { return '--a:' + b.accent + ';--as:' + b.soft + ';--ai:' + b.ink + ';'; }

  function logRows(rows, limit) {
    if (!rows.length) return '<div class="empty">ยังไม่มีเหตุการณ์ ลองกดเมนูในมือถือ หรือปิดบิลที่หน้าร้าน</div>';
    return rows.slice(0, limit || 40).map((r) =>
      '<div class="log-row"><span class="k ' + r.kind + '">' + esc(r.kind) + '</span><span class="m">' + esc(r.method) + '</span> ' + esc(r.path) +
      ' <span style="opacity:.6">· ' + time(r.at) + '</span>' +
      (r.body ? '<pre>' + esc(JSON.stringify(r.body)) + '</pre>' : '') +
      (r.result ? '<div class="r">→ ' + esc(r.result) + '</div>' : '') + '</div>').join('');
  }

  window.U = { esc, fmt, baht, date, time, dt, ago, left, I, qrSvg, toast, brandVars, logRows };
})();
