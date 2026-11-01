import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import webpush from "web-push";
import { authorize } from "./guard";
import { say } from "./messages";
import type { DeviceService } from "./devices";

/** Categories a person can mute. Hub problems and insights are optional too; nothing is forced. */
export const KINDS = ["device_offline", "lock_open", "hub", "insight"] as const;
export const DEDUPE_MS = 6 * 3600_000, INSIGHT_DEDUPE_MS = 72 * 3600_000, RATE_PER_HOUR = 10, RETENTION_MS = 90 * 86400_000;

export type PushSub = { endpoint: string; p256dh: string; auth: string };
export interface PushSender { publicKey(): string; send(sub: PushSub, payload: object): Promise<"ok" | "gone" | "failed"> }

/** Browsers hand us the push endpoint. Only well-known push services may be called, or a subscriber could aim the server at our own network. */
const EXACT = ["fcm.googleapis.com"], SUFFIX = ["push.services.mozilla.com", "push.apple.com", "notify.windows.com"];
export function pushEndpointOk(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length > 600) return false;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.port && !u.username && (EXACT.includes(u.hostname) || SUFFIX.some((s) => u.hostname === s || u.hostname.endsWith("." + s)));
  } catch { return false; }
}

export function realPush(db: Database, subject: string, proxy?: string): PushSender {
  const keys = () => {
    let k: any = db.query("SELECT public_key, private_key FROM vapid_keys WHERE id = 1").get();
    if (!k) { const g = webpush.generateVAPIDKeys(); db.query("INSERT INTO vapid_keys (id, public_key, private_key) VALUES (1,?,?)").run(g.publicKey, g.privateKey); k = { public_key: g.publicKey, private_key: g.privateKey }; }
    return k as { public_key: string; private_key: string };
  };
  return {
    publicKey: () => keys().public_key,
    async send(sub, payload) {
      const k = keys();
      try {
        await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } }, JSON.stringify(payload), { vapidDetails: { subject, publicKey: k.public_key, privateKey: k.private_key }, TTL: 3600, timeout: 8000, ...(proxy ? { proxy } : {}) });
        return "ok";
      } catch (e: any) { return e?.statusCode === 404 || e?.statusCode === 410 ? "gone" : "failed"; }
    },
  };
}

export type Prefs = { muted: string[]; quiet: { enabled: boolean; start: string; end: string; tz: string } };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const tzOk = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

export function createNotifier(db: Database, svc: DeviceService, push: PushSender | null, now: () => number = Date.now) {
  function prefsOf(userId: string): Prefs {
    const r: any = db.query("SELECT * FROM notification_prefs WHERE user_id = ?").get(userId);
    return { muted: r ? JSON.parse(r.muted) : [], quiet: { enabled: !!r?.quiet_enabled, start: r?.quiet_start ?? "22:00", end: r?.quiet_end ?? "07:00", tz: r?.tz ?? "UTC" } };
  }
  /** Quiet hours hold back push only. The notification is still in the inbox. */
  function inQuiet(p: Prefs, at: number) {
    if (!p.quiet.enabled || p.quiet.start === p.quiet.end) return false;
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: p.quiet.tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
    return p.quiet.start < p.quiet.end ? parts >= p.quiet.start && parts < p.quiet.end : parts >= p.quiet.start || parts < p.quiet.end;
  }
  const subsOf = (userId: string) => db.query("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?").all(userId) as PushSub[];
  async function pushTo(userId: string, payload: object) {
    if (!push) return 0;
    let sent = 0;
    for (const s of subsOf(userId)) {
      const r = await push.send(s, payload);
      if (r === "ok") sent++;
      if (r === "gone") db.query("DELETE FROM push_subscriptions WHERE endpoint = ?").run(s.endpoint);
    }
    return sent;
  }

  type N = { householdId: string; kind: (typeof KINDS)[number] | "maintenance"; audience?: "admins"; actions?: { action: string; title: string }[]; title: string; body: string; entityId?: string; dedupeKey: string; dedupeMs?: number };
  /** Who hears about it: people who may use the device, or admins and members for household-wide news. */
  function recipients(n: N) {
    const users = db.query("SELECT id, role FROM users WHERE household_id = ? AND status = 'active'").all(n.householdId) as { id: string; role: "admin" | "member" | "guest" }[];
    if (n.audience === "admins") return users.filter((u) => u.role === "admin");
    return users.filter((u) => !(n.kind === "insight" && u.role === "guest")).filter((u) => (n.entityId ? svc.accessor(u as any)(n.entityId) : u.role !== "guest"));
  }
  async function emit(n: N) {
    const t = now(), out = { recipients: 0, pushed: 0 };
    for (const u of recipients(n)) {
      const p = prefsOf(u.id);
      if (p.muted.includes(n.kind) && n.kind !== "maintenance") continue; // maintenance news about the device itself cannot be muted
      if (db.query("SELECT 1 FROM notifications WHERE user_id = ? AND dedupe_key = ? AND created_at > ?").get(u.id, n.dedupeKey, t - (n.dedupeMs ?? DEDUPE_MS))) continue;
      const recent = (db.query("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND kind != 'summary' AND created_at > ?").get(u.id, t - 3600_000) as any).n;
      if (recent >= RATE_PER_HOUR) {
        // Over the limit: one running line instead of a flood, and no push.
        const key = `summary:${Math.floor(t / 3600_000)}`;
        const ex: any = db.query("SELECT id, body FROM notifications WHERE user_id = ? AND dedupe_key = ?").get(u.id, key);
        const held = ex ? Number(String(ex.body).match(/\d+/)?.[0] ?? 0) + 1 : 1;
        const body = `${held} more notification${held === 1 ? " was" : "s were"} held back this hour to avoid flooding you.`;
        if (ex) db.query("UPDATE notifications SET body = ?, read_at = NULL WHERE id = ?").run(body, ex.id);
        else db.query("INSERT INTO notifications (id, household_id, user_id, kind, title, body, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?)").run(randomUUID(), n.householdId, u.id, "summary", "Lots happening at home", body, key, t);
        continue;
      }
      db.query("INSERT INTO notifications (id, household_id, user_id, kind, title, body, entity_id, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?,?)")
        .run(randomUUID(), n.householdId, u.id, n.kind, n.title, n.body, n.entityId ?? null, n.dedupeKey, t);
      out.recipients++;
      if (!inQuiet(p, t)) out.pushed += await pushTo(u.id, { title: n.title, body: n.body, url: "/activity", ...(n.entityId ? { entityId: n.entityId } : {}), ...(n.actions ? { actions: n.actions } : {}) });
    }
    return out;
  }
  const list = (userId: string, limit = 50) => (db.query("SELECT id, kind, title, body, entity_id, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?").all(userId, limit) as any[])
    .map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, entityId: r.entity_id, createdAt: r.created_at, read: r.read_at !== null }));
  const unread = (userId: string) => (db.query("SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL").get(userId) as any).n as number;
  const prune = () => db.query("DELETE FROM notifications WHERE created_at < ?").run(now() - RETENTION_MS);
  return { emit, list, unread, prune, prefsOf, inQuiet, pushTo, push };
}
export type Notifier = ReturnType<typeof createNotifier>;

export function notifyRoutes(db: Database, secure: boolean, nf: Notifier) {
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error, message: say(error) }; };
  const lastTest = new Map<string, number>();
  const b64 = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(v);

  return new Elysia({ name: "notifications" })
    .get("/api/notifications", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { notifications: nf.list(g.user.id), unread: nf.unread(g.user.id) };
    })
    .get("/api/notifications/unread", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { unread: nf.unread(g.user.id) };
    })
    .post("/api/notifications/read", ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const ids = body?.ids;
      if (ids !== undefined && (!Array.isArray(ids) || ids.length > 200 || !ids.every((x: unknown) => typeof x === "string"))) return deny(set, 400, "invalid_input");
      const t = Date.now();
      if (ids === undefined) db.query("UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL").run(t, g.user.id);
      else for (const id of ids) db.query("UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL").run(t, id, g.user.id); // only your own
      return { ok: true, unread: nf.unread(g.user.id) };
    })
    .get("/api/me/notifications", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const subs = (db.query("SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ?").get(g.user.id) as any).n;
      return { ...nf.prefsOf(g.user.id), kinds: g.user.role === "guest" ? KINDS.filter((k) => k !== "insight") : KINDS, pushDevices: subs, pushAvailable: !!nf.push };
    })
    .put("/api/me/notifications", ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, ["prefs.edit"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const cur = nf.prefsOf(g.user.id), b = body ?? {};
      const muted = b.muted === undefined ? cur.muted : b.muted;
      const q = { ...cur.quiet, ...(b.quiet ?? {}) };
      if (!Array.isArray(muted) || !muted.every((k: unknown) => (KINDS as readonly string[]).includes(k as string)) || typeof q.enabled !== "boolean" || !HHMM.test(q.start) || !HHMM.test(q.end) || typeof q.tz !== "string" || !tzOk(q.tz)) return deny(set, 400, "invalid_input");
      db.query(`INSERT INTO notification_prefs (user_id, muted, quiet_enabled, quiet_start, quiet_end, tz) VALUES (?,?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET muted=excluded.muted, quiet_enabled=excluded.quiet_enabled, quiet_start=excluded.quiet_start, quiet_end=excluded.quiet_end, tz=excluded.tz`)
        .run(g.user.id, JSON.stringify([...new Set(muted)]), q.enabled ? 1 : 0, q.start, q.end, q.tz);
      return { ...nf.prefsOf(g.user.id) };
    })
    .get("/api/push/key", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return nf.push ? { publicKey: nf.push.publicKey() } : deny(set, 404, "not_found");
    })
    .post("/api/push/subscribe", ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, ["prefs.edit"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const e = body?.endpoint, k = body?.keys;
      if (!nf.push || !pushEndpointOk(e) || !b64(k?.p256dh) || !b64(k?.auth)) return deny(set, 400, "invalid_input");
      const mine = (db.query("SELECT COUNT(*) n FROM push_subscriptions WHERE user_id = ? AND endpoint != ?").get(g.user.id, e) as any).n;
      if (mine >= 5) return deny(set, 400, "invalid_input");
      db.query(`INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, created_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, p256dh=excluded.p256dh, auth=excluded.auth`).run(randomUUID(), g.user.id, e, k.p256dh, k.auth, Date.now());
      return { ok: true };
    })
    .post("/api/push/unsubscribe", ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (typeof body?.endpoint !== "string") return deny(set, 400, "invalid_input");
      db.query("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?").run(body.endpoint, g.user.id);
      return { ok: true };
    })
    // Lets someone check the whole path works, honestly: "sent" counts what the push service accepted.
    .post("/api/push/test", async ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (Date.now() - (lastTest.get(g.user.id) ?? 0) < 30_000) return deny(set, 429, "rate_limited");
      lastTest.set(g.user.id, Date.now());
      return { sent: await nf.pushTo(g.user.id, { title: "Test notification", body: "If you can read this, notifications reach this device.", url: "/notifications" }) };
    });
}
