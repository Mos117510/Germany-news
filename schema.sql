CREATE TABLE IF NOT EXISTS daily_updates (
  day TEXT PRIMARY KEY,
  overview TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  articles_json TEXT NOT NULL,
  translations_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_daily_updates_day ON daily_updates(day DESC);

CREATE TABLE IF NOT EXISTS period_updates (
  type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  overview TEXT NOT NULL,
  sections_json TEXT NOT NULL,
  days_json TEXT NOT NULL,
  translations_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (type, period_key)
);
CREATE INDEX IF NOT EXISTS idx_period_updates ON period_updates(type, period_key DESC);
