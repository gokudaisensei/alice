import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { audit } from "./audit";
import { authorize } from "./guard";
import { friendlyName, haError, type HaApi } from "./ha";
import type { Notifier } from "./notify";
import { asObject, denyWith as deny } from "./http";
import { one } from "./sql";

const CACHE_MS = 60_000, DAY = 86400_000;
const BAD_ENTRY = ["setup_error", "setup_retry", "migration_error", "failed_unload"];

export type HaStatus = {
  notifications: { id: string; title: string; message: string; at: number | null }[];
  repairs: { id: string; domain: string; severity: string; title: string }[];
  updates: { id: string; name: string; installed: string | null; latest: string | null; inProgress: boolean }[];
  integrations: { id: string; name: string; state: string }[];
  /** null when the hub has no backup feature to ask */
  backup: { count: number; lastAt: number | null; lastAutomaticAt: number | null; scheduled: boolean } | null;
};

const words = (s: string) => s.replace(/[_-]+/g, " ").trim();
const sentence = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
/** The hub's own messages are Markdown or HTML; the app shows plain text, and not much of it. */
const plain = (s: unknown) => String(s ?? "").replace(/<[^>]*>/g, " ").replace(/[*_`#>]+/g, "").replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\s+/g, " ").trim().slice(0, 300);
const stamp = (v: unknown) => { const t = typeof v === "number" ? (v < 1e11 ? v * 1000 : v) : Date.parse(String(v ?? "")); return Number.isFinite(t) ? t : null; };

/** What Home Assistant itself is worried about: its notices, repairs, pending updates, failing integrations and its own backups. */
export function createHaStatus(db: Database, ha: HaApi, now: () => number = Date.now) {
  let cache: { at: number; value: HaStatus } | null = null;

  async function load(): Promise<HaStatus> {
    const [pn, rp, ce, bk] = await Promise.all([
      ha.ws({ type: "persistent_notification/get" }), ha.ws({ type: "repairs/list_issues" }), ha.ws({ type: "config_entries/get" }), ha.ws({ type: "backup/info" }),
    ]);
    const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? v : v && typeof v === "object" ? Object.values(v) : []).filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    const notifications = pn.success ? list(pn.result).map((n) => ({ id: String(n.notification_id ?? n.id ?? ""), title: plain(n.title) || "Notice from Home Assistant", message: plain(n.message), at: stamp(n.created_at) })).filter((n) => n.id) : [];
    const issues = rp.success && rp.result && typeof rp.result === "object" ? list((rp.result as { issues?: unknown }).issues) : [];
    const repairs = issues.filter((i) => !i.ignored && i.issue_id).map((i) => ({ id: `${i.domain}:${i.issue_id}`, domain: String(i.domain ?? ""), severity: String(i.severity ?? "warning"), title: sentence(words(`${i.domain ?? ""}: ${i.translation_key ?? i.issue_id}`)) }));
    const updates = [...ha.entities.values()].filter((e) => e.entity_id.startsWith("update.") && e.state === "on").map((e) => ({
      id: e.entity_id, name: String(e.attributes.title ?? friendlyName(e).replace(/ update$/i, "")), installed: typeof e.attributes.installed_version === "string" ? e.attributes.installed_version : null,
      latest: typeof e.attributes.latest_version === "string" ? e.attributes.latest_version : null, inProgress: !!e.attributes.in_progress,
    }));
    const integrations = ce.success ? list(ce.result).filter((c) => BAD_ENTRY.includes(String(c.state))).map((c) => ({ id: String(c.entry_id ?? ""), name: String(c.title || c.domain || "An integration"), state: String(c.state) })).filter((c) => c.id) : [];
    let backup: HaStatus["backup"] = null;
    if (bk.success && bk.result && typeof bk.result === "object") {
      const r = bk.result as { backups?: unknown; last_completed_automatic_backup?: unknown; next_automatic_backup?: unknown };
      const items = list(r.backups), dates = items.map((b) => stamp(b.date)).filter((t): t is number => t !== null);
      backup = { count: items.length, lastAt: dates.length ? Math.max(...dates) : null, lastAutomaticAt: stamp(r.last_completed_automatic_backup), scheduled: !!r.next_automatic_backup };
    }
    return { notifications, repairs, updates, integrations, backup };
  }

  /** Cached for a minute: the admin page asks on every visit. */
  async function status(fresh = false): Promise<HaStatus | null> {
    if (ha.isStale()) return null;
    if (!fresh && cache && now() - cache.at < CACHE_MS) return cache.value;
    const value = await load();
    cache = { at: now(), value };
    return value;
  }

  /** Tell the admins about what the hub is worried about, once per item (and again later if it is still there). Errors and criticals only for repairs: warnings stay on the page. */
  async function sweep(nf: Notifier) {
    const h = one<{ id: string }>(db, "SELECT id FROM households LIMIT 1")?.id, s = await status(true);
    if (!h || !s) return 0;
    const say = (key: string, ms: number, title: string, body: string) => nf.emit({ householdId: h, kind: "ha_issue", audience: "admins", dedupeKey: key, dedupeMs: ms, title, body });
    let n = 0;
    const count = async (p: Promise<{ recipients: number }>) => { n += (await p).recipients; };
    for (const r of s.repairs.filter((x) => x.severity === "critical" || x.severity === "error")) await count(say(`repair:${r.id}`, 3 * DAY, "Home Assistant needs attention", `${r.title}. Open Home Assistant, Settings, Repairs to fix it.`));
    for (const x of s.notifications) await count(say(`pn:${x.id}`, 30 * DAY, x.title, x.message || "Home Assistant has a notice for you."));
    for (const u of s.updates.filter((x) => !x.inProgress)) await count(say(`update:${u.id}:${u.latest}`, 7 * DAY, `Update available: ${u.name}`, `${u.latest ? `Version ${u.latest} is ready` : "A new version is ready"}${u.installed ? ` (you have ${u.installed})` : ""}. You can install it from the System page.`));
    for (const c of s.integrations) await count(say(`entry:${c.id}:${c.state}`, 3 * DAY, `${c.name} isn't working`, "Home Assistant couldn't set this up. Devices that depend on it may be missing or offline."));
    if (s.backup?.scheduled && s.backup.lastAutomaticAt && now() - s.backup.lastAutomaticAt > 3 * DAY) await count(say("habackup", 3 * DAY, "Home Assistant hasn't backed up lately", "Its last automatic backup was more than three days ago."));
    return n;
  }
  const invalidate = () => { cache = null; };
  return { status, sweep, invalidate };
}
export type HaStatusService = ReturnType<typeof createHaStatus>;

/** Messages the hub's own automations send through the Alice integration reach people here, once a minute at most per message. */
export function forwardHaMessages(db: Database, ha: HaApi, nf: Notifier) {
  return ha.subscribe((e) => {
    if (e.type !== "message") return;
    const h = one<{ id: string }>(db, "SELECT id FROM households LIMIT 1")?.id; if (!h) return;
    void nf.emit({ householdId: h, kind: "from_ha", critical: e.critical, ...(e.admins ? { audience: "admins" as const } : {}), title: e.title || "A message from your home", body: e.message, dedupeKey: `ha:${e.title}:${e.message}`.slice(0, 200), dedupeMs: 60_000 });
  });
}

export function haStatusRoutes(db: Database, ha: HaApi, secure: boolean, hs: HaStatusService) {
  const log = (u: { householdId: string; id: string }, action: string, target: string) => audit(db, { householdId: u.householdId, actorType: "user", actorId: u.id, action, target, outcome: "success" });
  return new Elysia({ name: "ha-status" })
    .get("/api/admin/ha-status", async ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const s = await hs.status();
      return s ?? deny(set, 503, "ha_unavailable");
    })
    // Installing something into the hub is a deliberate act: admins only, with a fresh passkey check.
    .post("/api/admin/ha-status/update", async ({ request, body, set }) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const id = asObject(body).entityId, e = typeof id === "string" ? ha.entities.get(id) : undefined;
      if (!e || !e.entity_id.startsWith("update.") || e.state !== "on") return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const r = await ha.callService("update", "install", {}, e.entity_id);
      if (!r.ok) return deny(set, r.error === "ha_unavailable" ? 503 : 409, r.error === "home_assistant_error" ? "ha_not_admin" : r.error); // a key that is not an administrator's is refused this
      hs.invalidate(); log(g.user, "ha.update_install", e.entity_id);
      return { ok: true, started: true };
    })
    .post("/api/admin/ha-status/backup", async ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const r = await ha.ws({ type: "backup/generate" });
      // A backup takes longer than we wait; the hub carries on, so a timeout means it started.
      if (!r.success && r.error?.code !== "timeout") return deny(set, 502, haError(r));
      hs.invalidate(); log(g.user, "ha.backup", "home_assistant");
      return { ok: true, started: true };
    });
}
