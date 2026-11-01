-- A limit in watts that a person sets by hand for one power meter. No row means no alert; nothing is chosen automatically.
CREATE TABLE power_limits (
  household_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  watts INTEGER NOT NULL CHECK (watts > 0),
  enabled INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (household_id, entity_id)
);
