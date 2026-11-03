import { expect, test } from "bun:test";
import { all, scalar } from "./sql";
import { setup, type Body } from "./testkit";
import { SESSION } from "./session";

async function household() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  return { t, admin: admin.cookie!, member, guest };
}

test("role defaults: member and guest permissions", async () => {
  const { t, member, guest } = await household();
  const m = (await t.call("GET", "/api/me", { cookie: member.cookie })).json;
  expect(m.permissions).toContain("automation.manage");
  expect(m.permissions).not.toContain("admin.access");
  const g = (await t.call("GET", "/api/me", { cookie: guest.cookie })).json;
  expect(g.permissions).not.toContain("automation.manage");
  expect(g.permissions).not.toContain("rooms.manage");
  expect(g.permissions).not.toContain("users.manage");
});

test("members and guests cannot use any admin endpoint (server-side)", async () => {
  const { t, member, guest } = await household();
  for (const who of [member, guest]) {
    for (const [m, p, b] of [["GET", "/api/admin/users"], ["GET", "/api/admin/activity"], ["POST", "/api/admin/users", { displayName: "x", role: "guest" }],
      ["PATCH", `/api/admin/users/${guest.userId}`, { role: "admin" }], ["PUT", `/api/admin/users/${guest.userId}/permissions`, { overrides: { "users.manage": true } }],
      ["POST", `/api/admin/users/${guest.userId}/recovery`], ["DELETE", `/api/admin/users/${guest.userId}`]] as Body[]) {
      expect((await t.call(m, p, { cookie: who.cookie, body: b })).status).toBe(403);
    }
  }
  expect(t.db.query("SELECT COUNT(*) c FROM security_audit WHERE action='authz.denied'").get()).toEqual({ c: 14 });
});

test("admin can manage users; sensitive actions need a recent re-authentication", async () => {
  const { t, admin } = await household();
  expect((await t.call("GET", "/api/admin/users", { cookie: admin })).json.users.length).toBe(3);
  t.db.query("UPDATE sessions SET reauth_at = ?").run(Date.now() - SESSION.reauthMs - 1000);
  const r = await t.call("POST", "/api/admin/users", { cookie: admin, body: { displayName: "N", role: "guest" } });
  expect(r.status).toBe(401);
  expect(r.json).toEqual({ error: "reauth_required" });
  await t.reauth(admin, "a1");
  expect((await t.call("POST", "/api/admin/users", { cookie: admin, body: { displayName: "N", role: "guest" } })).status).toBe(200);
});

test("per-user overrides are enforced and revocable", async () => {
  const { t, admin, member } = await household();
  expect((await t.call("PUT", `/api/admin/users/${member.userId}/permissions`, { cookie: admin, body: { overrides: { "automation.manage": false, "rooms.manage": true } } })).status).toBe(200);
  const me = (await t.call("GET", "/api/me", { cookie: member.cookie })).json;
  expect(me.permissions).not.toContain("automation.manage");
  expect(me.permissions).toContain("rooms.manage");
  await t.call("PUT", `/api/admin/users/${member.userId}/permissions`, { cookie: admin, body: { overrides: { "automation.manage": null } } });
  expect((await t.call("GET", "/api/me", { cookie: member.cookie })).json.permissions).toContain("automation.manage");
});

test("no privilege escalation via delegated users.manage", async () => {
  const { t, admin, member, guest } = await household();
  // Admin delegates user management (and admin pages) to a member.
  await t.call("PUT", `/api/admin/users/${member.userId}/permissions`, { cookie: admin, body: { overrides: { "users.manage": true, "admin.access": true } } });
  await t.reauth(member.cookie, "m1");
  expect((await t.call("GET", "/api/admin/users", { cookie: member.cookie })).status).toBe(200);
  const call = (m: string, p: string, body?: unknown) => t.call(m, p, { cookie: member.cookie, body });
  expect((await call("POST", "/api/admin/users", { displayName: "x", role: "admin" })).status).toBe(403);
  expect((await call("PATCH", `/api/admin/users/${guest.userId}`, { role: "admin" })).status).toBe(403);
  expect((await call("PUT", `/api/admin/users/${guest.userId}/permissions`, { overrides: { "users.manage": true } })).status).toBe(403);
  expect((await call("PUT", `/api/admin/users/${guest.userId}/permissions`, { overrides: { "rooms.manage": true } })).status).toBe(403); // member lacks it, can't hand it out
  const adminId = scalar(t.db, "SELECT id FROM users WHERE role='admin'", "");
  expect((await call("POST", `/api/admin/users/${adminId}/recovery`)).status).toBe(403);
  expect((await call("DELETE", `/api/admin/users/${adminId}`)).status).toBe(403);
});

test("the last active admin cannot be demoted or removed", async () => {
  const { t, admin } = await household();
  const adminId = scalar(t.db, "SELECT id FROM users WHERE role='admin'", "");
  expect((await t.call("PATCH", `/api/admin/users/${adminId}`, { cookie: admin, body: { role: "member" } })).status).toBe(409);
  expect((await t.call("DELETE", `/api/admin/users/${adminId}`, { cookie: admin })).status).toBe(409);
});

test("revoking a user ends their sessions and blocks login", async () => {
  const { t, admin, guest } = await household();
  expect((await t.call("DELETE", `/api/admin/users/${guest.userId}`, { cookie: admin })).status).toBe(200);
  expect((await t.call("GET", "/api/me", { cookie: guest.cookie })).status).toBe(401);
  expect((await t.login("g1")).status).toBe(401);
});

test("household privacy: admin APIs never reveal who did what; audit is append-only", async () => {
  const { t, admin, member } = await household();
  await t.call("PATCH", `/api/admin/users/${member.userId}`, { cookie: admin, body: { role: "guest" } });
  const act = await t.call("GET", "/api/admin/activity", { cookie: admin });
  expect(act.json.events.length).toBeGreaterThan(0);
  const dump = JSON.stringify([act.json, (await t.call("GET", "/api/admin/users", { cookie: admin })).json]).toLowerCase();
  expect(dump).not.toContain("actor");
  expect(Object.keys(act.json.events[0]).sort()).toEqual(["kind", "summary", "ts"]);
  const cols = all<{ name: string }>(t.db, "PRAGMA table_info(activity_events)").map((c) => c.name);
  expect(cols.some((c) => c.includes("actor") || c.includes("user"))).toBe(false);
  // No route exposes security_audit at all.
  for (const p of ["/api/admin/audit", "/api/audit", "/api/admin/security-audit"]) expect((await t.call("GET", p, { cookie: admin })).status).toBe(404);
  expect(() => t.db.query("UPDATE security_audit SET outcome='x'").run()).toThrow();
  expect(() => t.db.query("DELETE FROM security_audit").run()).toThrow();
});

test("users in other households are not reachable", async () => {
  const { t, admin } = await household();
  t.db.query("INSERT INTO households (id, name) VALUES ('h2','Other')").run();
  t.db.query("INSERT INTO users (id, household_id, display_name, role, status, created_at) VALUES ('u2','h2','Eve','member','active',1)").run();
  expect((await t.call("PATCH", "/api/admin/users/u2", { cookie: admin, body: { role: "admin" } })).status).toBe(404);
  expect((await t.call("DELETE", "/api/admin/users/u2", { cookie: admin })).status).toBe(404);
  expect((await t.call("GET", "/api/admin/users", { cookie: admin })).json.users.some((u: Body) => u.id === "u2")).toBe(false);
});
