CREATE TABLE users (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','member','guest')),
  status TEXT NOT NULL CHECK (status IN ('pending','active','revoked')),
  created_at INTEGER NOT NULL
);
CREATE INDEX users_household ON users(household_id);

CREATE TABLE passkeys (
  credential_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX passkeys_user ON passkeys(user_id);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL,
  reauth_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

CREATE TABLE enrollment_tokens (
  token_hash TEXT PRIMARY KEY,
  purpose TEXT NOT NULL CHECK (purpose IN ('bootstrap','invite','recovery')),
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE permission_overrides (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  granted INTEGER NOT NULL CHECK (granted IN (0,1)),
  PRIMARY KEY (user_id, permission)
);

-- Security audit: actor-attributed. Never exposed through household APIs.
CREATE TABLE security_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  household_id TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT,
  action TEXT NOT NULL,
  target TEXT,
  outcome TEXT NOT NULL,
  reason TEXT
);
-- Household-visible activity: deliberately has NO actor column.
CREATE TABLE activity_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  household_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL
);
CREATE INDEX activity_household_ts ON activity_events(household_id, ts);

-- Append-only: no updates; deletes only for retention (older than 365 days).
CREATE TRIGGER security_audit_no_update BEFORE UPDATE ON security_audit
BEGIN SELECT RAISE(ABORT, 'audit is append-only'); END;
CREATE TRIGGER security_audit_retention_only BEFORE DELETE ON security_audit
WHEN OLD.ts > (unixepoch() - 365*86400) * 1000
BEGIN SELECT RAISE(ABORT, 'audit retention not reached'); END;
