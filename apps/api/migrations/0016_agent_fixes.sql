-- agent/health fixMissingImages: 图片补抓尝试次数。
-- 每次补抓 +1，≥3 后不再选入，避免对同一批抓不到的图反复 fetch（旧逻辑每轮都重抓同一批 3 篇）。
ALTER TABLE news ADD COLUMN image_attempts INTEGER NOT NULL DEFAULT 0;
