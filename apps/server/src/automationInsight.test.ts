import { expect, test } from "bun:test";
import { ensureModeHelper } from "./modes";
import { ent, setup, type Body } from "./testkit";
import { failedCondition } from "./automationInsight";

async function home() {
  const t = setup();
  await ensureModeHelper(t.ha);
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  const j = (m: string, p: string, cookie: string, body?: unknown) => t.call(m, p, { cookie, body });
  const make = async (over: Record<string, unknown> = {}) => {
    const r = await j("POST", "/api/automations", admin.cookie!, { name: "Evening", triggers: [{ type: "time", at: "20:00" }], conditions: [{ type: "mode", mode: "home" }, { type: "presence", people: "anyone" }], actions: [{ type: "device", entityId: "light.kitchen", action: "turn_on" }], ...over });
    return r;
  };
  return { t, admin: admin.cookie!, guest: guest.cookie, j, make };
}

test("someone arriving or leaving home is a trigger, and who is home is a condition", async () => {
  const { t, admin, j, make } = await home();
  expect((await make({ triggers: [{ type: "presence", personId: "person.alex", to: "home" }] })).status).toBe(200);
  const [, cfg] = [...t.ha.configs].find(([k]) => k.startsWith("automation/"))! as [string, Body];
  expect(cfg.triggers).toEqual([{ trigger: "state", entity_id: ["person.alex"], from: "not_home", to: "home" }]);
  expect(cfg.conditions[1]).toEqual({ condition: "or", conditions: [{ condition: "state", entity_id: "person.alex", state: "home" }, { condition: "state", entity_id: "person.sam", state: "home" }] });
  const any = await j("POST", "/api/automations/preview", admin, { triggers: [{ type: "presence", personId: null, to: "not_home" }], conditions: [{ type: "presence", people: "nobody" }], actions: [{ type: "device", entityId: "light.kitchen", action: "turn_off" }] });
  expect(any.json.summary).toContain("When someone leaves home, and only if nobody is home");
  expect((await j("POST", "/api/automations/preview", admin, { triggers: [{ type: "presence", personId: "person.nobody", to: "home" }], actions: [] })).status).toBe(404);
  expect((await j("POST", "/api/automations/preview", admin, { triggers: [{ type: "presence", personId: null, to: "elsewhere" }], actions: [] })).status).toBe(400);
  expect((await j("GET", "/api/automations/people", admin)).json.people).toEqual([{ id: "person.alex", name: "alex", home: true }, { id: "person.sam", name: "sam", home: true }]);
});

test("the hub is asked to check an automation first, and its objection stops the save", async () => {
  const { t, make } = await home();
  const seen: Body[] = [];
  t.ha.replies.set("validate_config", (m) => { seen.push(m); return { triggers: { valid: true, error: null }, conditions: { valid: false, error: "bad" }, actions: { valid: true, error: null } }; });
  expect((await make()).json.error).toBe("ha_invalid");
  expect(seen[0]).toHaveProperty("conditions");
  expect([...t.ha.configs].some(([k]) => k.startsWith("automation/"))).toBe(false); // nothing was written
  t.ha.replies.set("validate_config", () => ({ triggers: { valid: true }, conditions: { valid: true }, actions: { valid: true } }));
  expect((await make()).status).toBe(200);
});

test("why it did or didn't run: the failed condition is named, in the words the automation uses", async () => {
  const { t, admin, j, make } = await home();
  const id = (await make()).json.id as string;
  const haId = (t.db.query("SELECT ha_id FROM automations WHERE id = ?").get(id) as { ha_id: string }).ha_id;
  const at = (m: number) => new Date(t.clock.t - m * 60_000).toISOString();
  t.ha.replies.set("trace/list", () => [
    { run_id: "r1", timestamp: { start: at(60) }, script_execution: "finished" },
    { run_id: "r2", timestamp: { start: at(5) }, script_execution: "failed_conditions" },
    { run_id: "r3", timestamp: { start: at(30) }, script_execution: "error", error: "secret internal text" },
  ]);
  t.ha.replies.set("trace/get", (m) => (m.run_id === "r2" ? { trace: { "trigger/0": [{}], "condition/0": [{ result: { result: true } }], "condition/1": [{ result: { result: false } }] } } : { trace: {} }));
  const r = (await j("GET", `/api/automations/${id}/trace`, admin)).json;
  expect(r.enabled).toBe(true);
  expect(r.runs.map((x: Body) => x.outcome)).toEqual(["skipped", "error", "ran"]); // newest first
  expect(r.runs[0].why).toBe("It started, but a limit wasn't met: someone is home.");
  expect(r.summary).toBe("It started, but a limit wasn't met: someone is home.");
  expect(JSON.stringify(r)).not.toContain("secret internal text");
  void haId;
  await j("POST", `/api/automations/${id}/enabled`, admin, { enabled: false });
  expect((await j("GET", `/api/automations/${id}/trace`, admin)).json.summary).toBe("It is switched off, so it won't run.");
  t.ha.replies.set("trace/list", () => []);
  await j("POST", `/api/automations/${id}/enabled`, admin, { enabled: true });
  expect((await j("GET", `/api/automations/${id}/trace`, admin)).json.summary).toContain("hasn't started yet");
});

test("failedCondition reads the first false condition from a trace, and nothing from an empty one", () => {
  expect(failedCondition({ trace: { "condition/0/entity_id/0": [{ result: { result: true } }], "condition/2": [{ result: { result: false } }] } })).toBe(2);
  expect(failedCondition({ trace: { "action/0": [{ result: { result: false } }] } })).toBeNull();
  expect(failedCondition(null)).toBeNull();
});

test("traces and the hub's own automations are for people who manage automations; guests get nothing", async () => {
  const { t, guest, j, make } = await home();
  const id = (await make()).json.id as string;
  for (const p of [`/api/automations/${id}/trace`, "/api/automations/native", "/api/automations/people"]) expect((await j("GET", p, guest)).status).toBe(403);
  expect((await t.call("GET", `/api/automations/${id}/trace`)).status).toBe(401);
  expect((await j("POST", "/api/automations/native/run", guest, { entityId: "automation.x" })).status).toBe(403);
});

test("automations and scripts made in the hub are listed apart from ours, and can be started and switched", async () => {
  const { t, admin, j, make } = await home();
  await make(); // ours: must not appear in the hub's own list
  t.ha.entities.set("automation.porch_light", ent("automation.porch_light", "on", { id: "1700000000000", friendly_name: "Porch light", last_triggered: "2026-11-02T18:00:00+00:00" }));
  t.ha.entities.set("script.goodnight", ent("script.goodnight", "off", { friendly_name: "Goodnight" }));
  t.ha.entities.set("script.alice_routine_ab12", ent("script.alice_routine_ab12", "off", { friendly_name: "Good Morning" })); // ours: never in the hub's list
  const r = (await j("GET", "/api/automations/native", admin)).json;
  expect(r.automations).toEqual([{ id: "automation.porch_light", name: "Porch light", enabled: true, lastTriggered: "2026-11-02T18:00:00+00:00" }]);
  expect(r.scripts).toEqual([{ id: "script.goodnight", name: "Goodnight", running: false, lastTriggered: null }]);
  expect((await j("POST", "/api/automations/native/run", admin, { entityId: "automation.porch_light" })).json).toEqual({ ok: true, started: true });
  expect(t.ha.calls.at(-1)).toMatchObject({ domain: "automation", service: "trigger", data: { skip_condition: true }, entityId: "automation.porch_light" });
  await j("POST", "/api/automations/native/run", admin, { entityId: "script.goodnight" });
  expect(t.ha.calls.at(-1)).toMatchObject({ domain: "script", service: "turn_on" });
  expect((await j("POST", "/api/automations/native/run", admin, { entityId: "light.kitchen" })).status).toBe(404); // only automations and scripts
  expect((await j("POST", "/api/automations/native/enabled", admin, { entityId: "automation.porch_light", enabled: false })).json).toEqual({ ok: true, enabled: false });
  expect(t.ha.entities.get("automation.porch_light")?.state).toBe("off");
  expect((await j("POST", "/api/automations/native/enabled", admin, { entityId: "automation.porch_light", enabled: "no" })).status).toBe(400);
  expect((t.db.query("SELECT action FROM security_audit WHERE action LIKE 'ha_native.%'").all() as Body[]).map((x) => x.action)).toEqual(["ha_native.run", "ha_native.run", "ha_native.disable"]);
});

test("what uses a device: answered from the hub, with ours marked", async () => {
  const { t, admin, j } = await home();
  t.ha.entities.set("automation.porch_light", ent("automation.porch_light", "on", { id: "1700000000000", friendly_name: "Porch light" }));
  t.ha.entities.set("automation.alice_one", ent("automation.alice_one", "on", { id: "alice_auto_ab12", friendly_name: "Evening" }));
  t.ha.replies.set("search/related", (m) => (m.item_id === "light.kitchen" ? { automation: ["automation.porch_light", "alice_auto_ab12"], scene: ["scene.movie_time"], area: ["kitchen"] } : {}));
  const r = (await j("GET", "/api/devices/light.kitchen/used-by", admin)).json;
  expect(r.items).toEqual([
    { kind: "automation", name: "Porch light", madeHere: false },
    { kind: "automation", name: "Evening", madeHere: true },
    { kind: "scene", name: "movie time", madeHere: false },
  ]);
  expect((await j("GET", "/api/devices/light.desk/used-by", admin)).json).toEqual({ items: [] });
  expect((await j("GET", "/api/devices/light.nope/used-by", admin)).status).toBe(404);
});
