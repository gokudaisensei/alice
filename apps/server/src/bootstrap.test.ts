import { expect, test } from "bun:test";
import { setup } from "./testkit";

test("bootstrap returns the first screen in one call, with the same permissions as the separate endpoints", async () => {
  const t = setup(), admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin.cookie!, body: { allow: ["light.kitchen"] } });
  expect((await t.call("GET", "/api/bootstrap")).status).toBe(401);
  const b = (await t.call("GET", "/api/bootstrap", { cookie: guest.cookie })).json;
  expect(b.me.role).toBe("guest");
  expect(b.devices.devices.map((d: any) => d.id)).toEqual(["light.kitchen"]);
  const a = (await t.call("GET", "/api/bootstrap", { cookie: admin.cookie! })).json;
  expect(a.devices.devices.length).toBeGreaterThan(1);
  for (const k of ["rooms", "groups", "prefs", "mode", "scenes", "routines"]) expect(a[k]).not.toBeNull();
});
