-- A room that mirrors a Home Assistant area. Colour, icon and order stay the household's; the name and the devices follow the area.
ALTER TABLE rooms ADD COLUMN ha_area_id TEXT;
CREATE UNIQUE INDEX rooms_ha_area ON rooms (household_id, ha_area_id) WHERE ha_area_id IS NOT NULL;
