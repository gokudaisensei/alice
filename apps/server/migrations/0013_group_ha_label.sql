-- A group that mirrors a Home Assistant label: its members are whatever carries the label there.
ALTER TABLE device_groups ADD COLUMN ha_label_id TEXT;
CREATE UNIQUE INDEX device_groups_ha_label ON device_groups (household_id, ha_label_id) WHERE ha_label_id IS NOT NULL;
