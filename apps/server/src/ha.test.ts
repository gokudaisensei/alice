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
