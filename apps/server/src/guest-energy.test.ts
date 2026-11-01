import { expect, test } from "bun:test";
import { ent, setup } from "./testkit";

test("guests never see energy use or insights, even with the meter granted; members do", async () => {
  const t = setup(), admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1"), guest = await t.addUser(admin.cookie!, "guest", "g1");
  t.ha.entities.set("sensor.house_power", ent("sensor.house_power", "420", { device_class: "power", unit_of_measurement: "W" }));
  await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin.cookie!, body: { allow: ["sensor.house_power", "light.kitchen"] } });
  const ids = async (cookie: string) => ((await t.call("GET", "/api/devices", { cookie })).json.devices as any[]).map((d) => d.id);
  expect(await ids(guest.cookie)).toContain("light.kitchen");
  expect(await ids(guest.cookie)).not.toContain("sensor.house_power");
  expect(await ids(member.cookie)).toContain("sensor.house_power");
  expect((await t.call("GET", "/api/energy", { cookie: guest.cookie })).status).toBe(403);
  expect((await t.call("GET", "/api/energy", { cookie: member.cookie })).status).toBe(200);
  expect((await t.call("GET", "/api/insights", { cookie: guest.cookie })).json.insights).toEqual([]);
  expect((await t.call("GET", "/api/me/notifications/settings", { cookie: guest.cookie })).status).toBeLessThan(500);
  const access = (await t.call("GET", `/api/admin/users/${guest.userId}/access`, { cookie: admin.cookie! })).json;
  expect(access.devices.map((d: any) => d.id)).not.toContain("sensor.house_power");
});
