CREATE TABLE IF NOT EXISTS visitor_checkins (
  session_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entry_path TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
);
CREATE INDEX IF NOT EXISTS checkins_time ON visitor_checkins(created_at);
