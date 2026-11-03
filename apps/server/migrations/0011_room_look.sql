-- How a room looks: a colour and an icon chosen by the household. NULL means the app's default.
ALTER TABLE rooms ADD COLUMN color TEXT;
ALTER TABLE rooms ADD COLUMN icon TEXT;
