-- แท็กสมาชิก (ไว้แบ่งกลุ่ม/ทำข้อมูล) และหมายเหตุ · แยกตามแบรนด์
--   kind manual = พนักงานติดเอง · auto = ระบบคำนวณจากเงื่อนไขใน rule ทุกครั้งที่ดู (ไม่เก็บรายชื่อ)
--   rule (auto): {"type":"new","days":30} สมัครภายใน N วัน · {"type":"inactive","days":60} เคยซื้อแต่ไม่มา N วัน
--                {"type":"visits","count":4,"days":30} มาซื้อ ≥ N บิลใน D วัน · {"type":"spend","amount":2000,"days":90} ยอดซื้อ ≥ X บาทใน D วัน
--                {"type":"birthday"} เกิดเดือนนี้ · {"type":"no_line"} ยังไม่ผูก LINE (พนักงานเพิ่มให้)
CREATE TABLE tags (
  id          serial PRIMARY KEY,
  brand_id    text NOT NULL REFERENCES brands(id),
  name        text NOT NULL,
  color       text NOT NULL DEFAULT 'blue' CHECK (color IN ('blue','green','orange','red','purple','gray')),
  kind        text NOT NULL DEFAULT 'manual' CHECK (kind IN ('manual','auto')),
  rule        jsonb,
  description text NOT NULL DEFAULT '',
  created_by  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX tags_brand_name ON tags(brand_id, lower(name));

CREATE TABLE member_tags (
  member_id text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  tag_id    int NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  added_by  text,
  added_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, tag_id)
);
CREATE INDEX ON member_tags(tag_id);

CREATE TABLE member_notes (
  member_id  text NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  brand_id   text NOT NULL REFERENCES brands(id),
  note       text NOT NULL,
  updated_by text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, brand_id)
);
