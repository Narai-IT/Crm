// ข้อมูลสาธารณะที่หน้า LIFF ใช้ก่อนล็อกอิน: แบรนด์ สีธีม สาขา และอัตราแต้ม
import { q, one } from '../db.js';
import { HttpError } from '../http.js';
import { verifyToken } from '../util.js';
import { receiptData, receiptPdf } from '../services/receipt.js';

export default function (r) {
  r.get('/api/public/brands', async () => {
    const brands = await q(`SELECT b.id, b.name, b.short_name, b.kind, b.theme_color, b.soft_color, b.ink_color, b.initial,
        e.baht_per_unit, e.points_per_unit, e.welcome_points, e.expiry_months
      FROM brands b LEFT JOIN earn_rules e ON e.brand_id = b.id AND e.effective_to IS NULL WHERE b.is_active ORDER BY b.id`);
    const branches = await q("SELECT id, brand_id, name, phone, to_char(open_time,'HH24:MI') AS open, to_char(close_time,'HH24:MI') AS close FROM branches WHERE is_active ORDER BY id");
    return brands.map((b) => ({ ...b, branches: branches.filter((x) => x.brand_id === b.id) }));
  });

  // PDF สำเนาใบเสร็จ: ลิงก์ที่ /api/liff/bills/:id/receipt ออกให้ (เซ็นด้วย APP_SECRET อายุ 15 นาที) · ชื่อไฟล์ท้าย path ให้เบราว์เซอร์ตั้งชื่อตอนบันทึก
  r.get('/api/public/receipts/:token/:name', async (_req, _b, url, p) => {
    const t = verifyToken(p.token);
    if (!t || !t.rcp || !t.m) throw new HttpError(410, 'link_expired', 'ลิงก์หมดอายุแล้ว กดดาวน์โหลดจากบัตรสมาชิกอีกครั้ง');
    const r0 = await receiptData({ q, one }, { txnId: t.rcp, memberId: t.m });
    const data = await receiptPdf(r0);
    const name = 'receipt-' + r0.billNo.replace(/[^\w-]+/g, '') + '.pdf';
    return { __file: { type: 'application/pdf', data, disposition: (url.searchParams.get('dl') === '1' ? 'attachment' : 'inline') + '; filename="' + name + '"' } };
  });
}
