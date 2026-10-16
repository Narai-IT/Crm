// ข้อมูลสาธารณะที่หน้า LIFF ใช้ก่อนล็อกอิน: แบรนด์ สีธีม สาขา และอัตราแต้ม
import { q } from '../db.js';

export default function (r) {
  r.get('/api/public/brands', async () => {
    const brands = await q(`SELECT b.id, b.name, b.short_name, b.kind, b.theme_color, b.soft_color, b.ink_color, b.initial,
        e.baht_per_unit, e.points_per_unit, e.welcome_points, e.expiry_months
      FROM brands b LEFT JOIN earn_rules e ON e.brand_id = b.id AND e.effective_to IS NULL WHERE b.is_active ORDER BY b.id`);
    const branches = await q("SELECT id, brand_id, name, phone, to_char(open_time,'HH24:MI') AS open, to_char(close_time,'HH24:MI') AS close FROM branches WHERE is_active ORDER BY id");
    return brands.map((b) => ({ ...b, branches: branches.filter((x) => x.brand_id === b.id) }));
  });
}
