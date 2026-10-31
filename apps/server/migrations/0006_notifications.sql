-- One row per recipient, so read state and visibility are per person.
CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  entity_id TEXT,
  dedupe_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  read_at INTEGER
);
CREATE INDEX notifications_user ON notifications(user_id, created_at DESC);
CREATE INDEX notifications_dedupe ON notifications(user_id, dedupe_key, created_at);

CREATE TABLE notification_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  muted TEXT NOT NULL DEFAULT '[]',
  quiet_enabled INTEGER NOT NULL DEFAULT 0,
  quiet_start TEXT NOT NULL DEFAULT '22:00',
  quiet_end TEXT NOT NULL DEFAULT '07:00',
  tz TEXT NOT NULL DEFAULT 'UTC'
);

CREATE TABLE push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE vapid_keys (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_key TEXT NOT NULL,
  private_key TEXT NOT NULL
);

-- Low-frequency readings (every 15 minutes) behind insights and the energy page. Kept 35 days.
CREATE TABLE samples (
  entity_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  value REAL NOT NULL,
  PRIMARY KEY (entity_id, ts)
) WITHOUT ROWID;

CREATE TABLE insight_dismissals (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  until INTEGER NOT NULL,
  PRIMARY KEY (user_id, key)
);
