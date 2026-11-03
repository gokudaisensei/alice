// Runs the app against a REAL Home Assistant (the stable container, with the demo integration).
// Skipped unless HA_REAL_URL and HA_REAL_TOKEN are set:  HA_REAL_URL=http://127.0.0.1:8123 HA_REAL_TOKEN=... bun test src/real-ha.test.ts
import { afterAll, beforeAll, expect, test } from "bun:test";
import { HaClient } from "./ha";
import { ensureModeHelper, MODE_ENTITY } from "./modes";
import { setup, type Body } from "./testkit";

const URL_ = process.env.HA_REAL_URL, TOKEN = process.env.HA_REAL_TOKEN;
const real = URL_ && TOKEN ? test : test.skip;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

let ha: HaClient, t: ReturnType<typeof setup>, admin: string;
const j = (m: string, p: string, body?: unknown) => t.call(m, p, { cookie: admin, body });
const state = async (id: string) => (await fetch(`${URL_}/api/states/${id}`, { headers: { authorization: `Bearer ${TOKEN}` } }).then((r) => r.json())) as Body;
const until = async (f: () => Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await wait(250); } return false; };

beforeAll(async () => {
  if (!URL_ || !TOKEN) return;
  ha = new HaClient(URL_, TOKEN); ha.start();
  expect(await until(async () => ha.health() === "ok")).toBe(true);
  t = setup(ha);
  const a = await t.bootstrapAdmin("a1"); await t.reauth(a.cookie!, "a1"); admin = a.cookie!;
});
afterAll(() => { ha?.stop?.(); });

real("connects, loads the demo home, and describes real devices", async () => {
  const devs = (await j("GET", "/api/devices")).json.devices as Body[];
  const by = (id: string) => devs.find((d) => d.id === id);
  expect(devs.length).toBeGreaterThan(10);
  expect(by("light.ceiling_lights").controls.map((c: Body) => c.type)).toEqual(expect.arrayContaining(["power", "brightness"]));
  expect(by("climate.hvac").controls.map((c: Body) => c.type)).toContain("thermostat");
  expect(by("lock.front_door").controls.map((c: Body) => c.type)).toContain("lock");
  expect(by("sensor.power_consumption")).toMatchObject({ category: "energy" });
  expect(by("cover.kitchen_window")).toBeUndefined(); // covers are out of scope for ordinary users
});

real("a command reaches the real light and is confirmed by the real state change", async () => {
  const r = await j("POST", `/api/devices/${encodeURIComponent("light.bed_light")}/command`, { action: "turn_on" });
  expect(r.json).toMatchObject({ ok: true, confirmed: true });
  expect((await state("light.bed_light")).state).toBe("on");
  const b = await j("POST", `/api/devices/${encodeURIComponent("light.bed_light")}/command`, { action: "set_brightness", value: 40 });
  expect(b.json.confirmed).toBe(true);
  expect(Math.round(((await state("light.bed_light")).attributes.brightness / 255) * 100)).toBe(40);
  await j("POST", `/api/devices/${encodeURIComponent("light.bed_light")}/command`, { action: "turn_off" });
});

real("unlocking needs a fresh check, and works on a real lock", async () => {
  t.db.query("UPDATE sessions SET reauth_at = 0").run();
  const id = encodeURIComponent("lock.front_door");
  expect((await j("POST", `/api/devices/${id}/command`, { action: "unlock" })).json.error).toBe("reauth_required");
  await t.reauth(admin, "a1");
  expect((await j("POST", `/api/devices/${id}/command`, { action: "unlock" })).json.confirmed).toBe(true);
  expect((await state("lock.front_door")).state).toBe("unlocked");
  await j("POST", `/api/devices/${id}/command`, { action: "lock" });
});

real("the household mode helper is created in real HA and switching it works", async () => {
  const r = await ensureModeHelper(ha);
  expect(["created", "exists"]).toContain(r);
  expect((await state(MODE_ENTITY)).attributes.options).toEqual(["home", "away", "night", "vacation"]);
  expect((await j("POST", "/api/mode", { mode: "away" })).json).toMatchObject({ ok: true, confirmed: true });
  expect((await state(MODE_ENTITY)).state).toBe("away");
  await j("POST", "/api/mode", { mode: "home" });
});

real("a scene is written through HA's config API, appears, and activates", async () => {
  await j("POST", `/api/devices/${encodeURIComponent("light.bed_light")}/command`, { action: "turn_on" });
  const c = await j("POST", "/api/scenes", { name: "Test movie night", entityIds: ["light.bed_light", "light.ceiling_lights"] });
  expect(c.status).toBe(200);
  const sc = (await j("GET", "/api/scenes")).json.scenes.find((s: Body) => s.name === "Test movie night");
  expect(sc?.managed).toBe(true);
  await j("POST", `/api/devices/${encodeURIComponent("light.bed_light")}/command`, { action: "turn_off" });
  const a = await j("POST", `/api/scenes/${encodeURIComponent(sc.id)}/activate`);
  expect(a.json.ok).toBe(true);
  expect(await until(async () => (await state("light.bed_light")).state === "on")).toBe(true);
  expect((await j("DELETE", `/api/scenes/${encodeURIComponent(sc.id)}`)).status).toBe(200);
});

real("a routine becomes a real HA script that really runs", async () => {
  await j("POST", `/api/devices/${encodeURIComponent("light.bed_light")}/command`, { action: "turn_off" });
  const c = await j("POST", "/api/routines", { name: "Test routine", steps: [{ type: "device", entityId: "light.bed_light", action: "turn_on" }, { type: "delay", seconds: 1 }, { type: "mode", mode: "night" }] });
  expect(c.status).toBe(200);
  const r = await j("POST", `/api/routines/${c.json.id}/run`);
  expect(r.json.ok).toBe(true);
  expect(await until(async () => (await state("light.bed_light")).state === "on" && (await state(MODE_ENTITY)).state === "night")).toBe(true);
  await j("POST", "/api/mode", { mode: "home" });
  expect((await j("DELETE", `/api/routines/${c.json.id}`)).status).toBe(200);
});

real("an automation is accepted by real HA, can be switched, and actually fires", async () => {
  await j("POST", `/api/devices/${encodeURIComponent("light.bed_light")}/command`, { action: "turn_off" });
  await j("POST", "/api/mode", { mode: "home" });
  const body = {
    name: "Test: away turns on bed light",
    triggers: [{ type: "mode", mode: "away" }],
    conditions: [{ type: "time", after: "00:00", before: "23:59" }, { type: "days", days: ["mon", "tue", "wed", "thu", "fri", "sat"] }],
    actions: [{ type: "device", entityId: "light.bed_light", action: "turn_on" }],
  };
  const c = await j("POST", "/api/automations", body);
  expect(c.status).toBe(200);
  const a = (await j("GET", "/api/automations")).json.automations.find((x: Body) => x.id === c.json.id);
  expect(a.enabled).toBe(true);
  // Off: nothing happens. On: it fires.
  expect((await j("POST", `/api/automations/${c.json.id}/enabled`, { enabled: false })).json.enabled).toBe(false);
  await j("POST", "/api/mode", { mode: "away" }); await wait(1500);
  expect((await state("light.bed_light")).state).toBe("off");
  await j("POST", "/api/mode", { mode: "home" });
  expect((await j("POST", `/api/automations/${c.json.id}/enabled`, { enabled: true })).json.enabled).toBe(true);
  await j("POST", "/api/mode", { mode: "away" });
  expect(await until(async () => (await state("light.bed_light")).state === "on")).toBe(true);
  expect(await until(async () => !!(await j("GET", "/api/automations")).json.automations.find((x: Body) => x.id === c.json.id).lastTriggered)).toBe(true);
  await j("POST", "/api/mode", { mode: "home" });
  expect((await j("DELETE", `/api/automations/${c.json.id}`)).status).toBe(200);
});

real("every trigger and condition type is valid HA configuration", async () => {
  const ids: string[] = [];
  const body = (over: Body) => ({ name: "Test shape " + ids.length, triggers: [{ type: "time", at: "03:15" }], conditions: [], actions: [{ type: "device", entityId: "light.bed_light", action: "turn_off" }], ...over });
  const cases = [
    { triggers: [{ type: "device_state", entityId: "light.ceiling_lights", to: "off", forSeconds: 300 }] },
    { triggers: [{ type: "sensor", entityId: "sensor.outside_temperature", above: 30, forSeconds: 60 }] },
    { triggers: [{ type: "sensor", entityId: "sensor.outside_temperature", below: -5 }] },
    { triggers: [{ type: "sun", event: "sunset", offsetMinutes: -30 }] },
    { triggers: [{ type: "sun", event: "sunrise" }] },
    { conditions: [{ type: "device_state", entityId: "switch.decorative_lights", is: "on" }, { type: "sensor", entityId: "sensor.power_consumption", above: 1, below: 5000 }, { type: "mode", mode: "home" }] },
    { actions: [{ type: "scene", entityId: "scene.nonexistent" }] },
  ];
  for (const [i, c] of cases.entries()) {
    const r = await j("POST", "/api/automations", body(c));
    if (i === cases.length - 1) { expect(r.status).toBe(404); continue; }
    expect([i, r.status, r.json?.error]).toEqual([i, 200, undefined]);
    ids.push(r.json.id);
    const entity = (await j("GET", "/api/automations")).json.automations.find((x: Body) => x.id === r.json.id);
    expect([i, entity.enabled, entity.needsAttention]).toEqual([i, true, false]);
  }
  for (const id of ids) await j("DELETE", `/api/automations/${id}`);
});

real("voice exposure works against real HA Cloud's exposure list", async () => {
  const v = (await j("GET", "/api/admin/voice")).json;
  expect(v.cloud).not.toBeNull(); // the command exists and answers
  const set = await j("PUT", "/api/admin/voice", { entityId: "light.bed_light", enabled: true });
  expect([set.status, set.json]).toEqual([200, { ok: true }]);
  const r = await ha.ws({ type: "homeassistant/expose_entity/list" });
  expect(JSON.stringify(r.result)).toContain("light.bed_light");
  expect((await j("PUT", "/api/admin/voice", { entityId: "light.bed_light", enabled: false })).status).toBe(200);
});

real("energy meters are recognised and sampled", async () => {
  const meters = (await j("GET", "/api/energy")).json.meters as Body[];
  expect(meters.map((m) => m.id)).toEqual(expect.arrayContaining(["sensor.power_consumption", "sensor.total_energy_kwh"]));
  expect(meters.find((m) => m.id === "sensor.power_consumption")).toMatchObject({ kind: "power", unit: "W" });
  expect(meters.find((m) => m.id === "sensor.total_energy_kwh")).toMatchObject({ kind: "energy", unit: "kWh" });
});

real("camera stills come through HA's proxy", async () => {
  const r = await t.app.handle(new Request(`http://localhost/api/devices/${encodeURIComponent("camera.demo_camera_png")}/snapshot`, { headers: { cookie: admin, "x-requested-with": "alice" } }));
  expect([r.status, r.headers.get("content-type")]).toEqual([200, expect.stringContaining("image/")]);
});

// ---- Disruptive: needs docker and the name of the HA container (HA_REAL_DOCKER=alice-ha). Stops and restarts it. ----
const dockerName = process.env.HA_REAL_DOCKER;
const disruptive = URL_ && TOKEN && dockerName ? test : test.skip;
const docker = (...args: string[]) => Bun.spawnSync(["docker", ...args]);

disruptive("the hub going away and coming back is reported honestly and recovers by itself", async () => {
  const { createDeviceService } = await import("./devices");
  const { createNotifier } = await import("./notify");
  const { startRules } = await import("./rules");
  const nf = createNotifier(t.db, createDeviceService(t.db, ha), t.push);
  const stop = startRules(t.db, ha, nf, { offlineMs: 60_000, lockMs: 60_000, hubMs: 500 });
  const id = encodeURIComponent("light.bed_light");
  try {
    docker("stop", "-t", "5", dockerName!);
    expect(await until(async () => ha.isStale(), 20_000)).toBe(true);
    // While it's gone: last-known state is still shown, marked unreachable; commands refuse instead of pretending.
    const list = (await j("GET", "/api/devices")).json;
    expect(list.haHealth).not.toBe("ok");
    expect(list.devices.find((d: Body) => d.id === "light.bed_light")).toMatchObject({ available: false, reason: "home_assistant_unavailable" });
    const cmd = await j("POST", `/api/devices/${id}/command`, { action: "turn_on" });
    expect([cmd.status, cmd.json.error]).toEqual([503, "ha_unavailable"]);
    expect((await j("POST", "/api/mode", { mode: "away" })).status).toBe(503);
    expect((await j("POST", "/api/automations", { name: "x", triggers: [{ type: "time", at: "01:00" }], actions: [{ type: "device", entityId: "light.bed_light", action: "turn_off" }] })).status).toBe(503);
    expect(await until(async () => ((await j("GET", "/api/notifications")).json.notifications as Body[]).some((n) => n.title === "Home hub unreachable"), 10_000)).toBe(true);

    docker("start", dockerName!);
    expect(await until(async () => !ha.isStale() && ha.health() === "ok", 120_000)).toBe(true);
    expect((await j("POST", `/api/devices/${id}/command`, { action: "turn_on" })).json).toMatchObject({ ok: true });
    expect(await until(async () => ((await j("GET", "/api/notifications")).json.notifications as Body[]).some((n) => n.title === "Home hub is back"), 10_000)).toBe(true);
    expect((await j("GET", "/api/devices")).json.devices.find((d: Body) => d.id === "light.bed_light").available).toBe(true);
  } finally { docker("start", dockerName!); stop(); }
}, 240_000);

real("a wrong access key is reported as such, not as an outage", async () => {
  const bad = new HaClient(URL_!, "not-a-real-token"); bad.start();
  expect(await until(async () => bad.health() === "auth_failed", 15_000)).toBe(true);
  bad.stop();
});

real("sessions survive an app restart (same database, new process)", async () => {
  const { createApp } = await import("./app");
  const { fakeWebAuthn } = await import("./testkit");
  const again = createApp({ db: t.db, ha, webauthn: fakeWebAuthn, origin: "https://home.test", cookieSecure: false });
  const r = await again.handle(new Request("http://localhost/api/me", { headers: { cookie: admin } }));
  expect(r.status).toBe(200);
});
