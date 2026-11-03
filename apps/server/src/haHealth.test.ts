import { expect, test } from "bun:test";
import { scalar } from "./sql";
import { createDeviceService } from "./devices";
import { createNotifier } from "./notify";
import { createHaStatus } from "./haStatus";
import { startRules } from "./rules";
import { ent, setup, type Body } from "./testkit";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const FAST = { offlineMs: 40, lockMs: 40, hubMs: 40, batteryMs: 40, openMs: 40 };
const EP = "https://fcm.googleapis.com/fcm/send/abc123";
const KEYS = { p256dh: "BPublicKeyAAAAAAAAAA", auth: "AuthSecretAAAAAA" };

async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  const j = (m: string, p: string, cookie: string, body?: unknown) => t.call(m, p, { cookie, body });
  t.ha.set("switch.heater", "off");
  const nf = createNotifier(t.db, createDeviceService(t.db, t.ha), t.push, () => t.clock.t);
  const titles = async (cookie: string) => ((await j("GET", "/api/notifications", cookie)).json.notifications as Body[]).map((n) => n.title);
  const h = () => scalar(t.db, "SELECT id FROM households", "");
  return { t, admin: admin.cookie!, member, guest, j, nf, titles, h };
}
const sensor = (t: ReturnType<typeof setup>, id: string, state: string, cls: string, extra: Record<string, unknown> = {}) => t.ha.entities.set(id, ent(id, state, { device_class: cls, ...extra }));

test("smoke, gas and leak sensors are reported at once, by what the hub says they are; a name alone is not enough", async () => {
  const { t, admin, member, guest, j, nf, titles } = await home();
  sensor(t, "binary_sensor.hall_smoke", "off", "smoke"); sensor(t, "binary_sensor.sink_leak", "off", "moisture"); sensor(t, "binary_sensor.smoke_but_no_class", "off", "occupancy");
  await j("PUT", `/api/admin/users/${guest.userId}/devices`, admin, { allow: ["binary_sensor.hall_smoke"] });
  const stop = startRules(t.db, t.ha, nf, FAST);
  t.ha.set("binary_sensor.hall_smoke", "on"); t.ha.set("binary_sensor.smoke_but_no_class", "on"); await wait(15);
  expect(await titles(admin)).toEqual(["Smoke detected: hall smoke"]);
  expect(await titles(member.cookie)).toEqual(["Smoke detected: hall smoke"]);
  expect(await titles(guest.cookie)).toEqual(["Smoke detected: hall smoke"]); // it is theirs to see
  t.ha.set("binary_sensor.sink_leak", "on"); await wait(15);
  expect(await titles(guest.cookie)).toEqual(["Smoke detected: hall smoke"]); // not granted: not told
  expect(await titles(admin)).toContain("Water leak detected: sink leak");
  t.ha.set("binary_sensor.hall_smoke", "off"); t.ha.set("binary_sensor.hall_smoke", "on"); await wait(15);
  expect((await titles(admin)).filter((x) => x.startsWith("Smoke")).length).toBe(1); // deduplicated
  stop();
});

test("an alarm going off is a safety alert", async () => {
  const { t, admin, nf, titles } = await home();
  t.ha.entities.set("alarm_control_panel.home", ent("alarm_control_panel.home", "armed_away", { supported_features: 3 }));
  const stop = startRules(t.db, t.ha, nf, FAST);
  t.ha.set("alarm_control_panel.home", "triggered"); await wait(15);
  expect(await titles(admin)).toEqual(["Alarm triggered: home"]);
  stop();
});

test("a battery that stays low is reported once a day; one that dips for a moment is not", async () => {
  const { t, admin, nf, titles } = await home();
  sensor(t, "sensor.door_battery", "80", "battery", { unit_of_measurement: "%", friendly_name: "Door battery" });
  sensor(t, "binary_sensor.motion_battery", "off", "battery", { friendly_name: "Motion battery" });
  const stop = startRules(t.db, t.ha, nf, FAST);
  t.ha.set("sensor.door_battery", "12"); await wait(15); t.ha.set("sensor.door_battery", "60"); await wait(60);
  expect(await titles(admin)).toEqual([]);
  t.ha.set("sensor.door_battery", "9"); t.ha.set("binary_sensor.motion_battery", "on"); await wait(90);
  expect((await titles(admin)).sort()).toEqual(["Door battery is low", "Motion battery is low"]);
  t.ha.set("sensor.door_battery", "8"); await wait(90);
  expect((await titles(admin)).length).toBe(2); // not again today
  stop();
});

test("a door or window left open is reported only once it has been open a while", async () => {
  const { t, admin, nf, titles } = await home();
  sensor(t, "binary_sensor.back_door", "off", "door", { friendly_name: "Back door" });
  const stop = startRules(t.db, t.ha, nf, FAST);
  t.ha.set("binary_sensor.back_door", "on"); await wait(15); t.ha.set("binary_sensor.back_door", "off"); await wait(60);
  expect(await titles(admin)).toEqual([]);
  t.ha.set("binary_sensor.back_door", "on"); await wait(90);
  expect(await titles(admin)).toEqual(["Back door is still open"]);
  stop();
});

test("quiet hours still hold back safety alerts unless the person opted in, and a flood never swallows one", async () => {
  const { t, admin, j, nf } = await home();
  await j("POST", "/api/push/subscribe", admin, { endpoint: EP, keys: KEYS });
  await j("PUT", "/api/me/notifications", admin, { quiet: { enabled: true, start: "22:00", end: "07:00", tz: "UTC" } });
  const d = new Date(t.clock.t); d.setUTCHours(3, 30, 0, 0); t.clock.t = d.getTime();
  const h = scalar(t.db, "SELECT id FROM households", "");
  const alarm = (k: string) => nf.emit({ householdId: h, kind: "safety", critical: true, title: k, body: "b", dedupeKey: k });
  await alarm("a"); expect(t.push.sent.length).toBe(0); // default: asleep stays asleep
  expect((await j("PUT", "/api/me/notifications", admin, { criticalBypass: true })).json.criticalBypass).toBe(true);
  await alarm("b"); expect(t.push.sent.map((p) => (p.payload as Body).title)).toEqual(["b"]);
  await nf.emit({ householdId: h, kind: "hub", title: "ordinary", body: "b", dedupeKey: "o" }); expect(t.push.sent.length).toBe(1); // only safety may sound
  for (let i = 0; i < 12; i++) await nf.emit({ householdId: h, kind: "hub", title: `n${i}`, body: "b", dedupeKey: `k${i}` });
  const before = t.push.sent.length; await alarm("c"); expect(t.push.sent.length).toBe(before + 1); // over the hourly limit, still delivered
  expect((await j("PUT", "/api/me/notifications", admin, { criticalBypass: "yes" })).status).toBe(400);
});

test("who can choose which kinds: admins hear about the hub's own worries, others do not", async () => {
  const { admin, member, guest, j } = await home();
  const kinds = async (c: string) => (await j("GET", "/api/me/notifications", c)).json.kinds as string[];
  expect(await kinds(admin)).toContain("ha_issue");
  expect(await kinds(member.cookie)).not.toContain("ha_issue");
  expect(await kinds(guest.cookie)).toEqual(expect.arrayContaining(["safety", "battery", "open_long"]));
  expect(await kinds(guest.cookie)).not.toContain("ha_issue");
});

// ---------- what the hub itself is worried about ----------

function hub(t: ReturnType<typeof setup>) {
  t.ha.replies.set("persistent_notification/get", () => ({ "login_1": { notification_id: "login_1", title: "Login attempt failed", message: "From **10.0.0.9** <b>now</b> [details](http://x)", created_at: "2026-11-03T10:00:00+00:00" } }));
  t.ha.replies.set("repairs/list_issues", () => ({ issues: [{ domain: "zha", issue_id: "radio_gone", severity: "critical", translation_key: "radio_gone" }, { domain: "hue", issue_id: "tip", severity: "warning" }, { domain: "x", issue_id: "muted", severity: "error", ignored: true }] }));
  t.ha.replies.set("config_entries/get", () => [{ entry_id: "e1", domain: "tuya", title: "Tuya", state: "setup_error" }, { entry_id: "e2", domain: "hue", title: "Hue", state: "loaded" }]);
  t.ha.replies.set("backup/info", () => ({ backups: [{ backup_id: "b1", date: "2026-10-20T01:00:00+00:00" }], last_completed_automatic_backup: "2026-10-20T01:00:00+00:00", next_automatic_backup: "2026-11-04T01:00:00+00:00" }));
  t.ha.entities.set("update.core", ent("update.core", "on", { title: "Home Assistant Core", installed_version: "2026.10.4", latest_version: "2026.11.0" }));
  t.ha.entities.set("update.hue", ent("update.hue", "off", { installed_version: "1", latest_version: "1" }));
}

test("the admin page shows the hub's notices, repairs, updates, failing integrations and backups", async () => {
  const { t, admin, member, j } = await home();
  hub(t);
  const s = (await j("GET", "/api/admin/ha-status", admin)).json;
  expect(s.notifications).toEqual([{ id: "login_1", title: "Login attempt failed", message: "From 10.0.0.9 now details", at: Date.parse("2026-11-03T10:00:00+00:00") }]);
  expect(s.repairs.map((r: Body) => [r.id, r.severity, r.title])).toEqual([["zha:radio_gone", "critical", "Zha: radio gone"], ["hue:tip", "warning", "Hue: tip"]]);
  expect(s.updates).toEqual([{ id: "update.core", name: "Home Assistant Core", installed: "2026.10.4", latest: "2026.11.0", inProgress: false }]);
  expect(s.integrations).toEqual([{ id: "e1", name: "Tuya", state: "setup_error" }]);
  expect(s.backup).toMatchObject({ count: 1, scheduled: true });
  expect((await j("GET", "/api/admin/ha-status", member.cookie)).status).toBe(403);
  t.ha.setStale(true);
  expect((await j("GET", "/api/admin/ha-status", admin)).status).toBe(503);
});

test("a hub without these features gives an empty page, not an error", async () => {
  const { admin, j } = await home();
  const s = (await j("GET", "/api/admin/ha-status", admin)).json;
  expect(s).toEqual({ notifications: [], repairs: [], updates: [], integrations: [], backup: null });
});

test("admins are told about the serious ones, once, and nobody else hears", async () => {
  const { t, admin, member, nf, titles } = await home();
  hub(t);
  const hs = createHaStatus(t.db, t.ha, () => t.clock.t);
  t.clock.t = Date.parse("2026-11-03T12:00:00Z");
  expect(await hs.sweep(nf)).toBeGreaterThan(0);
  const got = await titles(admin);
  expect(got).toEqual(expect.arrayContaining(["Home Assistant needs attention", "Login attempt failed", "Update available: Home Assistant Core", "Tuya isn't working"]));
  expect(got.filter((x) => x === "Home Assistant needs attention").length).toBe(1); // the warning and the ignored one stay quiet
  expect(got).toContain("Home Assistant hasn't backed up lately"); // scheduled, but the last automatic one was two weeks ago
  expect(await titles(member.cookie)).toEqual([]);
  expect(await hs.sweep(nf)).toBe(0); // nothing new
});

test("installing a hub update needs an admin with a fresh passkey check; backing up the hub is admin-only", async () => {
  const { t, admin, member, j } = await home();
  hub(t);
  expect((await j("POST", "/api/admin/ha-status/update", member.cookie, { entityId: "update.core" })).status).toBe(403);
  t.db.query("UPDATE sessions SET reauth_at = 0").run();
  expect((await j("POST", "/api/admin/ha-status/update", admin, { entityId: "update.core" })).json.error).toBe("reauth_required");
  await t.reauth(admin, "a1");
  expect((await j("POST", "/api/admin/ha-status/update", admin, { entityId: "light.kitchen" })).status).toBe(404);
  expect((await j("POST", "/api/admin/ha-status/update", admin, { entityId: "update.hue" })).status).toBe(404); // nothing pending
  expect((await j("POST", "/api/admin/ha-status/update", admin, { entityId: "update.core" })).json).toEqual({ ok: true, started: true });
  expect(t.ha.calls.at(-1)).toMatchObject({ domain: "update", service: "install", entityId: "update.core" });
  t.ha.replies.set("backup/generate", () => ({ backup_job_id: "j1" }));
  expect((await j("POST", "/api/admin/ha-status/backup", admin)).json).toEqual({ ok: true, started: true });
  expect((await j("POST", "/api/admin/ha-status/backup", member.cookie)).status).toBe(403);
  expect((t.db.query("SELECT action FROM security_audit WHERE action LIKE 'ha.%'").all() as Body[]).map((x) => x.action)).toEqual(["ha.update_install", "ha.backup"]);
});
