import { expect, test } from "bun:test";
import { createDeviceService } from "./devices";
import { createNotifier } from "./notify";
import { createPowerLimits, switchFor } from "./power";
import { startRules } from "./rules";
import { ent, setup } from "./testkit";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAST = { offlineMs: 40, lockMs: 40, hubMs: 40, powerMs: 60 };
const KETTLE = "sensor.kettle_power";

async function home() {
  const t = setup(), admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1"), guest = await t.addUser(admin.cookie!, "guest", "g1");
  const j = (m: string, p: string, cookie: string, body?: any) => t.call(m, p, { cookie, body });
  t.ha.entities.set(KETTLE, ent(KETTLE, "50", { device_class: "power", unit_of_measurement: "W", friendly_name: "Kettle Power" }));
  t.ha.entities.set("switch.kettle", ent("switch.kettle", "on", { friendly_name: "Kettle" }));
  t.ha.set("switch.heater", "off");
  const svc = createDeviceService(t.db, t.ha), nf = createNotifier(t.db, svc, t.push, () => t.clock.t);
  const limits = createPowerLimits(t.db), hid = (t.db.query("SELECT id FROM households LIMIT 1").get() as any).id as string;
  const titles = async (cookie: string) => ((await j("GET", "/api/notifications", cookie)).json.notifications as any[]).filter((n) => n.kind === "power").map((n) => n.title);
  return { t, admin: admin.cookie!, member, guest, j, nf, limits, hid, titles };
}

test("limits are set by hand, validated, and only by people who may manage rules", async () => {
  const { t, admin, member, guest, j } = await home();
  await j("PUT", `/api/admin/users/${guest.userId}/devices`, admin, { allow: [KETTLE] });
  expect((await j("PUT", `/api/power-limits/${KETTLE}`, guest.cookie, { watts: 2000 })).status).toBe(403);
  expect((await j("PUT", `/api/power-limits/${KETTLE}`, member.cookie, { watts: 2000 })).status).toBe(200);
  for (const bad of [0, -5, 1.5, "2000", 1e9, null]) expect((await j("PUT", `/api/power-limits/${KETTLE}`, member.cookie, { watts: bad })).status).toBe(400);
  expect((await j("PUT", "/api/power-limits/light.kitchen", member.cookie, { watts: 100 })).status).toBe(400); // not a power meter
  expect((await j("PUT", "/api/power-limits/sensor.nope", member.cookie, { watts: 100 })).status).toBe(404);
  expect((await j("GET", "/api/power-limits", member.cookie)).json.limits).toEqual([{ entityId: KETTLE, watts: 2000, enabled: true }]);
  expect((await j("GET", "/api/power-limits", admin)).json.limits.length).toBe(1);
  expect((await j("DELETE", `/api/power-limits/${KETTLE}`, member.cookie)).status).toBe(200);
  expect((await j("GET", "/api/power-limits", member.cookie)).json.limits).toEqual([]);
  expect((t.db.query("SELECT COUNT(*) n FROM security_audit WHERE action LIKE 'power.%'").get() as any).n).toBeGreaterThanOrEqual(2);
});

test("a reading that stays over the limit is reported once, with a switch-off button; spikes and no limit are not", async () => {
  const { t, admin, member, guest, nf, limits, hid, titles } = await home();
  const stop = startRules(t.db, t.ha, nf, FAST, limits);
  t.ha.set(KETTLE, "3000"); await wait(100);
  expect(await titles(admin)).toEqual([]); // no limit set: nothing, however high
  limits.set(hid, KETTLE, 2000, true);
  t.ha.set(KETTLE, "50"); await wait(10);
  t.ha.set(KETTLE, "2500"); await wait(20); t.ha.set(KETTLE, "100"); await wait(100);
  expect(await titles(admin)).toEqual([]); // a short spike is never reported
  t.ha.set(KETTLE, "2500"); await wait(120);
  expect(await titles(admin)).toEqual(["Kettle is using 2.5 kW"]);
  expect(await titles(member.cookie)).toEqual(["Kettle is using 2.5 kW"]);
  expect(await titles(guest.cookie)).toEqual([]); // guests never hear about energy
  t.ha.set(KETTLE, "2600"); await wait(120);
  expect((await titles(admin)).length).toBe(1); // not repeated straight away
  stop();
  expect(switchFor(t.ha, KETTLE)).toBe("switch.kettle"); // the button targets the plug's own switch
  t.ha.entities.set("sensor.lamp_power", ent("sensor.lamp_power", "5", { device_class: "power", unit_of_measurement: "W", friendly_name: "Orphan Power" }));
  expect(switchFor(t.ha, "sensor.lamp_power")).toBeNull(); // no clear match, no button
});

test("the button and the limit follow the plug; changing a limit restarts the clock; muting is respected", async () => {
  const { t, admin, j, nf, limits, hid, titles } = await home();
  const stop = startRules(t.db, t.ha, nf, FAST, limits);
  limits.set(hid, KETTLE, 2000, true);
  t.ha.set(KETTLE, "2500"); await wait(35);
  limits.set(hid, KETTLE, 3000, true); // now under the limit: the clock is dropped
  await wait(100);
  expect(await titles(admin)).toEqual([]);
  limits.set(hid, KETTLE, 2000, false);
  await wait(100);
  expect(await titles(admin)).toEqual([]); // switched off
  await j("PUT", "/api/me/notifications", admin, { muted: ["power"] });
  limits.set(hid, KETTLE, 2000, true);
  await wait(120);
  expect(await titles(admin)).toEqual([]); // muted category
  stop();
});
