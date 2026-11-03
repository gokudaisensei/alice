import { expect, test } from "bun:test";
import { createApp } from "./app";
import { migrate, openDb } from "./db";
import { FakeHa, fakeWebAuthn } from "./testkit";
import { readdirSync } from "node:fs";

const mk = (webDir?: string) => createApp({ db: openDb(":memory:"), ha: Object.assign(new FakeHa(), { stale: true }), webauthn: fakeWebAuthn, origin: "https://home.test", cookieSecure: false, webDir });

test("migrations apply once", () => {
  const db = openDb(":memory:");
  expect(migrate(db)).toBe(readdirSync(new URL("../migrations", import.meta.url).pathname).filter((f) => f.endsWith(".sql")).length);
  expect(migrate(db)).toBe(0);
});

test("health reports Home Assistant state honestly", async () => {
  const db = openDb(":memory:"); migrate(db);
  const body = await (await createApp({ db, ha: Object.assign(new FakeHa(), { stale: true }), webauthn: fakeWebAuthn, origin: "https://home.test", cookieSecure: false }).handle(new Request("http://localhost/api/health"))).json();
  expect(body).toEqual({ app: "ok", database: "ok", homeAssistant: "unreachable" });
});

test("generic 404 and security headers", async () => {
  const res = await mk().handle(new Request("http://localhost/nope"));
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not_found" });
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
});

test("serves SPA fallback but never traverses outside the web dir", async () => {
  const app = mk("../web/build");
  const home = await app.handle(new Request("http://localhost/rooms/kitchen"));
  expect(home.status).toBe(200);
  expect(await home.text()).toContain("<html");
  const evil = await app.handle(new Request("http://localhost/..%2f..%2fpackage.json"));
  expect(await evil.text()).not.toContain("workspaces");
  expect((await app.handle(new Request("http://localhost/api/unknown"))).status).toBe(404);
});

test("CSP allows only the build's own inline start-up script, by hash", async () => {
  const app = mk("../web/build");
  const res = await app.handle(new Request("http://localhost/"));
  const csp = res.headers.get("content-security-policy")!;
  const html = await res.text();
  const inline = [...html.matchAll(/<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/g)];
  expect(inline.length).toBeGreaterThan(0);
  for (const m of inline) expect(csp).toContain(`'sha256-${new Bun.CryptoHasher("sha256").update(m[1] ?? "").digest("base64")}'`);
  expect(csp).not.toContain("unsafe-inline'; frame"); // no blanket inline scripts
  expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  expect(csp).toContain("frame-ancestors 'none'");
});
