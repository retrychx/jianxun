-- Missing indexes: AI analysis pipeline scans analyzed_at + score often
CREATE INDEX IF NOT EXISTS idx_news_analyzed_at ON news(analyzed_at, score);

-- Published-at + score covers the main feed, trending, briefing, digest queries
CREATE INDEX IF NOT EXISTS idx_news_pub_score ON news(published_at, score);

-- Source + created_at covers per-source counts and the sources view
CREATE INDEX IF NOT EXISTS idx_news_source_created ON news(source, created_at);
