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
  const mine = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "kitchen" } })).json; // already organised by hand
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
  const den = (await t.call("POST", "/api/admin/rooms", { cookie: admin, body: { name: "Den" } })).json;
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
