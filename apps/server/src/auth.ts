import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { audit, activity } from "./audit";
import { RateLimiter } from "./ratelimit";
import {
  SESSION, createSession, destroySession, destroyUserSessions, lookupSession, markReauth, newToken, sha256,
  type SessionUser,
} from "./session";
import type { StoredCredential, WebAuthnService } from "./webauthn";
import type { Permission } from "./policy";
import { all, one, scalar } from "./sql";
import { asObject, text } from "./http";

export type AuthDeps = {
  db: Database; webauthn: WebAuthnService; origin: string; cookieSecure: boolean;
};

const COOKIE = (secure: boolean) => (secure ? "__Host-sid" : "sid");
const CHALLENGE_TTL = 5 * 6e4;
export const ENROLL_TTL = { bootstrap: 60 * 6e4, invite: 24 * 60 * 6e4, recovery: 60 * 6e4 };

export function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return v.join("=");
  }
  return null;
}

type TokenPurpose = "bootstrap" | "invite" | "recovery";
type EnrollmentTokenRow = { token_hash: string; purpose: TokenPurpose; user_id: string | null; expires_at: number; used_at: number | null };
type PasskeyRow = { credential_id: string; user_id: string; public_key: string; counter: number; transports: string | null };
type LoginRow = PasskeyRow & { household_id: string; status: string };

const storedCredential = (row: PasskeyRow): StoredCredential => ({
  credentialId: row.credential_id, publicKey: row.public_key, counter: row.counter, transports: JSON.parse(row.transports ?? "[]") as string[],
});

export function clientIp(req: Request): string {
  // Only Caddy can reach the app; it appends the real peer as the LAST X-Forwarded-For entry.
  const xff = req.headers.get("x-forwarded-for");
  return xff ? (xff.split(",").pop() ?? "").trim() : "local";
}

export function issueEnrollmentToken(db: Database, purpose: TokenPurpose, userId: string | null): string {
  const token = newToken();
  db.query("INSERT INTO enrollment_tokens (token_hash, purpose, user_id, expires_at) VALUES (?,?,?,?)")
    .run(sha256(token), purpose, userId, Date.now() + ENROLL_TTL[purpose]);
  return token;
}

/** Create a one-time setup code when no household exists yet. Returns the code, or null. */
export function ensureBootstrapCode(db: Database): string | null {
  if (scalar(db, "SELECT COUNT(*) FROM users", 0) > 0) return null;
  db.query("DELETE FROM enrollment_tokens WHERE purpose='bootstrap'").run();
  const code = issueEnrollmentToken(db, "bootstrap", null);
  audit(db, { actorType: "system", action: "bootstrap.code_issued", outcome: "success" });
  return code;
}

type Pending = { challenge: string; kind: "enroll" | "login" | "reauth"; expires: number; token?: string; userId?: string; displayName?: string };

export function authRoutes(d: AuthDeps) {
  const { db } = d;
  const pending = new Map<string, Pending>();
  const ipLimit = new RateLimiter(30, 60_000);
  const failures = new RateLimiter(10, 15 * 60_000); // brute-force lockout per IP
  const cookieName = COOKIE(d.cookieSecure);

  const stash = (p: Omit<Pending, "expires">) => {
    const id = randomUUID();
    pending.set(id, { ...p, expires: Date.now() + CHALLENGE_TTL });
    if (pending.size > 1000) for (const [k, v] of pending) if (v.expires < Date.now()) pending.delete(k);
    return id;
  };
  const take = (id: unknown, kind: Pending["kind"]) => {
    const p = typeof id === "string" ? pending.get(id) : undefined;
    if (typeof id === "string") pending.delete(id); // single use
    return p && p.kind === kind && p.expires > Date.now() ? p : null;
  };
  const cookieHeader = (token: string, maxAgeS: number) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeS}${d.cookieSecure ? "; Secure" : ""}`;

  const checkToken = (token: unknown) => {
    if (typeof token !== "string") return null;
    const r = one<EnrollmentTokenRow>(db, "SELECT * FROM enrollment_tokens WHERE token_hash = ?", sha256(token));
    return r && !r.used_at && r.expires_at > Date.now() ? r : null;
  };

  return new Elysia({ name: "auth" })
    .onBeforeHandle(({ request, set }) => {
      const p = new URL(request.url).pathname;
      if (!p.startsWith("/api/auth/")) return;
      if (!ipLimit.take(clientIp(request))) { set.status = 429; return { error: "rate_limited" }; }
      return undefined;
    })
    // ---- enrollment (bootstrap / invite / recovery) ----
    .post("/api/auth/enroll/options", async ({ body, set }) => {
      const input = asObject(body), token = input.token;
      const t = checkToken(token);
      if (!t) { audit(db, { actorType: "anonymous", action: "enroll.options", outcome: "failure", reason: "bad_token" }); set.status = 400; return { error: "invalid_or_expired_code" }; }
      let user: { id: string; name: string }, displayName: string | undefined, userId: string | undefined;
      if (t.purpose === "bootstrap") {
        displayName = text(input.displayName).trim().slice(0, 60);
        if (!displayName) { set.status = 400; return { error: "display_name_required" }; }
        user = { id: randomUUID(), name: displayName };
      } else {
        const u = one<{ id: string; display_name: string }>(db, "SELECT id, display_name FROM users WHERE id = ?", t.user_id);
        if (!u) { set.status = 400; return { error: "invalid_or_expired_code" }; }
        user = { id: u.id, name: u.display_name }; userId = u.id;
      }
      const exclude = t.purpose === "invite" ? [] : all<{ credential_id: string }>(db, "SELECT credential_id FROM passkeys WHERE user_id = ?", user.id).map((r) => r.credential_id);
      const { options, challenge } = await d.webauthn.regOptions(user, t.purpose === "recovery" ? [] : exclude);
      return { challengeId: stash({ challenge, kind: "enroll", token: text(token), userId: userId ?? user.id, ...(displayName !== undefined && { displayName }) }), options };
    })
    .post("/api/auth/enroll/verify", async ({ body, set }) => {
      const input = asObject(body);
      const p = take(input.challengeId, "enroll");
      const t = checkToken(p?.token);
      if (!p || !t) { set.status = 400; return { error: "invalid_or_expired_code" }; }
      const cred = await d.webauthn.regVerify(input.response, p.challenge);
      if (!cred) { audit(db, { actorType: "anonymous", action: "enroll.verify", outcome: "failure", reason: "attestation" }); set.status = 400; return { error: "passkey_rejected" }; }
      let userId = t.user_id, householdId = "";
      const tx = db.transaction(() => {
        const used = db.query("UPDATE enrollment_tokens SET used_at = ? WHERE token_hash = ? AND used_at IS NULL").run(Date.now(), t.token_hash);
        if (used.changes !== 1) throw new Error("token_used");
        if (t.purpose === "bootstrap") {
          if (scalar(db, "SELECT COUNT(*) FROM users", 0) > 0) throw new Error("already_set_up");
          householdId = randomUUID(); userId = p.userId ?? randomUUID();
          db.query("INSERT INTO households (id, name) VALUES (?,?)").run(householdId, "My Home");
          db.query("INSERT INTO users (id, household_id, display_name, role, status, created_at) VALUES (?,?,?,?, 'active', ?)")
            .run(userId, householdId, p.displayName ?? "", "admin", Date.now());
        } else {
          const owner = one<{ household_id: string }>(db, "SELECT household_id FROM users WHERE id = ?", userId);
          if (!owner) throw new Error("unknown_user");
          householdId = owner.household_id;
          if (t.purpose === "recovery" && userId) {
            db.query("DELETE FROM passkeys WHERE user_id = ?").run(userId); // lost device: old passkeys stop working
            destroyUserSessions(db, userId);
          }
          db.query("UPDATE users SET status = 'active' WHERE id = ? AND status != 'revoked'").run(userId);
        }
        db.query("INSERT INTO passkeys (credential_id, user_id, public_key, counter, transports, created_at) VALUES (?,?,?,?,?,?)")
          .run(cred.credentialId, userId, cred.publicKey, cred.counter, JSON.stringify(cred.transports), Date.now());
      });
      try { tx(); } catch (e) {
        audit(db, { actorType: "anonymous", action: `enroll.${t.purpose}`, outcome: "failure", reason: e instanceof Error ? e.message : String(e) });
        set.status = 400; return { error: "invalid_or_expired_code" };
      }
      audit(db, { householdId, actorType: "user", actorId: userId, action: `enroll.${t.purpose}`, target: userId, outcome: "success" });
      if (t.purpose === "bootstrap") activity(db, householdId, "household", "Household created");
      const token = createSession(db, userId ?? "");
      set.headers["set-cookie"] = cookieHeader(token, SESSION.absoluteMs / 1000);
      return { ok: true };
    })
    // ---- login (discoverable credential, no username) ----
    .post("/api/auth/login/options", async ({ request, set }) => {
      if (failures.count(clientIp(request)) >= 10) { set.status = 429; return { error: "rate_limited" }; }
      const { options, challenge } = await d.webauthn.authOptions();
      return { challengeId: stash({ challenge, kind: "login" }), options };
    })
    .post("/api/auth/login/verify", async ({ body, request, set }) => {
      const ip = clientIp(request);
      if (failures.count(ip) >= 10) { set.status = 429; return { error: "rate_limited" }; }
      const input = asObject(body), response = asObject(input.response);
      const p = take(input.challengeId, "login");
      const credId = response.id;
      const row = p && typeof credId === "string" ? one<LoginRow>(db,
        "SELECT p.*, u.household_id, u.status FROM passkeys p JOIN users u ON u.id = p.user_id WHERE p.credential_id = ?", credId) : null;
      const fail = (reason: string) => {
        failures.record(ip);
        audit(db, { householdId: row?.household_id ?? null, actorType: "anonymous", actorId: row?.user_id ?? null, action: "login", outcome: "failure", reason });
        set.status = 401; return { error: "login_failed" };
      };
      if (!p || !row || row.status !== "active") return fail("unknown_challenge_or_credential");
      const newCounter = await d.webauthn.authVerify(input.response, p.challenge, storedCredential(row));
      if (newCounter === null) return fail("assertion_invalid");
      db.query("UPDATE passkeys SET counter = ? WHERE credential_id = ?").run(newCounter, row.credential_id);
      const token = createSession(db, row.user_id); // fresh id on every login: no fixation
      audit(db, { householdId: row.household_id, actorType: "user", actorId: row.user_id, action: "login", outcome: "success" });
      set.headers["set-cookie"] = cookieHeader(token, SESSION.absoluteMs / 1000);
      return { ok: true };
    })
    // ---- re-authentication for sensitive actions ----
    .post("/api/auth/reauth/options", async ({ request, set }) => {
      const me = lookupSession(db, readCookie(request, cookieName));
      if (!me) { set.status = 401; return { error: "unauthenticated" }; }
      const { options, challenge } = await d.webauthn.authOptions();
      return { challengeId: stash({ challenge, kind: "reauth", userId: me.id }), options };
    })
    .post("/api/auth/reauth/verify", async ({ body, request, set }) => {
      const me = lookupSession(db, readCookie(request, cookieName));
      const input = asObject(body), credId = asObject(input.response).id;
      const p = take(input.challengeId, "reauth");
      if (!me || !p || p.userId !== me.id) { set.status = 401; return { error: "reauth_failed" }; }
      const row = typeof credId === "string" ? one<PasskeyRow>(db, "SELECT * FROM passkeys WHERE credential_id = ? AND user_id = ?", credId, me.id) : null;
      const n = row ? await d.webauthn.authVerify(input.response, p.challenge, storedCredential(row)) : null;
      if (!row || n === null) { audit(db, { householdId: me.householdId, actorType: "user", actorId: me.id, action: "reauth", outcome: "failure" }); set.status = 401; return { error: "reauth_failed" }; }
      db.query("UPDATE passkeys SET counter = ? WHERE credential_id = ?").run(n, row.credential_id);
      markReauth(db, me.tokenHash);
      audit(db, { householdId: me.householdId, actorType: "user", actorId: me.id, action: "reauth", outcome: "success" });
      return { ok: true };
    })
    .post("/api/auth/logout", ({ request, set }) => {
      const t = readCookie(request, cookieName);
      if (t) destroySession(db, t);
      set.headers["set-cookie"] = cookieHeader("", 0);
      return { ok: true };
    })
    .get("/api/me", ({ request, set }) => {
      const me = lookupSession(db, readCookie(request, cookieName));
      if (!me) { set.status = 401; return { error: "unauthenticated" }; }
      return { id: me.id, displayName: me.displayName, role: me.role, permissions: me.permissions };
    });
}

export function sessionFrom(db: Database, req: Request, secure: boolean): SessionUser | null {
  return lookupSession(db, readCookie(req, COOKIE(secure)));
}

export type Guard = { perm?: Permission; sensitive?: boolean };
