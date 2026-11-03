-- Whether a person wants safety alerts (smoke, leak, alarm) to reach them even during their quiet hours. Off unless they choose it.
ALTER TABLE notification_prefs ADD COLUMN critical_bypass INTEGER NOT NULL DEFAULT 0;
