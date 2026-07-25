-- Optimize indexes for query performance
CREATE INDEX IF NOT EXISTS idx_news_published_at ON news(published_at);
CREATE INDEX IF NOT EXISTS idx_news_source ON news(source);

-- Composite index for list query (category filter + time sort)
CREATE INDEX IF NOT EXISTS idx_news_list ON news(category, published_at DESC, created_at DESC);

-- Drop unused analysis table (analysis is done on-the-fly in API)
DROP TABLE IF EXISTS analysis;
