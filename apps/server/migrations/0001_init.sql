CREATE TABLE households (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE TABLE app_settings (
  household_id TEXT NOT NULL REFERENCES households(id),
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (household_id, key)
);
