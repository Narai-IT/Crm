-- เหตุผลการคืนเงิน/ยกเลิกบิล (POS ส่งหมายเหตุที่พนักงานใส่ตอนยกเลิกบิลมาด้วย)
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS reason text;
