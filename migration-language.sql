ALTER TABLE daily_updates ADD COLUMN translations_json TEXT NOT NULL DEFAULT '{}';
ALTER TABLE period_updates ADD COLUMN translations_json TEXT NOT NULL DEFAULT '{}';
