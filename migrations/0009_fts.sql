-- Full-text search via FTS5 (enables stemming, ranking, fast partial matches).
-- The unicode61 tokenizer with tokenchars treats CJK characters as searchable
-- tokens, improving Chinese search quality over simple LIKE.

CREATE VIRTUAL TABLE IF NOT EXISTS news_fts USING fts5(
  title, description,
  content='news',
  content_rowid='id',
  tokenize='unicode61 tokenchars'
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
