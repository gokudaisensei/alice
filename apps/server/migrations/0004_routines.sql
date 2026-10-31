-- The routine's steps live here (app-owned, so they can be edited and summarised);
-- Home Assistant holds the equivalent script and is what actually runs it.
CREATE TABLE routines (
  id TEXT PRIMARY KEY,
  household_id TEXT NOT NULL REFERENCES households(id),
  template TEXT,
  name TEXT NOT NULL,
  steps TEXT NOT NULL,
  script_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX routines_template ON routines(household_id, template) WHERE template IS NOT NULL;
