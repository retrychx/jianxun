-- Enhanced AI analysis fields: key points, significance, controversy, impact.
-- Stored as a JSON string alongside existing summary/entities/sentiment columns.
ALTER TABLE news ADD COLUMN analysis_detail TEXT;
