-- 将 FTS 从 unicode61 换成 trigram tokenizer。
-- unicode61 会把每个汉字拆成单字 token，中文短语 MATCH 质量很差，真实中文搜索
-- 全部落回 LIKE 全表扫描（开销大）。trigram 支持中英文子串匹配，且与现有查询
-- 语法兼容（英文 `word*` 前缀、中文 ≥3 字裸词；<3 字返回 0 行由代码自动落回 LIKE 兜底）。
-- 已在本机 miniflare SQLite 验证 trigram 可用。

-- 先删触发器，再重建表，避免残留引用旧表
DROP TRIGGER IF EXISTS news_fts_ai;
DROP TRIGGER IF EXISTS news_fts_ad;
DROP TRIGGER IF EXISTS news_fts_au;

DROP TABLE IF EXISTS news_fts;

CREATE VIRTUAL TABLE news_fts USING fts5(
  title, description,
  content='news',
  content_rowid='id',
  tokenize='trigram'
);

-- 回填
INSERT INTO news_fts(rowid, title, description)
SELECT id, title, COALESCE(description, '') FROM news;

-- 保持 FTS 索引同步
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
