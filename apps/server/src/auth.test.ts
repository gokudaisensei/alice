import { expect, test } from "bun:test";
import { setup } from "./testkit";
import { SESSION } from "./session";

test("bootstrap creates the first admin, who gets a session", async () => {
  const t = setup();
  const { status, cookie } = await t.bootstrapAdmin();
  expect(status).toBe(200);
  const me = await t.call("GET", "/api/me", { cookie });
  expect(me.json.role).toBe("admin");
  expect(me.json.permissions).toContain("users.manage");
});

test("bootstrap code is single-use and cannot create a second household", async () => {
  const t = setup();
  const { code } = await t.bootstrapAdmin();
  expect((await t.enroll(code, "evil")).status).toBe(400);
});

test("unauthenticated requests cannot reach protected resources", async () => {
  const t = setup();
  await t.bootstrapAdmin();
  for (const [m, p] of [["GET", "/api/me"], ["GET", "/api/admin/users"], ["GET", "/api/admin/activity"], ["POST", "/api/admin/users"], ["DELETE", "/api/admin/users/x"]] as const) {
    expect((await t.call(m, p, { body: m === "POST" ? {} : undefined })).status).toBe(401);
  }
});

test("CSRF: state-changing requests need the custom header and a matching Origin", async () => {
  const t = setup();
  const { cookie } = await t.bootstrapAdmin();
  const noHdr = await t.call("POST", "/api/auth/logout", { cookie, headers: { "x-requested-with": "" } });
  expect(noHdr.status).toBe(403);
  const badOrigin = await t.call("POST", "/api/auth/logout", { cookie, headers: { origin: "https://evil.test" } });
  expect(badOrigin.status).toBe(403);
  expect((await t.call("GET", "/api/me", { cookie })).status).toBe(200); // still logged in
});

test("login: success sets an HttpOnly cookie with a fresh session id; failure is generic and audited", async () => {
  const t = setup();
  const a = await t.bootstrapAdmin("c1");
  const ok = await t.login("c1");
  expect(ok.status).toBe(200);
  expect(ok.cookie).not.toBe(a.cookie); // no fixation: new id per login
  expect(ok.headers.get("set-cookie")).toContain("HttpOnly");
  const bad = await t.login("c1", false);
  expect(bad.status).toBe(401);
  expect(bad.json).toEqual({ error: "login_failed" });
  const unknown = await t.login("nope");
  expect(unknown.json).toEqual({ error: "login_failed" }); // same answer: no account enumeration
  expect(t.db.query("SELECT COUNT(*) c FROM security_audit WHERE action='login' AND outcome='failure'").get()).toEqual({ c: 2 });
});

test("brute force: repeated failures lock the source out, even for the right credential", async () => {
  const t = setup();
  await t.bootstrapAdmin("c1");
  for (let i = 0; i < 10; i++) await t.login("c1", false, "9.9.9.9");
  const r = await t.login("c1", true, "9.9.9.9");
  expect(r.status).toBe(429);
  expect((await t.login("c1", true, "8.8.8.8")).status).toBe(200); // other sources unaffected
});

test("auth endpoints are rate limited per source", async () => {
  const t = setup();
  let last = 0;
  for (let i = 0; i < 40; i++) last = (await t.call("POST", "/api/auth/login/options", { ip: "7.7.7.7" })).status;
  expect(last).toBe(429);
});

test("sessions expire when idle or past the absolute lifetime, and logout destroys them", async () => {
  const t = setup();
  const { cookie } = await t.bootstrapAdmin();
  t.db.query("UPDATE sessions SET last_seen = ?").run(Date.now() - SESSION.idleMs - 1000);
  expect((await t.call("GET", "/api/me", { cookie })).status).toBe(401);
  const l = await t.login("admin-cred");
  t.db.query("UPDATE sessions SET created_at = ?").run(Date.now() - SESSION.absoluteMs - 1000);
  expect((await t.call("GET", "/api/me", { cookie: l.cookie })).status).toBe(401);
  const l2 = await t.login("admin-cred");
  await t.call("POST", "/api/auth/logout", { cookie: l2.cookie });
  expect((await t.call("GET", "/api/me", { cookie: l2.cookie })).status).toBe(401);
});

test("recovery replaces old passkeys, kills sessions, and the code is single-use", async () => {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const m = await t.addUser(admin.cookie!, "member", "m1");
  const rec = await t.call("POST", `/api/admin/users/${m.userId}/recovery`, { cookie: admin.cookie });
  expect(rec.status).toBe(200);
  const e = await t.enroll(rec.json.enrollmentCode, "m1-new");
  expect(e.status).toBe(200);
  expect((await t.call("GET", "/api/me", { cookie: m.cookie })).status).toBe(401); // old session gone
  expect((await t.login("m1")).status).toBe(401); // old passkey gone
  expect((await t.login("m1-new")).status).toBe(200);
  expect((await t.enroll(rec.json.enrollmentCode, "m1-again")).status).toBe(400); // used
});

test("expired enrollment codes are rejected", async () => {
  const t = setup();
  const { code } = await t.bootstrapAdmin();
  const admin = await t.login("admin-cred");
  await t.reauth(admin.cookie!, "admin-cred");
  const inv = await t.call("POST", "/api/admin/users", { cookie: admin.cookie, body: { displayName: "G", role: "guest" } });
  t.db.query("UPDATE enrollment_tokens SET expires_at = ?").run(Date.now() - 1);
  expect((await t.enroll(inv.json.enrollmentCode, "g1")).status).toBe(400);
  void code;
});
