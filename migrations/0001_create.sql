-- News articles
CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT,
  url TEXT NOT NULL UNIQUE,
  image TEXT,
  source TEXT NOT NULL,
  lang TEXT NOT NULL DEFAULT 'zh',
  category TEXT NOT NULL DEFAULT '科技',
  score INTEGER NOT NULL DEFAULT 50,
  summary TEXT,
  published_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- AI analysis results
CREATE TABLE IF NOT EXISTS analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  news_id INTEGER NOT NULL UNIQUE,
  content TEXT,
  summary TEXT,
  entities TEXT,
  sentiment TEXT,
  analyzed INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_news_category ON news(category);
CREATE INDEX IF NOT EXISTS idx_news_score ON news(score);
CREATE INDEX IF NOT EXISTS idx_news_created_at ON news(created_at);
CREATE INDEX IF NOT EXISTS idx_news_url ON news(url);
CREATE INDEX IF NOT EXISTS idx_analysis_news_id ON analysis(news_id);
