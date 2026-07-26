-- Entity linking: maps original entity names to canonical names
CREATE TABLE IF NOT EXISTS entity_links (
  original_name TEXT NOT NULL,
  canonical_name TEXT NOT NULL,
  entity_type TEXT,
  last_seen TEXT NOT NULL,
  article_count INTEGER DEFAULT 1,
  PRIMARY KEY (original_name)
);
CREATE INDEX IF NOT EXISTS idx_entity_canonical ON entity_links(canonical_name);

-- Adaptive source weights (tuned by the agent based on failure patterns)
CREATE TABLE IF NOT EXISTS source_weights (
  source TEXT PRIMARY KEY,
  weight REAL NOT NULL DEFAULT 1.0,
  consecutive_failures INTEGER DEFAULT 0,
  total_fetches INTEGER DEFAULT 0,
  last_adjusted TEXT
);
