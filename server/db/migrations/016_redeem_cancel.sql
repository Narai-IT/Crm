-- ยกเลิกการแลกแต้ม: จดว่าการตัดแต้มแต่ละครั้งใช้แต้มจากก้อนไหน เพื่อคืนเข้าก้อนเดิม (วันหมดอายุเดิม)
CREATE TABLE point_lot_uses (
  ledger_id bigint NOT NULL REFERENCES point_ledger(id),
  lot_id    bigint NOT NULL REFERENCES point_lots(id),
  points    int NOT NULL CHECK (points > 0),
  PRIMARY KEY (ledger_id, lot_id)
);
ALTER TABLE member_coupons ADD COLUMN voided_at timestamptz;
