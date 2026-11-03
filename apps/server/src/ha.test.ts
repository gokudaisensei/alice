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
