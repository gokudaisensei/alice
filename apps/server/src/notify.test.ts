import { expect, test } from "bun:test";
import { createDeviceService } from "./devices";
import { createInsights, createSampler, SAMPLE_MS } from "./insights";
import { createNotifier, pushEndpointOk, RATE_PER_HOUR } from "./notify";
import { startRules } from "./rules";
import { ent, setup } from "./testkit";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAST = { offlineMs: 40, lockMs: 40, hubMs: 40 };
const EP = "https://fcm.googleapis.com/fcm/send/abc123";
const KEYS = { p256dh: "BPublicKeyAAAAAAAAAA", auth: "AuthSecretAAAAAA" };

async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  const j = (m: string, p: string, cookie: string, body?: any) => t.call(m, p, { cookie, body });
  t.ha.set("switch.heater", "off"); // the fixture heater starts offline; keep it out of these scenarios
  const svc = createDeviceService(t.db, t.ha);
  const nf = createNotifier(t.db, svc, t.push, () => t.clock.t);
  const titles = async (cookie: string) => ((await j("GET", "/api/notifications", cookie)).json.notifications as any[]).map((n) => n.title);
  return { t, admin: admin.cookie!, member, guest, j, svc, nf, titles };
}

// ---------- rules ----------

test("a device that stays offline is reported to the people who can use it, once", async () => {
  const { t, admin, member, guest, j, nf, titles } = await home();
  await j("PUT", `/api/admin/users/${guest.userId}/devices`, admin, { allow: ["light.kitchen"] });
  const stop = startRules(t.db, t.ha, nf, FAST);
  t.ha.set("light.kitchen", "unavailable");
  await wait(15); t.ha.set("light.kitchen", "on"); await wait(60);
  expect(await titles(admin)).toEqual([]); // a blip that recovered is never reported
  t.ha.set("light.kitchen", "unavailable"); await wait(90);
  expect(await titles(admin)).toEqual(["kitchen is offline"]);
  expect(await titles(member.cookie)).toEqual(["kitchen is offline"]);
  expect(await titles(guest.cookie)).toEqual(["kitchen is offline"]); // granted this device
  t.ha.set("light.hall", "unavailable"); await wait(90);
  expect(await titles(guest.cookie)).toEqual(["kitchen is offline"]); // not theirs, so not told
  expect((await titles(admin)).length).toBe(2);
  t.ha.set("light.kitchen", "on"); t.ha.set("light.kitchen", "unavailable"); await wait(90);
  expect((await titles(admin)).filter((x) => x === "kitchen is offline").length).toBe(1); // deduplicated
  stop();
});

test("an unlocked door is reported only if it stays unlocked", async () => {
  const { t, admin, nf, titles } = await home();
  const stop = startRules(t.db, t.ha, nf, FAST);
  t.ha.set("lock.front", "unlocked"); await wait(15); t.ha.set("lock.front", "locked"); await wait(60);
  expect(await titles(admin)).toEqual([]);
  t.ha.set("lock.front", "unlocked"); await wait(90);
  expect(await titles(admin)).toEqual(["front is unlocked"]);
  stop();
});

test("hub trouble goes to admins and members only, and recovery is announced", async () => {
  const { t, admin, member, guest, nf, titles } = await home();
  const stop = startRules(t.db, t.ha, nf, FAST);
  t.ha.setStale(true); await wait(90);
  expect(await titles(admin)).toEqual(["Home hub unreachable"]);
  expect(await titles(member.cookie)).toEqual(["Home hub unreachable"]);
  expect(await titles(guest.cookie)).toEqual([]);
  t.ha.setStale(false); await wait(10);
  expect(await titles(admin)).toContain("Home hub is back");
  t.ha.setStale(true); await wait(15); t.ha.setStale(false); await wait(60);
  expect((await titles(admin)).filter((x) => x === "Home hub unreachable").length).toBe(1); // a short blip says nothing
  stop();
});

// ---------- delivery rules ----------

test("quiet hours hold back push, never the inbox", async () => {
  const { t, admin, j, nf, titles } = await home();
  await j("POST", "/api/push/subscribe", admin, { endpoint: EP, keys: KEYS });
  await j("PUT", "/api/me/notifications", admin, { quiet: { enabled: true, start: "22:00", end: "07:00", tz: "UTC" } });
  const at = (h: number) => { const d = new Date(t.clock.t); d.setUTCHours(h, 30, 0, 0); t.clock.t = d.getTime(); };
  const n = (k: string) => nf.emit({ householdId: (t.db.query("SELECT id FROM households").get() as any).id, kind: "hub", title: k, body: "b", dedupeKey: k });
  at(23); let r = await n("night"); expect([r.recipients > 0, r.pushed]).toEqual([true, 0]);
  at(3); await n("small hours"); expect(t.push.sent.length).toBe(0);
  at(12); r = await n("noon"); expect(r.pushed).toBe(1);
  expect(t.push.sent[0].payload).toMatchObject({ title: "noon" });
  expect((await titles(admin)).length).toBe(3);
});

test("muted categories are skipped, and a flood is collapsed into one line", async () => {
  const { t, admin, j, nf, titles } = await home();
  const h = (t.db.query("SELECT id FROM households").get() as any).id;
  await j("PUT", "/api/me/notifications", admin, { muted: ["insight"] });
  expect((await nf.emit({ householdId: h, kind: "insight", title: "x", body: "b", dedupeKey: "i" })).recipients).toBe(2 - 1); // member still hears it, admin muted it
  await j("PUT", "/api/me/notifications", admin, { muted: [] });
  await j("POST", "/api/push/subscribe", admin, { endpoint: EP, keys: KEYS });
  t.push.sent.length = 0;
  for (let i = 0; i < RATE_PER_HOUR + 4; i++) await nf.emit({ householdId: h, kind: "hub", title: `n${i}`, body: "b", dedupeKey: `k${i}` });
  const mine = (await j("GET", "/api/notifications", admin)).json.notifications as any[];
  expect(mine.filter((x) => x.kind === "summary")).toHaveLength(1);
  expect(mine.find((x) => x.kind === "summary").body).toContain("4 more notifications were held back");
  expect(t.push.sent.length).toBe(RATE_PER_HOUR); // nothing pushed beyond the limit
  expect(mine.filter((x) => x.kind === "hub").length).toBe(RATE_PER_HOUR);
  expect(await titles(admin)).toContain("Lots happening at home");
});

// ---------- notification API and push ----------

test("people only see and mark their own notifications", async () => {
  const { t, admin, member, j, nf } = await home();
  const h = (t.db.query("SELECT id FROM households").get() as any).id;
  await nf.emit({ householdId: h, kind: "hub", title: "T", body: "b", dedupeKey: "d" });
  expect((await j("GET", "/api/notifications/unread", admin)).json.unread).toBe(1);
  const adminId = (await j("GET", "/api/notifications", admin)).json.notifications[0].id;
  await j("POST", "/api/notifications/read", member.cookie, { ids: [adminId] });
  expect((await j("GET", "/api/notifications/unread", admin)).json.unread).toBe(1); // someone else's id does nothing
  expect((await j("POST", "/api/notifications/read", admin, { ids: [adminId] })).json.unread).toBe(0);
  expect((await j("POST", "/api/notifications/read", admin, { ids: "x" })).status).toBe(400);
  expect((await t.call("GET", "/api/notifications")).status).toBe(401);
});

test("push endpoints are limited to real push services", async () => {
  expect(pushEndpointOk(EP)).toBe(true);
  expect(pushEndpointOk("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
  expect(pushEndpointOk("https://web.push.apple.com/x")).toBe(true);
  for (const bad of ["http://fcm.googleapis.com/x", "https://homeassistant:8123/api", "https://127.0.0.1/x", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com.evil.com/x", "https://fcm.googleapis.com:8123/x", "https://user@fcm.googleapis.com/x", 5, null])
    expect(pushEndpointOk(bad)).toBe(false);
  const { j, admin } = await home();
  expect((await j("POST", "/api/push/subscribe", admin, { endpoint: "https://homeassistant:8123/api", keys: KEYS })).status).toBe(400);
  expect((await j("POST", "/api/push/subscribe", admin, { endpoint: EP, keys: { p256dh: "!", auth: "x" } })).status).toBe(400);
});

test("subscribing, testing, and unsubscribing push", async () => {
  const { t, admin, member, j } = await home();
  expect((await j("GET", "/api/push/key", admin)).json.publicKey).toBe("BFakePublicKey");
  expect((await j("POST", "/api/push/subscribe", admin, { endpoint: EP, keys: KEYS })).status).toBe(200);
  expect((await j("GET", "/api/me/notifications", admin)).json.pushDevices).toBe(1);
  expect((await j("POST", "/api/push/test", admin)).json.sent).toBe(1);
  expect((await j("POST", "/api/push/test", admin)).status).toBe(429);
  t.push.results.set(EP, "failed");
  await j("POST", "/api/push/unsubscribe", member.cookie, { endpoint: EP }); // not theirs: nothing happens
  expect((await j("GET", "/api/me/notifications", admin)).json.pushDevices).toBe(1);
  await j("POST", "/api/push/unsubscribe", admin, { endpoint: EP });
  expect((await j("GET", "/api/me/notifications", admin)).json.pushDevices).toBe(0);
});

test("a subscription the push service has dropped is removed", async () => {
  const { t, admin, j, nf } = await home();
  await j("POST", "/api/push/subscribe", admin, { endpoint: EP, keys: KEYS });
  t.push.results.set(EP, "gone");
  const h = (t.db.query("SELECT id FROM households").get() as any).id;
  await nf.emit({ householdId: h, kind: "hub", title: "T", body: "b", dedupeKey: "d" });
  expect((await j("GET", "/api/me/notifications", admin)).json.pushDevices).toBe(0);
});

test("notification preferences are validated", async () => {
  const { j, admin } = await home();
  const put = (b: any) => j("PUT", "/api/me/notifications", admin, b);
  expect((await put({ muted: ["nope"] })).status).toBe(400);
  expect((await put({ quiet: { start: "25:00" } })).status).toBe(400);
  expect((await put({ quiet: { tz: "Mars/Base" } })).status).toBe(400);
  const ok = await put({ muted: ["insight", "insight"], quiet: { enabled: true, start: "21:30", end: "06:45", tz: "Europe/London" } });
  expect(ok.json).toMatchObject({ muted: ["insight"], quiet: { enabled: true, start: "21:30", end: "06:45", tz: "Europe/London" } });
});

// ---------- samples, insights, energy ----------

function seed(t: any, id: string, count: number, value: (i: number) => number) {
  const ins = t.db.query("INSERT INTO samples (entity_id, ts, value) VALUES (?,?,?)");
  for (let i = 0; i < count; i++) ins.run(id, t.clock.t - (count - 1 - i) * SAMPLE_MS, value(i));
}

test("the sampler records useful readings and leaves gaps alone", async () => {
  const { t } = await home();
  t.ha.entities.set("sensor.house_energy", ent("sensor.house_energy", "12.5", { unit_of_measurement: "kWh", device_class: "energy" }));
  t.ha.set("light.hall", "unavailable");
  createSampler(t.db, t.ha, () => t.clock.t).sampleOnce();
  const rows = Object.fromEntries((t.db.query("SELECT entity_id, value FROM samples").all() as any[]).map((r) => [r.entity_id, r.value]));
  expect(rows["sensor.house_energy"]).toBe(12.5);
  expect(rows["sensor.plug_power"]).toBe(42);
  expect(rows["light.kitchen"]).toBeDefined();
  expect(rows["light.hall"]).toBeUndefined();
  expect(rows["sensor.temp"]).toBeUndefined(); // not an energy or on/off device
});

test("a light left on all day becomes an insight, with a suggestion and no action taken", async () => {
  const { t, admin, member, j, svc } = await home();
  t.ha.set("light.desk", "on");
  seed(t, "light.desk", 40, () => 1); // ten hours of readings
  const r = (await j("GET", "/api/insights", admin)).json.insights as any[];
  const i = r.find((x) => x.key === "long_on:light.desk");
  expect(i.title).toMatch(/has been on for about 10 hours/);
  expect(i.suggestion.href).toBe("/automations/new?device=light.desk");
  expect(t.ha.calls.filter((c) => c.entityId === "light.desk")).toEqual([]); // nothing was switched off for them
  await j("POST", "/api/insights/dismiss", admin, { key: i.key });
  expect(((await j("GET", "/api/insights", admin)).json.insights as any[]).some((x) => x.key === i.key)).toBe(false);
  expect(((await j("GET", "/api/insights", member.cookie)).json.insights as any[]).some((x) => x.key === i.key)).toBe(true); // dismissal is personal
  void svc;
});

test("too little data means no insight", async () => {
  const { t, admin, j } = await home();
  t.ha.set("light.desk", "on");
  seed(t, "light.desk", 12, () => 1); // three hours
  seed(t, "sensor.plug_power", 20, () => 42); // five hours
  expect((await j("GET", "/api/insights", admin)).json.insights).toEqual([]);
  t.ha.set("light.desk", "on");
  t.db.query("DELETE FROM samples").run();
  seed(t, "light.desk", 40, (i) => (i === 20 ? 0 : 1)); // on-time broken by an off reading
  expect((await j("GET", "/api/insights", admin)).json.insights).toEqual([]);
});

test("a constant standby draw is reported with the numbers behind it", async () => {
  const { t, admin, j } = await home();
  seed(t, "sensor.plug_power", 90, (i) => 12 + (i % 3));
  t.ha.set("sensor.plug_power", "13");
  const i = ((await j("GET", "/api/insights", admin)).json.insights as any[]).find((x) => x.kind === "standby");
  expect(i.title).toBe("plug power uses at least 12 W around the clock");
  expect(i.body).toContain("0.3 kWh a day");
});

test("a jump in daily energy is flagged against the previous days", async () => {
  const { t, admin, j } = await home();
  t.ha.entities.set("sensor.house_energy", ent("sensor.house_energy", "0", { unit_of_measurement: "kWh", device_class: "energy" }));
  t.clock.t = new Date(new Date().setHours(12, 0, 0, 0)).getTime();
  // 8 days of readings every 15 minutes: ~5 kWh a day, then yesterday ~9
  const ins = t.db.query("INSERT INTO samples (entity_id, ts, value) VALUES (?,?,?)");
  let total = 100;
  const start = t.clock.t - 7 * 86400_000 - 12 * 3600_000;
  for (let ts = start; ts <= t.clock.t; ts += SAMPLE_MS) {
    const day = Math.floor((t.clock.t - ts) / 86400_000); // 0 = today
    total += (day === 1 ? 9 : 5) / 96;
    ins.run("sensor.house_energy", ts, total);
  }
  const found = ((await j("GET", "/api/insights", admin)).json.insights as any[]).find((x) => x.kind === "energy_up");
  expect(found.title).toBe("house energy used more than usual yesterday");
  expect(found.body).toMatch(/kWh yesterday, against a usual \d+(\.\d)? kWh over the previous \d+ days/);
});

test("the energy page shows only meters you can see, and says how it measures", async () => {
  const { t, admin, guest, j } = await home();
  seed(t, "sensor.plug_power", 10, (i) => 40 + i);
  const e = (await j("GET", "/api/energy", admin)).json;
  const m = e.meters.find((x: any) => x.id === "sensor.plug_power");
  expect(m).toMatchObject({ kind: "power", peak24h: 49, low24h: 40, unit: "W" });
  expect(e.note).toContain("15 minutes");
  expect(e.sampledSince).not.toBeNull();
  expect((await j("GET", "/api/energy", guest.cookie)).status).toBe(403); // guests never see energy use
  expect((await t.call("GET", "/api/energy")).status).toBe(401);
});

test("the daily sweep tells only the people who can see the device", async () => {
  const { t, admin, member, guest, j, nf, svc } = await home();
  t.ha.set("light.desk", "on");
  seed(t, "light.desk", 40, () => 1);
  const ins = createInsights(t.db, t.ha, svc, () => t.clock.t);
  expect(await ins.sweep(nf)).toBe(2);
  expect(await ins.sweep(nf)).toBe(0); // not again within three days
  expect(((await j("GET", "/api/notifications", guest.cookie)).json.notifications as any[])).toEqual([]);
  void admin; void member;
});

test("an unlocked-door push carries a Lock button the phone can use without opening the app", async () => {
  const { t, admin, j, nf } = await home();
  await j("POST", "/api/push/subscribe", admin, { endpoint: EP, keys: KEYS });
  const stop = startRules(t.db, t.ha, nf, FAST);
  t.ha.set("lock.front", "unlocked"); await wait(120);
  stop();
  const p = t.push.sent.at(-1)!.payload;
  expect(p).toMatchObject({ title: "front is unlocked", entityId: "lock.front", actions: [{ action: "lock", title: "Lock" }] });
});
