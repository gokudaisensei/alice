import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { statSync, statfsSync } from "node:fs";
import { dirname } from "node:path";
import { authorize } from "./guard";
import { say } from "./messages";
import type { HaApi } from "./ha";
import type { Backups } from "./backup";
import type { Updates } from "./updates";

type Check = { id: string; label: string; status: "ok" | "warn" | "fail"; detail: string; advice?: string };
const MB = 1024 * 1024, GB = 1024 * MB;
const human = (b: number) => (b >= GB ? `${(b / GB).toFixed(1)} GB` : `${Math.round(b / MB)} MB`);
const ago = (ms: number) => (ms < 90_000 ? "just now" : ms < 5400_000 ? `${Math.round(ms / 60_000)} minutes ago` : ms < 172800_000 ? `${Math.round(ms / 3600_000)} hours ago` : `${Math.round(ms / 86400_000)} days ago`);

/** A plain-language picture of whether the home is in good shape. Contains no personal data, so support may be shown the same thing. */
export function createHealth(db: Database, ha: HaApi, bk: Backups, up: Updates, o: { version: string; startedAt: number; dbPath: string; now?: () => number }) {
  const now = o.now ?? Date.now;
  return function snapshot(householdId: string) {
    const checks: Check[] = [];
    const h = ha.health();
    checks.push(h === "ok" && !ha.isStale()
      ? { id: "hub", label: "Home hub", status: "ok", detail: `Connected, ${ha.entities.size} things known.` }
      : h === "auth_failed"
        ? { id: "hub", label: "Home hub", status: "fail", detail: "The hub refused the app's access key.", advice: "Contact support: the key the app uses to talk to the hub needs replacing." }
        : { id: "hub", label: "Home hub", status: "fail", detail: "The app can't reach the home hub.", advice: "Check that the hub is powered on and connected to your network. Devices can't be controlled from the app until it is back." });

    let size = 0, free: number | null = null;
    try { if (o.dbPath !== ":memory:") { size = statSync(o.dbPath).size; const s = statfsSync(dirname(o.dbPath)); free = Number(s.bavail) * Number(s.bsize); } } catch {}
    const qc = (db.query("PRAGMA quick_check(1)").get() as any)?.quick_check;
    checks.push(qc === "ok" ? { id: "db", label: "App data", status: "ok", detail: `Healthy (${human(size)}).` } : { id: "db", label: "App data", status: "fail", detail: "The app's data failed a self-check.", advice: "Contact support before doing anything else. Your latest backup is the safe way back." });
    if (free !== null) checks.push(free < 200 * MB ? { id: "disk", label: "Storage space", status: "fail", detail: `Only ${human(free)} left.`, advice: "Free up space on the device or contact support. The app may stop saving changes." }
      : free < GB ? { id: "disk", label: "Storage space", status: "warn", detail: `${human(free)} left.`, advice: "Space is getting low. Old backups and photos are the usual cause." } : { id: "disk", label: "Storage space", status: "ok", detail: `${human(free)} free.` });

    const b = bk.status(householdId);
    if (!b.recipientSet) checks.push({ id: "backup", label: "Backups", status: "warn", detail: "Backups aren't set up yet.", advice: "Create your backup key under Backups, then make the first backup." });
    else if (!b.latest) checks.push({ id: "backup", label: "Backups", status: "warn", detail: "No backup has been made yet.", advice: "Make a backup now from the Backups page." });
    else {
      const age = now() - b.latest.createdAt, lv = b.latest.level;
      const bits = [`Last backup ${ago(age)}`, lv === "restore_tested" ? "restore tested" : "checked, but never test-restored"];
      checks.push(b.overdue ? { id: "backup", label: "Backups", status: "warn", detail: `${bits[0]}.`, advice: "Backups are meant to run every day. Make one now and check the destinations." }
        : !b.latest.offDevice ? { id: "backup", label: "Backups", status: "warn", detail: `${bits.join("; ")}. The only copy is on this device.`, advice: "A backup on the same device doesn't survive a failure of that device. Plug in the backup drive or connect the network share." }
        : { id: "backup", label: "Backups", status: lv === "restore_tested" ? "ok" : "warn", detail: `${bits.join("; ")}.`, ...(lv === "restore_tested" ? {} : { advice: "Run a restore test so you know the backup can really be used." }) });
    }

    const lastSample = (db.query("SELECT MAX(ts) t FROM samples").get() as any)?.t as number | null;
    checks.push(lastSample && now() - lastSample < 2 * 3600_000 ? { id: "sampling", label: "Energy and insight readings", status: "ok", detail: `Last reading ${ago(now() - lastSample)}.` }
      : { id: "sampling", label: "Energy and insight readings", status: "warn", detail: lastSample ? `Last reading ${ago(now() - lastSample)}.` : "No readings yet.", advice: "Insights and the energy page need readings every 15 minutes. If the hub is unreachable they pause." });

    const u = up.status() as any;
    if (!u.configured) checks.push({ id: "updates", label: "Updates", status: "ok", detail: "Updates are installed by your support team on this device." });
    else if (u.state === "broken") checks.push({ id: "updates", label: "Updates", status: "fail", detail: "An update failed and the previous version did not start.", advice: "Contact support now." });
    else if (u.state === "failed") checks.push({ id: "updates", label: "Updates", status: "warn", detail: "The last update didn't work and was undone. You're on the previous version.", advice: "Support has been told. Nothing was lost." });
    else if (u.refusedRecently) checks.push({ id: "updates", label: "Updates", status: "warn", detail: "An update was refused because it didn't pass the signature check.", advice: "Nothing was installed. If you weren't expecting this, tell support." });
    else if (u.available) checks.push({ id: "updates", label: "Updates", status: "warn", detail: `Version ${u.available.version} is ready to install (you have ${u.current}).`, advice: "Install it from the System page when it suits you." });
    else if (!u.lastCheckAt || now() - u.lastCheckAt > 72 * 3600_000) checks.push({ id: "updates", label: "Updates", status: "warn", detail: u.lastCheckAt ? `Last checked for updates ${ago(now() - u.lastCheckAt)}.` : "Hasn't checked for updates yet.", advice: "Checking needs an internet connection. If it stays like this, tell support." });
    else checks.push({ id: "updates", label: "Updates", status: "ok", detail: `Up to date (version ${u.current}); checked ${ago(now() - u.lastCheckAt)}.` });

    const order = { ok: 0, warn: 1, fail: 2 } as const;
    const overall = checks.reduce<Check["status"]>((a, c) => (order[c.status] > order[a] ? c.status : a), "ok");
    return {
      overall, checks,
      facts: { version: o.version, uptimeSeconds: Math.round((now() - o.startedAt) / 1000), memoryMb: Math.round(process.memoryUsage().rss / MB), dbBytes: size, schema: (db.query("SELECT MAX(version) v FROM schema_migrations").get() as any).v as number,
        pushDevices: (db.query("SELECT COUNT(*) n FROM push_subscriptions").get() as any).n as number },
    };
  };
}
export type HealthSnapshot = ReturnType<typeof createHealth>;

export function healthRoutes(db: Database, secure: boolean, snap: HealthSnapshot) {
  return new Elysia({ name: "health" }).get("/api/admin/health", ({ request, set }) => {
    const g = authorize(db, request, secure, ["admin.access"]);
    if (!("user" in g)) { set.status = g.status; return { error: g.body.error, message: say(g.body.error) }; }
    return snap(g.user.householdId);
  });
}
