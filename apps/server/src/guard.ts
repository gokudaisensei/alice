import type { Database } from "bun:sqlite";
import { audit } from "./audit";
import { sessionFrom } from "./auth";
import { SESSION, type SessionUser } from "./session";
import type { Permission } from "./policy";

export type GuardResult = { user: SessionUser } | { status: number; body: { error: string } };

/** Server-side authorization for every protected route. Deny by default. */
export function authorize(db: Database, req: Request, secure: boolean, need: Permission[], sensitive = false): GuardResult {
  const user = sessionFrom(db, req, secure);
  if (!user) return { status: 401, body: { error: "unauthenticated" } };
  const missing = need.filter((p) => !user.permissions.includes(p));
  if (missing.length) {
    audit(db, { householdId: user.householdId, actorType: "user", actorId: user.id, action: "authz.denied", target: new URL(req.url).pathname, outcome: "denied", reason: missing.join(",") });
    return { status: 403, body: { error: "forbidden" } };
  }
  if (sensitive && Date.now() - user.reauthAt > SESSION.reauthMs) return { status: 401, body: { error: "reauth_required" } };
  return { user };
}
