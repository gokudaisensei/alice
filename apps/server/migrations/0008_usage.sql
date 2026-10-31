-- Per-person tap counts, used only to offer "often used" shortcuts to that same person. Nobody else can read them.
CREATE TABLE device_usage (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  last_used INTEGER NOT NULL,
  PRIMARY KEY (user_id, entity_id)
);
