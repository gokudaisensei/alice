-- A person's own choice of icon for a device. NULL means the app picks one from the device's type and name.
ALTER TABLE device_meta ADD COLUMN icon TEXT;
