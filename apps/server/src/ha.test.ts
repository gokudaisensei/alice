import { afterAll, expect, test } from "bun:test";
import { HaClient } from "./ha";
import { startMockHa } from "../../mock-ha/src/mock";

const mock = startMockHa(18123, "tok");
afterAll(() => mock.stop());
const until = async (f: () => boolean, ms = 3000) => { const t = Date.now(); while (!f() && Date.now() - t < ms) await Bun.sleep(20); };

test("connects, caches states, follows events, and reports unavailable devices honestly", async () => {
  const ha = new HaClient("http://127.0.0.1:18123", "tok"); ha.start();
  await until(() => ha.conn === "connected");
  expect(ha.health()).toBe("ok");
  expect(ha.entities.get("light.living_room")?.state).toBe("on");
  expect(await ha.callService("light", "turn_off", {}, "light.living_room")).toEqual({ ok: true });
  await until(() => ha.entities.get("light.living_room")?.state === "off");
  expect(ha.entities.get("light.living_room")?.state).toBe("off");
  expect(await ha.callService("switch", "turn_on", {}, "switch.heater")).toEqual({ ok: false, error: "device_unavailable" });
  expect(await ha.callService("light", "turn_on", {}, "light.nope")).toEqual({ ok: false, error: "device_unavailable" });
  ha.stop();
});

test("a change that lands before we start waiting is still seen as a confirmation", async () => {
  const ha = new HaClient("http://127.0.0.1:18123", "tok"); ha.start();
  await until(() => ha.conn === "connected");
  const before = ha.entities.get("light.living_room");
  await ha.callService("light", "turn_on", {}, "light.living_room");
  await until(() => ha.entities.get("light.living_room") !== before); // event already processed
  expect(await ha.waitForChange("light.living_room", before, 100)).toBe(true);
  expect(await ha.waitForChange("light.living_room", ha.entities.get("light.living_room"), 60)).toBe(false); // nothing new: honest timeout
  ha.stop();
});

test("a wrong token is auth_failed, not a generic outage", async () => {
  const ha = new HaClient("http://127.0.0.1:18123", "wrong"); ha.start();
  await until(() => ha.conn === "auth_failed");
  expect(ha.health()).toBe("auth_failed");
  ha.stop();
});

test("when HA is down: unreachable, stale, and commands fail instead of queueing", async () => {
  const ha = new HaClient("http://127.0.0.1:1", "tok"); ha.start();
  await Bun.sleep(150);
  expect(ha.health()).toBe("unreachable");
  expect(ha.isStale()).toBe(true);
  expect(await ha.callService("light", "turn_on", {}, "light.living_room")).toEqual({ ok: false, error: "ha_unavailable" });
  ha.stop();
});

test("reads the hub's version, time zone and unit system", async () => {
  const ha = new HaClient("http://127.0.0.1:18123", "tok"); ha.start();
  await until(() => ha.info.version !== null);
  expect(ha.info).toEqual({ version: "2026.10.4", timeZone: "Asia/Kolkata", locationName: "Home", metric: true });
  ha.stop();
});

test("a rename in the hub reaches the cache without a restart, and a burst of changes is read once", async () => {
  mock.registry.entities = [{ entity_id: "light.kitchen", device_id: "d1", original_name: "Light" }];
  mock.registry.devices = [{ id: "d1", name: "Kitchen strip" }];
  const ha = new HaClient("http://127.0.0.1:18123", "tok", { registryDebounceMs: 30 }); ha.start();
  await until(() => ha.parents.get("light.kitchen")?.deviceName === "Kitchen strip");
  let reads = 0; ha.subscribe((e) => { if (e.type === "conn") reads++; });
  mock.registry.devices = [{ id: "d1", name: "Kitchen strip", name_by_user: "Under-cabinet" }];
  mock.registry.entities = [{ entity_id: "light.kitchen", device_id: "d1", original_name: "Light", hidden_by: "user" }];
  for (const t of ["device_registry_updated", "entity_registry_updated", "device_registry_updated"]) mock.fire(t);
  await until(() => ha.parents.get("light.kitchen")?.deviceName === "Under-cabinet");
  await Bun.sleep(100);
  expect(ha.parents.get("light.kitchen")?.deviceName).toBe("Under-cabinet");
  expect(ha.secondary.has("light.kitchen")).toBe(true);
  expect(reads).toBe(1);
  ha.stop();
  mock.registry.entities = []; mock.registry.devices = [];
});

test("a link that stops answering is dropped and re-established, instead of looking connected", async () => {
  const ha = new HaClient("http://127.0.0.1:18123", "tok", { pingMs: 40, replyMs: 80 }); ha.start();
  await until(() => ha.conn === "connected");
  mock.goQuiet(true);
  await until(() => ha.conn !== "connected", 2000);
  expect(ha.isStale()).toBe(true);
  mock.goQuiet(false);
  await until(() => ha.conn === "connected", 4000);
  expect(ha.health()).toBe("ok");
  ha.stop();
});

test("areas and floors are read, and an entity is in its own area or else its device's", async () => {
  mock.registry.floors = [{ floor_id: "f1", name: "Upstairs", level: 1 }];
  mock.registry.areas = [{ area_id: "bed", name: "Bedroom", floor_id: "f1" }, { area_id: "bath", name: "Bathroom", floor_id: null }];
  mock.registry.devices = [{ id: "d1", name: "Lamp", area_id: "bed" }];
  mock.registry.entities = [{ entity_id: "light.living_room", device_id: "d1" }, { entity_id: "light.kitchen", device_id: "d1", area_id: "bath" }, { entity_id: "light.hall", area_id: "gone" }];
  const ha = new HaClient("http://127.0.0.1:18123", "tok", { registryDebounceMs: 30 }); ha.start();
  await until(() => ha.areas.size === 2);
  expect(ha.areas.get("bed")).toEqual({ id: "bed", name: "Bedroom", floorId: "f1" });
  expect(ha.floors.get("f1")?.name).toBe("Upstairs");
  expect(ha.areaOf.get("light.living_room")).toBe("bed");  // through its device
  expect(ha.areaOf.get("light.kitchen")).toBe("bath");     // its own area beats its device's
  expect(ha.areaOf.has("light.hall")).toBe(false);          // an area that no longer exists
  mock.registry.areas = [{ area_id: "bed", name: "Master bedroom", floor_id: "f1" }, { area_id: "bath", name: "Bathroom", floor_id: null }];
  mock.fire("area_registry_updated");
  await until(() => ha.areas.get("bed")?.name === "Master bedroom");
  expect(ha.areas.get("bed")?.name).toBe("Master bedroom");
  ha.stop();
  mock.registry.entities = []; mock.registry.devices = []; mock.registry.areas = []; mock.registry.floors = [];
});

test("labels, device details and the integration of each entity are read from the registries", async () => {
  mock.registry.labels = [{ label_id: "evening", name: "Evening lights" }];
  mock.registry.devices = [{ id: "d1", name: "Strip", manufacturer: "Acme", model: "S2", sw_version: "1.4", labels: ["evening"] }];
  mock.registry.entities = [{ entity_id: "light.kitchen", device_id: "d1", platform: "zha", labels: ["gone"] }];
  const ha = new HaClient("http://127.0.0.1:18123", "tok", { registryDebounceMs: 30 }); ha.start();
  await until(() => ha.labels.size === 1);
  expect(ha.labelsOf.get("light.kitchen")).toEqual(["evening"]); // its device's label; an unknown one is ignored
  expect(ha.deviceInfo.get("d1")).toEqual({ manufacturer: "Acme", model: "S2", firmware: "1.4", hardware: null });
  expect(ha.platformOf.get("light.kitchen")).toBe("zha");
  ha.stop();
  mock.registry.entities = []; mock.registry.devices = []; mock.registry.labels = [];
});
