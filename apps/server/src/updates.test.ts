import { expect, test } from "bun:test";
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createNotifier } from "./notify";
import { createDeviceService } from "./devices";
import { setup, type Body } from "./testkit";

async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const j = (m: string, p: string, cookie: string, body?: unknown) => t.call(m, p, { cookie, body });
  const event = (e: object, seq: number) => appendFileSync(join(t.upOut, "events.jsonl"), JSON.stringify({ seq, ts: new Date(t.clock.t).toISOString(), ...e }) + "\n");
  const titles = async (cookie: string) => ((await j("GET", "/api/notifications", cookie)).json.notifications as Body[]).map((n) => n.title);
  return { t, admin: admin.cookie!, member, j, event, titles };
}
const iso = (ms: number) => new Date(ms).toISOString();

test("the container health check reports the version without involving Home Assistant", async () => {
  const { t } = await home();
  t.ha.setStale(true);
  const r = await t.call("GET", "/healthz");
  expect(r.status).toBe(200);
  expect(r.json).toMatchObject({ ok: true, version: "1.0.0" });
});

test("an urgent update is announced beforehand to everyone, and told to admins who can't mute it", async () => {
  const { t, admin, member, j, event, titles } = await home();
  await j("PUT", "/api/me/notifications", admin, { muted: ["device_offline", "lock_open", "hub", "insight"] });
  const startsAt = iso(t.clock.t + 5 * 60_000);
  event({ type: "update_starting", version: "1.0.1", from: "1.0.0", emergency: true, reason: "Security fix", startsAt }, 1);
  const n = (await j("GET", "/api/updates/notice", member.cookie)).json.notice;
  expect(n).toMatchObject({ version: "1.0.1", emergency: true, reason: "Security fix" });
  expect(await titles(admin)).toEqual(["Urgent update coming"]);
  expect(await titles(member.cookie)).toEqual([]); // news about the device goes to admins; members just see the notice
  expect(t.db.query("SELECT action, actor_type FROM security_audit WHERE action LIKE 'update.%'").all()).toEqual([{ action: "update.emergency_starting", actor_type: "system" }]);
  event({ type: "update_succeeded", version: "1.0.1", from: "1.0.0", emergency: true }, 2);
  expect((await j("GET", "/api/updates/notice", member.cookie)).json.notice).toBeNull();
  expect(await titles(admin)).toEqual(expect.arrayContaining(["Update installed", "Urgent update coming"]));
  const acts = JSON.stringify((await j("GET", "/api/admin/activity", admin)).json);
  expect(acts).toContain("An urgent security update was installed (version 1.0.1)");
});

test("events are applied once, in order, and bad lines are ignored", async () => {
  const { t, admin, j, event, titles } = await home();
  appendFileSync(join(t.upOut, "events.jsonl"), "not json\n");
  event({ type: "update_succeeded", version: "1.0.2", emergency: false }, 2);
  event({ type: "update_starting", version: "1.0.2", from: "1.0.0", emergency: false, startsAt: iso(t.clock.t) }, 1);
  await j("GET", "/api/admin/updates", admin); await j("GET", "/api/admin/updates", admin);
  expect((await titles(admin)).sort()).toEqual(["Update installed", "Update starting"]);
  expect(t.db.query("SELECT COUNT(*) n FROM security_audit WHERE action = 'update.succeeded'").get()).toEqual({ n: 1 });
  expect((await j("GET", "/api/updates/notice", admin)).json.notice).toBeNull(); // success came last
});

test("a failed update is reported honestly, including whether it was undone", async () => {
  const { t, admin, j, event, titles } = await home();
  event({ type: "update_failed", version: "1.1.0", rolledBack: true, backTo: "1.0.0" }, 1);
  await j("GET", "/api/admin/updates", admin);
  expect(await titles(admin)).toEqual(["Update didn't work"]);
  event({ type: "update_failed", version: "1.1.0", rolledBack: false }, 2);
  await j("GET", "/api/admin/updates", admin);
  expect(await titles(admin)).toContain("Update problem");
  writeFileSync(join(t.upOut, "status.json"), JSON.stringify({ state: "broken", message: "x" }));
  const h = (await j("GET", "/api/admin/health", admin)).json.checks.find((c: Body) => c.id === "updates");
  expect([h.status, h.advice]).toEqual(["fail", "Contact support now."]);
  expect(t.db.query("SELECT outcome FROM security_audit WHERE action = 'update.failed' ORDER BY id").all()).toEqual([{ outcome: "failure" }, { outcome: "failure" }]);
});

test("a refused release is audited and flagged but never announced as an update", async () => {
  const { t, admin, j, event, titles } = await home();
  event({ type: "update_refused", version: "9.9.9", why: "image" }, 1);
  const h = (await j("GET", "/api/admin/health", admin)).json.checks.find((c: Body) => c.id === "updates");
  expect(h.status).toBe("warn");
  expect(h.detail).toContain("signature");
  await j("GET", "/api/admin/updates", admin); // the audit entry is written when the event is ingested
  expect(await titles(admin)).toEqual([]);
  expect(t.db.query("SELECT action, outcome FROM security_audit WHERE action = 'update.refused'").all()).toEqual([{ action: "update.refused", outcome: "denied" }]);
});

test("a stale notice does not linger", async () => {
  const { t, j, event, admin } = await home();
  event({ type: "update_starting", version: "1.0.1", emergency: false, startsAt: iso(t.clock.t) }, 1);
  expect((await j("GET", "/api/updates/notice", admin)).json.notice).not.toBeNull();
  t.clock.t += 31 * 60_000;
  expect((await j("GET", "/api/updates/notice", admin)).json.notice).toBeNull();
});

test("an admin can ask for the verified release and nothing else", async () => {
  const { t, admin, member, j } = await home();
  const apply = (cookie: string, version: unknown) => j("POST", "/api/admin/updates/apply", cookie, { version });
  expect((await apply(admin, "1.2.0")).status).toBe(409); // nothing is available
  writeFileSync(join(t.upOut, "available.json"), JSON.stringify({ version: "1.2.0", notes: "Better things", created: iso(t.clock.t) }));
  writeFileSync(join(t.upOut, "last-check"), String(Math.floor(t.clock.t / 1000)));
  const s = (await j("GET", "/api/admin/updates", admin)).json;
  expect(s).toMatchObject({ configured: true, current: "1.0.0", available: { version: "1.2.0", notes: "Better things" } });
  expect((await apply(member.cookie, "1.2.0")).status).toBe(403);
  expect((await apply(admin, "6.6.6")).status).toBe(409); // not the release the updater verified
  expect((await apply(admin, 5)).status).toBe(400);
  t.db.query("UPDATE sessions SET reauth_at = 0").run();
  expect((await apply(admin, "1.2.0")).json.error).toBe("reauth_required");
  await t.reauth(admin, "a1");
  expect((await apply(admin, "1.2.0")).status).toBe(200);
  expect(JSON.parse(readFileSync(join(t.upIn, "request.json"), "utf8")).version).toBe("1.2.0");
  writeFileSync(join(t.upOut, "status.json"), JSON.stringify({ state: "applying" }));
  expect((await apply(admin, "1.2.0")).status).toBe(409); // already underway
  expect(t.db.query("SELECT COUNT(*) n FROM security_audit WHERE action = 'update.approved'").get()).toEqual({ n: 1 });
});

test("health tells the household about updates in plain words", async () => {
  const { t, admin, j } = await home();
  const chk = async () => (await j("GET", "/api/admin/health", admin)).json.checks.find((c: Body) => c.id === "updates");
  expect((await chk()).detail).toContain("Hasn't checked");
  writeFileSync(join(t.upOut, "last-check"), String(Math.floor(t.clock.t / 1000)));
  expect((await chk()).status).toBe("ok");
  t.clock.t += 4 * 86400_000;
  expect((await chk()).detail).toContain("Last checked for updates");
  writeFileSync(join(t.upOut, "available.json"), JSON.stringify({ version: "1.3.0", notes: "", created: "" }));
  expect((await chk()).detail).toContain("1.3.0");
  expect(existsSync(join(t.upIn, "request.json"))).toBe(false);
  void createNotifier; void createDeviceService;
});
