-- News Narrative Agent: cross-cycle story tracking.
-- Tracks which topics evolve across multiple fetch cycles,
-- storing AI-generated developments and article associations.

CREATE TABLE IF NOT EXISTS narratives (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keyword TEXT NOT NULL,
  label TEXT,
  first_seen TEXT NOT NULL,
  last_updated TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  summary TEXT,
  developments TEXT NOT NULL DEFAULT '[]',
  article_ids TEXT NOT NULL DEFAULT '[]',
  source_stats TEXT NOT NULL DEFAULT '{}',
  UNIQUE(keyword)
);

CREATE INDEX IF NOT EXISTS idx_narratives_status ON narratives(status, last_updated);

-- Agent internal state (key-value)
CREATE TABLE IF NOT EXISTS agent_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
