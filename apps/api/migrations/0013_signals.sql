-- User engagement signals (clicks, views) for agent self-learning
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target_type TEXT NOT NULL,  -- 'article', 'narrative', 'entity'
  target_id TEXT NOT NULL,     -- article id, narrative keyword, entity name
  action TEXT NOT NULL DEFAULT 'click',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_signals_target ON signals(target_type, target_id);
CREATE INDEX IF NOT EXISTS idx_signals_created ON signals(created_at);

-- Add click count column to news
ALTER TABLE news ADD COLUMN click_count INTEGER NOT NULL DEFAULT 0;
