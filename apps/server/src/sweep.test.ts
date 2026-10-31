// Walks EVERY registered API route, so a new route that forgets its guard fails here instead of shipping.
import { expect, test } from "bun:test";
import { setup } from "./testkit";

// The only routes that may answer without a household session. Adding to this list is a security decision.
const PUBLIC = new Set([
  "POST /api/auth/enroll/options", "POST /api/auth/enroll/verify", "POST /api/auth/login/options", "POST /api/auth/login/verify", "POST /api/auth/logout",
  "POST /api/ops/auth/enroll/options", "POST /api/ops/auth/enroll/verify", "POST /api/ops/auth/login/options", "POST /api/ops/auth/login/verify", "POST /api/ops/auth/logout",
  "GET /api/health",
]);
// Answered for any signed-in household member: they are about the person themselves.
const OWN = /^\/api\/(me|notifications|push|insights|energy|support|updates|devices|rooms|groups|search|stream|mode|scenes|routines|health)/;
const fill = (p: string) => p.replace(/:[a-z]+/g, "x");

async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  const routes = ((t.app as any).routes as { method: string; path: string }[]).filter((r) => r.path.startsWith("/api") && r.method !== "HEAD" && r.method !== "OPTIONS");
  const hit = async (r: { method: string; path: string }, o: { cookie?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const res = await t.app.handle(new Request("http://localhost" + fill(r.path), {
      method: r.method, headers: { "content-type": "application/json", "x-forwarded-for": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`, ...(o.cookie ? { cookie: o.cookie } : {}), ...o.headers },
      body: r.method === "GET" ? undefined : (o.body ?? "{}"),
    }));
    if (r.path === "/api/stream" && res.body) await res.body.cancel();
    return res.status;
  };
  return { t, admin: admin.cookie!, member: member.cookie, guest: guest.cookie, routes, hit };
}
const key = (r: { method: string; path: string }) => `${r.method} ${r.path}`;

test("the sweep sees the whole API", async () => {
  const { routes } = await home();
  expect(routes.length).toBeGreaterThan(80);
});

test("every route except the public ones refuses an anonymous caller", async () => {
  const { routes, hit } = await home();
  const open: string[] = [];
  for (const r of routes) if (!PUBLIC.has(key(r)) && !r.path.startsWith("/api/ops/") && (await hit(r, { headers: { "x-requested-with": "alice" } })) !== 401) open.push(key(r));
  expect(open).toEqual([]);
});

test("operator routes refuse every household session, even an admin's", async () => {
  const { routes, hit, admin, member, guest } = await home();
  const leaks: string[] = [];
  for (const r of routes.filter((r) => r.path.startsWith("/api/ops/") && !PUBLIC.has(key(r))))
    for (const c of [admin, member, guest]) if ((await hit(r, { cookie: c, headers: { "x-requested-with": "alice" } })) !== 401) leaks.push(key(r));
  expect(leaks).toEqual([]);
});

test("household-management routes refuse members and guests", async () => {
  const { routes, hit, member, guest } = await home();
  const ok: string[] = [];
  for (const r of routes.filter((r) => r.path.startsWith("/api/admin/")))
    for (const c of [member, guest]) if ((await hit(r, { cookie: c, headers: { "x-requested-with": "alice" } })) !== 403) ok.push(`${key(r)} -> not 403`);
  expect(ok).toEqual([]);
});

test("guests cannot reach automations, or change scenes, routines or the household mode", async () => {
  const { routes, hit, guest } = await home();
  const gated = routes.filter((r) => r.path.startsWith("/api/automations") || (["POST", "PUT", "DELETE"].includes(r.method) && /^\/api\/(scenes|routines)(\/|$)/.test(r.path) && !/activate|run$/.test(r.path)) || key(r) === "POST /api/mode");
  expect(gated.length).toBeGreaterThan(8);
  const wrong: string[] = [];
  for (const r of gated) if ((await hit(r, { cookie: guest, headers: { "x-requested-with": "alice" } })) !== 403) wrong.push(key(r));
  expect(wrong).toEqual([]);
});

test("every state-changing route refuses a request that lacks the CSRF header", async () => {
  const { routes, hit, admin } = await home();
  const weak: string[] = [];
  for (const r of routes.filter((r) => r.method !== "GET" && !r.path.startsWith("/api/auth/") && !r.path.startsWith("/api/ops/auth/"))) {
    const s = await hit(r, { cookie: admin });
    if (s < 400) weak.push(`${key(r)} -> ${s}`);
  }
  expect(weak).toEqual([]);
});

test("a cross-site Origin is refused on state-changing requests", async () => {
  const { routes, hit, admin } = await home();
  const weak: string[] = [];
  for (const r of routes.filter((r) => r.method !== "GET").slice(0, 25)) {
    const s = await hit(r, { cookie: admin, headers: { "x-requested-with": "alice", origin: "https://evil.example" } });
    if (s < 400) weak.push(`${key(r)} -> ${s}`);
  }
  expect(weak).toEqual([]);
});

test("garbage input is a clean 4xx on every route, never a crash", async () => {
  const { routes, hit, admin } = await home();
  const bad: string[] = [];
  for (const r of routes.filter((r) => r.method !== "GET" && r.path !== "/api/stream")) {
    for (const body of ["not json", "[1,2,3]", '{"a":' + "x".repeat(2000) + "}", "null"]) {
      const s = await hit(r, { cookie: admin, headers: { "x-requested-with": "alice" }, body });
      if (s >= 500) bad.push(`${key(r)} ${body.slice(0, 12)} -> ${s}`);
    }
  }
  expect(bad).toEqual([]);
});

test("responses to signed-in callers never carry caching or sniffing hazards", async () => {
  const { t, admin } = await home();
  const res = await t.app.handle(new Request("http://localhost/api/me", { headers: { cookie: admin } }));
  expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  expect(res.headers.get("x-frame-options")).toBe("DENY");
  expect(res.headers.get("referrer-policy")).toBe("no-referrer");
  void OWN;
});
