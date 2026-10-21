-- ริชเมนู LINE ที่ติดตั้งจากหลังบ้าน · เก็บรูปและปุ่มไว้ เพื่อย้อนกลับไปใช้เมนูเดิมได้
CREATE TABLE rich_menus (
  id            serial PRIMARY KEY,
  brand_id      text NOT NULL REFERENCES brands(id),
  layout        text NOT NULL,
  actions       jsonb NOT NULL,                       -- [{kind, value}] ตามลำดับช่อง A, B, C…
  chat_bar      text NOT NULL,
  mime          text NOT NULL,
  width         int NOT NULL,
  height        int NOT NULL,
  data          bytea NOT NULL,
  line_menu_id  text,                                 -- id ล่าสุดที่ LINE ใช้อยู่ (null = ไม่ได้ใช้แล้ว)
  is_active     boolean NOT NULL DEFAULT false,
  created_by    text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  installed_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON rich_menus (brand_id, created_at DESC);
CREATE UNIQUE INDEX rich_menus_one_active ON rich_menus (brand_id) WHERE is_active;
