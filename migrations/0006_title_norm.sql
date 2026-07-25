-- Dedup by normalized title per source (catches the same article re-posted with URL variants)
ALTER TABLE news ADD COLUMN title_norm TEXT;

-- Backfill. Must stay in sync with normalizeTitle() in src/title-norm.ts:
-- lowercase + trim + strip spaces/ideographic spaces/，/。
UPDATE news SET title_norm = lower(replace(replace(replace(replace(trim(title), ' ', ''), '，', ''), '。', ''), '　', ''));

-- Drop exact same-title duplicates per source, keeping the oldest row
DELETE FROM news WHERE id NOT IN (SELECT MIN(id) FROM news GROUP BY source, title_norm);

-- INSERT OR IGNORE now also skips same-title variants from the same source
CREATE UNIQUE INDEX idx_news_source_title ON news(source, title_norm);
