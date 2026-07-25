-- Cache AI analysis results in news table (avoid re-fetching article pages)
ALTER TABLE news ADD COLUMN entities TEXT;
ALTER TABLE news ADD COLUMN sentiment TEXT;
ALTER TABLE news ADD COLUMN analyzed_at TEXT;
