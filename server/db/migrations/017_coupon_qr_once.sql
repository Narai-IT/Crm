-- QR คูปองแบบใช้ได้ครั้งเดียว: เก็บ QR ที่สแกนไปแล้ว (หมดอายุภายในไม่กี่สิบวินาที ลบทิ้งได้)
CREATE TABLE coupon_qr_used (
  jti     text PRIMARY KEY,
  used_at timestamptz NOT NULL DEFAULT now()
);
