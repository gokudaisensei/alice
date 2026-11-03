import { expect, test } from "bun:test";
import { setup, type Body } from "./testkit";

async function home() {
  const t = setup(), admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  await new Promise((r) => setTimeout(r, 30)); // responses finish a moment before their "something changed" note
  return { t, admin: admin.cookie!, member: member.cookie };
}

test("sync needs a sign-in, and a stale or missing position asks for a full refresh", async () => {
  const { t, admin } = await home();
  expect((await t.call("GET", "/api/sync?rev=0")).status).toBe(401);
  const r = await t.call("GET", "/api/sync?rev=99999", { cookie: admin });
  expect(r.json.resync).toBe(true);
  expect(typeof r.json.rev).toBe("number");
});

test("a change made on one device reaches another person's waiting device", async () => {
  const { t, admin, member } = await home();
  const start = (await t.call("GET", "/api/sync", { cookie: member })).json.rev as number;
  const waiting = t.call("GET", `/api/sync?rev=${start}`, { cookie: member });
  await new Promise((r) => setTimeout(r, 30));
  await t.call("POST", "/api/devices/light.kitchen/command", { cookie: admin, body: { action: "turn_off" } });
  const r = (await waiting).json;
  expect(r.devices.map((d: Body) => d.id)).toContain("light.kitchen");
  expect(r.devices.find((d: Body) => d.id === "light.kitchen").state).toBe("off");
});

test("something the app stores (a new room) tells other screens to refresh", async () => {
  const { t, admin, member } = await home();
  const start = (await t.call("GET", "/api/sync", { cookie: member })).json.rev as number;
  const waiting = t.call("GET", `/api/sync?rev=${start}`, { cookie: member });
  await new Promise((r) => setTimeout(r, 30));
  expect((await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Study" } })).status).toBe(200);
  expect((await waiting).json.data).toBe(true);
});
