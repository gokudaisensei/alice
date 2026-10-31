import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { activity, audit } from "./audit";
import { readCookie, clientIp } from "./auth";
import { authorize } from "./guard";
import { say } from "./messages";
import { RateLimiter } from "./ratelimit";
import { newToken, sha256 } from "./session";
import type { WebAuthnService } from "./webauthn";
import type { HaApi } from "./ha";
import type { HealthSnapshot } from "./health";
import type { RoutineService } from "./routines";
import type { AutomationService } from "./automations";

export const SCOPES = ["diagnostics", "read_config"] as const;
export const OPS = { idleMs: 30 * 60_000, absoluteMs: 8 * 3600_000, enrollMs: 3600_000 };
const COOKIE = (secure: boolean) => (secure ? "__Host-ops" : "ops");

export function activeSupport(db: Database, householdId: string, now = Date.now()) {
  return db.query("SELECT s.*, o.name operator_name FROM support_sessions s LEFT JOIN operators o ON o.id = s.operator_id WHERE s.household_id = ? AND s.ended_at IS NULL AND s.expires_at > ? ORDER BY s.created_at DESC LIMIT 1").get(householdId, now) as any | null;
}

/** Physical-access CLI helper: create an operator and a one-time enrollment code. */
export function createOperator(db: Database, name: string) {
  const id = randomUUID(), token = newToken();
  db.query("INSERT INTO operators (id, name, status, created_at) VALUES (?,?, 'pending', ?)").run(id, name, Date.now());
  db.query("INSERT INTO operator_enrollment (token_hash, operator_id, expires_at) VALUES (?,?,?)").run(sha256(token), id, Date.now() + OPS.enrollMs);
  audit(db, { actorType: "system", action: "operator.created", target: id, outcome: "success", reason: "physical access" });
  return { id, token };
}

/** Household side: grant, see, and end a support session. Visible to everyone in the home while it lasts. */
export function supportRoutes(db: Database, secure: boolean) {
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error, message: say(error) }; };
  const shape = (s: any) => ({ id: s.id, scopes: JSON.parse(s.scopes), expiresAt: s.expires_at, connected: !!s.operator_id, operatorName: s.operator_name ?? null });
  return new Elysia({ name: "support" })
    .get("/api/support", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const s = activeSupport(db, g.user.householdId);
      return { active: s ? shape(s) : null, canManage: g.user.permissions.includes("admin.access") };
    })
    .post("/api/admin/support", ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const scopes = body?.scopes, hours = body?.hours ?? 4;
      if (!Array.isArray(scopes) || !scopes.length || !scopes.every((x: unknown) => (SCOPES as readonly string[]).includes(x as string)) || !Number.isInteger(hours) || hours < 1 || hours > 72) return deny(set, 400, "invalid_input");
      if (activeSupport(db, g.user.householdId)) return deny(set, 409, "invalid_input");
      const id = randomUUID(), t = Date.now();
      db.query("INSERT INTO support_sessions (id, household_id, granted_by, scopes, created_at, expires_at) VALUES (?,?,?,?,?,?)").run(id, g.user.householdId, g.user.id, JSON.stringify([...new Set(scopes)]), t, t + hours * 3600_000);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "support.grant", target: id, outcome: "success", reason: `${scopes.join(",")} ${hours}h` });
      activity(db, g.user.householdId, "support", "A support session was allowed");
      return { ok: true, active: shape(activeSupport(db, g.user.householdId)) };
    })
    .delete("/api/admin/support/:id", ({ request, params, set }: any) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const r = db.query("UPDATE support_sessions SET ended_at = ? WHERE id = ? AND household_id = ? AND ended_at IS NULL").run(Date.now(), params.id, g.user.householdId);
      if (!r.changes) return deny(set, 404, "not_found");
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "support.revoke", target: params.id, outcome: "success" });
      activity(db, g.user.householdId, "support", "A support session was ended");
      return { ok: true };
    });
}

type Pending = { challenge: string; kind: "enroll" | "login"; expires: number; token?: string; operatorId?: string };

/** Operator side: own identity store, own cookie, own limits. Household sessions mean nothing here, and vice versa. */
export function opsRoutes(d: { db: Database; webauthn: WebAuthnService; secure: boolean; ha: HaApi; health: HealthSnapshot; routines: RoutineService; automations: AutomationService }) {
  const { db } = d, cookie = COOKIE(d.secure);
  const pending = new Map<string, Pending>(), ipLimit = new RateLimiter(20, 60_000), failures = new RateLimiter(5, 15 * 60_000);
  const stash = (p: Omit<Pending, "expires">) => { const id = randomUUID(); pending.set(id, { ...p, expires: Date.now() + 5 * 60_000 }); return id; };
  const take = (id: unknown, kind: Pending["kind"]) => { const p = typeof id === "string" ? pending.get(id) : undefined; if (typeof id === "string") pending.delete(id); return p && p.kind === kind && p.expires > Date.now() ? p : null; };
  const setCookie = (t: string, age: number) => `${cookie}=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${d.secure ? "; Secure" : ""}`;
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error, message: say(error) }; };

  function operatorFrom(req: Request) {
    const t = readCookie(req, cookie); if (!t) return null;
    const r: any = db.query("SELECT s.created_at, s.last_seen, o.id, o.name, o.status FROM operator_sessions s JOIN operators o ON o.id = s.operator_id WHERE s.token_hash = ?").get(sha256(t));
    const now = Date.now();
    if (!r || r.status !== "active" || now - r.created_at > OPS.absoluteMs || now - r.last_seen > OPS.idleMs) { if (r) db.query("DELETE FROM operator_sessions WHERE token_hash = ?").run(sha256(t)); return null; }
    db.query("UPDATE operator_sessions SET last_seen = ? WHERE token_hash = ?").run(now, sha256(t));
    return { id: r.id as string, name: r.name as string };
  }
  const startSession = (opId: string) => { const t = newToken(); db.query("INSERT INTO operator_sessions (token_hash, operator_id, created_at, last_seen) VALUES (?,?,?,?)").run(sha256(t), opId, Date.now(), Date.now()); return t; };
  const household = () => (db.query("SELECT id FROM households LIMIT 1").get() as any)?.id as string | undefined;
  const log = (op: { id: string }, action: string, outcome: "success" | "failure" | "denied" = "success", target?: string) => audit(db, { householdId: household(), actorType: "operator", actorId: op.id, action, target, outcome });
  /** The only door to a home's data: an active grant, claimed by this operator, covering this scope. */
  function window(op: { id: string }, scope: string, set: any) {
    const h = household(), s = h ? activeSupport(db, h) : null;
    if (!s || s.operator_id !== op.id || !(JSON.parse(s.scopes) as string[]).includes(scope)) { log(op, `ops.${scope}`, "denied"); return deny(set, 403, "forbidden"); }
    return s;
  }

  return new Elysia({ name: "ops" })
    .onBeforeHandle(({ request, set }) => { if (new URL(request.url).pathname.startsWith("/api/ops/auth/") && !ipLimit.take(clientIp(request))) { set.status = 429; return { error: "rate_limited" }; } })
    .post("/api/ops/auth/enroll/options", async ({ body, set }: any) => {
      const t: any = typeof body?.token === "string" ? db.query("SELECT * FROM operator_enrollment WHERE token_hash = ?").get(sha256(body.token)) : null;
      if (!t || t.used_at || t.expires_at < Date.now()) { audit(db, { actorType: "anonymous", action: "ops.enroll.options", outcome: "failure" }); return deny(set, 400, "invalid_or_expired_code"); }
      const o: any = db.query("SELECT id, name FROM operators WHERE id = ?").get(t.operator_id);
      const { options, challenge } = await d.webauthn.regOptions({ id: o.id, name: o.name }, [], { hardwareKey: true });
      return { challengeId: stash({ challenge, kind: "enroll", token: body.token, operatorId: o.id }), options };
    })
    .post("/api/ops/auth/enroll/verify", async ({ body, set }: any) => {
      const p = take(body?.challengeId, "enroll");
      const t: any = p?.token ? db.query("SELECT * FROM operator_enrollment WHERE token_hash = ?").get(sha256(p.token)) : null;
      if (!p || !t || t.used_at || t.expires_at < Date.now()) return deny(set, 400, "invalid_or_expired_code");
      const cred = await d.webauthn.regVerify(body?.response, p.challenge);
      if (!cred) { audit(db, { actorType: "anonymous", action: "ops.enroll.verify", outcome: "failure" }); return deny(set, 400, "passkey_rejected"); }
      db.transaction(() => {
        if (db.query("UPDATE operator_enrollment SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(Date.now(), t.token_hash).changes !== 1) throw new Error("used");
        db.query("INSERT INTO operator_passkeys (credential_id, operator_id, public_key, counter, transports, created_at) VALUES (?,?,?,?,?,?)").run(cred.credentialId, p.operatorId!, cred.publicKey, cred.counter, JSON.stringify(cred.transports), Date.now());
        db.query("UPDATE operators SET status = 'active' WHERE id = ? AND status != 'revoked'").run(p.operatorId!);
      })();
      audit(db, { actorType: "operator", actorId: p.operatorId, action: "ops.enroll", outcome: "success" });
      set.headers["set-cookie"] = setCookie(startSession(p.operatorId!), OPS.absoluteMs / 1000);
      return { ok: true };
    })
    .post("/api/ops/auth/login/options", async ({ request, set }) => {
      if (failures.count(clientIp(request)) >= 5) return deny(set, 429, "rate_limited");
      const { options, challenge } = await d.webauthn.authOptions();
      return { challengeId: stash({ challenge, kind: "login" }), options };
    })
    .post("/api/ops/auth/login/verify", async ({ body, request, set }: any) => {
      const ip = clientIp(request);
      if (failures.count(ip) >= 5) return deny(set, 429, "rate_limited");
      const p = take(body?.challengeId, "login");
      const row: any = p && typeof body?.response?.id === "string" ? db.query("SELECT k.*, o.status FROM operator_passkeys k JOIN operators o ON o.id = k.operator_id WHERE k.credential_id = ?").get(body.response.id) : null;
      const fail = () => { failures.record(ip); audit(db, { actorType: "anonymous", actorId: row?.operator_id, action: "ops.login", outcome: "failure" }); return deny(set, 401, "login_failed"); };
      if (!p || !row || row.status !== "active") return fail();
      const n = await d.webauthn.authVerify(body.response, p.challenge, { credentialId: row.credential_id, publicKey: row.public_key, counter: row.counter, transports: JSON.parse(row.transports ?? "[]") });
      if (n === null) return fail();
      db.query("UPDATE operator_passkeys SET counter = ? WHERE credential_id = ?").run(n, row.credential_id);
      audit(db, { actorType: "operator", actorId: row.operator_id, action: "ops.login", outcome: "success" });
      set.headers["set-cookie"] = setCookie(startSession(row.operator_id), OPS.absoluteMs / 1000);
      return { ok: true };
    })
    .post("/api/ops/auth/logout", ({ request, set }) => { const t = readCookie(request, cookie); if (t) db.query("DELETE FROM operator_sessions WHERE token_hash = ?").run(sha256(t)); set.headers["set-cookie"] = setCookie("", 0); return { ok: true }; })
    .get("/api/ops/me", ({ request, set }) => { const op = operatorFrom(request); return op ? op : deny(set, 401, "unauthenticated"); })
    .get("/api/ops/support", ({ request, set }) => {
      const op = operatorFrom(request); if (!op) return deny(set, 401, "unauthenticated");
      const h = household(), s = h ? activeSupport(db, h) : null;
      return { active: s ? { id: s.id, scopes: JSON.parse(s.scopes), expiresAt: s.expires_at, claimedByYou: s.operator_id === op.id, claimedByOther: !!s.operator_id && s.operator_id !== op.id } : null };
    })
    .post("/api/ops/support/claim", ({ request, set }) => {
      const op = operatorFrom(request); if (!op) return deny(set, 401, "unauthenticated");
      const h = household(), s = h ? activeSupport(db, h) : null;
      if (!s || (s.operator_id && s.operator_id !== op.id)) { log(op, "ops.claim", "denied"); return deny(set, 404, "not_found"); }
      if (!s.operator_id) { db.query("UPDATE support_sessions SET operator_id = ?, claimed_at = ? WHERE id = ?").run(op.id, Date.now(), s.id); activity(db, h!, "support", "Support connected"); }
      log(op, "ops.claim", "success", s.id);
      return { ok: true };
    })
    .get("/api/ops/support/diagnostics", ({ request, set }) => {
      const op = operatorFrom(request); if (!op) return deny(set, 401, "unauthenticated");
      const w = window(op, "diagnostics", set); if (!("id" in w)) return w;
      log(op, "ops.diagnostics", "success", w.id);
      return d.health(w.household_id);
    })
    // Structure only: names of rooms, devices, scenes, routines and automations. No people, no history, no credentials.
    .get("/api/ops/support/config", ({ request, set }) => {
      const op = operatorFrom(request); if (!op) return deny(set, 401, "unauthenticated");
      const w = window(op, "read_config", set); if (!("id" in w)) return w;
      log(op, "ops.read_config", "success", w.id);
      const h = w.household_id as string;
      return {
        rooms: (db.query("SELECT id, name FROM rooms WHERE household_id = ?").all(h) as any[]),
        devices: (db.query("SELECT entity_id id, name, room_id roomId, hidden FROM device_meta WHERE household_id = ?").all(h) as any[]).map((r) => ({ ...r, hidden: !!r.hidden })),
        routines: d.routines.rows(h).map((r) => { const v = d.routines.view(r); return { name: v.name, summary: v.summary, needsAttention: v.needsAttention }; }),
        automations: d.automations.rows(h).map((r) => { const v = d.automations.view(r); return { name: v.name, summary: v.summary, enabled: v.enabled, needsAttention: v.needsAttention }; }),
      };
    })
    .post("/api/ops/support/end", ({ request, set }) => {
      const op = operatorFrom(request); if (!op) return deny(set, 401, "unauthenticated");
      const h = household(), s = h ? activeSupport(db, h) : null;
      if (!s || s.operator_id !== op.id) return deny(set, 404, "not_found");
      db.query("UPDATE support_sessions SET ended_at = ? WHERE id = ?").run(Date.now(), s.id);
      activity(db, h!, "support", "Support disconnected");
      log(op, "ops.end", "success", s.id);
      return { ok: true };
    });
}
