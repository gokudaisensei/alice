import { expect, test } from "bun:test";
import { ensureModeHelper, MODE_ENTITY } from "./modes";
import { setup } from "./testkit";

async function home() {
  const t = setup();
  await ensureModeHelper(t.ha);
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  const j = (m: string, p: string, cookie: string, body?: any) => t.call(m, p, { cookie, body });
  return { t, admin: admin.cookie!, member, guest, j };
}
const body = (over: any = {}) => ({
  name: "Evening lights",
  triggers: [{ type: "sun", event: "sunset", offsetMinutes: -30 }],
  conditions: [{ type: "mode", mode: "home" }, { type: "days", days: ["fri", "sat"] }],
  actions: [{ type: "device", entityId: "light.kitchen", action: "turn_on" }, { type: "delay", seconds: 10 }, { type: "device", entityId: "light.desk", action: "turn_off" }],
  ...over,
});
const autos = (t: any) => [...t.ha.configs].filter(([k]: any) => k.startsWith("automation/"));

test("creating writes an equivalent automation to Home Assistant and explains it in a sentence", async () => {
  const { t, admin, j } = await home();
  const r = await j("POST", "/api/automations", admin, body());
  expect(r.status).toBe(200);
  const [[key, cfg]] = autos(t) as any;
  expect(cfg).toMatchObject({
    alias: "Evening lights", mode: "single",
    triggers: [{ trigger: "sun", event: "sunset", offset: "-00:30:00" }],
    conditions: [{ condition: "state", entity_id: MODE_ENTITY, state: "home" }, { condition: "time", weekday: ["fri", "sat"] }],
    actions: [{ action: "light.turn_on", target: { entity_id: "light.kitchen" } }, { delay: { seconds: 10 } }, { action: "light.turn_off", target: { entity_id: "light.desk" } }],
  });
  expect(key).toMatch(/^automation\/alice_auto_/);
  const list = (await j("GET", "/api/automations", admin)).json;
  expect(list.automations).toHaveLength(1);
  expect(list.automations[0]).toMatchObject({ name: "Evening lights", enabled: true, needsAttention: false, lastTriggered: null });
  expect(list.automations[0].summary).toBe("When 30 minutes before sunset, and only if the household mode is Home and it is Fri, Sat: Turn on kitchen, then wait 10 seconds, then turn off desk");
  expect(list.suggested.length).toBeGreaterThan(0); // suggestions are never created on their own
  expect(list.automations.map((a: any) => a.name)).not.toContain(list.suggested[0].name);
});

test("every trigger and condition type compiles to the right Home Assistant form", async () => {
  const { t, admin, j } = await home();
  const r = await j("POST", "/api/automations", admin, body({
    triggers: [
      { type: "device_state", entityId: "lock.front", to: "unlocked", forSeconds: 300 },
      { type: "sensor", entityId: "sensor.plug_power", above: 5, forSeconds: 60 },
      { type: "time", at: "22:30" },
      { type: "mode", mode: "night" },
    ],
    conditions: [
      { type: "device_state", entityId: "light.desk", is: "on" },
      { type: "sensor", entityId: "sensor.plug_power", above: 1, below: 3000 },
      { type: "time", after: "18:00", before: "23:30" },
    ],
  }));
  expect(r.status).toBe(200);
  const [[, cfg]] = autos(t) as any;
  expect(cfg.triggers).toEqual([
    { trigger: "state", entity_id: "lock.front", to: "unlocked", for: { seconds: 300 } },
    { trigger: "numeric_state", entity_id: "sensor.plug_power", above: 5, for: { seconds: 60 } },
    { trigger: "time", at: "22:30:00" },
    { trigger: "state", entity_id: MODE_ENTITY, to: "night" },
  ]);
  expect(cfg.conditions).toEqual([
    { condition: "state", entity_id: "light.desk", state: "on" },
    { condition: "numeric_state", entity_id: "sensor.plug_power", above: 1, below: 3000 },
    { condition: "time", after: "18:00:00", before: "23:30:00" },
  ]);
  const s = (await j("GET", "/api/automations", admin)).json.automations[0].summary as string;
  expect(s.startsWith("When front stays unlocked for 5 minutes or ")).toBe(true);
  expect(s).toContain("goes above 5W for 1 minute");
  expect(s).toContain("the time is between 18:00 and 23:30");
});

test("invalid definitions are refused with where the problem is, and nothing is written", async () => {
  const { t, admin, j } = await home();
  const bad = async (over: any) => (await j("POST", "/api/automations", admin, body(over)));
  let r = await bad({ triggers: [] }); expect([r.status, r.json.where]).toEqual([400, "trigger"]);
  r = await bad({ triggers: [{ type: "time", at: "25:00" }] }); expect([r.status, r.json.where, r.json.index]).toEqual([400, "trigger", 0]);
  r = await bad({ triggers: [{ type: "time", at: "10:00" }, { type: "sensor", entityId: "sensor.plug_power" }] }); expect([r.json.where, r.json.index]).toEqual(["trigger", 1]);
  r = await bad({ triggers: [{ type: "sensor", entityId: "sensor.plug_power", above: 10, below: 5 }] }); expect(r.status).toBe(400);
  r = await bad({ triggers: [{ type: "sensor", entityId: "light.kitchen", above: 1 }] }); expect(r.status).toBe(404);
  r = await bad({ triggers: [{ type: "device_state", entityId: "light.kitchen", to: "exploding" }] }); expect(r.status).toBe(400);
  r = await bad({ conditions: [{ type: "time", after: "10:00", before: "10:00" }] }); expect([r.status, r.json.where]).toEqual([400, "condition"]);
  r = await bad({ conditions: [{ type: "mode", mode: "party" }] }); expect(r.status).toBe(400);
  r = await bad({ actions: [] }); expect([r.status, r.json.where]).toEqual([400, "action"]);
  r = await bad({ actions: [{ type: "device", entityId: "lock.front", action: "unlock" }] }); expect([r.status, r.json.where]).toEqual([400, "action"]); // never unlocks a door
  r = await bad({ actions: [{ type: "device", entityId: "light.nope", action: "turn_on" }] }); expect(r.status).toBe(404);
  r = await bad({ name: "  " }); expect(r.status).toBe(400);
  expect(autos(t)).toHaveLength(0);
});

test("every day of the week means no day restriction", async () => {
  const { t, admin, j } = await home();
  await j("POST", "/api/automations", admin, body({ conditions: [{ type: "days", days: ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] }] }));
  expect((autos(t)[0] as any)[1].conditions).toEqual([]);
});

test("preview explains without writing anything", async () => {
  const { t, admin, j } = await home();
  const r = await j("POST", "/api/automations/preview", admin, body());
  expect(r.json.summary).toContain("sunset");
  expect(autos(t)).toHaveLength(0);
  expect((await j("POST", "/api/automations/preview", admin, body({ triggers: [] }))).status).toBe(400);
});

test("only people who manage automations can use them, and only with devices they can use", async () => {
  const { t, admin, member, guest, j } = await home();
  expect((await j("GET", "/api/automations", guest.cookie)).status).toBe(403);
  expect((await j("POST", "/api/automations", guest.cookie, body())).status).toBe(403);
  expect((await t.call("GET", "/api/automations")).status).toBe(401);
  // member may manage automations but has been denied the desk lamp
  await t.call("PUT", `/api/admin/users/${member.userId}/devices`, { cookie: admin, body: { deny: ["light.desk"] } });
  expect((await j("POST", "/api/automations", member.cookie, body())).status).toBe(404); // references the desk lamp
  const ok = await j("POST", "/api/automations", member.cookie, body({ actions: [{ type: "device", entityId: "light.kitchen", action: "turn_on" }] }));
  expect(ok.status).toBe(200);
  // the admin made one using the desk lamp; the member can neither see nor touch it
  const mine = await j("POST", "/api/automations", admin, body());
  expect((await j("GET", "/api/automations", member.cookie)).json.automations.map((a: any) => a.id)).toEqual([ok.json.id]);
  expect((await j("GET", `/api/automations/${mine.json.id}`, member.cookie)).status).toBe(404);
  expect((await j("POST", `/api/automations/${mine.json.id}/enabled`, member.cookie, { enabled: false })).status).toBe(404);
  expect((await j("DELETE", `/api/automations/${mine.json.id}`, member.cookie)).status).toBe(404);
  expect((await j("PUT", `/api/automations/${mine.json.id}`, member.cookie, body())).status).toBe(404);
  expect((await j("POST", `/api/automations/${mine.json.id}/duplicate`, member.cookie)).status).toBe(404);
});

test("switching on and off is confirmed by Home Assistant", async () => {
  const { t, admin, j } = await home();
  const { id } = (await j("POST", "/api/automations", admin, body())).json;
  const eid = [...t.ha.entities.keys()].find((k) => k.startsWith("automation."))!;
  let r = await j("POST", `/api/automations/${id}/enabled`, admin, { enabled: false });
  expect(r.json).toMatchObject({ ok: true, enabled: false });
  expect(t.ha.entities.get(eid)!.state).toBe("off");
  expect((await j("GET", "/api/automations", admin)).json.automations[0].enabled).toBe(false);
  t.ha.ignoring.add(eid); // hub accepts the command but nothing changes
  r = await j("POST", `/api/automations/${id}/enabled`, admin, { enabled: true });
  expect([r.status, r.json.error]).toEqual([502, "not_confirmed"]);
  t.ha.ignoring.clear();
  expect((await j("POST", `/api/automations/${id}/enabled`, admin, { enabled: "yes" })).status).toBe(400);
  t.ha.setStale(true);
  expect((await j("POST", `/api/automations/${id}/enabled`, admin, { enabled: true })).status).toBe(503);
});

test("editing updates Home Assistant and keeps a switched-off automation off", async () => {
  const { t, admin, j } = await home();
  const { id } = (await j("POST", "/api/automations", admin, body())).json;
  const eid = [...t.ha.entities.keys()].find((k) => k.startsWith("automation."))!;
  await j("POST", `/api/automations/${id}/enabled`, admin, { enabled: false });
  const r = await j("PUT", `/api/automations/${id}`, admin, body({ name: "Dusk lights", triggers: [{ type: "time", at: "19:15" }] }));
  expect(r.status).toBe(200);
  const [[, cfg]] = autos(t) as any;
  expect(cfg.alias).toBe("Dusk lights");
  expect(cfg.triggers).toEqual([{ trigger: "time", at: "19:15:00" }]);
  expect(t.ha.entities.get(eid)!.state).toBe("off");
  const a = (await j("GET", `/api/automations/${id}`, admin)).json;
  expect([a.name, a.enabled]).toEqual(["Dusk lights", false]);
  expect((await j("PUT", `/api/automations/${id}`, admin, body({ triggers: [] }))).status).toBe(400);
  expect((autos(t)[0] as any)[1].alias).toBe("Dusk lights"); // a rejected edit changes nothing
});

test("a copy is created switched off", async () => {
  const { t, admin, j } = await home();
  const { id } = (await j("POST", "/api/automations", admin, body())).json;
  const r = await j("POST", `/api/automations/${id}/duplicate`, admin);
  expect(r.status).toBe(200);
  const list = (await j("GET", "/api/automations", admin)).json.automations;
  expect(list.map((a: any) => [a.name, a.enabled])).toEqual([["Evening lights", true], ["Evening lights (copy)", false]]);
  expect(autos(t)).toHaveLength(2);
});

test("a rejected or unconfirmed write is never saved", async () => {
  const { t, admin, j } = await home();
  t.ha.configFails = "ha_not_admin";
  let r = await j("POST", "/api/automations", admin, body());
  expect([r.status, r.json.error]).toEqual([502, "ha_not_admin"]);
  t.ha.configFails = null;
  t.ha.setStale(true);
  expect((await j("POST", "/api/automations", admin, body())).status).toBe(503);
  t.ha.setStale(false);
  expect(t.db.query("SELECT COUNT(*) n FROM automations").get()).toEqual({ n: 0 });
  expect(autos(t)).toHaveLength(0);
});

test("deleting removes it from Home Assistant and the app", async () => {
  const { t, admin, j } = await home();
  const { id } = (await j("POST", "/api/automations", admin, body())).json;
  const eid = [...t.ha.entities.keys()].find((k) => k.startsWith("automation."))!;
  expect((await j("DELETE", `/api/automations/${id}`, admin)).status).toBe(200);
  expect(autos(t)).toHaveLength(0);
  expect(t.ha.entities.has(eid)).toBe(false);
  expect((await j("GET", "/api/automations", admin)).json.automations).toEqual([]);
});

test("an automation whose device has gone is flagged, and the audit trail records changes", async () => {
  const { t, admin, j } = await home();
  const { id } = (await j("POST", "/api/automations", admin, body())).json;
  t.ha.entities.delete("light.desk");
  expect((await j("GET", `/api/automations/${id}`, admin)).json.needsAttention).toBe(true);
  const acts = (t.db.query("SELECT action FROM security_audit WHERE action LIKE 'automation.%'").all() as any[]).map((r) => r.action);
  expect(acts).toEqual(["automation.create"]);
  // household admins never see who did it
  expect(t.db.query("SELECT COUNT(*) n FROM activity_events WHERE kind LIKE 'automation%'").get()).toEqual({ n: 0 });
});

test("a hub that saves but never loads what the app writes is reported plainly, and the write is undone", async () => {
  const { t, admin, j } = await home();
  t.ha.notLoading = true;
  const a = await j("POST", "/api/automations", admin, body());
  expect([a.status, a.json.error]).toEqual([502, "ha_not_loading"]);
  expect(a.json.message).toContain("isn't loading it");
  const r = await j("POST", "/api/routines", admin, { name: "R", steps: [{ type: "device", entityId: "light.kitchen", action: "turn_on" }] });
  expect([r.status, r.json.error]).toEqual([502, "ha_not_loading"]);
  const s = await j("POST", "/api/scenes", admin, { name: "S", entityIds: ["light.kitchen"] });
  expect([s.status, s.json.error]).toEqual([502, "ha_not_loading"]);
  expect([...t.ha.configs.keys()]).toEqual([]); // nothing left behind in the hub's files
  expect(t.db.query("SELECT (SELECT COUNT(*) FROM automations) a, (SELECT COUNT(*) FROM routines) r").get()).toEqual({ a: 0, r: 0 });
});
