import { config } from "./config";
import { migrate, openDb } from "./db";
import { createApp } from "./app";
import { ensureBootstrapCode } from "./auth";
import { HaClient } from "./ha";
import { ensureModeHelper } from "./modes";
import { realWebAuthn } from "./webauthn";
import { createDeviceService } from "./devices";
import { createNotifier, realPush } from "./notify";
import { createInsights, createSampler } from "./insights";
import { startRules } from "./rules";
import { createPowerLimits } from "./power";
import { createBackups, parseDests } from "./backup";
import { dirname } from "node:path";
import { createUpdates } from "./updates";
import { runRetention } from "./retention";
import { all, scalar } from "./sql";

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

const db = openDb(config.dbPath);
migrate(db);
const ha = new HaClient(config.haUrl, config.haToken);
ha.start();
// The household mode lives in HA so HA automations can use it. Create it the first time we connect.
ha.subscribe((e) => {
  if (e.type !== "conn" || ha.health() !== "ok") return;
  ensureModeHelper(ha).then((r) => { if (r === "created") console.log("Created household mode helper in Home Assistant"); if (r === "failed") console.warn("Could not create the household mode helper (needs an HA admin token)"); });
});

const code = ensureBootstrapCode(db);
if (code) console.log(`First-time setup: open the app and use setup code ${code} (valid 1 hour)`);

const push = realPush(db, config.vapidSubject, config.egressProxy || undefined);
const devices = createDeviceService(db, ha), notifier = createNotifier(db, devices, push);
const powerLimits = createPowerLimits(db);
startRules(db, ha, notifier, undefined, powerLimits);
createSampler(db, ha).start();
// Once a day: tell people about new insights (at most once per finding every three days) and apply retention.
const insights = createInsights(db, ha, devices);
setInterval(() => { insights.sweep(notifier).catch(() => {}); notifier.prune(); try { const r = runRetention(db); if (r.auditBlocked) console.warn("Audit retention skipped: system clock looks wrong"); } catch (e) { console.warn("Retention failed", errorMessage(e)); } }, 24 * 3600_000);

// Nightly encrypted backup (once a key is set). On start-up, catch up if the last one is more than a day old.
const backups = createBackups(db, parseDests(dirname(config.dbPath), config.backupDirs));
const runBackup = async () => {
  for (const h of all<{ id: string }>(db, "SELECT id FROM households")) {
    const last = scalar(db, "SELECT MAX(created_at) FROM backups WHERE household_id = ?", 0, h.id);
    if (!backups.recipient(h.id) || Date.now() - last < 23 * 3600_000) continue;
    const r = await backups.create(h.id, "auto");
    if ("error" in r) console.warn("Backup did not run:", r.error); else console.log("Backup made");
  }
};
const backupFailed = (e: unknown) => console.warn("Backup failed", errorMessage(e));
setTimeout(() => runBackup().catch(backupFailed), 30_000);
setInterval(() => runBackup().catch(backupFailed), 3600_000);

const updates = createUpdates(db, config.updatesOut ? { out: config.updatesOut, in: config.updatesIn } : null, config.version);
setInterval(() => updates.ingest(notifier).catch(() => {}), 60_000); // turns the updater's events into notices, notifications and audit entries
updates.ingest(notifier).catch(() => {});

createApp({
  updates, push, backups, dbPath: config.dbPath, version: config.version, db, ha, origin: config.origin, cookieSecure: config.cookieSecure, webDir: config.webDir, powerLimits,
  webauthn: realWebAuthn({ rpID: config.rpID, rpName: "Smart Home Companion", origin: config.origin }),
}).listen(config.port);
console.log(`server listening on :${config.port}`);
