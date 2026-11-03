import { expect, test } from "bun:test";
import { ent, setup, type Body } from "./testkit";

const MID = (d: string) => Date.parse(`${d}T12:00:00Z`);
async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  t.ha.entities.set("sensor.plug_energy", ent("sensor.plug_energy", "12", { unit_of_measurement: "kWh", device_class: "energy", friendly_name: "Washer energy" }));
  t.clock.t = MID("2026-11-03");
  t.ha.replies.set("energy/get_prefs", () => ({
    energy_sources: [
      { type: "grid", flow_from: [{ stat_energy_from: "sensor.grid_in" }], flow_to: [{ stat_energy_to: "sensor.grid_out" }] },
      { type: "solar", stat_energy_from: "sensor.solar" },
      { type: "gas", stat_energy_from: "sensor.gas" },
    ],
    device_consumption: [{ stat_consumption: "sensor.plug_energy" }, { stat_consumption: "sensor.hidden_energy" }],
  }));
  const row = (d: string, change: number) => ({ start: MID(d), end: MID(d) + 3600_000, change });
  t.ha.replies.set("recorder/statistics_during_period", () => ({
    "sensor.grid_in": [row("2026-11-01", 6), row("2026-11-02", 5000)], // no unit given, so taken as kWh
    "sensor.grid_out": [row("2026-11-01", 1), row("2026-11-02", 1)],
    "sensor.solar": [row("2026-11-01", 4), row("2026-11-02", 3)],
    "sensor.gas": [row("2026-11-01", 2.5), row("2026-11-02", 1.5)],
    "sensor.plug_energy": [row("2026-11-01", 1.2), row("2026-11-02", 0.8)],
    "sensor.hidden_energy": [row("2026-11-01", 9)],
  }));
  t.ha.replies.set("recorder/get_statistics_metadata", () => [{ statistic_id: "sensor.gas", display_unit_of_measurement: "m³" }]);
  const get = (cookie: string, q = "") => t.call("GET", `/api/energy/ha${q}`, { cookie });
  return { t, admin: admin.cookie!, guest: guest.cookie, member: member.cookie, get };
}

test("energy comes from the hub's own statistics: home use is import plus solar minus export", async () => {
  const { admin, get } = await home();
  const r = (await get(admin)).json;
  expect(r).toMatchObject({ available: true, range: "week", bucket: "day", has: { grid: true, solar: true, battery: false } });
  expect(r.buckets).toEqual([
    { date: "2026-11-01", import: 6, export: 1, solar: 4, batteryIn: 0, batteryOut: 0, consumption: 9 },
    { date: "2026-11-02", import: 5000, export: 1, solar: 3, batteryIn: 0, batteryOut: 0, consumption: 5002 },
  ]);
  expect(r.totals.consumption).toBe(5011);
  expect(r.other).toEqual([{ kind: "gas", total: 4, unit: "m³" }]);
});

test("a meter reporting in Wh is converted", async () => {
  const { t, admin, get } = await home();
  t.ha.replies.set("recorder/get_statistics_metadata", () => [{ statistic_id: "sensor.grid_in", display_unit_of_measurement: "Wh" }]);
  const r = (await get(admin, "?range=month")).json;
  expect(r.totals.import).toBe(5.01);
});

test("a device appears only to someone who may use it, and the hub's own sensor id never leaks", async () => {
  const { admin, member, get } = await home();
  const a = (await get(admin)).json;
  expect(a.devices).toEqual([{ id: "sensor.plug_energy", name: "Washer energy", kwh: 2 }]); // the unknown one is dropped
  expect((await get(member)).json.devices.map((d: Body) => d.id)).toEqual(["sensor.plug_energy"]);
});

test("guests get nothing; bad ranges are refused; the hub going quiet is said plainly", async () => {
  const { t, admin, guest, get } = await home();
  expect((await get(guest)).status).toBe(403);
  expect((await get(admin, "?range=decade")).status).toBe(400);
  t.ha.setStale(true);
  expect((await get(admin, "?range=year")).json).toEqual({ available: false, reason: "ha_unavailable" });
});

test("not set up in the hub, or nothing recorded yet", async () => {
  const { t, admin, get } = await home();
  t.ha.replies.set("energy/get_prefs", () => ({ energy_sources: [], device_consumption: [] }));
  expect((await get(admin)).json).toEqual({ available: false, reason: "not_configured" });
  t.ha.replies.set("energy/get_prefs", () => ({ energy_sources: [{ type: "solar", stat_energy_from: "sensor.solar" }] }));
  t.ha.replies.set("recorder/statistics_during_period", () => ({}));
  expect((await get(admin, "?range=month")).json).toEqual({ available: false, reason: "no_statistics" });
});

test("long device history uses hourly statistics, and falls back to what the hub still has", async () => {
  const { t, admin } = await home();
  const temp = [{ start: MID("2026-10-30"), mean: 20.123 }, { start: MID("2026-10-31"), mean: 22 }, { start: MID("2026-11-01"), mean: null }];
  t.ha.replies.set("recorder/statistics_during_period", (m) => ((m.statistic_ids as string[]).includes("sensor.temp") ? { "sensor.temp": temp } : {}));
  const week = (await t.call("GET", "/api/devices/sensor.temp/history?hours=168", { cookie: admin })).json;
  expect(week).toMatchObject({ kind: "numeric", hours: 168, points: [{ t: MID("2026-10-30"), state: "20.12" }, { t: MID("2026-10-31"), state: "22" }] });
  const day = (await t.call("GET", "/api/devices/sensor.temp/history", { cookie: admin })).json;
  expect(day.hours).toBe(24);
  t.ha.replies.set("recorder/statistics_during_period", () => ({})); // no statistics for it: no invented line
  expect((await t.call("GET", "/api/devices/sensor.temp/history?hours=9999", { cookie: admin })).json.hours).toBe(720);
});

test("the logbook says what caused each change, never who", async () => {
  const { t, admin, member } = await home();
  const at = (s: number) => (t.clock.t - s * 1000) / 1000;
  t.ha.replies.set("logbook/get_events", () => [
    { when: at(60), entity_id: "light.kitchen", message: "turned on", context_event_type: "automation_triggered", context_name: "Evening lights" },
    { when: at(300), entity_id: "light.kitchen", message: "turned off", context_user_id: "u-secret-123", context_service: "turn_off", context_domain: "light" },
    { when: at(900), entity_id: "switch.plug", state: "on" },
    { when: at(30), entity_id: "light.not_visible", message: "turned on" },
    { when: at(500), entity_id: "lock.front", message: "locked", context_domain: "script", context_entity_id_name: "Goodnight" },
  ]);
  const r = (await t.call("GET", "/api/logbook?hours=6", { cookie: member })).json.events as Body[];
  expect(r.map((e) => [e.id, e.origin])).toEqual([
    ["light.kitchen", { kind: "automation", name: "Evening lights" }],
    ["light.kitchen", { kind: "app", name: null }],
    ["lock.front", { kind: "script", name: "Goodnight" }],
    ["switch.plug", { kind: "device", name: null }],
  ]);
  expect(r.find((e) => e.id === "switch.plug").message).toBe("turned on"); // a row with only a state still reads as a sentence
  expect(JSON.stringify(r)).not.toContain("u-secret-123");
  t.ha.setStale(true);
  expect((await t.call("GET", "/api/logbook", { cookie: admin })).status).toBe(503);
  expect((await t.call("GET", "/api/logbook")).status).toBe(401);
});
