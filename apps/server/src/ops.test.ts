import { expect, test } from "bun:test";
import { createOperator } from "./ops";
import { setup, type Body } from "./testkit";

async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "Mia");
  const guest = await t.addUser(admin.cookie!, "guest", "Gus");
  const j = (m: string, p: string, cookie: string | undefined, body?: unknown) => t.call(m, p, { cookie, body });
  async function operator(name: string, cred: string) {
    const { id, token } = createOperator(t.db, name);
    const o = await t.call("POST", "/api/ops/auth/enroll/options", { body: { token } });
    const v = await t.call("POST", "/api/ops/auth/enroll/verify", { body: { challengeId: o.json.challengeId, response: { id: cred, ok: true } } });
    return { id, token, cookie: v.cookie!, status: v.status };
  }
  const grant = (scopes: string[], hours = 4) => j("POST", "/api/admin/support", admin.cookie, { scopes, hours });
  return { t, admin: admin.cookie!, member, guest, j, operator, grant };
}

// ---------- operators ----------

test("an operator enrolls once with a code, then logs in with the key", async () => {
  const { t, j, operator } = await home();
  const op = await operator("Sam (support)", "op-key");
  expect(op.status).toBe(200);
  expect((await j("GET", "/api/ops/me", op.cookie)).json.name).toBe("Sam (support)");
  const again = await t.call("POST", "/api/ops/auth/enroll/options", { body: { token: op.token } });
  expect(again.status).toBe(400); // single use
  const o = await t.call("POST", "/api/ops/auth/login/options");
  const v = await t.call("POST", "/api/ops/auth/login/verify", { body: { challengeId: o.json.challengeId, response: { id: "op-key", ok: true } } });
  expect(v.status).toBe(200);
  const bad = await t.call("POST", "/api/ops/auth/login/options");
  expect((await t.call("POST", "/api/ops/auth/login/verify", { body: { challengeId: bad.json.challengeId, response: { id: "op-key", ok: false } } })).status).toBe(401);
});

test("household and operator identities never mix", async () => {
  const { t, admin, j, operator } = await home();
  const op = await operator("Sam", "op-key");
  expect((await j("GET", "/api/ops/me", admin)).status).toBe(401); // a household admin is not an operator
  expect((await j("GET", "/api/admin/health", op.cookie)).status).toBe(401); // an operator is not a household user
  expect((await j("GET", "/api/devices", op.cookie)).status).toBe(401);
  // an operator's passkey cannot sign into the household, nor a household passkey into /ops
  const o = await t.call("POST", "/api/auth/login/options");
  expect((await t.call("POST", "/api/auth/login/verify", { body: { challengeId: o.json.challengeId, response: { id: "op-key", ok: true } } })).status).toBe(401);
  const p = await t.call("POST", "/api/ops/auth/login/options");
  expect((await t.call("POST", "/api/ops/auth/login/verify", { body: { challengeId: p.json.challengeId, response: { id: "a1", ok: true } } })).status).toBe(401);
});

test("a revoked operator is out immediately", async () => {
  const { t, j, operator } = await home();
  const op = await operator("Sam", "op-key");
  t.db.query("UPDATE operators SET status = 'revoked' WHERE id = ?").run(op.id);
  expect((await j("GET", "/api/ops/me", op.cookie)).status).toBe(401);
  const o = await t.call("POST", "/api/ops/auth/login/options");
  expect((await t.call("POST", "/api/ops/auth/login/verify", { body: { challengeId: o.json.challengeId, response: { id: "op-key", ok: true } } })).status).toBe(401);
});

// ---------- support sessions ----------

test("without a grant an operator sees nothing of the home", async () => {
  const { j, operator } = await home();
  const op = await operator("Sam", "op-key");
  expect((await j("GET", "/api/ops/support", op.cookie)).json.active).toBeNull();
  for (const p of ["diagnostics", "config"]) expect((await j("GET", `/api/ops/support/${p}`, op.cookie)).status).toBe(403);
  expect((await j("POST", "/api/ops/support/claim", op.cookie)).status).toBe(404);
});

test("only a household admin can grant support, and it needs a fresh confirmation", async () => {
  const { t, admin, member, guest, j, grant } = await home();
  expect((await j("POST", "/api/admin/support", member.cookie, { scopes: ["diagnostics"] })).status).toBe(403);
  expect((await j("POST", "/api/admin/support", guest.cookie, { scopes: ["diagnostics"] })).status).toBe(403);
  for (const bad of [{ scopes: [] }, { scopes: ["control_devices"] }, { scopes: ["diagnostics"], hours: 100 }, { scopes: ["diagnostics"], hours: 0.5 }, {}])
    expect((await j("POST", "/api/admin/support", admin, bad)).status).toBe(400);
  expect((await grant(["diagnostics"])).status).toBe(200);
  expect((await grant(["diagnostics"])).status).toBe(409); // one at a time
  t.db.query("UPDATE sessions SET reauth_at = 0").run();
  expect((await j("POST", "/api/admin/support", admin, { scopes: ["diagnostics"] })).json.error).toBe("reauth_required");
});

test("everyone in the home can see when support is allowed", async () => {
  const { member, guest, j, grant } = await home();
  expect((await j("GET", "/api/support", member.cookie)).json.active).toBeNull();
  await grant(["diagnostics", "read_config"], 2);
  for (const c of [member.cookie, guest.cookie]) {
    const s = (await j("GET", "/api/support", c)).json;
    expect(s.active.scopes).toEqual(["diagnostics", "read_config"]);
    expect(s.active.connected).toBe(false);
    expect(s.canManage).toBe(false);
  }
});

test("an operator only gets what was granted, and only after claiming the session", async () => {
  const { t, admin, j, operator, grant } = await home();
  const op = await operator("Sam", "op-key");
  await grant(["diagnostics"]);
  expect((await j("GET", "/api/ops/support/diagnostics", op.cookie)).status).toBe(403); // granted, but not claimed yet
  expect((await j("POST", "/api/ops/support/claim", op.cookie)).status).toBe(200);
  const d = await j("GET", "/api/ops/support/diagnostics", op.cookie);
  expect(d.status).toBe(200);
  expect(d.json.checks.find((c: Body) => c.id === "hub").status).toBe("ok");
  expect((await j("GET", "/api/ops/support/config", op.cookie)).status).toBe(403); // not in scope
  expect((await j("GET", "/api/support", admin)).json.active).toMatchObject({ connected: true, operatorName: "Sam", scopes: ["diagnostics"] });
  const other = await operator("Robin", "op-key-2");
  expect((await j("POST", "/api/ops/support/claim", other.cookie)).status).toBe(404); // someone else already has it
  expect((await j("GET", "/api/ops/support/diagnostics", other.cookie)).status).toBe(403);
  const rows = t.db.query("SELECT action, outcome, actor_type FROM security_audit WHERE actor_type = 'operator' AND action LIKE 'ops.%' AND action NOT IN ('ops.login','ops.enroll')").all() as Body[];
  expect(rows.map((r) => `${r.action}:${r.outcome}`)).toEqual(expect.arrayContaining(["ops.diagnostics:success", "ops.read_config:denied", "ops.claim:success"]));
});

test("configuration is shared as structure only, never people or history", async () => {
  const { t, j, operator, grant } = await home();
  const op = await operator("Sam", "op-key");
  await grant(["read_config"]);
  await j("POST", "/api/ops/support/claim", op.cookie);
  const r = await j("GET", "/api/ops/support/config", op.cookie);
  expect(r.status).toBe(200);
  expect(Object.keys(r.json).sort()).toEqual(["automations", "devices", "rooms", "routines"]);
  const text = JSON.stringify(r.json);
  for (const secret of ["Mia", "Gus", "Alex", "passkey", "session"]) expect(text).not.toContain(secret);
  expect((await j("GET", "/api/ops/support/diagnostics", op.cookie)).status).toBe(403);
  void t;
});

test("the household can end support at any time, and it expires by itself", async () => {
  const { t, admin, member, j, operator, grant } = await home();
  const op = await operator("Sam", "op-key");
  const id = (await grant(["diagnostics"])).json.active.id;
  await j("POST", "/api/ops/support/claim", op.cookie);
  expect((await j("DELETE", `/api/admin/support/${id}`, member.cookie)).status).toBe(403);
  expect((await j("DELETE", `/api/admin/support/${id}`, admin)).status).toBe(200);
  expect((await j("GET", "/api/ops/support/diagnostics", op.cookie)).status).toBe(403);
  expect((await j("GET", "/api/support", admin)).json.active).toBeNull();
  const id2 = (await grant(["diagnostics"])).json.active.id;
  await j("POST", "/api/ops/support/claim", op.cookie);
  expect((await j("GET", "/api/ops/support/diagnostics", op.cookie)).status).toBe(200);
  t.db.query("UPDATE support_sessions SET expires_at = ? WHERE id = ?").run(Date.now() - 1000, id2);
  expect((await j("GET", "/api/ops/support/diagnostics", op.cookie)).status).toBe(403);
  expect((await j("GET", "/api/support", admin)).json.active).toBeNull();
});

test("support activity is visible to the household without naming anyone", async () => {
  const { t, admin, j, operator, grant } = await home();
  const op = await operator("Sam", "op-key");
  await grant(["diagnostics"]);
  await j("POST", "/api/ops/support/claim", op.cookie);
  await j("POST", "/api/ops/support/end", op.cookie);
  const acts = ((await j("GET", "/api/admin/activity", admin)).json.events ?? (await j("GET", "/api/admin/activity", admin)).json) as Body;
  const text = JSON.stringify(acts);
  expect(text).toContain("support");
  expect(text).not.toContain("Sam");
  expect(t.db.query("SELECT COUNT(*) n FROM activity_events WHERE kind = 'support'").get()).toEqual({ n: 3 });
});

// ---------- voice ----------

test("voice access is opt-in, one item at a time, and never offered for doors or cameras", async () => {
  const { t, admin, member, j } = await home();
  expect((await j("GET", "/api/admin/voice", member.cookie)).status).toBe(403);
  const list = (await j("GET", "/api/admin/voice", admin)).json;
  expect(list.cloud).toEqual({ loggedIn: true });
  const ids = list.items.map((i: Body) => i.id);
  expect(ids).toContain("light.kitchen");
  expect(ids).toContain("scene.movie_time");
  for (const never of ["lock.front", "camera.porch", "cover.blind", "sensor.temp"]) expect(ids).not.toContain(never);
  expect(list.items.every((i: Body) => i.enabled === false)).toBe(true); // nothing exposed by default
  expect((await j("PUT", "/api/admin/voice", admin, { entityId: "lock.front", enabled: true })).status).toBe(404);
  t.db.query("UPDATE sessions SET reauth_at = 0").run();
  expect((await j("PUT", "/api/admin/voice", admin, { entityId: "light.kitchen", enabled: true })).json.error).toBe("reauth_required");
  await t.reauth(admin, "a1");
  const r = await j("PUT", "/api/admin/voice", admin, { entityId: "light.kitchen", enabled: true });
  expect(r.status).toBe(200);
  expect(t.ha.wsCalls.filter((c) => c.type === "homeassistant/expose_entity")).toEqual([{ type: "homeassistant/expose_entity", assistants: ["cloud.alexa", "cloud.google_assistant"], entity_ids: ["light.kitchen"], should_expose: true }]);
  expect((await j("GET", "/api/admin/voice", admin)).json.items.find((i: Body) => i.id === "light.kitchen").enabled).toBe(true);
  await j("PUT", "/api/admin/voice", admin, { entityId: "light.kitchen", enabled: false });
  expect((await j("GET", "/api/admin/voice", admin)).json.items.find((i: Body) => i.id === "light.kitchen").enabled).toBe(false);
});

test("if Home Assistant doesn't accept a voice change, nothing is recorded", async () => {
  const { t, admin, j } = await home();
  t.ha.exposeFails = true;
  expect((await j("PUT", "/api/admin/voice", admin, { entityId: "light.kitchen", enabled: true })).status).toBe(502);
  expect(t.db.query("SELECT COUNT(*) n FROM voice_exposure").get()).toEqual({ n: 0 });
  t.ha.exposeFails = false; t.ha.setStale(true);
  expect((await j("PUT", "/api/admin/voice", admin, { entityId: "light.kitchen", enabled: true })).status).toBe(503);
});
