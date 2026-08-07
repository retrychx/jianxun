-- Track AI analysis attempts so unanalyzable articles are not retried forever
ALTER TABLE news ADD COLUMN analyze_attempts INTEGER NOT NULL DEFAULT 0;
