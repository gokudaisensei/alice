-- App-owned organisation of Home Assistant entities. HA stays the source of truth for state.
CREATE TABLE rooms (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE device_meta (
  household_id TEXT NOT NULL REFERENCES households(id),
  entity_id TEXT NOT NULL,
  name TEXT,
  room_id TEXT REFERENCES rooms(id) ON DELETE SET NULL,
  hidden INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (household_id, entity_id)
);
-- Per-user override of the role default (admin/member: allowed, guest: denied).
CREATE TABLE device_access (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0,1)),
  PRIMARY KEY (user_id, entity_id)
);
CREATE TABLE device_groups (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL
);
CREATE TABLE group_members (
  group_id TEXT NOT NULL REFERENCES device_groups(id) ON DELETE CASCADE,
  entity_id TEXT NOT NULL,
  PRIMARY KEY (group_id, entity_id)
);
CREATE TABLE user_prefs (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  template TEXT NOT NULL DEFAULT 'comfort',
  appearance TEXT NOT NULL DEFAULT 'system',
  sections TEXT NOT NULL DEFAULT '["favorites","rooms"]',
  room_order TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE user_favorites (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('device','room')),
  ref TEXT NOT NULL,
  position INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, ref)
);
