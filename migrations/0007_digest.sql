-- AI 中文日报：items 是 JSON 数组 [{news_id, why, category}]，extra 是 JSON {news_id, why} 或 NULL
CREATE TABLE digests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL UNIQUE,
  intro TEXT NOT NULL DEFAULT '',
  items TEXT NOT NULL DEFAULT '[]',
  extra TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 英文文章的标题/摘要中文翻译缓存
ALTER TABLE news ADD COLUMN title_zh TEXT;
ALTER TABLE news ADD COLUMN summary_zh TEXT;

-- 信源健康：每个 RSS 源最近一次成功/失败时间与连续失败次数
CREATE TABLE source_stats (
  source TEXT PRIMARY KEY,
  last_ok TEXT,
  last_error TEXT,
  fail_count INTEGER NOT NULL DEFAULT 0
);
