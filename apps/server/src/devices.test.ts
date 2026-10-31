import { expect, test } from "bun:test";
import { describe } from "./capabilities";
import { ent, setup } from "./testkit";

const kinds = (e: any) => describe(e).controls.map((c) => c.type);

test("controls follow the device's real capabilities, not its category", () => {
  expect(kinds(ent("light.a", "on", { supported_color_modes: ["onoff"] }))).toEqual(["power"]);
  expect(kinds(ent("light.b", "on", { supported_color_modes: ["brightness"] }))).toEqual(["power", "brightness"]);
  expect(kinds(ent("light.c", "on", { supported_color_modes: ["color_temp", "hs"] }))).toEqual(["power", "brightness", "color_temp", "color"]);
  expect(kinds(ent("switch.s", "on"))).toEqual(["power"]); // a plug never shows lighting controls
  expect(kinds(ent("fan.f", "on", { supported_features: 0 }))).toEqual(["power"]);
  expect(kinds(ent("fan.g", "on", { supported_features: 1 }))).toEqual(["power", "fan_speed"]);
  expect(describe(ent("media_player.m", "on", { supported_features: 0 })).ordinary).toBe(false); // nothing we can control reliably
  expect(describe(ent("media_player.n", "on", { supported_features: 4 })).controls).toEqual([{ type: "media", playback: false, volume: true, power: false }]);
  const sensor = describe(ent("sensor.t", "21", { unit_of_measurement: "°C" }));
  expect(sensor.controls).toEqual([]);
  expect(sensor.reading).toEqual({ value: "21", unit: "°C", kind: "measurement" });
  expect(describe(ent("sensor.p", "5", { device_class: "power", unit_of_measurement: "W" })).category).toBe("energy");
  expect(describe(ent("cover.c", "open")).ordinary).toBe(false); // covers/blinds are out of v1
  expect(describe(ent("climate.x", "off", {})).ordinary).toBe(false); // no usable thermostat controls
});

async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  const devices = async (cookie: string) => (await t.call("GET", "/api/devices", { cookie })).json;
  const ids = async (cookie: string) => (await devices(cookie)).devices.map((d: any) => d.id as string);
  const cmd = (cookie: string, id: string, action: string, value?: any) => t.call("POST", `/api/devices/${id}/command`, { cookie, body: { action, value } });
  return { t, admin: admin.cookie!, member, guest, devices, ids, cmd };
}

test("members see household devices; unsupported ones stay out of the household UI", async () => {
  const { member, ids } = await home();
  const list = await ids(member.cookie);
  expect(list).toContain("light.kitchen");
  expect(list).not.toContain("cover.blind");
  const { admin, t } = await home();
  const all = (await t.call("GET", "/api/admin/devices", { cookie: admin })).json.devices;
  expect(all.find((d: any) => d.id === "cover.blind")).toMatchObject({ ordinary: false });
});

test("guests see and control only devices explicitly granted; revocable; per-user denies for members", async () => {
  const { t, admin, member, guest, ids, cmd } = await home();
  expect(await ids(guest.cookie)).toEqual([]);
  expect((await cmd(guest.cookie, "light.kitchen", "turn_off")).status).toBe(404);
  expect((await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin, body: { allow: ["light.kitchen"] } })).status).toBe(200);
  expect(await ids(guest.cookie)).toEqual(["light.kitchen"]);
  expect((await cmd(guest.cookie, "light.kitchen", "turn_off")).status).toBe(200);
  expect((await cmd(guest.cookie, "light.hall", "turn_off")).status).toBe(404); // not granted: indistinguishable from missing
  await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin, body: { reset: ["light.kitchen"] } });
  expect(await ids(guest.cookie)).toEqual([]);
  await t.call("PUT", `/api/admin/users/${member.userId}/devices`, { cookie: admin, body: { deny: ["lock.front"] } });
  expect(await ids(member.cookie)).not.toContain("lock.front");
  expect((await cmd(member.cookie, "lock.front", "lock")).status).toBe(404);
});

test("device.control permission is enforced separately from visibility", async () => {
  const { t, admin, member, cmd } = await home();
  await t.call("PUT", `/api/admin/users/${member.userId}/permissions`, { cookie: admin, body: { overrides: { "device.control": false } } });
  expect((await cmd(member.cookie, "light.kitchen", "turn_off")).status).toBe(403);
  expect((await t.call("GET", "/api/devices", { cookie: member.cookie })).status).toBe(200);
});

test("commands are validated against capabilities", async () => {
  const { t, member, cmd } = await home();
  expect((await cmd(member.cookie, "light.hall", "set_brightness", 50)).status).toBe(400); // on/off light
  expect((await cmd(member.cookie, "switch.plug", "set_brightness", 50)).status).toBe(400);
  expect((await cmd(member.cookie, "light.kitchen", "set_brightness", 500)).status).toBe(400);
  expect((await cmd(member.cookie, "light.kitchen", "set_brightness", "high")).status).toBe(400);
  expect((await cmd(member.cookie, "light.kitchen", "explode")).status).toBe(400);
  expect((await cmd(member.cookie, "climate.living", "set_temperature", 99)).status).toBe(400);
  expect((await cmd(member.cookie, "climate.living", "set_hvac_mode", "cool")).status).toBe(400);
  expect((await cmd(member.cookie, "sensor.temp", "turn_on")).status).toBe(400);
  expect(t.ha.calls.length).toBe(0); // nothing reached Home Assistant
});

test("successful commands translate to the right HA service and report the new state", async () => {
  const { t, member, cmd } = await home();
  const r = await cmd(member.cookie, "light.kitchen", "set_brightness", 40);
  expect(r.status).toBe(200);
  expect(r.json.confirmed).toBe(true);
  expect(r.json.device.attrs.brightnessPct).toBe(40);
  expect(t.ha.calls[0]).toEqual({ domain: "light", service: "turn_on", data: { brightness_pct: 40 }, entityId: "light.kitchen" });
  await cmd(member.cookie, "climate.living", "set_temperature", 22.5);
  expect(t.ha.calls[1]).toMatchObject({ domain: "climate", service: "set_temperature", data: { temperature: 22.5 } });
  await cmd(member.cookie, "media_player.tv", "set_volume", 30);
  expect(t.ha.calls[2]).toMatchObject({ service: "volume_set", data: { volume_level: 0.3 } });
});

test("accepted-but-unconfirmed and failed commands are never reported as success", async () => {
  const { t, member, cmd } = await home();
  t.ha.ignoring.add("light.kitchen");
  const unconfirmed = await cmd(member.cookie, "light.kitchen", "turn_off");
  expect(unconfirmed.json).toMatchObject({ ok: true, confirmed: false });
  expect(unconfirmed.json.device.state).toBe("on"); // still on: we report what HA says, not what we asked for
  t.ha.failing.add("switch.plug");
  const failed = await cmd(member.cookie, "switch.plug", "turn_off");
  expect(failed.status).toBe(409);
  expect(failed.json.ok).toBeUndefined();
  expect(failed.json.message).toBeTruthy();
});

test("offline devices stay visible, are flagged, and refuse commands without queueing", async () => {
  const { t, member, devices, cmd } = await home();
  const heater = (await devices(member.cookie)).devices.find((d: any) => d.id === "switch.heater");
  expect(heater).toMatchObject({ available: false, reason: "device_offline" });
  const r = await cmd(member.cookie, "switch.heater", "turn_on");
  expect(r.status).toBe(409);
  expect(r.json.message).toContain("offline");
  t.ha.set("switch.heater", "off"); // device reconnects
  expect(t.ha.calls.length).toBe(0); // the earlier failed command was NOT replayed
  expect((await devices(member.cookie)).devices.find((d: any) => d.id === "switch.heater").available).toBe(true);
});

test("when Home Assistant is down this is distinct from a device being offline", async () => {
  const { t, member, devices, cmd } = await home();
  t.ha.setStale(true);
  const d = await devices(member.cookie);
  expect(d.haHealth).toBe("unreachable");
  expect(d.devices.every((x: any) => !x.available && x.reason === "home_assistant_unavailable")).toBe(true);
  const r = await cmd(member.cookie, "light.kitchen", "turn_off");
  expect(r.status).toBe(503);
  expect(r.json.error).toBe("ha_unavailable");
  t.ha.setStale(false);
  expect(t.ha.calls.length).toBe(0);
});

test("unlocking needs recent re-authentication and both directions are audited", async () => {
  const { t, member, cmd } = await home();
  t.db.query("UPDATE sessions SET reauth_at = 0").run(); // as if they signed in a while ago
  expect((await cmd(member.cookie, "lock.front", "lock")).status).toBe(200); // locking is not sensitive
  expect((await cmd(member.cookie, "lock.front", "unlock")).json).toEqual({ error: "reauth_required" });
  await t.reauth(member.cookie, "m1");
  expect((await cmd(member.cookie, "lock.front", "unlock")).status).toBe(200);
  const rows = t.db.query("SELECT action, outcome FROM security_audit WHERE action LIKE 'lock.%'").all();
  expect(rows).toEqual([{ action: "lock.lock", outcome: "success" }, { action: "lock.unlock", outcome: "success" }]);
});

async function withGroup() {
  const h = await home();
  const g = await h.t.call("POST", "/api/admin/groups", { cookie: h.admin, body: { name: "Downstairs", entityIds: ["light.kitchen", "light.hall", "light.desk"] } });
  return { ...h, gid: g.json.id as string, gcmd: (cookie: string, action: string, value?: any) => h.t.call("POST", `/api/groups/${g.json.id}/command`, { cookie, body: { action, value } }) };
}

test("group commands report every outcome honestly, including partial failure", async () => {
  const { t, member, gcmd } = await withGroup();
  const all = await gcmd(member.cookie, "turn_off");
  expect(all.json.summary).toBe("all");
  t.ha.failing.add("light.hall");
  const partial = await gcmd(member.cookie, "turn_on");
  expect(partial.json.summary).toBe("partial");
  expect(partial.json.results.find((r: any) => r.id === "light.hall")).toMatchObject({ ok: false });
  expect(partial.json.results.filter((r: any) => r.ok).length).toBe(2);
  t.ha.failing.add("light.kitchen"); t.ha.failing.add("light.desk");
  expect((await gcmd(member.cookie, "turn_on")).json.summary).toBe("none");
  // an action some members can't do is a per-device failure, not a fake success
  t.ha.failing.clear();
  const mixed = await gcmd(member.cookie, "set_brightness", 30);
  expect(mixed.json.summary).toBe("partial");
  expect(mixed.json.results.find((r: any) => r.id === "light.hall")).toMatchObject({ ok: false, error: "unsupported" });
});

test("group commands never touch devices the caller may not control, and never name them", async () => {
  const { t, admin, guest, gcmd } = await withGroup();
  await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin, body: { allow: ["light.kitchen", "light.hall"] } });
  t.ha.calls.length = 0;
  const r = await gcmd(guest.cookie, "turn_off");
  expect(r.json.summary).toBe("partial");
  expect(r.json.notPermitted).toBe(1);
  expect(r.json.results.map((x: any) => x.id).sort()).toEqual(["light.hall", "light.kitchen"]);
  expect(t.ha.calls.map((c) => c.entityId).sort()).toEqual(["light.hall", "light.kitchen"]);
  expect(JSON.stringify(r.json)).not.toContain("desk");
  expect((await t.call("GET", "/api/groups", { cookie: guest.cookie })).json.groups[0].deviceIds).not.toContain("light.desk");
  expect((await t.call("POST", `/api/groups/${r.json.id ?? "x"}/command`, { cookie: guest.cookie, body: { action: "unlock" } })).status).toBe(400);
});

test("a user with no access to any member cannot see or use the group; locks can't be grouped", async () => {
  const { t, guest, gid, member } = await withGroup();
  expect((await t.call("GET", "/api/groups", { cookie: guest.cookie })).json.groups).toEqual([]);
  expect((await t.call("POST", `/api/groups/${gid}/command`, { cookie: guest.cookie, body: { action: "turn_off" } })).status).toBe(404);
  expect((await t.call("POST", `/api/groups/${gid}/command`, { cookie: member.cookie, body: { action: "unlock" } })).status).toBe(400);
});

test("rooms and device organisation are admin-only and household-scoped", async () => {
  const { t, admin, member, ids, devices } = await home();
  expect((await t.call("POST", "/api/admin/rooms", { cookie: member.cookie, body: { name: "Den" } })).status).toBe(403);
  expect((await t.call("PUT", "/api/admin/devices/light.kitchen", { cookie: member.cookie, body: { name: "x" } })).status).toBe(403);
  const room = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Kitchen" } })).json;
  expect((await t.call("PUT", "/api/admin/devices/light.kitchen", { cookie: admin, body: { roomId: room.id, name: "Ceiling light" } })).status).toBe(200);
  const k = (await devices(member.cookie)).devices.find((d: any) => d.id === "light.kitchen");
  expect(k).toMatchObject({ name: "Ceiling light", roomId: room.id });
  expect((await t.call("PUT", "/api/admin/devices/light.kitchen", { cookie: admin, body: { roomId: "not-a-room" } })).status).toBe(400);
  expect((await t.call("PUT", "/api/admin/devices/nope.nope", { cookie: admin, body: { name: "x" } })).status).toBe(404);
  await t.call("PUT", "/api/admin/devices/light.hall", { cookie: admin, body: { hidden: true } });
  expect(await ids(member.cookie)).not.toContain("light.hall");
  expect((await t.call("GET", "/api/rooms", { cookie: member.cookie })).json.rooms).toEqual([{ id: room.id, name: "Kitchen" }]);
});

test("personal preferences and favourites are per user and validated", async () => {
  const { t, admin, member, guest } = await home();
  await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin, body: { allow: ["light.kitchen"] } });
  const put = (cookie: string, body: any) => t.call("PUT", "/api/me/prefs", { cookie, body });
  expect((await put(member.cookie, { template: "minimal", appearance: "dark", sections: ["favorites", "sensors"] })).status).toBe(200);
  await t.call("PUT", "/api/me/favorites", { cookie: member.cookie, body: { devices: ["light.desk", "light.kitchen", "lock.front"], rooms: [] } });
  const mine = (await t.call("GET", "/api/me/prefs", { cookie: member.cookie })).json;
  expect(mine).toMatchObject({ template: "minimal", appearance: "dark" });
  expect(mine.favorites.devices).toEqual(["light.desk", "light.kitchen", "lock.front"]); // order preserved
  const theirs = (await t.call("GET", "/api/me/prefs", { cookie: admin })).json;
  expect(theirs).toMatchObject({ template: "comfort", appearance: "system" });
  expect(theirs.favorites.devices).toEqual([]);
  // a guest can't favourite what they can't see
  const g = await t.call("PUT", "/api/me/favorites", { cookie: guest.cookie, body: { devices: ["light.kitchen", "lock.front"], rooms: [] } });
  expect(g.json.favorites.devices).toEqual(["light.kitchen"]);
  for (const bad of [{ template: "neon" }, { appearance: "sepia" }, { sections: ["admin"] }, { roomOrder: "x" }]) expect((await put(member.cookie, bad)).status).toBe(400);
  // losing access also removes it from the favourites response
  await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin, body: { reset: ["light.kitchen"] } });
  expect((await t.call("GET", "/api/me/prefs", { cookie: guest.cookie })).json.favorites.devices).toEqual([]);
});

test("search matches name, room and type, and respects permissions", async () => {
  const { t, admin, member, guest } = await home();
  const room = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Bedroom" } })).json;
  await t.call("PUT", "/api/admin/devices/fan.bedroom", { cookie: admin, body: { roomId: room.id } });
  const q = async (cookie: string, s: string) => (await t.call("GET", `/api/search?q=${encodeURIComponent(s)}`, { cookie })).json;
  expect((await q(member.cookie, "kitch")).devices.map((d: any) => d.id)).toEqual(["light.kitchen"]);
  expect((await q(member.cookie, "bedroom")).devices.map((d: any) => d.id)).toContain("fan.bedroom"); // by room
  expect((await q(member.cookie, "bedroom")).rooms.length).toBe(1);
  expect((await q(member.cookie, "light")).devices.length).toBeGreaterThanOrEqual(3); // by type
  expect((await q(member.cookie, "door")).devices.map((d: any) => d.id)).toContain("lock.front");
  expect((await q(member.cookie, "blind")).devices).toEqual([]); // unsupported device is not discoverable
  expect((await q(guest.cookie, "light")).devices).toEqual([]); // nothing granted
  expect((await q(guest.cookie, "kitchen")).devices).toEqual([]);
  expect((await t.call("GET", "/api/search?q=x")).status).toBe(401);
});

test("camera snapshots go through the app, with the same access rules", async () => {
  const { t, admin, member, guest } = await home();
  const ok = await t.app.handle(new Request("http://localhost/api/devices/camera.porch/snapshot", { headers: { cookie: member.cookie } }));
  expect(ok.status).toBe(200);
  expect(ok.headers.get("content-type")).toBe("image/jpeg");
  const denied = await t.app.handle(new Request("http://localhost/api/devices/camera.porch/snapshot", { headers: { cookie: guest.cookie } }));
  expect(denied.status).toBe(404);
  expect((await t.app.handle(new Request("http://localhost/api/devices/light.kitchen/snapshot", { headers: { cookie: admin } }))).status).toBe(404);
});

test("live stream delivers only changes the user is allowed to see, and stops when access ends", async () => {
  const { t, admin, member, guest } = await home();
  await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin, body: { allow: ["light.kitchen"] } });
  const open = async (cookie: string) => {
    const res = await t.app.handle(new Request("http://localhost/api/stream", { headers: { cookie } }));
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader(); const dec = new TextDecoder();
    const queue: string[] = [];
    (async () => { try { for (;;) { const r = await reader.read(); if (r.done) return; queue.push(dec.decode(r.value)); } } catch {} })();
    return { next: async () => { for (let i = 0; i < 15 && !queue.length; i++) await Bun.sleep(20); return queue.shift() ?? null; }, reader };
  };
  const m = await open(member.cookie), g = await open(guest.cookie);
  expect(await m.next()).toContain("event: hello");
  expect(await g.next()).toContain("event: hello");
  t.ha.set("light.desk", "on");
  expect(await m.next()).toContain("light.desk");
  expect(await g.next()).toBeNull(); // guest isn't allowed light.desk
  t.ha.set("light.kitchen", "off");
  expect(await g.next()).toContain("light.kitchen");
  t.ha.setStale(true);
  expect(await g.next()).toContain("event: ha");
  await t.call("DELETE", `/api/admin/users/${guest.userId}`, { cookie: admin });
  t.ha.set("light.kitchen", "on");
  expect(await g.next()).toBeNull(); // revoked: stream is closed, nothing delivered
  expect((await t.call("GET", "/api/stream")).status).toBe(401);
  await m.reader.cancel();
});

test("rooms are only revealed to people who can use something in them", async () => {
  const { t, admin, member, guest } = await home();
  const a = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Study" } })).json;
  const b = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Nursery" } })).json;
  await t.call("PUT", "/api/admin/devices/light.kitchen", { cookie: admin, body: { roomId: a.id } });
  await t.call("PUT", "/api/admin/devices/light.hall", { cookie: admin, body: { roomId: b.id } });
  await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin, body: { allow: ["light.kitchen"] } });
  const names = async (c: string) => (await t.call("GET", "/api/rooms", { cookie: c })).json.rooms.map((r: any) => r.name).sort();
  expect(await names(guest.cookie)).toEqual(["Study"]); // not "Nursery"
  expect(await names(member.cookie)).toEqual(["Nursery", "Study"]);
  expect(await names(admin)).toEqual(["Nursery", "Study"]); // managers see empty rooms too
});

test("asking for what is already true is confirmed, but a device that ignores a real change is not", async () => {
  const { t, admin } = await (async () => { const t = setup(); const a = await t.bootstrapAdmin("a1"); return { t, admin: a.cookie! }; })();
  const cmd = (id: string, action: string) => t.call("POST", `/api/devices/${encodeURIComponent(id)}/command`, { cookie: admin, body: { action } });
  t.ha.set("light.kitchen", "on");
  expect((await cmd("light.kitchen", "turn_on")).json.confirmed).toBe(true); // already on: no state change happens, still true
  t.ha.ignoring.add("light.hall"); t.ha.set("light.hall", "off");
  expect((await cmd("light.hall", "turn_on")).json.confirmed).toBe(false); // accepted but never happened
});

test("what someone reaches for most is remembered for them alone", async () => {
  const t = setup(); const a = await t.bootstrapAdmin("a1"); const m = await t.addUser(a.cookie!, "member", "m1");
  const cmd = (cookie: string, id: string, action: string) => t.call("POST", `/api/devices/${encodeURIComponent(id)}/command`, { cookie, body: { action } });
  const freq = async (cookie: string) => (await t.call("GET", "/api/me/prefs", { cookie })).json.frequent as string[];
  for (let i = 0; i < 3; i++) { await cmd(a.cookie!, "light.kitchen", i % 2 ? "turn_off" : "turn_on"); }
  await cmd(a.cookie!, "light.hall", "turn_on"); // a one-off is not a habit
  expect(await freq(a.cookie!)).toEqual(["light.kitchen"]);
  expect(await freq(m.cookie)).toEqual([]); // someone else's taps are theirs alone
  await t.call("PUT", "/api/me/favorites", { cookie: a.cookie!, body: { devices: ["light.kitchen"], rooms: [] } });
  expect(await freq(a.cookie!)).toEqual([]); // already a favourite, so not repeated
});

test("a device's day is available only to people who can use it, and is honest when the hub is away", async () => {
  const t = setup(); const a = await t.bootstrapAdmin("a1"); const g = await t.addUser(a.cookie!, "guest", "g1");
  const now = Date.now();
  t.ha.historyFor.set("light.kitchen", [{ t: now - 7200_000, state: "on" }, { t: now - 3600_000, state: "off" }]);
  const r = await t.call("GET", "/api/devices/light.kitchen/history", { cookie: a.cookie! });
  expect([r.status, r.json.kind, r.json.points.length]).toEqual([200, "state", 2]);
  t.ha.historyFor.set("sensor.temp", [{ t: now - 1000, state: "21.5" }, { t: now, state: "21.7" }]);
  expect((await t.call("GET", "/api/devices/sensor.temp/history", { cookie: a.cookie! })).json.kind).toBe("numeric");
  expect((await t.call("GET", "/api/devices/light.kitchen/history", { cookie: g.cookie })).status).toBe(404);
  t.ha.setStale(true);
  expect((await t.call("GET", "/api/devices/light.kitchen/history", { cookie: a.cookie! })).status).toBe(503);
});
