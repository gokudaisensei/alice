import { expect, test } from "bun:test";
import { createDeviceService } from "./devices";
import { createNotifier } from "./notify";
import { startRules } from "./rules";
import { scalar } from "./sql";
import { ent, setup, type Body } from "./testkit";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** A home like the real one: a light, a plug, and a wall panel whose settings are switches and buttons, plus helper values left by a simulator. */
async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1"); await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  t.ha.set("switch.heater", "off");
  const put = (id: string, state: string, a: Record<string, unknown> = {}) => t.ha.entities.set(id, ent(id, state, a));
  const parent = (id: string, deviceId: string, deviceName: string, cls: string | null = null, label: string | null = null) => t.ha.parents.set(id, { deviceId, deviceName, label, cls });
  // the wall panel: one physical device with a speaker, a camera and settings
  put("media_player.panel", "idle", { friendly_name: "Panel", supported_features: 4 | 1 | 16384, device_class: "speaker" }); parent("media_player.panel", "panel", "Panel", "speaker", "Speaker");
  put("media_player.panel_cast", "idle", { friendly_name: "Panel", supported_features: 4 }); parent("media_player.panel_cast", "panel", "Panel");
  put("camera.panel_camera", "idle", { friendly_name: "Camera" }); parent("camera.panel_camera", "panel", "Panel", null, "Camera");
  put("switch.panel_mic_mute", "on", { friendly_name: "Microphone mute" }); parent("switch.panel_mic_mute", "panel", "Panel", null, "Microphone mute");
  put("switch.panel_adb", "off", { friendly_name: "ADB over network" }); parent("switch.panel_adb", "panel", "Panel");
  put("button.panel_wake", "unknown", { friendly_name: "Wake" }); parent("button.panel_wake", "panel", "Panel");
  // a real plug (a switch on a device that has no other main function) and one the hub calls an outlet
  put("switch.coffee", "off", { friendly_name: "Coffee machine" }); parent("switch.coffee", "coffee-dev", "Coffee machine");
  put("switch.desk_outlet", "off", { friendly_name: "Desk outlet", device_class: "outlet" }); parent("switch.desk_outlet", "panel", "Panel", "outlet");
  // helper values
  for (const [id, v] of [["input_number.away_temperature", "16"], ["input_number.bedroom_light_level", "255"]] as const) put(id, v, { friendly_name: id.split(".")[1]!.replace(/_/g, " "), min: 0, max: 300, step: 1 });
  put("input_select.house_mode", "home", { friendly_name: "House Mode", options: ["home", "away"] });
  // a reading with no unit, no class and no name of its own
  put("sensor.protocol_version", "3", {}); t.ha.entities.set("sensor.protocol_version", { entity_id: "sensor.protocol_version", state: "3", attributes: {} } as never);
  const list = async (c = admin.cookie!) => ((await t.call("GET", "/api/devices", { cookie: c })).json.devices as Body[]).map((d) => d.id);
  return { t, admin: admin.cookie!, member, list, put, parent };
}

test("what the household sees: things, not their settings or helper values", async () => {
  const { list } = await home();
  const ids = await list();
  for (const hidden of ["switch.panel_mic_mute", "switch.panel_adb", "button.panel_wake", "input_number.away_temperature", "input_number.bedroom_light_level", "input_select.house_mode", "sensor.protocol_version"]) expect(ids).not.toContain(hidden);
  for (const shown of ["light.kitchen", "switch.coffee", "switch.desk_outlet", "camera.panel_camera", "media_player.panel", "lock.front"]) expect(ids).toContain(shown);
});

test("one speaker is one card, even when it shows up as several players", async () => {
  const { list } = await home();
  const ids = await list();
  expect(ids.filter((i) => i.startsWith("media_player.panel"))).toEqual(["media_player.panel"]); // the one that can do the most
});

test("showing a setting or helper is a choice: put it in a room, or pin it", async () => {
  const { t, admin, member, list } = await home();
  const room = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Lounge", inHa: false } })).json.id as string;
  expect((await t.call("PUT", `/api/admin/rooms/${room}/devices`, { cookie: admin, body: { add: ["input_number.away_temperature", "light.kitchen"] } })).status).toBe(200);
  expect(await list(member.cookie)).toContain("input_number.away_temperature");
  expect(await list(member.cookie)).not.toContain("input_number.bedroom_light_level");
  expect((await t.call("PUT", "/api/admin/devices/switch.panel_mic_mute", { cookie: admin, body: { pinned: true } })).status).toBe(200);
  expect(await list(member.cookie)).toContain("switch.panel_mic_mute");
  expect((await t.call("PUT", "/api/admin/devices/switch.panel_mic_mute", { cookie: admin, body: { pinned: false } })).status).toBe(200);
  expect(await list(member.cookie)).not.toContain("switch.panel_mic_mute");
});

test("the room picker offers devices first, and settings and helpers only when asked for or searched for", async () => {
  const { t, admin } = await home();
  const rows = async (q = "") => ((await t.call("GET", `/api/admin/devices${q}`, { cookie: admin })).json.devices as Body[]);
  const plain = await rows();
  expect(plain.map((r) => r.id)).toContain("switch.coffee");
  expect(plain.map((r) => r.id)).not.toContain("switch.panel_mic_mute");
  expect(plain.map((r) => r.id)).not.toContain("input_number.away_temperature");
  const more = await rows("?helpers=1");
  expect(more.find((r) => r.id === "switch.panel_mic_mute")).toMatchObject({ kind: "part" });
  expect(more.find((r) => r.id === "input_number.away_temperature")).toMatchObject({ kind: "helper" });
  expect((await rows("?q=away")).map((r) => r.id)).toContain("input_number.away_temperature"); // searching by name finds it
});

test("routine ideas never reach for a setting: only real lights and plugs", async () => {
  const { t, admin } = await home();
  const r = (await t.call("GET", "/api/routines", { cookie: admin })).json;
  const text = JSON.stringify(r);
  expect(text).not.toContain("Microphone mute");
  expect(text).not.toContain("ADB over network");
  const a = JSON.stringify((await t.call("GET", "/api/automations", { cookie: admin })).json);
  expect(a).not.toContain("Microphone mute");
});

test("an alert about a device being offline is only ever about a device", async () => {
  const { t } = await home();
  const nf = createNotifier(t.db, createDeviceService(t.db, t.ha), t.push, () => t.clock.t);
  const h = scalar(t.db, "SELECT id FROM households", "");
  const stop = startRules(t.db, t.ha, nf, { offlineMs: 30, lockMs: 30, hubMs: 30 }, undefined, (hh, id) => createDeviceService(t.db, t.ha).shown(hh, id));
  t.ha.set("switch.panel_adb", "unavailable"); t.ha.set("light.kitchen", "unavailable");
  await wait(120);
  const rows = (t.db.query("SELECT title FROM notifications").all() as Body[]).map((r) => r.title);
  expect(rows.some((x) => /kitchen/i.test(x))).toBe(true);
  expect(rows.some((x) => /adb/i.test(x))).toBe(false);
  stop(); void h;
});

test("voice control offers lights, plugs and scenes, not a panel's settings", async () => {
  const { t, admin } = await home();
  const items = ((await t.call("GET", "/api/admin/voice", { cookie: admin })).json.items as Body[]).map((i) => i.id);
  expect(items).toContain("switch.coffee");
  expect(items).not.toContain("switch.panel_adb");
  expect(items).not.toContain("switch.panel_mic_mute");
});

test("rooms from the hub are offered only when they hold devices the household sees", async () => {
  const { t, admin, put } = await home();
  t.ha.areas.set("lounge", { id: "lounge", name: "Lounge", floorId: null }); t.ha.areas.set("shed", { id: "shed", name: "Shed", floorId: null }); t.ha.areas.set("settings", { id: "settings", name: "Settings only", floorId: null });
  t.ha.areaOf.set("light.kitchen", "lounge"); t.ha.areaOf.set("switch.panel_adb", "settings"); t.ha.areaOf.set("input_number.away_temperature", "settings");
  void put;
  const r = (await t.call("GET", "/api/admin/rooms/ha-areas", { cookie: admin })).json;
  expect(r.areas.map((a: Body) => a.name)).toEqual(["Lounge"]); // no empty area, no area of only settings
  t.ha.labels.set("seed", "homeapp-seed"); t.ha.labelsOf.set("input_number.away_temperature", ["seed"]); t.ha.labelsOf.set("switch.panel_adb", ["seed"]);
  expect((await t.call("GET", "/api/admin/groups/ha-labels", { cookie: admin })).json.labels).toEqual([]);
});

test("the log: a burst of changes on one device is one line, and odd values become words", async () => {
  const { t, admin } = await home();
  const at = (s: number) => (t.clock.t - s * 1000) / 1000;
  t.ha.replies.set("logbook/get_events", () => [
    { when: at(10), entity_id: "media_player.panel", state: "playing" }, { when: at(40), entity_id: "media_player.panel", state: "idle" }, { when: at(70), entity_id: "media_player.panel", state: "paused" },
    { when: at(900), entity_id: "media_player.panel", state: "idle" },
    { when: at(200), entity_id: "light.kitchen", state: "2026-11-03T17:24:49.713794+00:00" }, { when: at(300), entity_id: "lock.front", state: "None" },
  ]);
  const ev = (await t.call("GET", "/api/logbook?hours=6", { cookie: admin })).json.events as Body[];
  expect(ev.filter((e) => e.id === "media_player.panel").map((e) => e.message)).toEqual(["is now playing", "is now idle"]); // the burst, then the earlier one apart from it
  expect(ev.find((e) => e.id === "light.kitchen")?.message).toBe("updated");
  expect(ev.find((e) => e.id === "lock.front")?.message).toBe("was cleared");
});

test("the hub's own automations can be put away and brought back, without touching Home Assistant", async () => {
  const { t, admin, put } = await home();
  put("automation.leak_light", "on", { id: "1700000000001", friendly_name: "Leak turns on kitchen light" }); put("script.lock_up", "off", { friendly_name: "Lock Up" });
  const j = (m: string, p: string, body?: unknown) => t.call(m, p, { cookie: admin, body });
  expect(((await j("GET", "/api/automations/native")).json.automations as Body[]).map((a) => a.name)).toEqual(["Leak turns on kitchen light"]);
  expect((await j("POST", "/api/automations/native/hidden", { entityId: "automation.leak_light", hidden: true })).json).toEqual({ ok: true });
  const after = (await j("GET", "/api/automations/native")).json;
  expect([after.automations.length, after.scripts.length, after.hiddenCount]).toEqual([0, 1, 1]);
  expect(((await j("GET", "/api/automations/native?hidden=1")).json.automations as Body[]).map((a) => a.id)).toEqual(["automation.leak_light"]);
  expect((await j("POST", "/api/automations/native/hidden", { entityId: "automation.leak_light", hidden: false })).status).toBe(200);
  expect(((await j("GET", "/api/automations/native")).json.automations as Body[]).length).toBe(1);
  expect((await j("POST", "/api/automations/native/hidden", { entityId: "light.kitchen", hidden: true })).status).toBe(404);
  expect((await j("POST", "/api/automations/native/hidden", { entityId: "script.lock_up", hidden: "yes" })).status).toBe(400);
  expect(t.ha.calls.length).toBe(0); // Home Assistant itself was never asked to change anything
});
