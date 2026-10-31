-- Like routines: the app keeps the structured definition (so it can be edited and summarised);
-- Home Assistant holds the equivalent automation and is what actually watches and runs it.
-- Whether it is switched on is read from Home Assistant, never stored here.
CREATE TABLE automations (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  name TEXT NOT NULL,
  triggers TEXT NOT NULL,
  conditions TEXT NOT NULL,
  actions TEXT NOT NULL,
  ha_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
