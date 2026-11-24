// สำเนาใบเสร็จของบิลสมาชิก: ดูในบัตรสมาชิก LINE และดาวน์โหลดเป็น PDF (ขนาดใบเสร็จ 80 มม.)
// เป็น "สำเนา" จากข้อมูลบิลที่ POS ส่งมา ไม่ใช่ใบกำกับภาษี (ข้อมูลผู้ขาย/VAT อยู่ที่ POS)
// ฟอนต์ Sarabun (SIL OFL 1.1 · assets/fonts/OFL.txt) ฝังในไฟล์ PDF จึงอ่านภาษาไทยได้ทุกเครื่อง
import PDFDocument from 'pdfkit';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { notFound } from '../http.js';

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'assets', 'fonts');
const FONT = join(FONT_DIR, 'Sarabun-Regular.ttf');
const FONT_BOLD = join(FONT_DIR, 'Sarabun-Bold.ttf');

const money = (n) => (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const thaiDateTime = (v) => new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(v));

// ข้อมูลใบเสร็จของบิล (ต้องเป็นบิลของสมาชิกคนนี้)
export async function receiptData(db, { txnId, memberId }) {
  const t = await db.one(`SELECT st.*, b.name AS brand_name, b.short_name, b.theme_color, br.name AS branch_name
      FROM sales_transactions st JOIN brands b ON b.id = st.brand_id LEFT JOIN branches br ON br.id = st.branch_id
     WHERE st.id = $1 AND st.member_id = $2`, [txnId, memberId]);
  if (!t) throw notFound('ไม่พบบิลนี้');
  const bal = await db.one(`SELECT balance_after FROM point_ledger WHERE member_id = $1 AND brand_id = $2 AND ref_type = 'sale' AND ref_id = $3 ORDER BY id DESC LIMIT 1`,
    [memberId, t.brand_id, String(t.id)]);
  const refunded = await db.one('SELECT COALESCE(sum(amount), 0) AS a FROM refunds WHERE txn_id = $1', [t.id]);
  const items = (Array.isArray(t.items) ? t.items : []).map((i) => ({ name: String(i.name || ''), qty: Number(i.qty) || 1, amount: Math.round((Number(i.price) || 0) * (Number(i.qty) || 1) * 100) / 100 }));
  return {
    id: String(t.id), billNo: t.pos_bill_id, brandName: t.brand_name, brandShort: t.short_name, color: t.theme_color || '#C7481A',
    branchName: t.branch_name || t.branch_id, paidAt: t.paid_at, paidAtText: thaiDateTime(t.paid_at), memberId,
    items, subtotal: Number(t.subtotal), discount: Number(t.discount) || 0, voucher: Number(t.voucher_total) || 0, total: Number(t.total),
    points: Number(t.points_earned) || 0, balance: bal ? Number(bal.balance_after) : null,
    status: t.status, refunded: Number(refunded.a) || 0
  };
}

// PDF ขนาดกว้าง 80 มม. สูงตามจำนวนรายการ
export function receiptPdf(r) {
  const W = 226.77; // 80 มม.
  const M = 14;
  const lineH = 15;
  const height = 262 + r.items.length * lineH * 1.6 + (r.discount ? lineH : 0) + (r.voucher ? lineH : 0) + (r.refunded ? lineH * 2 : 0);
  const doc = new PDFDocument({ size: [W, height], margin: M, info: { Title: 'ใบเสร็จ ' + r.billNo, Author: r.brandName } });
  doc.registerFont('r', FONT); doc.registerFont('b', FONT_BOLD);
  const inner = W - M * 2;
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const done = new Promise((res) => doc.on('end', () => res(Buffer.concat(chunks))));

  const center = (text, font = 'r', size = 9, color = '#111111') => { doc.font(font).fontSize(size).fillColor(color).text(text, M, doc.y, { width: inner, align: 'center' }); };
  const lr = (left, right, font = 'r', size = 9) => {
    const y = doc.y;
    doc.font(font).fontSize(size).fillColor('#111111');
    const rw = doc.widthOfString(right);
    doc.text(right, M + inner - rw, y, { lineBreak: false });
    doc.text(left, M, y, { width: inner - rw - 6 });
    doc.y = Math.max(doc.y, y + size * 1.45);
  };
  const hr = () => { const y = doc.y + 3; doc.save().moveTo(M, y).lineTo(W - M, y).dash(2, { space: 2 }).strokeColor('#888888').lineWidth(0.6).stroke().restore(); doc.y = y + 5; };

  // หัวใบ: วงกลมสีแบรนด์ + ตัวย่อ
  const cy = M + 20;
  doc.circle(W / 2, cy, 18).fill(r.color);
  doc.font('b').fontSize(17).fillColor('#ffffff').text(String(r.brandShort || r.brandName || '').trim().slice(0, 1), M, cy - 13, { width: inner, align: 'center' });
  doc.y = cy + 24;
  center(r.brandName, 'b', 12);
  center('สาขา ' + r.branchName, 'r', 9);
  center('ใบเสร็จรับเงิน / RECEIPT (สำเนา)', 'r', 7.5, '#444444');
  hr();
  lr('เลขที่บิล', r.billNo);
  lr('วันที่', r.paidAtText);
  lr('สมาชิก', r.memberId);
  hr();
  for (const it of r.items) lr(`${it.qty}× ${it.name}`, money(it.amount));
  hr();
  if (r.discount) { lr('รวมรายการ', money(r.subtotal)); lr('ส่วนลด', '-' + money(r.discount)); }
  lr('รวมทั้งสิ้น', '฿' + money(r.total), 'b', 12);
  if (r.voucher) lr('ชำระด้วย Voucher', money(r.voucher));
  if (r.refunded) { lr(r.status === 'refunded' ? 'ยกเลิก/คืนเงินทั้งบิล' : 'คืนเงินบางส่วน', '-' + money(r.refunded), 'b', 9); }
  hr();
  lr('แต้มที่ได้รับ', (r.points >= 0 ? '+' : '') + r.points);
  if (r.balance != null) lr(`แต้ม${r.brandShort || ''}คงเหลือ (หลังบิลนี้)`, String(r.balance));
  doc.moveDown(0.5);
  const boxY = doc.y;
  doc.font('r').fontSize(7.5).fillColor('#8A3A16').text('สำเนาจากบัตรสมาชิก LINE · ไม่ใช่ใบกำกับภาษี', M + 4, boxY + 4, { width: inner - 8, align: 'center' });
  doc.save().roundedRect(M, boxY, inner, doc.y - boxY + 4, 3).strokeColor(r.color).lineWidth(0.8).stroke().restore();
  doc.y += 10;
  center('ขอบคุณที่อุดหนุน', 'r', 8, '#444444');
  doc.end();
  return done;
}
