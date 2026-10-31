import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { activity, audit } from "./audit";
import { authorize } from "./guard";
import { say } from "./messages";
import type { Notifier } from "./notify";

export type Dirs = { out: string; in: string };
const readJson = (p: string) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/**
 * The app's side of updates. It never installs anything itself: the host updater (outside the containers, signature-checking)
 * publishes status and events into a read-only folder; the app turns them into notices, notifications and audit entries,
 * and can only ask for a release the updater has already verified.
 */
export function createUpdates(db: Database, dirs: Dirs | null, version: string, now: () => number = Date.now) {
  const household = () => (db.query("SELECT id FROM households LIMIT 1").get() as any)?.id as string | undefined;
  const setting = (h: string, k: string) => (db.query("SELECT value FROM app_settings WHERE household_id = ? AND key = ?").get(h, k) as any)?.value as string | undefined;
  const put = (h: string, k: string, v: string) => db.query("INSERT INTO app_settings (household_id, key, value) VALUES (?,?,?) ON CONFLICT(household_id, key) DO UPDATE SET value = excluded.value").run(h, k, v);

  async function ingest(nf: Notifier) {
    if (!dirs) return;
    const h = household(); if (!h) return;
    const file = join(dirs.out, "events.jsonl"); if (!existsSync(file)) return;
    const last = Number(setting(h, "updates.last_seq") ?? 0);
    const events = readFileSync(file, "utf8").split("\n").filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } }).filter((e) => Number.isInteger(e.seq) && e.seq > last).sort((a, b) => a.seq - b.seq);
    for (const e of events) {
      const urgent = !!e.emergency, v = String(e.version ?? "?").slice(0, 20), key = `upd:${e.seq}`;
      const say_ = (title: string, body: string) => nf.emit({ householdId: h, kind: "maintenance", audience: "admins", dedupeKey: key, title, body });
      if (e.type === "update_starting") {
        put(h, "updates.notice", JSON.stringify({ version: v, emergency: urgent, reason: String(e.reason ?? "").slice(0, 200), startsAt: String(e.startsAt ?? "") }));
        audit(db, { householdId: h, actorType: "system", action: urgent ? "update.emergency_starting" : "update.starting", target: v, outcome: "success", reason: urgent ? String(e.reason ?? "") : null });
        await say_(urgent ? "Urgent update coming" : "Update starting", `${urgent ? "An urgent security update" : "An update"} to version ${v} will start at ${time(e.startsAt)}. The app will be unavailable for a few minutes. Your devices and automations keep running on the home hub.`);
      } else if (e.type === "update_succeeded") {
        put(h, "updates.notice", "");
        audit(db, { householdId: h, actorType: "system", action: urgent ? "update.emergency_succeeded" : "update.succeeded", target: v, outcome: "success" });
        activity(db, h, "update", urgent ? `An urgent security update was installed (version ${v})` : `The app was updated to version ${v}`);
        await say_("Update installed", `The app is now on version ${v}.`);
      } else if (e.type === "update_failed") {
        put(h, "updates.notice", "");
        audit(db, { householdId: h, actorType: "system", action: "update.failed", target: v, outcome: "failure", reason: e.rolledBack ? "rolled back" : "NOT rolled back" });
        activity(db, h, "update", e.rolledBack ? `An update to ${v} didn't work and was undone` : "An update failed");
        await say_(e.rolledBack ? "Update didn't work" : "Update problem", e.rolledBack ? `Version ${v} didn't start properly, so the app went back to the previous version. Nothing was lost. Support will look into it.` : "An update failed and the previous version did not start. Please contact support.");
      } else if (e.type === "update_refused") {
        audit(db, { householdId: h, actorType: "system", action: "update.refused", target: v, outcome: "denied", reason: String(e.why ?? "verification") });
      }
      put(h, "updates.last_seq", String(e.seq));
    }
  }

  function status() {
    if (!dirs) return { configured: false as const, current: version };
    const st = readJson(join(dirs.out, "status.json")), av = readJson(join(dirs.out, "available.json"));
    let lc = NaN; try { lc = Number(readFileSync(join(dirs.out, "last-check"), "utf8").trim()) * 1000; } catch {}
    const refused = (() => { try { return readFileSync(join(dirs.out, "events.jsonl"), "utf8").split("\n").some((l) => { try { const e = JSON.parse(l); return e.type === "update_refused" && now() - Date.parse(e.ts) < 7 * 86400_000; } catch { return false; } }); } catch { return false; } })();
    return {
      configured: true as const, current: version, state: (st?.state ?? "unknown") as string, message: (st?.message ?? "") as string,
      available: av?.version ? { version: String(av.version), notes: String(av.notes ?? ""), created: String(av.created ?? "") } : null,
      lastCheckAt: Number.isFinite(lc) ? lc : null,
      refusedRecently: refused,
    };
  }

  /** A notice to show everyone while an update is about to happen. */
  function notice() {
    const h = household(); const raw = h ? setting(h, "updates.notice") : null;
    if (!raw) return null;
    const n = JSON.parse(raw);
    return Date.parse(n.startsAt) > now() - 30 * 60_000 ? n : null; // a notice that never resolved doesn't linger
  }

  function request(v: string) {
    if (!dirs) return { error: "invalid_input" };
    const s = status() as any;
    if (s.state === "applying" || s.available?.version !== v) return { error: "invalid_input" };
    const tmp = join(dirs.in, ".request.tmp");
    writeFileSync(tmp, JSON.stringify({ version: v, requestedAt: now() })); renameSync(tmp, join(dirs.in, "request.json"));
    return { ok: true };
  }
  return { ingest, status, notice, request };
}
export type Updates = ReturnType<typeof createUpdates>;

export function updateRoutes(db: Database, secure: boolean, up: Updates, nf: Notifier) {
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error, message: say(error) }; };
  return new Elysia({ name: "updates" })
    .get("/api/updates/notice", async ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      await up.ingest(nf); return { notice: up.notice() };
    })
    .get("/api/admin/updates", async ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      await up.ingest(nf); return up.status();
    })
    .post("/api/admin/updates/apply", ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (typeof body?.version !== "string") return deny(set, 400, "invalid_input");
      const r = up.request(body.version); if ("error" in r) return deny(set, 409, r.error as string);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "update.approved", target: body.version, outcome: "success" });
      activity(db, g.user.householdId, "update", `An update to version ${body.version} was approved`);
      return { ok: true };
    });
}
