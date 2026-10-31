import { expect, test } from "bun:test";
import { setup, realWa } from "./testkit";
import { SoftAuthenticator } from "./softauth";
import { ensureBootstrapCode } from "./auth";

const real = () => setup(undefined, realWa());

async function enrollOpts(t: ReturnType<typeof real>, code: string) {
  const o = await t.call("POST", "/api/auth/enroll/options", { body: { token: code, displayName: "Alex" } });
  return o.json as { challengeId: string; options: any };
}
async function register(t: ReturnType<typeof real>, a: SoftAuthenticator, code?: string, tweak = {}) {
  const o = await enrollOpts(t, code ?? ensureBootstrapCode(t.db)!);
  const v = await t.call("POST", "/api/auth/enroll/verify", { body: { challengeId: o.challengeId, response: a.register(o.options.challenge, tweak) } });
  return v;
}
async function loginWith(t: ReturnType<typeof real>, a: SoftAuthenticator, tweak = {}, ip?: string) {
  const o = await t.call("POST", "/api/auth/login/options", { ip });
  return t.call("POST", "/api/auth/login/verify", { ip, body: { challengeId: o.json.challengeId, response: a.assert(o.json.options.challenge, tweak) } });
}

test("real ceremony: register a passkey, then sign in with it", async () => {
  const t = real(), a = new SoftAuthenticator();
  const reg = await register(t, a);
  expect(reg.status).toBe(200);
  expect((await t.call("GET", "/api/me", { cookie: reg.cookie })).json.role).toBe("admin");
  const login = await loginWith(t, a);
  expect(login.status).toBe(200);
  expect((await t.call("GET", "/api/me", { cookie: login.cookie })).status).toBe(200);
  const row: any = t.db.query("SELECT counter FROM passkeys").get();
  expect(row.counter).toBe(1); // signature counter persisted
});

test("registration is rejected for wrong origin, wrong RP, or missing user verification", async () => {
  for (const tweak of [{ origin: "https://evil.test" }, { rpID: "evil.test" }, { uv: false }]) {
    const t = real();
    const reg = await register(t, new SoftAuthenticator(), undefined, tweak);
    expect(reg.status).toBe(400);
    expect(t.db.query("SELECT COUNT(*) c FROM users").get()).toEqual({ c: 0 });
  }
});

test("assertions with a forged signature, wrong origin, wrong RP, or no UV are rejected", async () => {
  const t = real(), a = new SoftAuthenticator();
  await register(t, a);
  for (const tweak of [{ badSignature: true }, { origin: "https://evil.test" }, { rpID: "evil.test" }, { uv: false }]) {
    expect((await loginWith(t, a, tweak)).status).toBe(401);
  }
  expect((await loginWith(t, a)).status).toBe(200); // genuine one still works
});

test("another authenticator cannot sign in as a known credential id", async () => {
  const t = real(), owner = new SoftAuthenticator(), attacker = new SoftAuthenticator();
  await register(t, owner);
  Object.defineProperty(attacker, "credId", { value: owner.credId }); // same id, different key
  expect((await loginWith(t, attacker)).status).toBe(401);
});

test("challenges are single-use: a captured assertion cannot be replayed", async () => {
  const t = real(), a = new SoftAuthenticator();
  await register(t, a);
  const o = await t.call("POST", "/api/auth/login/options");
  const response = a.assert(o.json.options.challenge);
  const body = { challengeId: o.json.challengeId, response };
  expect((await t.call("POST", "/api/auth/login/verify", { body })).status).toBe(200);
  expect((await t.call("POST", "/api/auth/login/verify", { body })).status).toBe(401);
});

test("an assertion bound to one challenge fails against another", async () => {
  const t = real(), a = new SoftAuthenticator();
  await register(t, a);
  const o1 = await t.call("POST", "/api/auth/login/options");
  const o2 = await t.call("POST", "/api/auth/login/options");
  const r = await t.call("POST", "/api/auth/login/verify", { body: { challengeId: o2.json.challengeId, response: a.assert(o1.json.options.challenge) } });
  expect(r.status).toBe(401);
});

test("a cloned authenticator is detected: counter going backwards is refused", async () => {
  const t = real(), a = new SoftAuthenticator();
  await register(t, a);
  expect((await loginWith(t, a, { counter: 5 })).status).toBe(200);
  expect((await loginWith(t, a, { counter: 3 })).status).toBe(401);
});

test("real re-authentication gates sensitive admin actions", async () => {
  const t = real(), a = new SoftAuthenticator();
  const reg = await register(t, a);
  t.db.query("UPDATE sessions SET reauth_at = 0").run();
  const blocked = await t.call("POST", "/api/admin/users", { cookie: reg.cookie, body: { displayName: "G", role: "guest" } });
  expect(blocked.json).toEqual({ error: "reauth_required" });
  const o = await t.call("POST", "/api/auth/reauth/options", { cookie: reg.cookie });
  const bad = await t.call("POST", "/api/auth/reauth/verify", { cookie: reg.cookie, body: { challengeId: o.json.challengeId, response: a.assert(o.json.options.challenge, { badSignature: true }) } });
  expect(bad.status).toBe(401);
  const o2 = await t.call("POST", "/api/auth/reauth/options", { cookie: reg.cookie });
  const good = await t.call("POST", "/api/auth/reauth/verify", { cookie: reg.cookie, body: { challengeId: o2.json.challengeId, response: a.assert(o2.json.options.challenge) } });
  expect(good.status).toBe(200);
  expect((await t.call("POST", "/api/admin/users", { cookie: reg.cookie, body: { displayName: "G", role: "guest" } })).status).toBe(200);
});

test("real invite and recovery flows end to end", async () => {
  const t = real(), admin = new SoftAuthenticator(), kid = new SoftAuthenticator(), kid2 = new SoftAuthenticator();
  const reg = await register(t, admin);
  const inv = await t.call("POST", "/api/admin/users", { cookie: reg.cookie, body: { displayName: "Sam", role: "member" } });
  expect((await register(t, kid, inv.json.enrollmentCode)).status).toBe(200);
  expect((await loginWith(t, kid)).status).toBe(200);
  const rec = await t.call("POST", `/api/admin/users/${inv.json.userId}/recovery`, { cookie: reg.cookie });
  expect((await register(t, kid2, rec.json.enrollmentCode)).status).toBe(200);
  expect((await loginWith(t, kid)).status).toBe(401);  // old device no longer works
  expect((await loginWith(t, kid2)).status).toBe(200);
});
