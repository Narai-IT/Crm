// คูปองของขวัญส่งอัตโนมัติตามรอบ (ทุกเดือน / ทุกสัปดาห์ / ครั้งเดียว · เวลาไทย)
// worker เรียก runDueRounds ทุกนาที · 1 รอบต่อคูปองส่งได้ครั้งเดียว (coupon_rounds unique) แม้รันหลาย instance หรือรีสตาร์ทกลางรอบ
import { issueCoupon, currentRule, MEMBER_SCOPE, OPEN_TPL } from './core.js';
import { queueMessage } from './line.js';
import { tierSql } from '../util.js';

const BKK = 7 * 3600e3;
const pad = (n) => String(n).padStart(2, '0');
// t: sched_kind, sched_day, sched_date ('YYYY-MM-DD'), sched_time ('HH:MM[:SS]')
function parts(t, now) {
  const [hh, mm] = String(t.sched_time || '09:00').split(':').map(Number);
  const at = (y, m, d) => new Date(Date.UTC(y, m, d, hh, mm) - BKK);
  const L = new Date(now.getTime() + BKK);
  const dayIn = (y, m) => Math.min(Number(t.sched_day) || 1, new Date(Date.UTC(y, m + 1, 0)).getUTCDate());
  return { at, y: L.getUTCFullYear(), m: L.getUTCMonth(), d: L.getUTCDate(), dow: L.getUTCDay(), dayIn };
}
function keyOf(t, o) {
  const L = new Date(o.getTime() + BKK);
  const ymd = L.getUTCFullYear() + '-' + pad(L.getUTCMonth() + 1) + '-' + pad(L.getUTCDate());
  return t.sched_kind === 'monthly' ? ymd.slice(0, 7) : t.sched_kind === 'weekly' ? 'W' + ymd : 'once';
}
// รอบล่าสุดที่ถึงเวลาแล้ว (null = ยังไม่มี)
export function lastRound(t, now = new Date()) {
  const { at, y, m, d, dow, dayIn } = parts(t, now);
  let o = null;
  if (t.sched_kind === 'monthly') {
    o = at(y, m, dayIn(y, m));
    if (o > now) { const py = m === 0 ? y - 1 : y; const pm = (m + 11) % 12; o = at(py, pm, dayIn(py, pm)); }
  } else if (t.sched_kind === 'weekly') {
    const back = (dow - (Number(t.sched_day) || 0) + 7) % 7;
    o = at(y, m, d - back); if (o > now) o = at(y, m, d - back - 7);
  } else if (t.sched_kind === 'once' && t.sched_date) {
    const [yy, mo, dd] = String(t.sched_date).slice(0, 10).split('-').map(Number);
    o = at(yy, mo - 1, dd); if (o > now) o = null;
  }
  return o ? { key: keyOf(t, o), at: o } : null;
}
// รอบถัดไปหลังเวลานี้ (null = ไม่มีแล้ว)
export function nextRound(t, now = new Date()) {
  const { at, y, m, d, dow, dayIn } = parts(t, now);
  let o = null;
  if (t.sched_kind === 'monthly') {
    o = at(y, m, dayIn(y, m));
    if (o <= now) { const ny = m === 11 ? y + 1 : y; const nm = (m + 1) % 12; o = at(ny, nm, dayIn(ny, nm)); }
  } else if (t.sched_kind === 'weekly') {
    const fwd = ((Number(t.sched_day) || 0) - dow + 7) % 7;
    o = at(y, m, d + fwd); if (o <= now) o = at(y, m, d + fwd + 7);
  } else if (t.sched_kind === 'once' && t.sched_date) {
    const [yy, mo, dd] = String(t.sched_date).slice(0, 10).split('-').map(Number);
    o = at(yy, mo - 1, dd); if (o <= now) o = null;
  }
  return o ? { key: keyOf(t, o), at: o } : null;
}

// สมาชิกที่ตรงเงื่อนไขของรอบ เรียงตามวิธีเลือก (แต้มสูงสุด / มาล่าสุด / สุ่ม)
export async function roundAudience(db, { brandId, tiers, followersOnly, pick, limit }) {
  const rule = await currentRule(db, brandId);
  const order = pick === 'recent' ? 'x.last_at DESC NULLS LAST, x.id' : pick === 'random' ? 'random()' : 'x.earned DESC, x.id';
  return db.q(`SELECT x.* FROM (
      SELECT m.id, COALESCE(k.follow_status, 'none') AS follow,
        COALESCE((SELECT sum(points) FROM point_ledger l WHERE l.member_id = m.id AND l.brand_id = $1 AND l.points > 0 AND l.entry_type <> 'merge' AND l.created_at > now() - interval '365 days'), 0)::int AS earned,
        (SELECT max(created_at) FROM point_ledger l WHERE l.member_id = m.id AND l.brand_id = $1) AS last_at,
        (SELECT line_user_id FROM member_line_identities i WHERE i.member_id = m.id ORDER BY linked_at DESC LIMIT 1) AS line_user_id
      FROM members m LEFT JOIN member_brand_links k ON k.member_id = m.id AND k.brand_id = $1
      WHERE m.status = 'active' AND ${MEMBER_SCOPE}) x
    WHERE ($2::text[] IS NULL OR ${tierSql(rule, 'x.earned')} = ANY($2)) AND (NOT $3 OR x.follow = 'follow')
    ORDER BY ${order}${limit ? ' LIMIT ' + (parseInt(limit, 10) || 1) : ''}`, [brandId, tiers && tiers.length ? tiers : null, !!followersOnly]);
}

const TPL_COLS = "t.*, to_char(t.sched_date, 'YYYY-MM-DD') AS sched_date, to_char(t.sched_time, 'HH24:MI') AS sched_time";
// ส่งรอบที่ถึงเวลาของคูปองนี้ (ทำใน transaction เดียว: จองรอบ → แจก → บันทึกจำนวน)
export async function runRound(db, templateId, now = new Date()) {
  const t = await db.one(`SELECT ${TPL_COLS} FROM coupon_templates t WHERE t.id = $1 AND t.kind = 'gift' AND t.auto_send AND ${OPEN_TPL} FOR UPDATE`, [templateId]);
  if (!t) return null;
  const due = lastRound(t, now);
  if (!due || (t.sched_since && due.at < new Date(t.sched_since))) return null;
  const claim = await db.one('INSERT INTO coupon_rounds (template_id, round_key, due_at) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING id', [t.id, due.key, due.at]);
  if (!claim) return null;
  const all = await roundAudience(db, { brandId: t.brand_id, tiers: t.audience_tiers, followersOnly: t.followers_only, pick: t.round_pick });
  const pickList = t.round_limit ? all.slice(0, t.round_limit) : all;
  let members = 0; let issued = 0; let soldOut = false;
  for (const m of pickList) {
    let got = 0;
    for (let i = 0; i < t.per_member; i++) {
      try { await issueCoupon(db, { memberId: m.id, templateId: t.id, source: 'gift', sourceRef: 'round:' + t.id + ':' + due.key + ':' + i }); got++; } catch (e) { if (e.code === 'coupon_sold_out') { soldOut = true; break; } throw e; }
    }
    if (got) {
      members++; issued += got;
      if (t.notify_line && m.line_user_id && m.follow === 'follow') {
        await queueMessage(db, { brandId: t.brand_id, lineUserId: m.line_user_id, kind: 'broadcast', data: { text: 'คุณได้รับคูปอง "' + t.title + '"' + (got > 1 ? ' ' + got + ' ใบ' : '') + ' เข้ากระเป๋าแล้ว', coupon: t.title } });
      }
    }
    if (soldOut) break;
  }
  await db.q('UPDATE coupon_rounds SET eligible = $2, members = $3, issued = $4 WHERE id = $1', [claim.id, all.length, members, issued]);
  return { key: due.key, eligible: all.length, members, issued };
}

// worker: หาคูปองที่ถึงรอบแล้วแต่ยังไม่ส่ง แล้วส่งทีละใบ
export async function runDueRounds({ q, tx }, now = new Date()) {
  const list = await q(`SELECT ${TPL_COLS}, (SELECT array_agg(round_key) FROM coupon_rounds r WHERE r.template_id = t.id) AS done
    FROM coupon_templates t WHERE t.kind = 'gift' AND t.auto_send AND ${OPEN_TPL}`);
  const out = [];
  for (const t of list) {
    const due = lastRound(t, now);
    if (!due || (t.sched_since && due.at < new Date(t.sched_since)) || (t.done || []).includes(due.key)) continue;
    const r = await tx((db) => runRound(db, t.id, now));
    if (r) out.push({ templateId: t.id, ...r });
  }
  return out;
}
