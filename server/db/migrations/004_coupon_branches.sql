-- คูปองต้อนรับแยกตามสาขาที่ลูกค้าเลือกตอนสมัคร (NULL = ทุกสาขา)
ALTER TABLE coupon_templates ADD COLUMN branch_ids text[];
