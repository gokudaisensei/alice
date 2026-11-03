import { expect, test } from "bun:test";
import { setup, type Body } from "./testkit";

async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  // The hub has two areas on one floor; the kitchen light is in one directly, the lamp through its device.
  t.ha.floors.set("f1", { id: "f1", name: "Ground floor", level: 0 });
  t.ha.areas.set("kitchen", { id: "kitchen", name: "Kitchen", floorId: "f1" });
  t.ha.areas.set("hall", { id: "hall", name: "Hallway", floorId: null });
  t.ha.areaOf.set("light.kitchen", "kitchen"); t.ha.areaOf.set("light.hall", "hall");
  const rooms = async (cookie: string) => (await t.call("GET", "/api/rooms", { cookie })).json.rooms as Body[];
  const room = async (id: string) => (await t.call("GET", "/api/devices", { cookie: member.cookie })).json.devices.find((d: Body) => d.id === id)?.roomId;
  return { t, admin: admin.cookie!, member, rooms, room };
}

test("areas are previewed first; nothing changes until an admin imports", async () => {
  const { t, admin, member, rooms, room } = await home();
  const r = (await t.call("GET", "/api/admin/rooms/ha-areas", { cookie: admin })).json;
  expect(r.available).toBe(true);
  expect(r.areas).toEqual([
    { id: "kitchen", name: "Kitchen", floor: "Ground floor", devices: 1, state: "new", roomId: null },
    { id: "hall", name: "Hallway", floor: null, devices: 1, state: "new", roomId: null },
  ]);
  expect(await rooms(admin)).toEqual([]);
  expect(await room("light.kitchen")).toBeNull();
  expect((await t.call("GET", "/api/admin/rooms/ha-areas", { cookie: member.cookie })).status).toBe(403);
  expect((await t.call("POST", "/api/admin/rooms/ha-import", { cookie: member.cookie, body: {} })).status).toBe(403);
});

test("importing creates rooms, links same-named ones, and devices follow their area", async () => {
  const { t, admin, rooms, room } = await home();
  const mine = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "kitchen", inHa: false } })).json; // already organised by hand, never sent to the hub
  expect((await t.call("POST", "/api/admin/rooms/ha-import", { cookie: admin, body: {} })).json).toEqual({ ok: true, created: 1, linked: 1 });
  const list = await rooms(admin);
  expect(list.map((x) => x.name).sort()).toEqual(["Hallway", "Kitchen"]); // the area's spelling wins
  expect(list.find((x) => x.id === mine.id)?.floor).toBe("Ground floor");
  expect(await room("light.kitchen")).toBe(mine.id);
  expect(await room("light.hall")).toBe(list.find((x) => x.name === "Hallway")!.id);
  // Running it again changes nothing.
  expect((await t.call("POST", "/api/admin/rooms/ha-import", { cookie: admin, body: {} })).json).toEqual({ ok: true, created: 0, linked: 0 });
  expect((await rooms(admin)).length).toBe(2);
});

test("only the areas asked for are imported, and bad input is refused", async () => {
  const { t, admin, rooms } = await home();
  expect((await t.call("POST", "/api/admin/rooms/ha-import", { cookie: admin, body: { areaIds: "kitchen" } })).status).toBe(400);
  expect((await t.call("POST", "/api/admin/rooms/ha-import", { cookie: admin, body: { areaIds: ["hall"] } })).json).toMatchObject({ created: 1 });
  expect((await rooms(admin)).map((x) => x.name)).toEqual(["Hallway"]);
});

test("a rename in the hub shows here; the household's own placement still wins", async () => {
  const { t, admin, rooms, room } = await home();
  await t.call("POST", "/api/admin/rooms/ha-import", { cookie: admin, body: {} });
  t.ha.areas.set("kitchen", { id: "kitchen", name: "Cooking space", floorId: "f1" });
  expect((await rooms(admin)).map((x) => x.name)).toContain("Cooking space");
  const den = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Den", inHa: false } })).json;
  await t.call("PUT", "/api/admin/devices/light.kitchen", { cookie: admin, body: { roomId: den.id } });
  expect(await room("light.kitchen")).toBe(den.id);
  // Moving the device to another area in the hub moves it here, unless the household chose.
  t.ha.areaOf.set("light.hall", "kitchen");
  expect(await room("light.hall")).toBe((await rooms(admin)).find((x) => x.name === "Cooking space")!.id);
});

test("with the hub down nothing is imported", async () => {
  const { t, admin, rooms } = await home();
  t.ha.setStale(true);
  expect((await t.call("POST", "/api/admin/rooms/ha-import", { cookie: admin, body: {} })).status).toBe(503);
  expect((await t.call("GET", "/api/admin/rooms/ha-areas", { cookie: admin })).json.available).toBe(false);
  expect(await rooms(admin)).toEqual([]);
});

test("a new room is made in the hub too, and one with the same name as an area joins it", async () => {
  const { t, admin, rooms } = await home();
  const lounge = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Lounge" } })).json;
  expect(lounge.inHa).toBe(true);
  expect(t.ha.areas.get("lounge")?.name).toBe("Lounge");
  const again = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "kitchen" } })).json;
  expect(again.inHa).toBe(true); // joined the existing Kitchen area rather than making a second
  expect([...t.ha.areas.values()].filter((a) => a.name.toLowerCase() === "kitchen").length).toBe(1);
  expect((await rooms(admin)).length).toBe(2);
});

test("when the hub refuses, a new room still exists here but is not linked", async () => {
  const { t, admin, rooms } = await home();
  t.ha.areaFails = true;
  const r = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Porch" } })).json;
  expect(r).toMatchObject({ name: "Porch", inHa: false });
  expect((await rooms(admin)).map((x) => x.name)).toEqual(["Porch"]);
});

test("renaming a linked room renames the area; if the hub refuses, nothing changes", async () => {
  const { t, admin, rooms } = await home();
  await t.call("POST", "/api/admin/rooms/ha-import", { cookie: admin, body: {} });
  const k = (await rooms(admin)).find((x) => x.name === "Kitchen")!;
  t.ha.areaFails = true;
  expect((await t.call("PATCH", `/api/admin/rooms/${k.id}`, { cookie: admin, body: { name: "Galley" } })).status).toBe(502);
  expect(t.ha.areas.get("kitchen")?.name).toBe("Kitchen");
  t.ha.areaFails = false;
  expect((await t.call("PATCH", `/api/admin/rooms/${k.id}`, { cookie: admin, body: { name: "Galley", color: "teal" } })).status).toBe(200);
  expect(t.ha.areas.get("kitchen")?.name).toBe("Galley");
  expect((await rooms(admin)).find((x) => x.id === k.id)).toMatchObject({ name: "Galley", color: "teal" });
});

test("placing a device in a linked room tells the hub, and says so when it could not", async () => {
  const { t, admin, room } = await home();
  await t.call("POST", "/api/admin/rooms/ha-import", { cookie: admin, body: {} });
  const hall = (await t.call("GET", "/api/rooms", { cookie: admin })).json.rooms.find((x: Body) => x.name === "Hallway");
  expect((await t.call("PUT", `/api/admin/rooms/${hall.id}/devices`, { cookie: admin, body: { add: ["light.desk"] } })).json).toEqual({ ok: true, inHa: true });
  expect(t.ha.areaOf.get("light.desk")).toBe("hall");
  expect(await room("light.desk")).toBe(hall.id);
  t.ha.areaFails = true;
  expect((await t.call("PUT", `/api/admin/rooms/${hall.id}/devices`, { cookie: admin, body: { add: ["switch.plug"] } })).json).toEqual({ ok: true, inHa: false });
  expect(await room("switch.plug")).toBe(hall.id); // the household's placement holds regardless
});

test("hub labels become groups whose members follow the label", async () => {
  const { t, admin, member } = await home();
  t.ha.labels.set("evening", "Evening lights"); t.ha.labels.set("away", "Away");
  t.ha.labelsOf.set("light.kitchen", ["evening"]); t.ha.labelsOf.set("light.hall", ["evening", "away"]);
  const mine = (await t.call("POST", "/api/admin/groups", { cookie: admin, body: { name: "evening lights", entityIds: ["light.desk"] } })).json;
  const plan = (await t.call("GET", "/api/admin/groups/ha-labels", { cookie: admin })).json;
  expect(plan.labels).toEqual([
    { id: "away", name: "Away", devices: 1, state: "new", groupId: null },
    { id: "evening", name: "Evening lights", devices: 2, state: "match", groupId: mine.id },
  ]);
  expect((await t.call("POST", "/api/admin/groups/ha-import", { cookie: member.cookie, body: {} })).status).toBe(403);
  expect((await t.call("POST", "/api/admin/groups/ha-import", { cookie: admin, body: {} })).json).toEqual({ ok: true, created: 1, linked: 1 });
  const groups = (await t.call("GET", "/api/groups", { cookie: admin })).json.groups as Body[];
  expect(groups.find((x) => x.id === mine.id).deviceIds.sort()).toEqual(["light.desk", "light.hall", "light.kitchen"]); // the one added by hand stays
  expect(groups.find((x) => x.name === "Away").deviceIds).toEqual(["light.hall"]);
  t.ha.labelsOf.delete("light.kitchen"); // unlabelled in the hub: leaves the group here
  expect((await t.call("GET", "/api/groups", { cookie: admin })).json.groups.find((x: Body) => x.id === mine.id).deviceIds).not.toContain("light.kitchen");
});

test("about a device: what the hub's registry knows, only for devices you can use", async () => {
  const { t, admin, member } = await home();
  t.ha.parents.set("light.kitchen", { deviceId: "d1", deviceName: "Kitchen strip", label: null, cls: null });
  t.ha.parents.set("sensor.temp", { deviceId: "d1", deviceName: "Kitchen strip", label: null, cls: null });
  t.ha.entities.set("sensor.strip_battery", { entity_id: "sensor.strip_battery", state: "81.6", attributes: { device_class: "battery", unit_of_measurement: "%" } });
  t.ha.parents.set("sensor.strip_battery", { deviceId: "d1", deviceName: "Kitchen strip", label: null, cls: "battery" });
  t.ha.deviceInfo.set("d1", { manufacturer: "Acme", model: "Strip 2", firmware: "1.4.2", hardware: null });
  t.ha.platformOf.set("light.kitchen", "zha");
  t.ha.labels.set("evening", "Evening lights"); t.ha.labelsOf.set("light.kitchen", ["evening"]);
  t.ha.areas.set("kitchen", { id: "kitchen", name: "Kitchen", floorId: "f1" }); t.ha.floors.set("f1", { id: "f1", name: "Ground floor", level: 0 }); t.ha.areaOf.set("light.kitchen", "kitchen");
  expect((await t.call("GET", "/api/devices/light.kitchen/about", { cookie: member.cookie })).json).toEqual({
    device: "Kitchen strip", manufacturer: "Acme", model: "Strip 2", firmware: "1.4.2", integration: "zha", room: "Kitchen", floor: "Ground floor", battery: 82, labels: ["Evening lights"],
  });
  expect((await t.call("GET", "/api/devices/light.nope/about", { cookie: admin })).status).toBe(404);
  expect((await t.call("GET", "/api/devices/light.kitchen/about")).status).toBe(401);
  // A light with no registry details answers with nothing rather than guessing.
  expect((await t.call("GET", "/api/devices/light.desk/about", { cookie: admin })).json).toEqual({ device: null, manufacturer: null, model: null, firmware: null, integration: null, room: null, floor: null, battery: null, labels: [] });
});
