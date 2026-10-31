import { createHash, randomBytes } from "node:crypto";
import type { Database } from "bun:sqlite";
import { effectivePermissions, type Permission, type Role } from "./policy";

// Documented lifetimes (see docs/SECURITY.md).
export const SESSION = { idleMs: 7 * 864e5, absoluteMs: 30 * 864e5, reauthMs: 10 * 6e4 };

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

export type SessionUser = {
  id: string; householdId: string; displayName: string; role: Role;
  permissions: Permission[]; reauthAt: number; tokenHash: string;
};

export function createSession(db: Database, userId: string): string {
  const token = newToken(), now = Date.now();
  db.query("INSERT INTO sessions (token_hash, user_id, created_at, last_seen, reauth_at) VALUES (?,?,?,?,?)")
    .run(sha256(token), userId, now, now, now);
  return token;
}

export function lookupSession(db: Database, token: string | null | undefined): SessionUser | null {
  if (!token) return null;
  const h = sha256(token), now = Date.now();
  const r: any = db.query(
    `SELECT s.created_at, s.last_seen, s.reauth_at, u.id, u.household_id, u.display_name, u.role, u.status
     FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).get(h);
  if (!r) return null;
  if (r.status !== "active" || now - r.created_at > SESSION.absoluteMs || now - r.last_seen > SESSION.idleMs) {
    db.query("DELETE FROM sessions WHERE token_hash = ?").run(h);
    return null;
  }
  if (now - r.last_seen > 6e4) db.query("UPDATE sessions SET last_seen = ? WHERE token_hash = ?").run(now, h);
  const overrides: Record<string, boolean> = {};
  for (const o of db.query("SELECT permission, granted FROM permission_overrides WHERE user_id = ?").all(r.id) as any[]) overrides[o.permission] = !!o.granted;
  return {
    id: r.id, householdId: r.household_id, displayName: r.display_name, role: r.role,
    permissions: effectivePermissions(r.role, overrides), reauthAt: r.reauth_at, tokenHash: h,
  };
}

export const destroySession = (db: Database, token: string) => db.query("DELETE FROM sessions WHERE token_hash = ?").run(sha256(token));
export const destroyUserSessions = (db: Database, userId: string) => db.query("DELETE FROM sessions WHERE user_id = ?").run(userId);
export const markReauth = (db: Database, tokenHash: string) => db.query("UPDATE sessions SET reauth_at = ? WHERE token_hash = ?").run(Date.now(), tokenHash);
