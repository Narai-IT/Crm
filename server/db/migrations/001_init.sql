-- Group CRM · PostgreSQL 14+
-- แบบ C: แยก LINE OA ตามแบรนด์ · 1 คน = 1 Member ID · แต้มแยกกระเป๋าตามแบรนด์
CREATE SCHEMA IF NOT EXISTS crm;
SET search_path = crm, public;

-- ---------- องค์กร ----------
CREATE TABLE brands (
  id            text PRIMARY KEY,                       -- narai / wakame / humlai
  name          text NOT NULL,
  short_name    text NOT NULL,
  kind          text,
  code_prefix   char(2) NOT NULL UNIQUE,                -- NR / WK / HL
  theme_color   char(7) NOT NULL,
  soft_color    char(7) NOT NULL,
  ink_color     char(7) NOT NULL,
  initial       text NOT NULL,
  oa_basic_id   text,                                   -- @xxxx
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE branches (
  id            text PRIMARY KEY,                       -- HL01
  brand_id      text NOT NULL REFERENCES brands(id),
  name          text NOT NULL,
  phone         text,
  open_time     time,
  close_time    time,
  pos_mode      text NOT NULL DEFAULT 'api' CHECK (pos_mode IN ('api','manual')),
  pos_last_seen timestamptz,
  earn_enabled  boolean NOT NULL DEFAULT true,
  is_active     boolean NOT NULL DEFAULT true
);
CREATE INDEX ON branches(brand_id);

-- 1 แถวต่อ 1 OA · secret/token อยู่ใน env (LINE_<BRAND>_SECRET / _TOKEN) ไม่เก็บใน DB
CREATE TABLE line_channels (
  brand_id      text PRIMARY KEY REFERENCES brands(id),
  channel_id    text,
  bot_user_id   text UNIQUE,                            -- "destination" ใน webhook
  rich_menu_id  text,
  monthly_quota int
);

-- ---------- สมาชิก ----------
CREATE SEQUENCE member_no START 12846;

CREATE TABLE members (
  id                  text PRIMARY KEY,                 -- MB-0012846 ใช้ได้ทุกแบรนด์
  full_name           text NOT NULL,
  phone               text NOT NULL,
  phone_verified_at   timestamptz,
  birth_date          date,
  home_branch_id      text REFERENCES branches(id),
  joined_brand_id     text NOT NULL REFERENCES brands(id),
  status              text NOT NULL DEFAULT 'active' CHECK (status IN ('active','merged','closed')),
  merged_into         text REFERENCES members(id),
  privacy_accepted_at timestamptz NOT NULL,
  privacy_version     text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX members_phone_active ON members(phone) WHERE status = 'active';

-- LINE userId เดียวกันทุก OA (OA + LINE Login อยู่ Provider เดียว)
CREATE TABLE member_line_identities (
  line_user_id  text PRIMARY KEY,
  member_id     text NOT NULL REFERENCES members(id),
  display_name  text,
  picture_url   text,
  linked_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON member_line_identities(member_id);

-- สถานะต่อแบรนด์: เพื่อน OA + ความยินยอมการตลาด (PDPA แยกรายแบรนด์)
CREATE TABLE member_brand_links (
  member_id          text NOT NULL REFERENCES members(id),
  brand_id           text NOT NULL REFERENCES brands(id),
  follow_status      text NOT NULL DEFAULT 'none' CHECK (follow_status IN ('none','follow','blocked')),
  follow_changed_at  timestamptz,
  marketing_consent  boolean NOT NULL DEFAULT false,
  consent_changed_at timestamptz,
  PRIMARY KEY (member_id, brand_id)
);

-- คนที่แอด OA แล้ว (รวมคนที่ยังไม่สมัคร) จาก follow/unfollow event
CREATE TABLE line_followers (
  line_user_id  text NOT NULL,
  brand_id      text NOT NULL REFERENCES brands(id),
  status        text NOT NULL CHECK (status IN ('follow','blocked')),
  display_name  text,
  changed_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (line_user_id, brand_id)
);

CREATE TABLE otp_requests (
  id            bigserial PRIMARY KEY,
  phone         text NOT NULL,
  line_user_id  text,
  code_hash     text NOT NULL,
  expires_at    timestamptz NOT NULL,
  attempts      int NOT NULL DEFAULT 0,
  verified_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON otp_requests(phone, created_at DESC);

-- ---------- กฎแต้ม (เก็บประวัติ ไม่แก้ทับ) ----------
CREATE TABLE earn_rules (
  id              serial PRIMARY KEY,
  brand_id        text NOT NULL REFERENCES brands(id),
  baht_per_unit   numeric(10,2) NOT NULL CHECK (baht_per_unit > 0),
  points_per_unit int NOT NULL CHECK (points_per_unit >= 0),
  base_amount     text NOT NULL DEFAULT 'net' CHECK (base_amount IN ('net','exvat','gross')),
  rounding        text NOT NULL DEFAULT 'floor' CHECK (rounding IN ('floor','round')),
  expiry_months   int NOT NULL DEFAULT 12,               -- 0 = ไม่หมดอายุ
  welcome_points  int NOT NULL DEFAULT 0,
  backdate_days   int NOT NULL DEFAULT 3,
  gold_at         int NOT NULL,
  platinum_at     int NOT NULL,
  promo_on        boolean NOT NULL DEFAULT false,        -- คูณแต้มตามวัน
  promo_mult      numeric(4,2) NOT NULL DEFAULT 2,
  promo_day       int NOT NULL DEFAULT 3 CHECK (promo_day BETWEEN 0 AND 6),
  effective_from  timestamptz NOT NULL DEFAULT now(),
  effective_to    timestamptz,
  created_by      text NOT NULL
);
CREATE UNIQUE INDEX earn_rules_current ON earn_rules(brand_id) WHERE effective_to IS NULL;

-- ---------- ธุรกรรมจาก POS ----------
CREATE TABLE sales_transactions (
  id            bigserial PRIMARY KEY,
  pos_bill_id   text NOT NULL,
  branch_id     text NOT NULL REFERENCES branches(id),
  brand_id      text NOT NULL REFERENCES brands(id),
  member_id     text REFERENCES members(id),
  channel       text NOT NULL CHECK (channel IN ('pos','kiosk','liff','manual')),
  subtotal      numeric(12,2) NOT NULL,
  discount      numeric(12,2) NOT NULL DEFAULT 0,
  total         numeric(12,2) NOT NULL,
  points_earned int NOT NULL DEFAULT 0,
  rule_id       int REFERENCES earn_rules(id),
  status        text NOT NULL DEFAULT 'paid' CHECK (status IN ('paid','partial_refund','refunded','void')),
  paid_at       timestamptz NOT NULL DEFAULT now(),
  staff_id      text,
  items         jsonb NOT NULL DEFAULT '[]',
  UNIQUE (branch_id, pos_bill_id)                       -- กันบิลซ้ำ
);
CREATE INDEX ON sales_transactions(member_id, paid_at DESC) WHERE member_id IS NOT NULL;
CREATE INDEX ON sales_transactions(branch_id, paid_at DESC);
CREATE INDEX ON sales_transactions(brand_id, paid_at DESC);

CREATE TABLE refunds (
  id              bigserial PRIMARY KEY,
  txn_id          bigint NOT NULL REFERENCES sales_transactions(id),
  pos_refund_id   text NOT NULL UNIQUE,
  amount          numeric(12,2) NOT NULL,
  points_reversed int NOT NULL,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------- แต้ม: wallet + ledger + lots ----------
CREATE TABLE wallets (
  member_id  text NOT NULL REFERENCES members(id),
  brand_id   text NOT NULL REFERENCES brands(id),
  balance    int NOT NULL DEFAULT 0 CHECK (balance >= 0),   -- แต้มห้ามติดลบ
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, brand_id)
);

CREATE TABLE point_ledger (
  id              bigserial PRIMARY KEY,
  member_id       text NOT NULL,
  brand_id        text NOT NULL,
  branch_id       text REFERENCES branches(id),
  entry_type      text NOT NULL CHECK (entry_type IN ('earn','welcome','bonus','redeem','refund','adjust','expire','merge')),
  points          int NOT NULL,
  balance_after   int NOT NULL,
  ref_type        text,
  ref_id          text,
  idempotency_key text NOT NULL UNIQUE,
  note            text,
  actor_type      text NOT NULL,                         -- system / pos / staff / member / line
  actor_id        text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (member_id, brand_id) REFERENCES wallets(member_id, brand_id)
);
CREATE INDEX ON point_ledger(member_id, brand_id, created_at DESC);
CREATE INDEX ON point_ledger(brand_id, created_at DESC);

CREATE TABLE point_lots (                                -- ตัดแต้มเก่าก่อน (FIFO ตามวันหมดอายุ)
  id               bigserial PRIMARY KEY,
  member_id        text NOT NULL,
  brand_id         text NOT NULL,
  source_ledger_id bigint NOT NULL REFERENCES point_ledger(id),
  points           int NOT NULL,
  remaining        int NOT NULL CHECK (remaining >= 0),
  expires_at       timestamptz
);
CREATE INDEX point_lots_open ON point_lots(member_id, brand_id, expires_at) WHERE remaining > 0;

CREATE TABLE point_adjust_requests (
  id             serial PRIMARY KEY,
  member_id      text NOT NULL REFERENCES members(id),
  brand_id       text NOT NULL REFERENCES brands(id),
  branch_id      text REFERENCES branches(id),
  points         int NOT NULL CHECK (points <> 0),
  reason         text NOT NULL,
  ref_pos_bill_id text,
  requested_by   text NOT NULL,
  status         text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  decided_by     text,
  decided_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (decided_by IS NULL OR decided_by <> requested_by)  -- ผู้ขอกับผู้อนุมัติต้องคนละคน
);

-- ---------- รางวัล / คูปอง ----------
CREATE TABLE coupon_templates (
  id             serial PRIMARY KEY,
  brand_id       text REFERENCES brands(id),             -- NULL = ใช้ได้ทุกแบรนด์
  title          text NOT NULL,
  badge_big      text NOT NULL,
  badge_small    text NOT NULL,
  condition_text text NOT NULL DEFAULT '',
  discount_type  text NOT NULL CHECK (discount_type IN ('baht','pct')),
  discount_value numeric(10,2) NOT NULL,
  min_spend      numeric(10,2) NOT NULL DEFAULT 0,
  valid_days     int NOT NULL DEFAULT 30
);

CREATE TABLE rewards (
  id                 serial PRIMARY KEY,
  brand_id           text NOT NULL REFERENCES brands(id),
  name               text NOT NULL,
  category           text NOT NULL,
  points_cost        int NOT NULL CHECK (points_cost > 0),
  coupon_template_id int NOT NULL REFERENCES coupon_templates(id),
  stock              int,                                -- NULL = ไม่จำกัด
  is_active          boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE promo_codes (                               -- โค้ดที่ลูกค้ากรอกเองในหน้าคูปอง
  code               text PRIMARY KEY,
  brand_id           text REFERENCES brands(id),
  coupon_template_id int NOT NULL REFERENCES coupon_templates(id),
  max_uses           int,
  used_count         int NOT NULL DEFAULT 0,
  expires_at         timestamptz
);

CREATE TABLE member_coupons (
  id              bigserial PRIMARY KEY,
  code            text NOT NULL UNIQUE,                  -- HL-7JCQ
  template_id     int NOT NULL REFERENCES coupon_templates(id),
  member_id       text NOT NULL REFERENCES members(id),
  brand_id        text REFERENCES brands(id),
  source          text NOT NULL CHECK (source IN ('welcome','redeem','campaign','code','birthday','manual')),
  source_ref      text,
  status          text NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','used','expired','void')),
  issued_at       timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz,
  used_txn_id     bigint REFERENCES sales_transactions(id),
  used_branch_id  text REFERENCES branches(id),
  used_by         text,
  UNIQUE (member_id, source, source_ref)                 -- กันออกคูปองซ้ำจากเหตุการณ์เดียวกัน
);
CREATE INDEX ON member_coupons(member_id, status, expires_at);

-- ---------- การตลาด / LINE ----------
CREATE TABLE campaigns (
  id                 serial PRIMARY KEY,
  brand_id           text NOT NULL REFERENCES brands(id),
  segment            text NOT NULL,
  message_text       text NOT NULL,
  coupon_template_id int REFERENCES coupon_templates(id),
  status             text NOT NULL DEFAULT 'sent' CHECK (status IN ('draft','scheduled','sending','sent','failed')),
  recipients         int NOT NULL DEFAULT 0,
  created_by         text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE campaign_recipients (
  campaign_id  int NOT NULL REFERENCES campaigns(id),
  member_id    text NOT NULL REFERENCES members(id),
  line_user_id text,
  PRIMARY KEY (campaign_id, member_id)
);

-- ประวัติข้อความเข้า/ออกของแต่ละ OA (ใช้ตอบลูกค้า และตรวจย้อนหลัง)
CREATE TABLE line_messages (
  id           bigserial PRIMARY KEY,
  brand_id     text NOT NULL REFERENCES brands(id),
  line_user_id text NOT NULL,
  direction    text NOT NULL CHECK (direction IN ('in','out')),
  kind         text NOT NULL,                            -- text / welcome / points / promo / branches / broadcast
  data         jsonb NOT NULL DEFAULT '{}',
  status       text NOT NULL DEFAULT 'done' CHECK (status IN ('queued','done','failed','skipped')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON line_messages(line_user_id, brand_id, id);

CREATE TABLE webhook_events (                            -- กัน LINE ส่ง event ซ้ำ
  webhook_event_id text PRIMARY KEY,
  brand_id         text NOT NULL,
  event_type       text NOT NULL,
  payload          jsonb NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE outbox (                                    -- งานส่งออก หลัง commit เท่านั้น
  id              bigserial PRIMARY KEY,
  kind            text NOT NULL,                         -- line_push / line_reply / sms_otp
  brand_id        text,
  payload         jsonb NOT NULL,
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  done_at         timestamptz
);
CREATE INDEX outbox_pending ON outbox(next_attempt_at) WHERE done_at IS NULL;

CREATE TABLE tax_invoice_requests (
  id          serial PRIMARY KEY,
  member_id   text NOT NULL REFERENCES members(id),
  txn_id      bigint NOT NULL REFERENCES sales_transactions(id),
  status      text NOT NULL DEFAULT 'pending',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------- ผู้ใช้หลังบ้าน / เครื่อง POS / ตรวจสอบ ----------
CREATE TABLE staff (
  id            text PRIMARY KEY,
  name          text NOT NULL,
  email         text UNIQUE,
  role          text NOT NULL CHECK (role IN ('super','marketing','brand','branchmgr','cashier')),
  password_hash text,                                    -- scrypt
  is_active     boolean NOT NULL DEFAULT true
);
CREATE TABLE staff_scopes (
  staff_id      text NOT NULL REFERENCES staff(id),
  scope_type    text NOT NULL CHECK (scope_type IN ('group','brand','branch')),
  scope_id      text NOT NULL DEFAULT '*',
  approve_limit int,
  PRIMARY KEY (staff_id, scope_type, scope_id)
);
CREATE TABLE pos_terminals (
  id           text PRIMARY KEY,
  branch_id    text NOT NULL REFERENCES branches(id),
  kind         text NOT NULL CHECK (kind IN ('pos','kiosk')),
  api_key_hash text NOT NULL UNIQUE,                     -- sha256 ของ API key
  last_seen_at timestamptz
);

CREATE TABLE audit_logs (                                -- append-only
  id          bigserial PRIMARY KEY,
  at          timestamptz NOT NULL DEFAULT now(),
  actor_type  text NOT NULL,
  actor_id    text,
  actor_name  text,
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  detail      text,
  before_json jsonb,
  after_json  jsonb
);
CREATE OR REPLACE FUNCTION audit_logs_readonly() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'audit_logs is append-only'; END $$;
CREATE TRIGGER audit_logs_no_update BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_logs_readonly();

-- คูปองต้อนรับของแต่ละแบรนด์ (สร้างตาราง coupon_templates ก่อนจึงอ้างได้)
ALTER TABLE brands ADD COLUMN welcome_template_id int REFERENCES coupon_templates(id);

