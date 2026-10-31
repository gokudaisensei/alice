-- Backups: encrypted archives written to one or more destinations. "Verified" is earned in stages (see docs).
CREATE TABLE backups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  created_at INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('auto','manual')),
  size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  counts TEXT NOT NULL,
  integrity_ok INTEGER NOT NULL,
  integrity_detail TEXT NOT NULL,
  dests TEXT NOT NULL,
  restore_tested_at INTEGER,
  restore_tested_ok INTEGER,
  restore_detail TEXT
);

-- Which items the household has chosen to allow by voice (synced to Home Assistant Cloud's exposure list).
CREATE TABLE voice_exposure (
  household_id TEXT NOT NULL REFERENCES households(id),
  entity_id TEXT NOT NULL,
  PRIMARY KEY (household_id, entity_id)
);

-- Company support staff. A separate identity store, unreachable from household APIs.
CREATE TABLE operators (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','active','revoked')),
  created_at INTEGER NOT NULL
);
CREATE TABLE operator_passkeys (
  credential_id TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  public_key TEXT NOT NULL,
  counter INTEGER NOT NULL,
  transports TEXT,
  created_at INTEGER NOT NULL
);
CREATE TABLE operator_sessions (
  token_hash TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
CREATE TABLE operator_enrollment (
  token_hash TEXT PRIMARY KEY,
  operator_id TEXT NOT NULL REFERENCES operators(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

-- A household-granted, time-boxed, scoped window in which an operator may look at this home.
CREATE TABLE support_sessions (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  granted_by TEXT NOT NULL REFERENCES users(id),
  scopes TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  operator_id TEXT REFERENCES operators(id),
  claimed_at INTEGER,
  ended_at INTEGER
);
