-- แต้มรีวิวร้านในแชท LINE (พิมพ์ "ติชม" แล้วเลือก อร่อยมาก/โอเค/ควรปรับปรุง)
-- ให้เฉพาะสมาชิกที่มีบิลของแบรนด์นี้ในวันเดียวกัน วันละครั้ง · 0 = ปิด
ALTER TABLE brands ADD COLUMN review_points int NOT NULL DEFAULT 5 CHECK (review_points BETWEEN 0 AND 1000);
