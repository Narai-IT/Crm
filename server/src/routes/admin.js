// API หลังบ้าน · ตรวจตำแหน่ง + ขอบเขตแบรนด์/สาขาทุกครั้งฝั่ง server
import { q, one, tx } from '../db.js';
import { bad, notFound, conflict, HttpError } from '../http.js';
import { staffUser, loadStaff, requirePage, requireBrand, scopeBrands, ROLE_PAGES, ROLE_NAMES, ROLE_SCOPE, ensureDefaultAdmin } from '../auth.js';
import { checkPassword, hashPassword, signToken, maskPhone } from '../util.js';
import * as core from '../services/core.js';
import { queueMessage } from '../services/line.js';
import * as rm from '../services/richmenu.js';
import { nextRound, roundAudience } from '../services/rounds.js';
import { TIER_KEYS, tierSql } from '../util.js';
import { COUPON_SQL, couponView } from './liff.js';

const actor = (s) => ({ type: 'staff', id: s.id, name: s.name });
const RM_COLS = 'id, brand_id, layout, actions, chat_bar, width, height, octet_length(data)::int AS size, is_active, created_by, created_at, installed_at';
const rmBusy = new Set();                                  // กันกดติดตั้งซ้อนกันในแบรนด์เดียว
// ติดตั้งเมนูให้ OA แล้วบันทึกว่าเมนูไหนใช้อยู่ · LINE ทำก่อน ถ้า LINE ไม่รับ ฐานข้อมูลไม่เปลี่ยน
async function installRichMenu(brandId, m, image, mime) {
  if (rmBusy.has(brandId)) throw conflict('richmenu_busy', 'กำลังติดตั้งเมนูของแบรนด์นี้อยู่ รอสักครู่');
  rmBusy.add(brandId);
  try {
    return await rm.install({ brandId, token: process.env['LINE_' + brandId.toUpperCase() + '_TOKEN'], liffId: process.env.LIFF_ID, ...m, image, mime });
  } catch (e) {
    if (e.code === 'richmenu_invalid' || e.code === 'line_error') throw bad(e.code, e.message);
    throw e;
  } finally { rmBusy.delete(brandId); }
}


function checkNewPassword(pw, id) {
  pw = String(pw || '');
  if (pw.length < 8) throw bad('password_short', 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
  if (pw.toLowerCase() === String(id).toLowerCase() || ['admin', 'password', '12345678', 'demo1234'].includes(pw.toLowerCase())) throw bad('password_weak', 'รหัสผ่านนี้เดาง่ายเกินไป');
  return pw;
}
// ตรวจตำแหน่ง + ขอบเขต: ผู้ดูแลระบบ/การตลาด = ทั้งเครือ · ผู้จัดการแบรนด์ = แบรนด์ · ผู้จัดการสาขา/แคชเชียร์ = สาขา
async function staffFields(b, keepScopes) {
  const name = String(b.name || '').trim();
  if (!name) throw bad('name_required', 'ใส่ชื่อพนักงาน');
  if (!ROLE_PAGES[b.role]) throw bad('role_invalid', 'เลือกตำแหน่ง');
  const scope = ROLE_SCOPE[b.role];
  const email = String(b.email || '').trim() || null;
  if (keepScopes) return { name, role: b.role, email, scope, scopeIds: null, limit: null };
  let ids = scope === 'group' ? ['*'] : [...new Set((b.scopeIds || []).map(String))];
  if (scope !== 'group') {
    if (!ids.length) throw bad('scope_required', scope === 'brand' ? 'เลือกแบรนด์ที่ดูแลอย่างน้อย 1 แบรนด์' : 'เลือกสาขาอย่างน้อย 1 สาขา');
    const ok = await q(scope === 'brand' ? 'SELECT id FROM brands WHERE id = ANY($1)' : 'SELECT id FROM branches WHERE id = ANY($1)', [ids]);
    if (ok.length !== ids.length) throw bad('scope_invalid', 'มีแบรนด์หรือสาขาที่ไม่ถูกต้อง');
  }
  const limit = b.role === 'branchmgr' ? (b.approveLimit === '' || b.approveLimit == null ? 200 : Math.max(0, parseInt(b.approveLimit, 10) || 0)) : null;
  return { name, role: b.role, email, scope, scopeIds: ids, limit };
}
async function setScopes(db, id, f) {
  if (!f.scopeIds) {
    // เปลี่ยนตำแหน่งโดยไม่ได้ส่งขอบเขตมา: ใช้ได้เฉพาะตำแหน่งที่ขอบเขตแบบเดิม
    const cur = await db.q('SELECT scope_type, scope_id, approve_limit FROM staff_scopes WHERE staff_id = $1', [id]);
    if (cur.some((c) => c.scope_type !== f.scope)) throw bad('scope_required', 'ตำแหน่งใหม่ต้องเลือกขอบเขตใหม่');
    if (f.role !== 'branchmgr') await db.q('UPDATE staff_scopes SET approve_limit = NULL WHERE staff_id = $1', [id]);
    return;
  }
  await db.q('DELETE FROM staff_scopes WHERE staff_id = $1', [id]);
  for (const sid of f.scopeIds) await db.q('INSERT INTO staff_scopes (staff_id, scope_type, scope_id, approve_limit) VALUES ($1,$2,$3,$4)', [id, f.scope, sid, f.limit]);
}

const KIND_NAMES = { general: 'ทั่วไป', code: 'กรอกโค้ด', birthday: 'วันเกิด', welcome: 'ต้อนรับ', gift: 'ของขวัญ' };
const DAY_SHORT = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'];
const dayStart = (d) => (d ? endOfDay(d, '00:00:00') : null);
function templateFields(b) {
  const kind = KIND_NAMES[b.kind] ? b.kind : null;
  if (!kind) throw bad('kind_invalid', 'เลือกประเภทคูปอง');
  const title = String(b.title || '').trim();
  if (!title) throw bad('title_required', 'ใส่ชื่อคูปอง');
  const style = ['baht', 'pct', 'free'].includes(b.type) ? b.type : 'baht';
  const items = itemRules(style, b);
  const value = items.free ? Math.max(...items.free.map((x) => x.price)) || 1 : Number(b.value);
  if (!(value > 0) || (style === 'pct' && value > 100)) throw bad('value_invalid', style === 'free' ? 'ใส่ราคาของที่แจกฟรี (ใช้เป็นส่วนลดตอนปิดบิล)' : 'ใส่มูลค่าส่วนลดให้ถูกต้อง');
  const min = Math.max(0, Number(b.min) || 0);
  const maxDiscount = style === 'pct' && Number(b.maxDiscount) > 0 ? Number(b.maxDiscount) : null;
  const validity = b.validity === 'dates' ? 'dates' : 'days';
  const validFrom = validity === 'dates' ? dayStart(b.validFrom) : null;
  const validTo = b.validTo ? endOfDay(b.validTo) : null;
  if (validity === 'dates' && (!validFrom || !validTo)) throw bad('dates_required', 'ใส่วันที่เริ่มและวันสุดท้ายที่ใช้ได้');
  if (validFrom && validTo && validFrom > validTo) throw bad('dates_invalid', 'วันเริ่มต้องไม่เกินวันสุดท้าย');
  const days = Math.min(365, Math.max(1, parseInt(b.days, 10) || 30));
  const issueFrom = dayStart(b.issueFrom); const issueTo = b.issueTo ? endOfDay(b.issueTo) : null;
  if (issueFrom && issueTo && issueFrom > issueTo) throw bad('dates_invalid', 'วันเริ่มแจกต้องไม่เกินวันสิ้นสุดการแจก');
  const useDays = parseInt(b.useDays, 10);
  if (!(useDays >= 1 && useDays <= 127)) throw bad('days_invalid', 'เลือกวันที่ใช้คูปองได้อย่างน้อย 1 วัน');
  const code = kind === 'code' ? String(b.code || '').trim().toUpperCase() : null;
  if (kind === 'code' && !/^[A-Z0-9]{4,20}$/.test(code)) throw bad('code_invalid', 'โค้ดต้องเป็นตัวอังกฤษหรือตัวเลข 4-20 ตัว');
  // ระดับที่ได้คูปอง: เลือกได้หลายระดับ (ไม่เลือก/เลือกครบ = ทุกระดับ) · รองรับค่าเดิม tier ระดับเดียว
  const tierList = Array.isArray(b.tiers) ? TIER_KEYS.filter((x) => b.tiers.includes(x)) : TIER_KEYS.includes(b.tier) ? [b.tier] : [];
  if (Array.isArray(b.tiers) && !tierList.length) throw bad('tier_required', 'เลือกระดับสมาชิกอย่างน้อย 1 ระดับ');
  const tiers = tierList.length && tierList.length < TIER_KEYS.length ? tierList : null;
  const sched = schedFields(kind, b);
  // สาขาที่สมัคร (เฉพาะคูปองต้อนรับ) · ว่าง = ทุกสาขา
  const branchIds = kind === 'welcome' && Array.isArray(b.branchIds) ? [...new Set(b.branchIds.map(String))] : null;
  if (branchIds && !branchIds.length) throw bad('branch_required', 'เลือกสาขาอย่างน้อย 1 สาขา หรือเลือก "ทุกสาขา"');
  // ป้ายบนคูปอง + เงื่อนไขย่อ (สร้างจากการตั้งค่า ลูกค้าเห็นตรงกับที่ระบบตรวจจริง)
  const big = style === 'free' ? 'ฟรี' : style === 'pct' ? '-' + value + '%' : '-' + value;
  const small = style === 'free' ? KIND_NAMES[kind] : style === 'pct' ? 'ส่วนลด' : 'บาท';
  const cond = [items.free ? 'ฟรี ' + items.free.map((x) => x.name).join(' หรือ ') + ' 1 ชิ้น (ต้องมีในบิล)' : '',
    items.condMode ? 'ต้องมี ' + items.condItems.map((x) => (x.type === 'cat' ? 'หมวด' : '') + x.name).join(items.condMode === 'all' ? ' และ ' : ' หรือ ') + (items.condQty > 1 ? ' รวม ' + items.condQty + ' ชิ้นขึ้นไป' : '') + ' ในบิล' : '',
    min ? 'ขั้นต่ำ ' + min + ' บาท' : '', maxDiscount ? 'ลดสูงสุด ' + maxDiscount + ' บาท' : '',
    useDays === 127 ? '' : 'ใช้ได้วัน ' + DAY_SHORT.filter((_, i) => useDays & (1 << i)).join(' '), '1 ใบใช้ได้ 1 ครั้ง'].filter(Boolean).join(' · ');
  return { kind, title, description: String(b.description || '').trim().slice(0, 1000), imageId: b.imageId ? parseInt(b.imageId, 10) : null, type: style === 'pct' ? 'pct' : 'baht',
    value, min, maxDiscount, big, small, cond, validity, validFrom, validTo, days, issueFrom, issueTo, tier: 'all', tiers, sched, items, followersOnly: !!b.followersOnly, useDays,
    maxIssue: optInt(b.maxIssue) || null, code, active: b.active !== false, branchIds };
}
// ของฟรีเลือกจากเมนู POS + เงื่อนไขสินค้าในบิล
function itemRules(style, b) {
  const clean = (list, withType) => (Array.isArray(list) ? list : []).slice(0, 30).map((x) => ({ ...(withType ? { type: x.type === 'cat' ? 'cat' : 'item' } : {}),
    id: String(x.id || '').slice(0, 100), name: String(x.name || '').trim().slice(0, 200), ...(withType ? {} : { price: Math.max(0, Number(x.price) || 0) }) })).filter((x) => x.id && x.name);
  const free = style === 'free' ? clean(b.freeItems, false) : [];
  const condItems = ['any', 'all'].includes(b.condMode) ? clean(b.condItems, true) : [];
  if (['any', 'all'].includes(b.condMode) && !condItems.length) throw bad('cond_required', 'เลือกเมนูหรือหมวดที่ต้องมีในบิลอย่างน้อย 1 รายการ (หรือเลือก "ไม่มีเงื่อนไข")');
  const condQty = Math.min(99, Math.max(1, parseInt(b.condQty, 10) || 1));
  return { free: free.length ? free : null, condMode: condItems.length ? b.condMode : null, condItems: condItems.length ? condItems : null, condQty, condScope: b.condScope === 'items' && condItems.length ? 'items' : 'bill' };
}
// ของขวัญส่งอัตโนมัติตามรอบ (เฉพาะประเภทของขวัญ)
function schedFields(kind, b) {
  const auto = kind === 'gift' && !!b.autoSend;
  if (!auto) return { auto: false, kind: null, day: null, date: null, time: '09:00', limit: null, pick: 'points', perMember: 1, notify: false };
  const sk = ['monthly', 'weekly', 'once'].includes(b.schedKind) ? b.schedKind : null;
  if (!sk) throw bad('sched_invalid', 'เลือกรอบส่ง');
  const day = sk === 'once' ? null : parseInt(b.schedDay, 10);
  if (sk === 'monthly' && !(day >= 1 && day <= 31)) throw bad('sched_invalid', 'เลือกวันที่ส่ง (1 - 31)');
  if (sk === 'weekly' && !(day >= 0 && day <= 6)) throw bad('sched_invalid', 'เลือกวันที่ส่งในสัปดาห์');
  const date = sk === 'once' ? String(b.schedDate || '').slice(0, 10) : null;
  if (sk === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('sched_invalid', 'เลือกวันที่ส่ง');
  const time = String(b.schedTime || '09:00').slice(0, 5);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw bad('sched_invalid', 'เวลาส่งไม่ถูกต้อง');
  const limit = b.roundLimit === '' || b.roundLimit == null ? null : parseInt(b.roundLimit, 10);
  if (limit !== null && !(limit >= 1 && limit <= 1000000)) throw bad('sched_invalid', 'จำนวนคนต่อรอบต้องเป็นตัวเลขตั้งแต่ 1');
  const perMember = parseInt(b.perMember, 10) || 1;
  if (!(perMember >= 1 && perMember <= 10)) throw bad('sched_invalid', 'จำนวนใบต่อคนต่อรอบต้องอยู่ระหว่าง 1 - 10');
  return { auto, kind: sk, day, date, time, limit, pick: ['points', 'recent', 'random'].includes(b.roundPick) ? b.roundPick : 'points', perMember, notify: !!b.notifyLine };
}
// บันทึกระดับ + รอบส่ง · sched_since = เวลาที่เริ่มนับรอบ (เปลี่ยนเมื่อเปิดส่งอัตโนมัติหรือเปลี่ยนรอบ ไม่ส่งรอบที่ผ่านไปแล้วย้อนหลัง)
async function saveAudience(db, id, f) {
  const x = f.sched;
  await db.q(`UPDATE coupon_templates SET audience_tiers = $2,
      sched_since = CASE WHEN $3 AND (NOT auto_send OR sched_since IS NULL OR sched_kind IS DISTINCT FROM $4 OR sched_day IS DISTINCT FROM $5 OR sched_date IS DISTINCT FROM $6::date OR sched_time IS DISTINCT FROM $7::time) THEN now() ELSE sched_since END,
      auto_send = $3, sched_kind = $4, sched_day = $5, sched_date = $6::date, sched_time = $7::time, round_limit = $8, round_pick = $9, per_member = $10, notify_line = $11,
      free_items = $12, cond_mode = $13, cond_items = $14, cond_qty = $15, cond_scope = $16 WHERE id = $1`,
    [id, f.tiers, x.auto, x.kind, x.day, x.date, x.time, x.limit, x.pick, x.perMember, x.notify,
      f.items.free ? JSON.stringify(f.items.free) : null, f.items.condMode, f.items.condItems ? JSON.stringify(f.items.condItems) : null, f.items.condQty, f.items.condScope]);
}
const hhmm = (v) => { const x = String(v || '').trim(); if (!x) return null; if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(x.slice(0, 5))) throw bad('time_invalid', 'เวลาไม่ถูกต้อง'); return x.slice(0, 5); };
function branchFields(b) {
  const name = String(b.name || '').trim();
  if (!name) throw bad('name_required', 'ใส่ชื่อสาขา');
  return { name, phone: String(b.phone || '').trim() || null, open: hhmm(b.open), close: hhmm(b.close), posMode: b.posMode === 'manual' ? 'manual' : 'api',
    earn: b.earnEnabled !== false, active: b.active !== false };
}
async function checkBranches(brandId, ids) {
  if (!ids) return null;
  const ok = await q('SELECT id FROM branches WHERE id = ANY($1) AND brand_id = $2', [ids, brandId]);
  if (ok.length !== ids.length) throw bad('branch_invalid', 'สาขาที่เลือกไม่ใช่ของแบรนด์นี้');
  return ids;
}
async function saveCode(db, t, f, oldCode) {
  if (oldCode && oldCode !== f.code) await db.q('DELETE FROM promo_codes WHERE code = $1 AND used_count = 0', [oldCode]);
  if (!f.code) return;
  const other = await db.one('SELECT coupon_template_id FROM promo_codes WHERE code = $1', [f.code]);
  if (other && other.coupon_template_id !== t.id) throw new HttpError(409, 'code_exists', 'โค้ด ' + f.code + ' ถูกใช้กับคูปองอื่นแล้ว');
  await db.q(`INSERT INTO promo_codes (code, brand_id, coupon_template_id, max_uses, expires_at) VALUES ($1,$2,$3,NULL,$4)
    ON CONFLICT (code) DO UPDATE SET expires_at = EXCLUDED.expires_at`, [f.code, t.brand_id, t.id, t.is_active ? t.issue_to : new Date()]);
}

const CATS = ['food', 'side', 'drink', 'discount'];
const optInt = (v) => (v === '' || v === null || v === undefined ? null : Math.max(0, parseInt(v, 10) || 0));
const endOfDay = (d, time = '23:59:59') => { const x = new Date(String(d).length <= 10 ? d + 'T' + time + '+07:00' : d); if (isNaN(x)) throw bad('date_invalid', 'วันที่ไม่ถูกต้อง'); return x; };
function rewardFields(b) {
  const name = String(b.name || '').trim(); const cost = parseInt(b.cost, 10);
  if (!name || !(cost > 0)) throw bad('reward_invalid', 'ใส่ชื่อรางวัลและแต้มที่ใช้');
  const cat = CATS.includes(b.cat) ? b.cat : 'food';
  const type = cat === 'discount' && b.type === 'pct' ? 'pct' : 'baht'; const value = Math.max(0, Number(b.value) || 0);
  if (cat === 'discount' && !(value > 0)) throw bad('reward_invalid', 'รางวัลแบบส่วนลด ต้องใส่มูลค่าส่วนลด');
  const kind = b.kind === 'coupon' ? 'coupon' : 'general';
  const templateId = kind === 'coupon' ? parseInt(b.templateId, 10) : null;
  if (kind === 'coupon' && !(templateId > 0)) throw bad('coupon_required', 'เลือกคูปองที่จะให้แลก');
  // ระดับสมาชิกที่แลกได้: ว่างหรือเลือกครบ = ทุกระดับ
  const tiers = Array.isArray(b.tiers) ? TIERS.filter((t) => b.tiers.includes(t)) : [];
  if (Array.isArray(b.tiers) && !tiers.length) throw bad('tier_required', 'เลือกระดับสมาชิกที่แลกได้อย่างน้อย 1 ระดับ');
  const limitCount = optInt(b.limitCount) || null;
  const limitPeriod = PERIODS.includes(b.limitPeriod) ? b.limitPeriod : 'all';
  const day = (v) => { if (!v) return null; if (!/^\d{4}-\d{2}-\d{2}$/.test(String(v))) throw bad('date_invalid', 'วันที่ไม่ถูกต้อง'); return String(v); };
  const startDate = day(b.startDate); const endDate = day(b.endDate);
  if (startDate && endDate && startDate > endDate) throw bad('dates_invalid', 'วันเริ่มต้องไม่เกินวันหมดอายุ');
  return { name, cost, cat: kind === 'coupon' ? 'coupon' : cat, type, value, min: Math.max(0, Number(b.min) || 0), days: Math.min(365, Math.max(1, parseInt(b.days, 10) || 30)), stock: optInt(b.stock),
    kind, templateId, description: String(b.description || '').trim().slice(0, 1000), imageId: b.imageId ? parseInt(b.imageId, 10) : null,
    tiers: tiers.length && tiers.length < TIERS.length ? tiers : null, limitCount, limitPeriod, startDate, endDate };
}
const TIERS = TIER_KEYS;
const PERIODS = ['day', 'week', 'month', 'year', 'all'];
// ของรางวัลแบบคูปอง: ต้องเป็นคูปองของแบรนด์เดียวกันที่สร้างในเมนูคูปอง (ไม่ใช่คูปองภายในของรางวัลอื่น)
async function couponForReward(db, brandId, templateId) {
  const t = await db.one("SELECT id FROM coupon_templates WHERE id = $1 AND brand_id = $2 AND kind <> 'internal' AND is_active", [templateId, brandId]);
  if (!t) throw bad('coupon_invalid', 'คูปองที่เลือกไม่มีแล้วหรือถูกปิดอยู่');
  return t.id;
}
const REWARD_COLS = 'name = $2, category = $3, points_cost = $4, stock = $5, is_active = COALESCE($6, is_active), coupon_template_id = $7, kind = $8, description = $9, image_id = $10, tiers = $11, limit_count = $12, limit_period = $13, start_date = $14, end_date = $15';
const rewardArgs = (f) => [f.name, f.cat, f.cost, f.stock];
const rewardExtra = (f) => [f.kind, f.description, f.imageId, f.tiers, f.limitCount, f.limitPeriod, f.startDate, f.endDate];
// รางวัลแบบของฟรี: คูปองลดเท่าราคาของชิ้นนั้น (value) · แบบส่วนลด: ลดตามที่ตั้ง
const rewardTemplate = (f) => f.cat === 'discount'
  ? { title: f.name, big: f.type === 'pct' ? '-' + f.value + '%' : '-' + f.value, small: f.type === 'pct' ? 'ส่วนลด' : 'บาท', cond: 'แลกด้วย ' + f.cost + ' แต้ม' + (f.min ? ' · ซื้อครบ ' + f.min + ' บาท' : ''), type: f.type, value: f.value, min: f.min, days: f.days }
  : { title: f.name, big: 'ฟรี', small: 'แลกแต้ม', cond: 'แลกด้วย ' + f.cost + ' แต้ม', type: 'baht', value: f.value, min: f.min, days: f.days };
async function newTemplate(db, brandId, t) {
  const big = t.big || (t.type === 'pct' ? '-' + t.value + '%' : '-' + t.value);
  const small = t.small || (t.type === 'pct' ? 'ส่วนลด' : 'บาท');
  return (await db.one(`INSERT INTO coupon_templates (brand_id, title, badge_big, badge_small, condition_text, discount_type, discount_value, min_spend, valid_days)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [brandId, t.title, big, small, t.cond || '', t.type, t.value, t.min || 0, t.days || 30])).id;
}

// กลุ่มเป้าหมายแคมเปญ: ต้องติดตาม OA ของแบรนด์ + ยินยอมรับข่าวสารของแบรนด์นั้นเสมอ
export function audienceSql(segment) {
  const base = `SELECT m.id, i.line_user_id FROM members m
    JOIN member_brand_links l ON l.member_id = m.id AND l.brand_id = $1 AND l.follow_status = 'follow' AND l.marketing_consent
    JOIN LATERAL (SELECT line_user_id FROM member_line_identities WHERE member_id = m.id ORDER BY linked_at DESC LIMIT 1) i ON true
    WHERE m.status = 'active'`;
  const seg = {
    all: '',
    new: " AND m.created_at > now() - interval '30 days'",
    gold: " AND (SELECT COALESCE(sum(points),0) FROM point_ledger p WHERE p.member_id = m.id AND p.brand_id = $1 AND p.points > 0 AND p.created_at > now() - interval '365 days') >= (SELECT gold_at FROM earn_rules WHERE brand_id = $1 AND effective_to IS NULL)",
    lapsed: " AND NOT EXISTS (SELECT 1 FROM sales_transactions s WHERE s.member_id = m.id AND s.brand_id = $1 AND s.status <> 'void' AND s.paid_at > now() - interval '30 days')",
    cross: " AND NOT EXISTS (SELECT 1 FROM sales_transactions s WHERE s.member_id = m.id AND s.brand_id = $1) AND EXISTS (SELECT 1 FROM sales_transactions s WHERE s.member_id = m.id AND s.brand_id <> $1)"
  }[segment];
  if (seg === undefined) throw bad('segment_invalid', 'ไม่รู้จักกลุ่มเป้าหมายนี้');
  return base + seg;
}

/* ---------------- สมาชิก: ขอบเขต แท็ก ---------------- */
// สมาชิกของแบรนด์ ($1) = สมัครที่แบรนด์นี้ หรือเคยผูก/มีแต้มกับแบรนด์นี้
const MEMBER_SCOPE = core.MEMBER_SCOPE;
const MEMBER_COLS = `m.id, m.full_name, m.phone, m.created_at, m.home_branch_id, m.birth_date,
  COALESCE((SELECT balance FROM wallets w WHERE w.member_id = m.id AND w.brand_id = $1), 0)::int AS points,
  COALESCE((SELECT sum(points) FROM point_ledger l WHERE l.member_id = m.id AND l.brand_id = $1 AND l.points > 0 AND l.entry_type <> 'merge' AND l.created_at > now() - interval '365 days'), 0)::int AS earned,
  (SELECT note FROM member_notes n WHERE n.member_id = m.id AND n.brand_id = $1) AS note,
  (SELECT picture_url FROM member_line_identities i WHERE i.member_id = m.id ORDER BY linked_at DESC LIMIT 1) AS picture,
  GREATEST((SELECT max(paid_at) FROM sales_transactions st WHERE st.member_id = m.id AND st.brand_id = $1),
           (SELECT max(created_at) FROM point_ledger l WHERE l.member_id = m.id AND l.brand_id = $1)) AS last_active`;
const BILLS = `sales_transactions st WHERE st.member_id = m.id AND st.brand_id = $1 AND st.status <> 'void'`;
const int = (v, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || 0));
// เงื่อนไข SQL ของแท็กอัตโนมัติ (ตัวเลขผ่าน int() แล้ว จึงใส่ใน SQL ตรงได้) · $1 = แบรนด์
function autoTagSql(rule) {
  const r = rule || {};
  if (r.type === 'new') return `m.created_at > now() - interval '${int(r.days, 1, 3650)} days'`;
  if (r.type === 'inactive') return `EXISTS (SELECT 1 FROM ${BILLS}) AND NOT EXISTS (SELECT 1 FROM ${BILLS} AND st.paid_at > now() - interval '${int(r.days, 1, 3650)} days')`;
  if (r.type === 'visits') return `(SELECT count(*) FROM ${BILLS} AND st.paid_at > now() - interval '${int(r.days, 1, 3650)} days') >= ${int(r.count, 1, 10000)}`;
  if (r.type === 'spend') return `(SELECT COALESCE(sum(st.total), 0) FROM ${BILLS} AND st.paid_at > now() - interval '${int(r.days, 1, 3650)} days') >= ${int(r.amount, 1, 100000000)}`;
  if (r.type === 'birthday') return `extract(month FROM m.birth_date) = extract(month FROM now() AT TIME ZONE 'Asia/Bangkok')`;
  if (r.type === 'no_line') return 'NOT EXISTS (SELECT 1 FROM member_line_identities i WHERE i.member_id = m.id)';
  return 'false';
}
const AUTO_TYPES = ['new', 'inactive', 'visits', 'spend', 'birthday', 'no_line'];
const TAG_COLORS = ['blue', 'green', 'orange', 'red', 'purple', 'gray'];
function tagFields(b) {
  const name = String(b.name || '').trim().slice(0, 40);
  if (!name) throw bad('tag_name_required', 'ใส่ชื่อแท็ก');
  const kind = b.kind === 'auto' ? 'auto' : 'manual';
  let rule = null;
  if (kind === 'auto') {
    const r = b.rule || {};
    if (!AUTO_TYPES.includes(r.type)) throw bad('tag_rule_invalid', 'เลือกเงื่อนไขของแท็กอัตโนมัติ');
    rule = { type: r.type };
    if (['new', 'inactive', 'visits', 'spend'].includes(r.type)) rule.days = int(r.days, 1, 3650) || 30;
    if (r.type === 'visits') rule.count = int(r.count, 1, 10000) || 1;
    if (r.type === 'spend') rule.amount = int(r.amount, 1, 100000000) || 1;
  }
  return { name, kind, rule, color: TAG_COLORS.includes(b.color) ? b.color : 'blue', description: String(b.description || '').trim().slice(0, 200) };
}
// เงื่อนไขกรองสมาชิกตามแท็ก (args = พารามิเตอร์ของคำสั่ง ใส่เพิ่มให้)
async function tagCond(brand, tagId, args, known) {
  const t = known || await one('SELECT * FROM tags WHERE id = $1 AND brand_id = $2', [tagId, brand]);
  if (!t) return 'false';
  if (t.kind === 'auto') return '(' + autoTagSql(t.rule) + ')';
  args.push(t.id); return `EXISTS (SELECT 1 FROM member_tags mt WHERE mt.member_id = m.id AND mt.tag_id = $${args.length})`;
}
// แท็กของสมาชิกหลายคน (ติดเอง + อัตโนมัติ) → { memberId: [{id,name,color,kind}] }
async function tagsOf(brand, ids) {
  const out = {}; if (!ids.length) return out;
  const tags = await q('SELECT id, name, color, kind, rule FROM tags WHERE brand_id = $1 ORDER BY kind DESC, name', [brand]);
  const add = (mid, t) => { (out[mid] = out[mid] || []).push({ id: t.id, name: t.name, color: t.color, kind: t.kind }); };
  const manual = await q('SELECT member_id, tag_id FROM member_tags WHERE member_id = ANY($1)', [ids]);
  for (const t of tags) {
    if (t.kind === 'manual') manual.filter((x) => x.tag_id === t.id).forEach((x) => add(x.member_id, t));
    else (await q(`SELECT m.id FROM members m WHERE m.id = ANY($2) AND ${autoTagSql(t.rule)}`, [brand, ids])).forEach((x) => add(x.id, t));
  }
  return out;
}
// ข้อมูลเฉพาะแบรนด์ในหน้ารายละเอียดสมาชิก
async function memberExtra(memberId, brand) {
  const row = await one(`SELECT ${MEMBER_COLS},
      COALESCE((SELECT sum(remaining) FROM point_lots p WHERE p.member_id = m.id AND p.brand_id = $1 AND p.remaining > 0 AND p.expires_at < now() + interval '30 days'), 0)::int AS expiring30,
      (SELECT count(*) FROM ${BILLS})::int AS visits, (SELECT COALESCE(sum(st.total), 0) FROM ${BILLS}) AS spend,
      EXISTS (SELECT 1 FROM member_line_identities i WHERE i.member_id = m.id) AS has_line
    FROM members m WHERE m.id = $2`, [brand, memberId]);
  return { extra: { ...row, phone: undefined, tags: (await tagsOf(brand, [memberId]))[memberId] || [] } };
}

export default function (r) {
  r.post('/api/admin/login', async (_req, body) => {
    const user = String(body.username || '').trim();
    // บัญชีเริ่มต้น admin: ถ้ายังไม่มี (เช่น server เปิดก่อนรัน migrate) สร้างให้ตอนนี้
    if (user.toLowerCase() === 'admin') await ensureDefaultAdmin();
    // ชื่อผู้ใช้/อีเมลไม่สนตัวพิมพ์เล็ก-ใหญ่ (มือถือมักขึ้นต้นตัวใหญ่ให้เอง)
    const s = await one('SELECT id, password_hash FROM staff WHERE (lower(id) = lower($1) OR lower(email) = lower($1)) AND is_active ORDER BY (id = $1) DESC LIMIT 1', [user]);
    if (!s || !checkPassword(String(body.password || ''), s.password_hash)) throw new HttpError(401, 'login_failed', 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
    const st = await loadStaff(s.id);
    if (!st.pages.length) throw new HttpError(403, 'forbidden', 'ตำแหน่งนี้ไม่มีสิทธิ์เข้าหลังบ้าน');
    await q('UPDATE staff SET last_login_at = now() WHERE id = $1', [s.id]);
    return { token: signToken({ sid: s.id }), staff: st };
  });
  r.get('/api/admin/me', async (req) => staffUser(req));
  // เปลี่ยนรหัสผ่านตัวเอง (บังคับครั้งแรกสำหรับรหัสเริ่มต้น/รหัสชั่วคราว)
  r.post('/api/admin/password', async (req, b) => {
    const s = await staffUser(req);
    const row = await one('SELECT password_hash FROM staff WHERE id = $1', [s.id]);
    if (!checkPassword(String(b.current || ''), row.password_hash)) throw bad('wrong_password', 'รหัสผ่านเดิมไม่ถูกต้อง');
    const pw = checkNewPassword(b.password, s.id);
    if (checkPassword(pw, row.password_hash)) throw bad('same_password', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');
    await tx(async (db) => {
      await db.q('UPDATE staff SET password_hash = $2, must_change_password = false WHERE id = $1', [s.id, hashPassword(pw)]);
      await core.audit(db, actor(s), 'change_password', { type: 'staff', id: s.id }, 'เปลี่ยนรหัสผ่านตัวเอง');
    });
    return { ok: true, staff: await loadStaff(s.id) };
  });

  r.get('/api/admin/dashboard', async (req, _b, url) => {
    const s = await staffUser(req); requirePage(s, 'dash');
    const bs = scopeBrands(s, url.searchParams.get('brand'));
    const k = await one(`
      WITH mem AS (SELECT DISTINCT member_id FROM point_ledger WHERE brand_id = ANY($1)),
           paid AS (SELECT * FROM sales_transactions WHERE brand_id = ANY($1) AND status IN ('paid','partial_refund')),
           buyers AS (SELECT member_id, count(*) n, max(paid_at) last FROM paid WHERE member_id IS NOT NULL GROUP BY member_id),
           brandsper AS (SELECT member_id, count(DISTINCT brand_id) nb FROM sales_transactions WHERE member_id IS NOT NULL AND status <> 'void' GROUP BY member_id)
      SELECT (SELECT count(*) FROM mem)::int AS total,
             (SELECT count(*) FROM members m JOIN mem ON mem.member_id = m.id WHERE m.created_at > now() - interval '30 days')::int AS new30,
             (SELECT count(*) FROM buyers WHERE last > now() - interval '30 days')::int AS active30,
             (SELECT count(*) FROM buyers)::int AS buyers,
             (SELECT count(*) FROM buyers WHERE n >= 2)::int AS repeaters,
             (SELECT count(*) FROM paid WHERE member_id IS NOT NULL)::int AS member_bills,
             (SELECT COALESCE(sum(total),0) FROM paid WHERE member_id IS NOT NULL) AS member_sales,
             (SELECT COALESCE(sum(total),0) FROM paid) AS all_sales,
             (SELECT count(*) FROM brandsper b JOIN mem ON mem.member_id = b.member_id WHERE nb > 1)::int AS cross_brand,
             (SELECT COALESCE(sum(points) FILTER (WHERE points > 0),0) FROM point_ledger WHERE brand_id = ANY($1)) AS issued,
             (SELECT COALESCE(-sum(points) FILTER (WHERE entry_type = 'redeem'),0) FROM point_ledger WHERE brand_id = ANY($1)) AS redeemed,
             (SELECT COALESCE(sum(balance),0) FROM wallets WHERE brand_id = ANY($1)) AS outstanding`, [bs]);
    const byBrand = await q(`SELECT b.id, (SELECT count(DISTINCT member_id) FROM point_ledger WHERE brand_id = b.id)::int AS members,
        (SELECT COALESCE(sum(total),0) FROM sales_transactions WHERE brand_id = b.id AND member_id IS NOT NULL AND status <> 'void') AS member_sales,
        (SELECT COALESCE(sum(total),0) FROM sales_transactions WHERE brand_id = b.id AND member_id IS NULL AND status <> 'void') AS other_sales
      FROM brands b WHERE b.id = ANY($1) ORDER BY b.id`, [bs]);
    const branches = await q(`SELECT br.id, br.name, br.pos_mode, br.pos_last_seen,
        (SELECT count(*) FROM members WHERE home_branch_id = br.id)::int AS home_members,
        count(s.*) FILTER (WHERE s.member_id IS NOT NULL)::int AS member_bills, count(s.*)::int AS bills,
        COALESCE(sum(s.total) FILTER (WHERE s.member_id IS NOT NULL),0) AS member_sales
      FROM branches br LEFT JOIN sales_transactions s ON s.branch_id = br.id AND s.status <> 'void'
      WHERE br.brand_id = ANY($1) ${s.branches ? 'AND br.id = ANY($2)' : ''} GROUP BY br.id ORDER BY br.id`, s.branches ? [bs, s.branches] : [bs]);
    return { kpi: k, byBrand, branches };
  });

  // รายชื่อสมาชิกของแบรนด์: ค้นหา + กรองระดับ/สาขาที่สมัคร/แท็ก + แบ่งหน้า · all=1 = ทั้งหมด (ดาวน์โหลด สูงสุด 5,000)
  r.get('/api/admin/members', async (req, _b, url) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const sp = url.searchParams; const brand = sp.get('brand');
    requireBrand(s, brand);
    const all = sp.get('all') === '1';
    const size = all ? 5000 : Math.min(100, Math.max(5, parseInt(sp.get('size'), 10) || 10));
    const page = all ? 1 : Math.max(1, parseInt(sp.get('page'), 10) || 1);
    const rule = await one('SELECT gold_at, platinum_at, diamond_at FROM earn_rules WHERE brand_id = $1 AND effective_to IS NULL', [brand]);
    const args = [brand]; const where = [];
    const term = String(sp.get('q') || '').trim();
    if (term) { args.push(term); where.push(`(m.id ILIKE '%' || $${args.length} || '%' OR m.full_name ILIKE '%' || $${args.length} || '%' OR m.phone LIKE '%' || $${args.length} || '%')`); }
    if (sp.get('branch')) { args.push(sp.get('branch')); where.push(`m.home_branch_id = $${args.length}`); }
    if (sp.get('tag')) where.push(await tagCond(brand, parseInt(sp.get('tag'), 10), args));
    const tier = sp.get('tier');
    const tierCond = TIER_KEYS.includes(tier) ? `${tierSql(rule, 'earned')} = '${tier}'` : 'true';
    const rows = await q(`WITH base AS (SELECT ${MEMBER_COLS} FROM members m WHERE m.status = 'active' AND ${MEMBER_SCOPE}${where.length ? ' AND ' + where.join(' AND ') : ''})
      SELECT *, ${tierSql(rule, 'earned')} AS tier, count(*) OVER()::int AS total FROM base WHERE ${tierCond} ORDER BY created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`, args);
    const tags = await tagsOf(brand, rows.map((r) => r.id));
    if (all) await core.audit({ q, one }, actor(s), 'export_members', { type: 'brand', id: brand }, 'ดาวน์โหลดรายชื่อสมาชิก ' + rows.length + ' คน');
    return { total: rows[0] ? rows[0].total : 0, page, size, rows: rows.map((m) => ({ ...m, total: undefined, phone: s.fullPii ? m.phone : maskPhone(m.phone),
      tags: tags[m.id] || [] })) };
  });
  // พนักงานเพิ่มสมาชิกเอง (ลูกค้ายินยอมที่ร้าน) · ได้แต้ม/คูปองต้อนรับเหมือนสมัครผ่าน LINE
  r.post('/api/admin/members', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'members'); requireBrand(s, b.brand);
    const name = String(b.name || '').trim().slice(0, 100); const phone = String(b.phone || '').replace(/\D/g, '');
    if (!name) throw bad('name_required', 'ใส่ชื่อ - นามสกุล');
    if (!/^0\d{8,9}$/.test(phone)) throw bad('phone_invalid', 'เบอร์โทรต้องเป็นตัวเลข 9-10 หลัก ขึ้นต้นด้วย 0');
    if (b.birthday && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.birthday))) throw bad('birthday_invalid', 'วันเกิดไม่ถูกต้อง');
    if (b.consent !== true) throw bad('consent_required', 'ต้องได้รับความยินยอมจากลูกค้าก่อนเพิ่มเป็นสมาชิก');
    if (b.branchId) await checkBranches(b.brand, [String(b.branchId)]);
    const res = await tx((db) => core.registerByStaff(db, { brandId: b.brand, name, phone, birthday: b.birthday || null, branchId: b.branchId || null, marketing: !!b.marketing, staff: s }));
    return { id: res.member.id, welcomePoints: res.welcomePoints };
  });

  // หมายเหตุสมาชิก (ต่อแบรนด์) · ว่าง = ลบ
  r.put('/api/admin/members/:id/note', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'members'); requireBrand(s, b.brand);
    const note = String(b.note || '').trim().slice(0, 500);
    if (!note) await q('DELETE FROM member_notes WHERE member_id = $1 AND brand_id = $2', [p.id, b.brand]);
    else await q(`INSERT INTO member_notes (member_id, brand_id, note, updated_by) VALUES ($1,$2,$3,$4)
      ON CONFLICT (member_id, brand_id) DO UPDATE SET note = EXCLUDED.note, updated_by = EXCLUDED.updated_by, updated_at = now()`, [p.id, b.brand, note, s.id]);
    return { note };
  });

  // แท็ก: รายการพร้อมจำนวนสมาชิก · สร้าง/แก้/ลบ · ติด/ถอดแท็กแบบพนักงานติดเอง
  r.get('/api/admin/tags', async (req, _b, url) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const brand = url.searchParams.get('brand'); requireBrand(s, brand);
    const list = await q('SELECT * FROM tags WHERE brand_id = $1 ORDER BY kind DESC, name', [brand]);
    for (const t of list) {
      const args = [brand];
      t.members = (await one(`SELECT count(*)::int AS n FROM members m WHERE m.status = 'active' AND ${MEMBER_SCOPE} AND ${await tagCond(brand, t.id, args, t)}`, args)).n;
    }
    return list;
  });
  r.post('/api/admin/tags', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'members'); requireBrand(s, b.brand);
    const f = tagFields(b);
    const dup = await one('SELECT id FROM tags WHERE brand_id = $1 AND lower(name) = lower($2)', [b.brand, f.name]);
    if (dup) throw conflict('tag_exists', 'มีแท็กชื่อนี้แล้ว');
    const t = await one('INSERT INTO tags (brand_id, name, color, kind, rule, description, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [b.brand, f.name, f.color, f.kind, f.rule, f.description, s.id]);
    await core.audit({ q, one }, actor(s), 'create_tag', { type: 'tag', id: String(t.id) }, b.brand + ' · ' + t.name);
    return t;
  });
  r.patch('/api/admin/tags/:id', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const t = await one('SELECT * FROM tags WHERE id = $1', [parseInt(p.id, 10)]); if (!t) throw notFound('ไม่พบแท็ก'); requireBrand(s, t.brand_id);
    const f = tagFields({ name: b.name ?? t.name, color: b.color ?? t.color, kind: t.kind, rule: b.rule ?? t.rule, description: b.description ?? t.description });
    const dup = await one('SELECT id FROM tags WHERE brand_id = $1 AND lower(name) = lower($2) AND id <> $3', [t.brand_id, f.name, t.id]);
    if (dup) throw conflict('tag_exists', 'มีแท็กชื่อนี้แล้ว');
    const out = await one('UPDATE tags SET name = $2, color = $3, rule = $4, description = $5 WHERE id = $1 RETURNING *', [t.id, f.name, f.color, f.rule, f.description]);
    await core.audit({ q, one }, actor(s), 'update_tag', { type: 'tag', id: String(t.id) }, out.name, t, out);
    return out;
  });
  r.del('/api/admin/tags/:id', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const t = await one('SELECT * FROM tags WHERE id = $1', [parseInt(p.id, 10)]); if (!t) throw notFound('ไม่พบแท็ก'); requireBrand(s, t.brand_id);
    await q('DELETE FROM tags WHERE id = $1', [t.id]);
    await core.audit({ q, one }, actor(s), 'delete_tag', { type: 'tag', id: String(t.id) }, t.name, t);
    return { deleted: true };
  });
  r.post('/api/admin/members/:id/tags', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const t = await one('SELECT * FROM tags WHERE id = $1', [parseInt(b.tagId, 10)]); if (!t) throw notFound('ไม่พบแท็ก'); requireBrand(s, t.brand_id);
    if (t.kind !== 'manual') throw bad('tag_auto', 'แท็กอัตโนมัติ ระบบติดให้เองตามเงื่อนไข');
    const m = await one("SELECT id FROM members WHERE id = $1 AND status = 'active'", [p.id]); if (!m) throw notFound('ไม่พบสมาชิก');
    await q('INSERT INTO member_tags (member_id, tag_id, added_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [m.id, t.id, s.id]);
    return { added: true };
  });
  r.del('/api/admin/members/:id/tags/:tag', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const t = await one('SELECT * FROM tags WHERE id = $1', [parseInt(p.tag, 10)]); if (!t) throw notFound('ไม่พบแท็ก'); requireBrand(s, t.brand_id);
    await q('DELETE FROM member_tags WHERE member_id = $1 AND tag_id = $2', [p.id, t.id]);
    return { removed: true };
  });

  r.get('/api/admin/members/:id', async (req, _b, url, p) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const brand = url.searchParams.get('brand'); if (brand) requireBrand(s, brand);
    const m = await one('SELECT * FROM members WHERE id = $1', [p.id]);
    if (!m) throw notFound('ไม่พบสมาชิก');
    const inScope = await one('SELECT 1 FROM point_ledger WHERE member_id = $1 AND brand_id = ANY($2) LIMIT 1', [m.id, s.brands]);
    if (!inScope) throw new HttpError(403, 'forbidden', 'สมาชิกนี้ไม่อยู่ในแบรนด์ที่คุณดูแล');
    return {
      member: { ...m, phone: s.fullPii ? m.phone : maskPhone(m.phone) },
      wallets: await core.walletsOf({ q, one }, m.id),
      links: await q('SELECT * FROM member_brand_links WHERE member_id = $1', [m.id]),
      ledger: await q('SELECT * FROM point_ledger WHERE member_id = $1 AND brand_id = ANY($2) ORDER BY id DESC LIMIT 50', [m.id, s.brands]),
      coupons: (await q(COUPON_SQL + ' WHERE c.member_id = $1 AND (c.brand_id = ANY($2) OR c.brand_id IS NULL) ORDER BY c.id DESC', [m.id, s.brands])).map(couponView),
      bills: await q('SELECT pos_bill_id, branch_id, brand_id, total, discount, points_earned, status, paid_at FROM sales_transactions WHERE member_id = $1 AND brand_id = ANY($2) ORDER BY paid_at DESC LIMIT 50', [m.id, s.brands]),
      ...(brand ? await memberExtra(m.id, brand) : {})
    };
  });

  r.get('/api/admin/point-adjustments', async (req) => {
    const s = await staffUser(req); requirePage(s, 'approvals');
    return q('SELECT r.*, st.name AS requested_by_name FROM point_adjust_requests r LEFT JOIN staff st ON st.id = r.requested_by WHERE r.brand_id = ANY($1) ORDER BY r.id DESC LIMIT 200', [s.brands]);
  });
  r.post('/api/admin/point-adjustments', async (req, body) => {
    const s = await staffUser(req); requirePage(s, 'members'); requireBrand(s, body.brand);
    const pts = parseInt(body.points, 10);
    if (!pts || !String(body.reason || '').trim()) throw bad('invalid', 'ใส่จำนวนแต้มและเหตุผล');
    const row = await tx((db) => core.requestAdjust(db, { memberId: body.memberId, brandId: body.brand, branchId: body.branchId || null, points: pts, reason: String(body.reason).trim(), by: s }));
    return { requestId: row.id };
  });
  r.post('/api/admin/point-adjustments/:id/:decision', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'approvals');
    if (!['approve', 'reject'].includes(p.decision)) throw notFound();
    const rq = await one('SELECT * FROM point_adjust_requests WHERE id = $1', [parseInt(p.id.replace(/\D/g, ''), 10)]);
    if (!rq) throw notFound('ไม่พบคำขอ');
    requireBrand(s, rq.brand_id);
    if (s.branches && rq.branch_id && !s.branches.includes(rq.branch_id)) throw new HttpError(403, 'forbidden', 'คำขอนี้ไม่ใช่สาขาของคุณ');
    const lim = s.role === 'branchmgr' ? (await one('SELECT max(approve_limit) AS l FROM staff_scopes WHERE staff_id = $1', [s.id])).l : null;
    if (lim !== null && lim !== undefined && Math.abs(rq.points) > lim) throw new HttpError(403, 'over_limit', 'เกินวงเงินอนุมัติของคุณ (' + lim + ' แต้ม)');
    return tx((db) => core.decideAdjust(db, { id: rq.id, approve: p.decision === 'approve', by: s }));
  });

  r.get('/api/admin/earn-rules', async (req) => {
    const s = await staffUser(req); requirePage(s, 'rules');
    return q(`SELECT e.*, b.points_notify, b.points_notify_min, b.review_points, b.oa_basic_id, b.require_follow FROM earn_rules e JOIN brands b ON b.id = e.brand_id
      WHERE e.effective_to IS NULL AND e.brand_id = ANY($1) ORDER BY e.brand_id`, [s.brands]);
  });
  // แก้กฎ = ปิดกฎเดิม (effective_to) แล้วเพิ่มกฎใหม่ · ย้อนดูได้ว่าบิลไหนใช้กฎไหน
  r.put('/api/admin/earn-rules/:brand', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rules'); requireBrand(s, p.brand);
    if (!(Number(b.baht) > 0) || !(Number(b.pts) >= 0)) throw bad('rule_invalid', 'อัตราแต้มไม่ถูกต้อง');
    const diamond = b.tiers?.diamond === '' || b.tiers?.diamond == null ? null : parseInt(b.tiers.diamond, 10);
    if (diamond !== null && !(diamond > (Number(b.tiers?.platinum) || 0))) throw bad('tier_invalid', 'แต้มระดับ Diamond ต้องมากกว่า Platinum (เว้นว่าง = ไม่ใช้ระดับ Diamond)');
    return tx(async (db) => {
      const old = await db.one('UPDATE earn_rules SET effective_to = now() WHERE brand_id = $1 AND effective_to IS NULL RETURNING *', [p.brand]);
      const nw = await db.one(`INSERT INTO earn_rules (brand_id, baht_per_unit, points_per_unit, base_amount, rounding, expiry_months, welcome_points, backdate_days, gold_at, platinum_at, promo_on, promo_mult, promo_day, created_by, diamond_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
        [p.brand, b.baht, b.pts, b.base || 'net', b.rounding || 'floor', b.expiryMonths ?? 12, b.welcome ?? 0, b.backdays ?? 3, b.tiers?.gold ?? 0, b.tiers?.platinum ?? 0, !!b.promo?.on, b.promo?.mult ?? 2, b.promo?.day ?? 3, s.id, diamond]);
      await core.audit(db, actor(s), 'update_earn_rule', { type: 'brand', id: p.brand }, nw.baht_per_unit + ' บาท = ' + nw.points_per_unit + ' แต้ม · หมดอายุ ' + nw.expiry_months + ' เดือน' + (nw.promo_on ? ' · คูณ ' + nw.promo_mult : ''), old, nw);
      return nw;
    });
  });

  // แจ้งแต้มทาง LINE หลังชำระบิล (ข้อความ push นับโควต้า LINE OA)
  r.patch('/api/admin/brands/:id/notify', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rules'); requireBrand(s, p.id);
    const mode = ['off', 'all', 'min'].includes(b.pointsNotify) ? b.pointsNotify : 'off';
    const min = Math.max(0, Number(b.pointsNotifyMin) || 0);
    if (mode === 'min' && !(min > 0)) throw bad('min_required', 'ใส่ยอดขั้นต่ำที่จะแจ้งเตือน');
    return tx(async (db) => {
      const old = await db.one('SELECT points_notify, points_notify_min FROM brands WHERE id = $1', [p.id]);
      const out = await db.one('UPDATE brands SET points_notify = $2, points_notify_min = $3 WHERE id = $1 RETURNING points_notify, points_notify_min', [p.id, mode, min]);
      await core.audit(db, actor(s), 'update_notify', { type: 'brand', id: p.id }, 'แจ้งแต้มทาง LINE: ' + ({ off: 'ไม่แจ้ง', all: 'ทุกบิล', min: 'บิลตั้งแต่ ' + min + ' บาท' }[mode]), old, out);
      return out;
    });
  });

  // แต้มรีวิวร้านในแชท LINE (ให้เฉพาะคนที่มีบิลวันนั้น) · 0 = ปิด
  r.patch('/api/admin/brands/:id/join', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rules'); requireBrand(s, p.id);
    let oa = String(b.oaBasicId || '').trim();
    if (oa && !oa.startsWith('@')) oa = '@' + oa;
    if (oa && !/^@[0-9a-z._-]{3,40}$/i.test(oa)) throw bad('oa_invalid', 'LINE OA ID ต้องเป็นรูปแบบ @xxxx');
    const req2 = !!b.requireFollow;
    return tx(async (db) => {
      const old = await db.one('SELECT oa_basic_id, require_follow FROM brands WHERE id = $1', [p.id]);
      if (!old) throw notFound('ไม่พบแบรนด์');
      if ((old.oa_basic_id || '') === oa && old.require_follow === req2) return old;
      const out = await db.one('UPDATE brands SET oa_basic_id = $2, require_follow = $3 WHERE id = $1 RETURNING oa_basic_id, require_follow', [p.id, oa || null, req2]);
      await core.audit(db, actor(s), 'update_join_rule', { type: 'brand', id: p.id }, 'สมัครสมาชิก: ' + (req2 ? 'ต้องเพิ่มเพื่อน ' + (oa || '(ยังไม่ใส่ OA)') : 'ไม่บังคับเพิ่มเพื่อน'), old, out);
      return out;
    });
  });
  r.patch('/api/admin/brands/:id/review', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rules'); requireBrand(s, p.id);
    const pts = Number(b.reviewPoints);
    if (!Number.isInteger(pts) || pts < 0 || pts > 1000) throw bad('review_points_invalid', 'แต้มรีวิวต้องเป็นจำนวนเต็ม 0 - 1000');
    return tx(async (db) => {
      const old = await db.one('SELECT review_points FROM brands WHERE id = $1', [p.id]);
      if (!old) throw notFound('ไม่พบแบรนด์');
      if (old.review_points === pts) return old;
      const out = await db.one('UPDATE brands SET review_points = $2 WHERE id = $1 RETURNING review_points', [p.id, pts]);
      await core.audit(db, actor(s), 'update_review_points', { type: 'brand', id: p.id }, 'แต้มรีวิวร้าน: ' + (pts ? pts + ' แต้ม' : 'ปิด'), old, out);
      return out;
    });
  });

  r.get('/api/admin/rewards', async (req) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    return q(`SELECT r.*, to_char(r.start_date, 'YYYY-MM-DD') AS start_day, to_char(r.end_date, 'YYYY-MM-DD') AS end_day,
      t.discount_type, t.discount_value, t.min_spend, t.valid_days, t.title AS coupon_title,
      (SELECT count(*) FROM point_ledger l WHERE l.entry_type = 'redeem' AND l.ref_type = 'reward' AND l.ref_id = r.id::text)::int AS redeemed
      FROM rewards r JOIN coupon_templates t ON t.id = r.coupon_template_id WHERE r.brand_id = ANY($1) ORDER BY r.brand_id, r.is_active DESC, r.points_cost`, [s.brands]);
  });
  r.post('/api/admin/rewards', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'rewards'); requireBrand(s, b.brand);
    const f = rewardFields(b);
    return tx(async (db) => {
      const t = f.kind === 'coupon' ? await couponForReward(db, b.brand, f.templateId) : await newTemplate(db, b.brand, rewardTemplate(f));
      const rw = await db.one(`INSERT INTO rewards (brand_id, name, category, points_cost, stock, is_active, coupon_template_id, kind, description, image_id, tiers, limit_count, limit_period, start_date, end_date)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`, [b.brand, ...rewardArgs(f), b.active !== false, t, ...rewardExtra(f)]);
      await core.audit(db, actor(s), 'create_reward', { type: 'reward', id: String(rw.id) }, b.brand + ' · ' + f.name + ' · ' + f.cost + ' แต้ม');
      return rw;
    });
  });
  // แก้รางวัล: ถ้าเปลี่ยนชื่อ/ส่วนลด จะสร้างแม่แบบคูปองใหม่ คูปองที่ลูกค้าแลกไปแล้วยังใช้ตามเงื่อนไขเดิม
  r.patch('/api/admin/rewards/:id', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const rw = await one(`SELECT r.*, to_char(r.start_date, 'YYYY-MM-DD') AS start_day, to_char(r.end_date, 'YYYY-MM-DD') AS end_day, t.discount_type, t.discount_value, t.min_spend, t.valid_days
      FROM rewards r JOIN coupon_templates t ON t.id = r.coupon_template_id WHERE r.id = $1`, [parseInt(p.id.replace(/\D/g, ''), 10)]);
    if (!rw) throw notFound(); requireBrand(s, rw.brand_id);
    const kept = (k, v) => (k in b ? b[k] : v);
    const f = rewardFields({
      name: b.name ?? rw.name, cat: b.cat ?? rw.category, cost: b.cost ?? rw.points_cost,
      value: b.value ?? rw.discount_value, type: b.type ?? rw.discount_type, min: b.min ?? rw.min_spend, days: b.days ?? rw.valid_days,
      stock: kept('stock', rw.stock), kind: b.kind ?? rw.kind, templateId: b.templateId ?? rw.coupon_template_id,
      description: kept('description', rw.description), imageId: kept('imageId', rw.image_id), tiers: kept('tiers', rw.tiers || undefined),
      limitCount: kept('limitCount', rw.limit_count), limitPeriod: b.limitPeriod ?? rw.limit_period,
      startDate: kept('startDate', rw.start_day), endDate: kept('endDate', rw.end_day)
    });
    return tx(async (db) => {
      let tpl;
      if (f.kind === 'coupon') tpl = await couponForReward(db, rw.brand_id, f.templateId);
      else {
        const changed = rw.kind !== 'general' || f.name !== rw.name || f.cat !== rw.category || f.value !== Number(rw.discount_value) || f.type !== rw.discount_type || f.min !== Number(rw.min_spend) || f.days !== rw.valid_days;
        tpl = changed ? await newTemplate(db, rw.brand_id, rewardTemplate(f)) : rw.coupon_template_id;
      }
      const out = await db.one('UPDATE rewards SET ' + REWARD_COLS + ' WHERE id = $1 RETURNING *', [rw.id, ...rewardArgs(f), b.active ?? null, tpl, ...rewardExtra(f)]);
      await core.audit(db, actor(s), 'update_reward', { type: 'reward', id: String(rw.id) }, out.name + ' · ' + out.points_cost + ' แต้ม' + (out.is_active ? '' : ' · ปิดแลก'), rw, out);
      return out;
    });
  });

  // จัดการคูปอง (ทุกประเภทที่ไม่ใช่แม่แบบภายในของรางวัล/แคมเปญ)
  const TPL_SQL = `SELECT t.*, to_char(t.sched_date, 'YYYY-MM-DD') AS sched_date, to_char(t.sched_time, 'HH24:MI') AS sched_time, p.code,
      (SELECT row_to_json(r) FROM (SELECT round_key, run_at, eligible, members, issued FROM coupon_rounds r WHERE r.template_id = t.id ORDER BY run_at DESC LIMIT 1) r) AS last_round, (SELECT count(*) FROM member_coupons c WHERE c.template_id = t.id)::int AS issued,
      (SELECT count(*) FROM member_coupons c WHERE c.template_id = t.id AND c.status = 'used')::int AS used
    FROM coupon_templates t LEFT JOIN promo_codes p ON p.coupon_template_id = t.id`;
  r.get('/api/admin/coupon-templates', async (req, _b, url) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const bs = scopeBrands(s, url.searchParams.get('brand'));
    const rows = await q(TPL_SQL + ` WHERE t.kind <> 'internal' AND (t.brand_id = ANY($1) OR (t.brand_id IS NULL AND $2)) ORDER BY t.is_active DESC, t.id DESC`, [bs, s.role === 'super']);
    return rows.map((t) => ({ ...t, next_round: t.auto_send ? (nextRound(t) || {}).at || null : null }));
  });
  // เมนูที่ POS ซิงก์มา (เลือกของฟรี/เงื่อนไขสินค้าในหน้าคูปอง)
  r.get('/api/admin/pos-menu', async (req, _b, url) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const brandId = url.searchParams.get('brand'); requireBrand(s, brandId);
    const b = await one('SELECT menu_synced_at FROM brands WHERE id = $1', [brandId]);
    const items = await q('SELECT item_id AS id, name, category, category_name, price::float AS price FROM pos_menu_items WHERE brand_id = $1 AND is_active ORDER BY category_name NULLS LAST, name', [brandId]);
    const cats = new Map(); for (const i of items) if (i.category && !cats.has(i.category)) cats.set(i.category, i.category_name || i.category);
    return { syncedAt: b ? b.menu_synced_at : null, items, categories: [...cats].map(([id, name]) => ({ id, name })) };
  });
  // ของขวัญส่งอัตโนมัติ: ตอนนี้ตรงเงื่อนไขกี่คน + รอบถัดไป (ใช้ในฟอร์มก่อนบันทึก)
  r.post('/api/admin/coupon-rounds/preview', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'rewards'); requireBrand(s, b.brand);
    const tierList = Array.isArray(b.tiers) ? TIER_KEYS.filter((x) => b.tiers.includes(x)) : [];
    const aud = await roundAudience({ q, one }, { brandId: b.brand, tiers: tierList.length < TIER_KEYS.length ? tierList : null, followersOnly: !!b.followersOnly, pick: 'points' });
    let sched = null; try { sched = schedFields('gift', { ...b, autoSend: true }); } catch (e) { /* ยังกรอกไม่ครบ */ }
    const nx = sched && nextRound({ sched_kind: sched.kind, sched_day: sched.day, sched_date: sched.date, sched_time: sched.time });
    const limit = sched && sched.limit;
    return { eligible: tierList.length ? aud.length : 0, members: tierList.length ? (limit ? Math.min(limit, aud.length) : aud.length) : 0, perMember: sched ? sched.perMember : 1, next: nx ? nx.at : null };
  });
  // ประวัติรอบส่งของคูปอง + ใช้ไปแล้วกี่ใบในแต่ละรอบ
  r.get('/api/admin/coupon-templates/:id/rounds', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const t = await one('SELECT brand_id FROM coupon_templates WHERE id = $1', [parseInt(p.id, 10)]);
    if (!t) throw notFound('ไม่พบคูปอง');
    if (t.brand_id) requireBrand(s, t.brand_id);
    return q(`SELECT r.round_key, r.due_at, r.run_at, r.eligible, r.members, r.issued,
        (SELECT count(*) FROM member_coupons c WHERE c.template_id = r.template_id AND c.source = 'gift' AND c.status = 'used'
          AND c.source_ref LIKE 'round:' || r.template_id || ':' || r.round_key || ':%')::int AS used
      FROM coupon_rounds r WHERE r.template_id = $1 ORDER BY r.run_at DESC LIMIT 24`, [parseInt(p.id, 10)]);
  });
  r.post('/api/admin/coupon-templates', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'rewards'); requireBrand(s, b.brand);
    const f = templateFields(b);
    return tx(async (db) => {
      const t = await db.one(`INSERT INTO coupon_templates (brand_id, kind, title, description, image_id, badge_big, badge_small, condition_text, discount_type, discount_value, max_discount, min_spend,
          validity, valid_from, valid_to, valid_days, issue_from, issue_to, audience_tier, followers_only, use_days, max_issue, is_active, created_by, branch_ids)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25) RETURNING *`,
        [b.brand, f.kind, f.title, f.description, f.imageId, f.big, f.small, f.cond, f.type, f.value, f.maxDiscount, f.min, f.validity, f.validFrom, f.validTo, f.days,
          f.issueFrom, f.issueTo, f.tier, f.followersOnly, f.useDays, f.maxIssue, f.active, s.id, await checkBranches(b.brand, f.branchIds)]);
      await saveCode(db, t, f, null);
      await saveAudience(db, t.id, f);
      await core.audit(db, actor(s), 'create_coupon', { type: 'coupon', id: String(t.id) }, b.brand + ' · ' + KIND_NAMES[f.kind] + ' · ' + f.title);
      return db.one(TPL_SQL + ' WHERE t.id = $1', [t.id]);
    });
  });
  r.patch('/api/admin/coupon-templates/:id', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const old = await one(TPL_SQL + " WHERE t.id = $1 AND t.kind <> 'internal'", [parseInt(p.id, 10)]);
    if (!old) throw notFound('ไม่พบคูปอง');
    if (old.brand_id) requireBrand(s, old.brand_id); else if (s.role !== 'super') throw new HttpError(403, 'forbidden', 'คูปองนี้ใช้ได้ทุกแบรนด์ แก้ได้เฉพาะผู้ดูแลระบบ');
    // แค่เปิด/ปิด
    const onlyToggle = Object.keys(b).length === 1 && 'active' in b;
    const f = onlyToggle ? null : templateFields(b);
    if (f && old.issued > 0) {
      // แจกไปแล้ว: ห้ามเปลี่ยนมูลค่า/เงื่อนไขที่ลูกค้าถืออยู่ ให้ปิดใบนี้แล้วสร้างใหม่แทน
      const same = f.kind === old.kind && f.type === old.discount_type && f.value === Number(old.discount_value) && f.min === Number(old.min_spend) && (f.maxDiscount ?? null) === (old.max_discount === null ? null : Number(old.max_discount)) && f.big === old.badge_big
        && JSON.stringify((f.items.free || []).map((x) => x.id)) === JSON.stringify((old.free_items || []).map((x) => x.id));
      if (!same) throw bad('coupon_locked', 'คูปองนี้แจกไปแล้ว ' + old.issued + ' ใบ เปลี่ยนประเภทหรือมูลค่าส่วนลดไม่ได้ ให้ปิดใบนี้แล้วสร้างใหม่');
      if ((f.code || null) !== (old.code || null)) throw bad('coupon_locked', 'คูปองนี้แจกไปแล้ว เปลี่ยนโค้ดไม่ได้');
      if (f.maxIssue && f.maxIssue < old.issued) throw bad('max_issue_low', 'จำนวนจำกัดต้องไม่น้อยกว่าที่แจกไปแล้ว (' + old.issued + ' ใบ)');
    }
    return tx(async (db) => {
      let t;
      if (onlyToggle) t = await db.one('UPDATE coupon_templates SET is_active = $2, updated_at = now() WHERE id = $1 RETURNING *', [old.id, !!b.active]);
      else {
        t = await db.one(`UPDATE coupon_templates SET kind = $2, title = $3, description = $4, image_id = $5, badge_big = $6, badge_small = $7, condition_text = $8, discount_type = $9, discount_value = $10,
            max_discount = $11, min_spend = $12, validity = $13, valid_from = $14, valid_to = $15, valid_days = $16, issue_from = $17, issue_to = $18, audience_tier = $19, followers_only = $20,
            use_days = $21, max_issue = $22, is_active = $23, branch_ids = $24, updated_at = now() WHERE id = $1 RETURNING *`,
          [old.id, f.kind, f.title, f.description, f.imageId, f.big, f.small, f.cond, f.type, f.value, f.maxDiscount, f.min, f.validity, f.validFrom, f.validTo, f.days,
            f.issueFrom, f.issueTo, f.tier, f.followersOnly, f.useDays, f.maxIssue, f.active, await checkBranches(old.brand_id, f.branchIds)]);
        await saveCode(db, t, f, old.code);
        await saveAudience(db, t.id, f);
        t = await db.one('SELECT * FROM coupon_templates WHERE id = $1', [t.id]);
      }
      // โค้ดหมดเขตตามช่วงแจกของคูปอง
      if (old.code && onlyToggle) await db.q('UPDATE promo_codes SET expires_at = $2 WHERE code = $1', [old.code, t.is_active ? t.issue_to : new Date()]);
      await core.audit(db, actor(s), 'update_coupon', { type: 'coupon', id: String(t.id) }, t.title + (t.is_active ? '' : ' · ปิดใช้งาน'), old, t);
      return t;
    });
  });
  // อัปโหลดรูปคูปอง: รับ data URL (หน้าเว็บย่อรูปให้ก่อนส่ง) ตรวจชนิดไฟล์จากเนื้อไฟล์จริง
  r.post('/api/admin/coupon-images', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const m = /^data:(image\/(?:png|jpeg|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
    if (!m) throw bad('image_invalid', 'รองรับเฉพาะรูป PNG, JPG, GIF หรือ WEBP');
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > 2 * 1024 * 1024) throw bad('image_too_large', 'รูปต้องไม่เกิน 2 MB');
    const sig = buf.subarray(0, 12).toString('hex');
    const real = sig.startsWith('89504e47') ? 'image/png' : sig.startsWith('ffd8ff') ? 'image/jpeg' : sig.startsWith('47494638') ? 'image/gif' : (sig.startsWith('52494646') && sig.slice(16, 24) === '57454250') ? 'image/webp' : null;
    if (!real) throw bad('image_invalid', 'ไฟล์ไม่ใช่รูปภาพ');
    const row = await one('INSERT INTO coupon_images (brand_id, mime, data, created_by) VALUES ($1,$2,$3,$4) RETURNING id', [b.brand || null, real, buf, s.id]);
    return { id: row.id, url: '/api/public/coupon-images/' + row.id };
  });
  // มอบคูปองให้สมาชิกรายคน (เมนูสมาชิก)
  r.post('/api/admin/members/:id/coupons', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'members');
    const t = await one('SELECT brand_id FROM coupon_templates WHERE id = $1', [parseInt(b.templateId, 10)]);
    if (!t) throw notFound('ไม่พบคูปอง');
    if (t.brand_id) requireBrand(s, t.brand_id);
    const c = await tx((db) => core.giftCoupon(db, { memberId: p.id, templateId: parseInt(b.templateId, 10), by: s }));
    return { couponId: String(c.id), code: c.code };
  });

  r.post('/api/admin/campaigns/preview', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'campaigns'); requireBrand(s, b.brand);
    const n = await one('SELECT count(*)::int AS n FROM (' + audienceSql(b.segment || 'all') + ') x', [b.brand]);
    const f = await one("SELECT count(*)::int AS n FROM member_brand_links WHERE brand_id = $1 AND follow_status = 'follow'", [b.brand]);
    return { recipients: n.n, followers: f.n };
  });
  r.get('/api/admin/campaigns', async (req) => {
    const s = await staffUser(req); requirePage(s, 'campaigns');
    return q('SELECT c.*, t.title AS coupon_title, st.name AS created_by_name FROM campaigns c LEFT JOIN coupon_templates t ON t.id = c.coupon_template_id LEFT JOIN staff st ON st.id = c.created_by WHERE c.brand_id = ANY($1) ORDER BY c.id DESC', [s.brands]);
  });
  r.post('/api/admin/campaigns', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'campaigns'); requireBrand(s, b.brand);
    if (!String(b.text || '').trim()) throw bad('text_required', 'ใส่ข้อความ');
    return tx(async (db) => {
      let tplId = null;
      if (b.coupon) {
        const v = Number(b.couponValue);
        if (!(v > 0)) throw bad('coupon_invalid', 'ใส่มูลค่าคูปอง');
        tplId = (await db.one(`INSERT INTO coupon_templates (brand_id, title, badge_big, badge_small, condition_text, discount_type, discount_value, valid_days)
          VALUES ($1,$2,$3,'บาท','จากแคมเปญ','baht',$4,14) RETURNING id`, [b.brand, b.couponTitle || 'ส่วนลด ' + v + ' บาท', '-' + v, v])).id;
      }
      const list = await db.q(audienceSql(b.segment || 'all'), [b.brand]);
      const c = await db.one('INSERT INTO campaigns (brand_id, segment, message_text, coupon_template_id, recipients, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [b.brand, b.segment || 'all', b.text, tplId, list.length, s.id]);
      for (const m of list) {
        await db.q('INSERT INTO campaign_recipients (campaign_id, member_id, line_user_id) VALUES ($1,$2,$3)', [c.id, m.id, m.line_user_id]);
        if (tplId) await core.issueCoupon(db, { memberId: m.id, templateId: tplId, source: 'campaign', sourceRef: c.id });
        await queueMessage(db, { brandId: b.brand, lineUserId: m.line_user_id, kind: 'broadcast', data: { text: b.text, coupon: tplId ? (b.couponTitle || null) : null, campaignId: c.id } });
      }
      await core.audit(db, actor(s), 'send_campaign', { type: 'campaign', id: String(c.id) }, b.brand + ' · ' + b.segment + ' · ' + list.length + ' คน');
      return { id: c.id, recipients: list.length };
    });
  }, (b, out) => 'ส่งถึง ' + (out?.recipients ?? 0) + ' คน');

  r.get('/api/admin/branches', async (req) => {
    const s = await staffUser(req);
    return q('SELECT * FROM branches WHERE brand_id = ANY($1) ORDER BY id', [s.brands]);
  });
  r.post('/api/admin/branches', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'branches'); requireBrand(s, b.brand);
    const id = String(b.id || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{2,10}$/.test(id)) throw bad('id_invalid', 'รหัสสาขาต้องเป็นตัวอังกฤษ/ตัวเลข 2-10 ตัว เช่น HL04');
    const f = branchFields(b);
    return tx(async (db) => {
      if (await db.one('SELECT 1 FROM branches WHERE id = $1', [id])) throw new HttpError(409, 'branch_exists', 'มีรหัสสาขานี้แล้ว');
      const out = await db.one('INSERT INTO branches (id, brand_id, name, phone, open_time, close_time, pos_mode, earn_enabled, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [id, b.brand, f.name, f.phone, f.open, f.close, f.posMode, f.earn, f.active]);
      await core.audit(db, actor(s), 'create_branch', { type: 'branch', id }, f.name);
      return out;
    });
  });
  r.patch('/api/admin/branches/:id', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'branches');
    const br = await one('SELECT * FROM branches WHERE id = $1', [p.id]);
    if (!br) throw notFound(); requireBrand(s, br.brand_id);
    // แค่สลับสะสมแต้ม (ปุ่มในตาราง) หรือแก้ทั้งหมด (ฟอร์ม)
    const f = Object.keys(b).length === 1 && 'earnEnabled' in b
      ? { name: br.name, phone: br.phone, open: br.open_time, close: br.close_time, posMode: br.pos_mode, earn: !!b.earnEnabled, active: br.is_active }
      : branchFields(b);
    return tx(async (db) => {
      const out = await db.one('UPDATE branches SET name = $2, phone = $3, open_time = $4, close_time = $5, pos_mode = $6, earn_enabled = $7, is_active = $8 WHERE id = $1 RETURNING *',
        [p.id, f.name, f.phone, f.open, f.close, f.posMode, f.earn, f.active]);
      await core.audit(db, actor(s), 'update_branch', { type: 'branch', id: p.id }, out.name + ' · สะสมแต้ม ' + (out.earn_enabled ? 'เปิด' : 'ปิด') + (out.is_active ? '' : ' · ปิดสาขา'), br, out);
      return out;
    });
  });
  // ลบสาขา: ได้เฉพาะสาขาที่ยังไม่มีบิล/แต้ม/สมาชิกประจำ (ประวัติการขายต้องเก็บไว้) ถ้ามีแล้วให้ "ปิดสาขา" แทน
  r.del('/api/admin/branches/:id', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'branches');
    const br = await one('SELECT * FROM branches WHERE id = $1', [p.id]);
    if (!br) throw notFound(); requireBrand(s, br.brand_id);
    const used = await one(`SELECT (SELECT count(*) FROM sales_transactions WHERE branch_id = $1)::int AS bills, (SELECT count(*) FROM point_ledger WHERE branch_id = $1)::int AS ledger,
      (SELECT count(*) FROM members WHERE home_branch_id = $1)::int AS members, (SELECT count(*) FROM member_coupons WHERE used_branch_id = $1)::int AS coupons,
      (SELECT count(*) FROM point_adjust_requests WHERE branch_id = $1)::int AS adjusts`, [p.id]);
    if (used.bills || used.ledger || used.members || used.coupons || used.adjusts) {
      throw new HttpError(409, 'branch_in_use', 'ลบไม่ได้ เพราะสาขานี้มีประวัติแล้ว (บิล ' + used.bills + ' · สมาชิกประจำ ' + used.members + ') ให้ใช้ "ปิดสาขา" แทน ข้อมูลเก่ายังอยู่ครบ');
    }
    return tx(async (db) => {
      await db.q('DELETE FROM pos_terminals WHERE branch_id = $1', [p.id]);
      await db.q("DELETE FROM staff_scopes WHERE scope_type = 'branch' AND scope_id = $1", [p.id]);
      await db.q("UPDATE coupon_templates SET branch_ids = NULLIF(array_remove(branch_ids, $1), '{}') WHERE $1 = ANY(branch_ids)", [p.id]);
      await db.q('DELETE FROM branches WHERE id = $1', [p.id]);
      await core.audit(db, actor(s), 'delete_branch', { type: 'branch', id: p.id }, br.name, br, null);
      return { deleted: p.id };
    });
  });

  // ลบสมาชิก (ตามคำขอลบข้อมูลส่วนบุคคล): ลบข้อมูลตัวตน แต้ม คูปอง ทั้งหมด · บิลขายยังเก็บไว้แต่ไม่ผูกกับสมาชิก
  r.del('/api/admin/members/:id', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'members');
    if (s.role !== 'super') throw new HttpError(403, 'forbidden', 'ลบสมาชิกได้เฉพาะผู้ดูแลระบบ');
    const m = await one('SELECT id, phone FROM members WHERE id = $1', [p.id]);
    if (!m) throw notFound('ไม่พบสมาชิก');
    return tx(async (db) => {
      const lines = (await db.q('SELECT line_user_id FROM member_line_identities WHERE member_id = $1', [m.id])).map((x) => x.line_user_id);
      const stat = await db.one(`SELECT (SELECT COALESCE(sum(balance),0) FROM wallets WHERE member_id = $1)::int AS points, (SELECT count(*) FROM sales_transactions WHERE member_id = $1)::int AS bills`, [m.id]);
      await db.q('DELETE FROM member_coupons WHERE member_id = $1', [m.id]);
      await db.q('DELETE FROM point_lots WHERE member_id = $1', [m.id]);
      await db.q('DELETE FROM point_ledger WHERE member_id = $1', [m.id]);
      await db.q('DELETE FROM wallets WHERE member_id = $1', [m.id]);
      await db.q('DELETE FROM point_adjust_requests WHERE member_id = $1', [m.id]);
      await db.q('DELETE FROM tax_invoice_requests WHERE member_id = $1', [m.id]);
      await db.q('DELETE FROM campaign_recipients WHERE member_id = $1', [m.id]);
      await db.q('DELETE FROM member_brand_links WHERE member_id = $1', [m.id]);
      await db.q('DELETE FROM member_line_identities WHERE member_id = $1', [m.id]);
      if (lines.length) await db.q('DELETE FROM line_messages WHERE line_user_id = ANY($1)', [lines]);
      if (m.phone) await db.q('DELETE FROM otp_requests WHERE phone = $1', [m.phone]);
      await db.q('UPDATE sales_transactions SET member_id = NULL WHERE member_id = $1', [m.id]);
      await db.q('UPDATE members SET merged_into = NULL WHERE merged_into = $1', [m.id]);
      await db.q('DELETE FROM members WHERE id = $1', [m.id]);
      // บันทึกเฉพาะเลขสมาชิก ไม่เก็บชื่อ/เบอร์ไว้ใน log
      await core.audit(db, actor(s), 'delete_member', { type: 'member', id: m.id }, 'ลบสมาชิก (แต้มคงเหลือ ' + stat.points + ' · บิล ' + stat.bills + ' ใบยังเก็บไว้แบบไม่ระบุตัวตน)');
      return { deleted: m.id };
    });
  });

  // ลบคูปอง: ลบใบที่แจกไปแล้วด้วย (ลูกค้าจะไม่เห็นอีก) · บิลที่เคยใช้คูปองยังเก็บยอดส่วนลดไว้
  r.del('/api/admin/coupon-templates/:id', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const t = await one("SELECT * FROM coupon_templates WHERE id = $1 AND kind <> 'internal'", [parseInt(p.id, 10)]);
    if (!t) throw notFound('ไม่พบคูปอง');
    if (t.brand_id) requireBrand(s, t.brand_id); else if (s.role !== 'super') throw new HttpError(403, 'forbidden', 'คูปองนี้ใช้ได้ทุกแบรนด์ ลบได้เฉพาะผู้ดูแลระบบ');
    return tx(async (db) => {
      const n = await db.one('SELECT count(*)::int AS n FROM member_coupons WHERE template_id = $1', [t.id]);
      await db.q('DELETE FROM member_coupons WHERE template_id = $1', [t.id]);
      await db.q('DELETE FROM promo_codes WHERE coupon_template_id = $1', [t.id]);
      await db.q('UPDATE brands SET welcome_template_id = NULL WHERE welcome_template_id = $1', [t.id]);
      await db.q('UPDATE campaigns SET coupon_template_id = NULL WHERE coupon_template_id = $1', [t.id]);
      if (await db.one('SELECT 1 FROM rewards WHERE coupon_template_id = $1', [t.id])) throw new HttpError(409, 'coupon_in_use', 'คูปองนี้ผูกกับของรางวัลอยู่ ลบของรางวัลก่อน');
      await db.q('DELETE FROM coupon_templates WHERE id = $1', [t.id]);
      if (t.image_id) await db.q('DELETE FROM coupon_images WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM coupon_templates WHERE image_id = $1)', [t.image_id]);
      await core.audit(db, actor(s), 'delete_coupon', { type: 'coupon', id: String(t.id) }, t.title + ' · ลบคูปองที่แจกไปแล้ว ' + n.n + ' ใบ', t, null);
      return { deleted: t.id, removedCoupons: n.n };
    });
  });

  // ลบของรางวัล: คูปองที่ลูกค้าแลกไปแล้วยังใช้ได้ตามเดิม
  r.del('/api/admin/rewards/:id', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'rewards');
    const rw = await one('SELECT * FROM rewards WHERE id = $1', [parseInt(p.id, 10)]);
    if (!rw) throw notFound(); requireBrand(s, rw.brand_id);
    return tx(async (db) => {
      await db.q('DELETE FROM rewards WHERE id = $1', [rw.id]);
      await core.audit(db, actor(s), 'delete_reward', { type: 'reward', id: String(rw.id) }, rw.name, rw, null);
      return { deleted: rw.id };
    });
  });

  r.get('/api/admin/staff', async (req) => {
    const s = await staffUser(req); requirePage(s, 'staff');
    const rows = await q(`SELECT st.id, st.name, st.role, st.email, st.is_active, st.must_change_password, st.last_login_at, st.created_at,
        COALESCE(json_agg(json_build_object('type', sc.scope_type, 'id', sc.scope_id, 'limit', sc.approve_limit)) FILTER (WHERE sc.staff_id IS NOT NULL), '[]') AS scopes
      FROM staff st LEFT JOIN staff_scopes sc ON sc.staff_id = st.id GROUP BY st.id ORDER BY st.is_active DESC, st.id`);
    return { staff: rows, roles: Object.keys(ROLE_PAGES).map((k) => ({ id: k, name: ROLE_NAMES[k], scope: ROLE_SCOPE[k], pages: ROLE_PAGES[k] })) };
  });
  r.post('/api/admin/staff', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'staff');
    const id = String(b.id || '').trim();
    if (!/^[A-Za-z0-9._-]{3,30}$/.test(id)) throw bad('id_invalid', 'ชื่อผู้ใช้ต้องเป็นตัวอังกฤษ/ตัวเลข 3-30 ตัว (ใช้ . _ - ได้)');
    const f = await staffFields(b);
    const pw = checkNewPassword(b.password, id);
    return tx(async (db) => {
      if (await db.one('SELECT 1 FROM staff WHERE lower(id) = lower($1)', [id])) throw new HttpError(409, 'staff_exists', 'มีชื่อผู้ใช้นี้แล้ว');
      if (f.email && await db.one('SELECT 1 FROM staff WHERE lower(email) = lower($1)', [f.email])) throw new HttpError(409, 'email_exists', 'อีเมลนี้มีผู้ใช้แล้ว');
      await db.q('INSERT INTO staff (id, name, role, email, password_hash, must_change_password) VALUES ($1,$2,$3,$4,$5,true)', [id, f.name, f.role, f.email, hashPassword(pw)]);
      await setScopes(db, id, f);
      await core.audit(db, actor(s), 'create_staff', { type: 'staff', id }, f.name + ' · ' + ROLE_NAMES[f.role] + ' · ' + f.scopeIds.join(', '));
      return { id };
    });
  });
  r.patch('/api/admin/staff/:id', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'staff');
    const old = await one('SELECT id, name, role, email, is_active FROM staff WHERE id = $1', [p.id]);
    if (!old) throw notFound('ไม่พบผู้ใช้');
    const f = await staffFields({ name: b.name ?? old.name, role: b.role ?? old.role, email: 'email' in b ? b.email : old.email, scopeIds: b.scopeIds, approveLimit: b.approveLimit }, !b.scopeIds);
    const active = b.active ?? old.is_active;
    if (old.id === s.id && (!active || f.role !== 'super')) throw bad('self_lock', 'ปิดหรือลดสิทธิ์บัญชีที่ตัวเองใช้อยู่ไม่ได้');
    return tx(async (db) => {
      if (old.role === 'super' && (f.role !== 'super' || !active)) {
        const n = await db.one("SELECT count(*)::int AS n FROM staff WHERE role = 'super' AND is_active AND id <> $1", [old.id]);
        if (!n.n) throw bad('last_admin', 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
      }
      if (f.email && await db.one('SELECT 1 FROM staff WHERE lower(email) = lower($1) AND id <> $2', [f.email, old.id])) throw new HttpError(409, 'email_exists', 'อีเมลนี้มีผู้ใช้แล้ว');
      await db.q('UPDATE staff SET name = $2, role = $3, email = $4, is_active = $5 WHERE id = $1', [old.id, f.name, f.role, f.email, active]);
      if (b.scopeIds || f.role !== old.role) await setScopes(db, old.id, f);
      await core.audit(db, actor(s), 'update_staff', { type: 'staff', id: old.id }, f.name + ' · ' + ROLE_NAMES[f.role] + (active ? '' : ' · ปิดใช้งาน'), old, { ...f, is_active: active });
      return { id: old.id };
    });
  });
  r.del('/api/admin/staff/:id', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'staff');
    const st = await one('SELECT id, name, role, is_active FROM staff WHERE id = $1', [p.id]);
    if (!st) throw notFound('ไม่พบผู้ใช้');
    if (st.id === s.id) throw bad('self_delete', 'ลบบัญชีที่ตัวเองใช้อยู่ไม่ได้');
    return tx(async (db) => {
      if (st.role === 'super' && st.is_active) {
        const n = await db.one("SELECT count(*)::int AS n FROM staff WHERE role = 'super' AND is_active AND id <> $1", [st.id]);
        if (!n.n) throw bad('last_admin', 'ต้องมีผู้ดูแลระบบที่ใช้งานได้อย่างน้อย 1 คน');
      }
      await db.q('DELETE FROM staff_scopes WHERE staff_id = $1', [st.id]);
      await db.q('DELETE FROM staff WHERE id = $1', [st.id]);
      // ประวัติการทำงาน (audit, คำขอปรับแต้ม) ยังอ้างชื่อผู้ใช้นี้ไว้ตามเดิม
      await core.audit(db, actor(s), 'delete_staff', { type: 'staff', id: st.id }, st.name + ' · ' + ROLE_NAMES[st.role]);
      return { deleted: st.id };
    });
  });
  // ตั้งรหัสผ่านชั่วคราวให้พนักงาน (เข้าครั้งถัดไปต้องเปลี่ยนเอง)
  r.post('/api/admin/staff/:id/password', async (req, b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'staff');
    const pw = checkNewPassword(b.password, p.id);
    return tx(async (db) => {
      const row = await db.one('UPDATE staff SET password_hash = $2, must_change_password = $3 WHERE id = $1 RETURNING id', [p.id, hashPassword(pw), p.id !== s.id]);
      if (!row) throw notFound('ไม่พบผู้ใช้');
      await core.audit(db, actor(s), 'reset_password', { type: 'staff', id: p.id }, 'ตั้งรหัสผ่านใหม่');
      return { ok: true };
    });
  });
  r.get('/api/admin/audit-logs', async (req) => {
    const s = await staffUser(req); requirePage(s, 'audit');
    return q('SELECT * FROM audit_logs ORDER BY id DESC LIMIT 300');
  });
  // ริชเมนู LINE: ประวัติเมนูของแบรนด์ + แบบช่อง/ปุ่มที่เลือกได้
  r.get('/api/admin/richmenus', async (req, _b, url) => {
    const s = await staffUser(req); requirePage(s, 'line');
    const brandId = url.searchParams.get('brand'); requireBrand(s, brandId);
    const b = await one('SELECT oa_basic_id FROM brands WHERE id = $1', [brandId]);
    if (!b) throw notFound('ไม่พบแบรนด์');
    // ดูเมนูที่ OA ใช้อยู่จริงใน LINE: ถ้าเป็นเมนูที่ระบบยังไม่รู้จัก (เช่นติดตั้งจากสคริปต์) ดึงมาเก็บเป็นเมนูปัจจุบัน
    // จุดกดไม่ตรงกับแบบของระบบ → แสดงรูปให้ดูอย่างเดียว · live = 'none' ไม่มีเมนูจาก API (อาจเป็นเมนูที่ตั้งใน OA Manager ซึ่ง LINE ไม่ให้ดึง)
    const token = process.env['LINE_' + brandId.toUpperCase() + '_TOKEN'];
    let live = token ? 'unknown' : 'no_token'; let liveView = null;
    if (token) {
      const act = await one('SELECT line_menu_id FROM rich_menus WHERE brand_id = $1 AND is_active', [brandId]);
      try {
        const lv = await rm.fetchLive(token, act && act.line_menu_id);
        if (!lv) live = 'none';
        else if (!lv.menu) live = 'synced';
        else {
          const m = rm.fromLine(lv.menu, brandId); const info = rm.imageInfo(lv.image);
          if (m && info) {
            await tx(async (db) => {
              await db.q('UPDATE rich_menus SET is_active = false, line_menu_id = null WHERE brand_id = $1 AND is_active', [brandId]);
              const row = await db.one(`INSERT INTO rich_menus (brand_id, layout, actions, chat_bar, mime, width, height, data, line_menu_id, is_active, created_by)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,'LINE') RETURNING id`, [brandId, m.layout, JSON.stringify(m.actions), m.chatBar, info.mime, info.width, info.height, lv.image, lv.richMenuId]);
              await core.audit(db, actor(s), 'import_richmenu', { type: 'brand', id: brandId }, 'ดึงริชเมนูที่ใช้อยู่ใน LINE มาเก็บ (#' + row.id + ')', null, { id: row.id, layout: m.layout });
            });
            live = 'synced';
          } else {
            live = 'other';
            liveView = { image: 'data:' + lv.mime + ';base64,' + lv.image.toString('base64'), width: lv.menu.size.width, height: lv.menu.size.height,
              areas: lv.menu.areas.map((a) => ({ bounds: [a.bounds.x, a.bounds.y, a.bounds.width, a.bounds.height], label: a.action.label || a.action.text || a.action.uri || a.action.type })) };
          }
        }
      } catch (e) { live = 'unknown'; }
    }
    const list = await q('SELECT ' + RM_COLS + ' FROM rich_menus WHERE brand_id = $1 ORDER BY is_active DESC, installed_at DESC LIMIT 20', [brandId]);
    return { oa: b.oa_basic_id, configured: !!token && !!process.env.LIFF_ID, live, liveView,
      layouts: rm.LAYOUTS, actions: rm.ACTIONS, defaults: rm.DEFAULT_ACTIONS, list: list.map((x) => ({ ...x, image: '/api/public/richmenu-images/' + x.id })) };
  });
  // ติดตั้งเมนูใหม่: รูปใหม่ (dataUrl) หรือใช้รูปของเมนูเดิม (fromId) แล้วเปลี่ยนแค่ปุ่ม
  r.post('/api/admin/richmenus', async (req, b) => {
    const s = await staffUser(req); requirePage(s, 'line'); requireBrand(s, b.brand);
    const m = (() => { try { return rm.checkMenu(b); } catch (e) { throw bad(e.code, e.message); } })();
    let image;
    if (b.fromId) {
      const src = await one('SELECT data FROM rich_menus WHERE id = $1 AND brand_id = $2', [parseInt(b.fromId, 10), b.brand]);
      if (!src) throw notFound('ไม่พบรูปของเมนูเดิม');
      image = Buffer.isBuffer(src.data) ? src.data : Buffer.from(String(src.data).replace(/^\\x/, ''), 'hex');
    } else {
      const d = /^data:image\/(?:png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(b.dataUrl || ''));
      if (!d) throw bad('richmenu_invalid', 'อัปโหลดรูปเมนู (JPG หรือ PNG)');
      image = Buffer.from(d[1], 'base64');
    }
    const info = (() => { try { return rm.checkImage(image, m.layout); } catch (e) { throw bad(e.code, e.message); } })();
    const res = await installRichMenu(b.brand, m, image, info.mime);
    return tx(async (db) => {
      await db.q('UPDATE rich_menus SET is_active = false, line_menu_id = null WHERE brand_id = $1 AND is_active', [b.brand]);
      const row = await db.one(`INSERT INTO rich_menus (brand_id, layout, actions, chat_bar, mime, width, height, data, line_menu_id, is_active, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) RETURNING ` + RM_COLS, [b.brand, m.layout, JSON.stringify(m.actions), m.chatBar, info.mime, info.width, info.height, image, res.richMenuId, s.id]);
      await core.audit(db, actor(s), 'install_richmenu', { type: 'brand', id: b.brand }, 'ติดตั้งริชเมนู ' + rm.LAYOUTS[m.layout].name + ' (#' + row.id + ')', null, { id: row.id, layout: m.layout, actions: m.actions, chatBar: m.chatBar });
      return row;
    });
  });
  // ย้อนกลับไปใช้เมนูเดิม: ติดตั้งรูปและปุ่มของเมนูนั้นให้ OA อีกครั้ง
  r.post('/api/admin/richmenus/:id/restore', async (req, _b, _u, p) => {
    const s = await staffUser(req); requirePage(s, 'line');
    const old = await one('SELECT * FROM rich_menus WHERE id = $1', [parseInt(p.id, 10)]);
    if (!old) throw notFound('ไม่พบเมนูนี้');
    requireBrand(s, old.brand_id);
    if (old.is_active) throw conflict('richmenu_active', 'เมนูนี้ใช้อยู่แล้ว');
    const image = Buffer.isBuffer(old.data) ? old.data : Buffer.from(String(old.data).replace(/^\\x/, ''), 'hex');
    const res = await installRichMenu(old.brand_id, { layout: old.layout, actions: old.actions, chatBar: old.chat_bar }, image, old.mime);
    return tx(async (db) => {
      await db.q('UPDATE rich_menus SET is_active = false, line_menu_id = null WHERE brand_id = $1 AND is_active', [old.brand_id]);
      const row = await db.one('UPDATE rich_menus SET is_active = true, line_menu_id = $2, installed_at = now() WHERE id = $1 RETURNING ' + RM_COLS, [old.id, res.richMenuId]);
      await core.audit(db, actor(s), 'restore_richmenu', { type: 'brand', id: old.brand_id }, 'ย้อนกลับไปใช้ริชเมนู #' + old.id, null, { id: old.id });
      return row;
    });
  });
  r.get('/api/admin/line-channels', async (req) => {
    const s = await staffUser(req); requirePage(s, 'line');
    const rows = await q(`SELECT b.id, b.name, b.oa_basic_id, c.channel_id,
        (SELECT count(*) FROM line_followers f WHERE f.brand_id = b.id AND f.status = 'follow')::int AS followers,
        (SELECT count(*) FROM line_followers f WHERE f.brand_id = b.id AND f.status = 'blocked')::int AS blocked,
        (SELECT count(*) FROM line_messages m WHERE m.brand_id = b.id AND m.direction = 'out' AND m.created_at > date_trunc('month', now()))::int AS sent_this_month
      FROM brands b LEFT JOIN line_channels c ON c.brand_id = b.id WHERE b.id = ANY($1) ORDER BY b.id`, [s.brands]);
    return rows.map((x) => ({ ...x, configured: !!process.env['LINE_' + x.id.toUpperCase() + '_TOKEN'] }));
  });
}
