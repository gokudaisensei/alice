-- A helper value or a device's own setting (a microphone mute, "Do not disturb") is not shown as a device unless a person chooses to show it.
ALTER TABLE device_meta ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
