-- Full-text search via FTS5 (enables stemming, ranking, fast partial matches).
-- D1 supports FTS5 with the unicode61 tokenizer (without tokenchars option,
-- which is not available in D1's SQLite build).

CREATE VIRTUAL TABLE IF NOT EXISTS news_fts USING fts5(
  title, description,
  content='news',
  content_rowid='id',
  tokenize='unicode61'
);

-- Populate from existing articles
INSERT INTO news_fts(rowid, title, description)
SELECT id, title, COALESCE(description, '') FROM news;

-- Keep FTS index in sync
CREATE TRIGGER IF NOT EXISTS news_fts_ai AFTER INSERT ON news BEGIN
  INSERT INTO news_fts(rowid, title, description) VALUES (new.id, new.title, COALESCE(new.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS news_fts_ad AFTER DELETE ON news BEGIN
  INSERT INTO news_fts(news_fts, rowid, title, description) VALUES('delete', old.id, old.title, COALESCE(old.description, ''));
END;

CREATE TRIGGER IF NOT EXISTS news_fts_au AFTER UPDATE OF title, description ON news BEGIN
  INSERT INTO news_fts(news_fts, rowid, title, description) VALUES('delete', old.id, old.title, COALESCE(old.description, ''));
  INSERT INTO news_fts(rowid, title, description) VALUES (new.id, new.title, COALESCE(new.description, ''));
END;
