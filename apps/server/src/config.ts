export const config = {
  port: Number(process.env.PORT ?? 3000),
  dbPath: process.env.DB_PATH ?? "./data/app.db",
  haUrl: process.env.HA_URL ?? "http://localhost:8123",
  // Never log or return this value.
  haToken: process.env.HA_TOKEN_FILE ? (await Bun.file(process.env.HA_TOKEN_FILE).text()).trim() : (process.env.HA_TOKEN ?? ""),
  webDir: process.env.WEB_DIR ?? "../web/build",
  origin: process.env.ORIGIN ?? "https://localhost",
  rpID: process.env.RP_ID ?? new URL(process.env.ORIGIN ?? "https://localhost").hostname,
  // Push services require a contact for the sender. Use a real address you control.
  vapidSubject: process.env.VAPID_SUBJECT ?? "mailto:admin@localhost.invalid",
  // Extra backup destinations, set by whoever installs the box: "usb=/backups/usb,nas=/backups/nas" (mount them into the container).
  backupDirs: process.env.BACKUP_DIRS ?? "",
  // Where the host updater publishes status (read-only here) and where an approved update is requested. Unset = no updater on this device.
  updatesOut: process.env.UPDATES_OUT ?? "",
  updatesIn: process.env.UPDATES_IN ?? "",
  // The app has no direct internet: push goes through the allow-listing proxy (deploy/egress). Unset = direct (development).
  egressProxy: process.env.EGRESS_PROXY ?? "",
  version: process.env.APP_VERSION ?? "dev",
  cookieSecure: (process.env.COOKIE_SECURE ?? "true") !== "false",
};
