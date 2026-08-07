-- 缺失索引修复（review 发现）：
--  1. news(title_norm) 单列索引——briefing/digest/curate 里每行做
--     (SELECT COUNT(*) ... WHERE n2.title_norm = n.title_norm) 相关子查询，
--     现有 (source, title_norm) 复合索引无法服务 title_norm 单独等值/排序。
--  2. news(lang, score)——translateMissing 每 3h 扫 WHERE lang='en' AND title_zh IS NULL ORDER BY score。
--  3. signals(target_type, created_at)——ingestSignals 的实体热度查询按 (target_type, created_at) 过滤。
CREATE INDEX IF NOT EXISTS idx_news_title_norm ON news(title_norm);
CREATE INDEX IF NOT EXISTS idx_news_lang_score ON news(lang, score);
CREATE INDEX IF NOT EXISTS idx_signals_target_created ON signals(target_type, created_at);

-- 限流表：支撑 research/ask/topic/signal-click 的 D1 固定窗口限流。
-- 过期行由 agent cleanup 定期清理（见 cleanup.ts）。
CREATE TABLE IF NOT EXISTS rate_limits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_rate_limits_scope_created ON rate_limits(scope, created_at);
