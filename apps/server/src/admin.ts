import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { audit, activity } from "./audit";
import { ENROLL_TTL, issueEnrollmentToken } from "./auth";
import { authorize } from "./guard";
import { destroyUserSessions, type SessionUser } from "./session";
import { isPermission, isRole, type Permission, type Role } from "./policy";
import { all, one, scalar } from "./sql";
import { asObject, deny, text } from "./http";

const ADMIN_ONLY_PERMS: readonly Permission[] = ["users.manage", "admin.access"];

type TargetUser = { id: string; household_id: string; display_name: string; role: Role; status: "active" | "pending" | "revoked" };

export function adminRoutes(db: Database, secure: boolean) {
  const need = (req: Request, sensitive = false) => authorize(db, req, secure, ["admin.access", "users.manage"], sensitive);
  const target = (actor: SessionUser, id: string) =>
    one<TargetUser>(db, "SELECT id, household_id, display_name, role, status FROM users WHERE id = ? AND household_id = ?", id, actor.householdId);
  const activeAdmins = (h: string) => scalar(db, "SELECT COUNT(*) FROM users WHERE household_id = ? AND role='admin' AND status='active'", 0, h);

  return new Elysia({ name: "admin" })
    .get("/api/admin/users", ({ request, set }) => {
      const g = need(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const users = all(db, "SELECT id, display_name AS displayName, role, status FROM users WHERE household_id = ? ORDER BY created_at", g.user.householdId);
      return { users };
    })
    // Household-visible activity. No actor information exists in this table.
    .get("/api/admin/activity", ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { events: all(db, "SELECT ts, kind, summary FROM activity_events WHERE household_id = ? ORDER BY ts DESC LIMIT 200", g.user.householdId) };
    })
    .post("/api/admin/users", ({ request, body, set }) => {
      const g = need(request, true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const input = asObject(body), name = text(input.displayName).trim().slice(0, 60), role = input.role;
      if (!name || !isRole(role)) return deny(set, 400, "invalid_input");
      if (role === "admin" && g.user.role !== "admin") { audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "user.invite", outcome: "denied", reason: "escalation" }); return deny(set, 403, "forbidden"); }
      const id = randomUUID();
      db.query("INSERT INTO users (id, household_id, display_name, role, status, created_at) VALUES (?,?,?,?, 'pending', ?)").run(id, g.user.householdId, name, role, Date.now());
      const code = issueEnrollmentToken(db, "invite", id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "user.invite", target: id, outcome: "success", reason: role });
      activity(db, g.user.householdId, "users", `${name} was invited as ${role}`);
      return { userId: id, enrollmentCode: code, expiresAt: Date.now() + ENROLL_TTL.invite };
    })
    .post("/api/admin/users/:id/recovery", ({ request, params, set }) => {
      const g = need(request, true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const t = target(g.user, params.id);
      if (!t || t.status === "revoked") return deny(set, 404, "not_found");
      if (t.role === "admin" && g.user.role !== "admin") return deny(set, 403, "forbidden");
      const code = issueEnrollmentToken(db, "recovery", t.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "user.recovery_issued", target: t.id, outcome: "success" });
      return { enrollmentCode: code, expiresAt: Date.now() + ENROLL_TTL.recovery };
    })
    .patch("/api/admin/users/:id", ({ request, params, body, set }) => {
      const g = need(request, true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const t = target(g.user, params.id), role = asObject(body).role;
      if (!t || !isRole(role)) return deny(set, t ? 400 : 404, t ? "invalid_input" : "not_found");
      if ((role === "admin" || t.role === "admin") && g.user.role !== "admin") { audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "user.role", target: t.id, outcome: "denied", reason: "escalation" }); return deny(set, 403, "forbidden"); }
      if (t.role === "admin" && role !== "admin" && t.status === "active" && activeAdmins(g.user.householdId) <= 1) return deny(set, 409, "last_admin");
      db.query("UPDATE users SET role = ? WHERE id = ?").run(role, t.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "user.role", target: t.id, outcome: "success", reason: `${t.role}->${role}` });
      activity(db, g.user.householdId, "users", `${t.display_name} is now ${role}`);
      return { ok: true };
    })
    .put("/api/admin/users/:id/permissions", ({ request, params, body, set }) => {
      const g = need(request, true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const t = target(g.user, params.id), ov = asObject(body).overrides;
      if (!t) return deny(set, 404, "not_found");
      if (!ov || typeof ov !== "object") return deny(set, 400, "invalid_input");
      if (t.role === "admin" && g.user.role !== "admin") return deny(set, 403, "forbidden");
      for (const [perm, v] of Object.entries(ov)) {
        if (!isPermission(perm) || (v !== true && v !== false && v !== null)) return deny(set, 400, "invalid_input");
        const escalates = v === true && (!g.user.permissions.includes(perm) || (ADMIN_ONLY_PERMS.includes(perm) && g.user.role !== "admin"));
        if (escalates) { audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "user.permissions", target: t.id, outcome: "denied", reason: `escalation:${perm}` }); return deny(set, 403, "forbidden"); }
      }
      db.transaction(() => {
        for (const [perm, v] of Object.entries(ov)) {
          if (v === null) db.query("DELETE FROM permission_overrides WHERE user_id = ? AND permission = ?").run(t.id, perm);
          else db.query("INSERT INTO permission_overrides (user_id, permission, granted) VALUES (?,?,?) ON CONFLICT(user_id, permission) DO UPDATE SET granted = excluded.granted").run(t.id, perm, v ? 1 : 0);
        }
      })();
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "user.permissions", target: t.id, outcome: "success", reason: JSON.stringify(ov) });
      return { ok: true };
    })
    .delete("/api/admin/users/:id", ({ request, params, set }) => {
      const g = need(request, true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const t = target(g.user, params.id);
      if (!t) return deny(set, 404, "not_found");
      if (t.role === "admin" && g.user.role !== "admin") return deny(set, 403, "forbidden");
      if (t.role === "admin" && t.status === "active" && activeAdmins(g.user.householdId) <= 1) return deny(set, 409, "last_admin");
      db.query("UPDATE users SET status = 'revoked' WHERE id = ?").run(t.id);
      destroyUserSessions(db, t.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "user.revoked", target: t.id, outcome: "success" });
      activity(db, g.user.householdId, "users", `${t.display_name}'s access was removed`);
      return { ok: true };
    });
}
