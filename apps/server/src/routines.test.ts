import { expect, test } from "bun:test";
import { ensureModeHelper, MODE_ENTITY } from "./modes";
import { setup, type Body } from "./testkit";

async function home() {
  const t = setup();
  await ensureModeHelper(t.ha);
  t.ha.calls.length = 0;
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  const j = (m: string, p: string, cookie: string, body?: unknown) => t.call(m, p, { cookie, body });
  const grant = (uid: string, ids: string[]) => t.call("PUT", `/api/admin/users/${uid}/devices`, { cookie: admin.cookie, body: { allow: ids } });
  return { t, admin: admin.cookie!, member, guest, j, grant };
}
const nightSteps = [
  { type: "device", entityId: "light.kitchen", action: "turn_off" },
  { type: "delay", seconds: 5 },
  { type: "device", entityId: "light.desk", action: "turn_on" },
  { type: "mode", mode: "night" },
];

// ---------- household modes ----------

test("the mode helper is created in Home Assistant once", async () => {
  const t = setup();
  expect(await ensureModeHelper(t.ha)).toBe("created");
  expect(t.ha.wsCalls[0]).toMatchObject({ type: "input_select/create", options: ["home", "away", "night", "vacation"] });
  expect(await ensureModeHelper(t.ha)).toBe("exists");
  expect(t.ha.wsCalls.length).toBe(1);
});

test("switching mode changes only the mode, never a device", async () => {
  const { t, member, j } = await home();
  const r = await j("POST", "/api/mode", member.cookie, { mode: "away" });
  expect(r.json).toMatchObject({ ok: true, confirmed: true, mode: "away" });
  expect(t.ha.calls).toEqual([{ domain: "input_select", service: "select_option", data: { option: "away" }, entityId: MODE_ENTITY }]);
  expect((await j("GET", "/api/mode", member.cookie)).json.current).toBe("away");
  expect((await j("GET", "/api/admin/activity", member.cookie)).status).toBe(403);
  expect(t.db.query("SELECT summary FROM activity_events WHERE kind='mode'").all()).toEqual([{ summary: "Household mode set to away" }]); // no actor recorded
});

test("mode changes are validated, permissioned, and honest when the hub can't do it", async () => {
  const { t, admin, member, guest, j } = await home();
  expect((await j("POST", "/api/mode", member.cookie, { mode: "party" })).status).toBe(400);
  expect((await j("POST", "/api/mode", guest.cookie, { mode: "away" })).status).toBe(403);
  expect((await j("GET", "/api/mode", guest.cookie)).json.canSet).toBe(false);
  t.ha.setStale(true);
  expect((await j("POST", "/api/mode", admin, { mode: "night" })).status).toBe(503);
  t.ha.setStale(false);
  t.ha.entities.delete(MODE_ENTITY);
  const r = await j("POST", "/api/mode", admin, { mode: "night" });
  expect(r.status).toBe(409);
  expect(r.json.error).toBe("mode_unavailable");
  expect((await j("GET", "/api/mode", admin)).json.available).toBe(false);
});

test("an unconfirmed mode change is not reported as confirmed", async () => {
  const { t, member, j } = await home();
  t.ha.ignoring.add(MODE_ENTITY);
  const r = await j("POST", "/api/mode", member.cookie, { mode: "vacation" });
  expect(r.json.confirmed).toBe(false);
  expect(r.json.mode).toBe("home");
  expect(t.db.query("SELECT COUNT(*) c FROM activity_events WHERE kind='mode'").get()).toEqual({ c: 0 });
});

test("presence only ever produces a suggestion", async () => {
  const { t, member, j } = await home();
  expect((await j("GET", "/api/mode", member.cookie)).json.suggestion).toBeNull();
  t.ha.set("person.alex", "not_home"); t.ha.set("person.sam", "not_home");
  t.ha.calls.length = 0;
  const m = (await j("GET", "/api/mode", member.cookie)).json;
  expect(m.suggestion).toMatchObject({ mode: "away" });
  expect(m.current).toBe("home"); // still home: nothing acted on the suggestion
  expect(t.ha.calls.length).toBe(0);
  expect(t.ha.entities.get("light.kitchen")!.state).toBe("on");
  await j("POST", "/api/mode", member.cookie, { mode: "away" });
  t.ha.set("person.sam", "home");
  expect((await j("GET", "/api/mode", member.cookie)).json.suggestion).toMatchObject({ mode: "home" });
});

// ---------- scenes ----------

test("scenes are listed per person and activated honestly", async () => {
  const { t, member, guest, grant, j } = await home();
  expect((await j("GET", "/api/scenes", member.cookie)).json.scenes.map((s: Body) => s.id)).toEqual(["scene.movie_time"]);
  expect((await j("GET", "/api/scenes", guest.cookie)).json.scenes).toEqual([]);
  expect((await j("POST", "/api/scenes/scene.movie_time/activate", guest.cookie)).status).toBe(404);
  await grant(guest.userId, ["scene.movie_time"]);
  const ok = await j("POST", "/api/scenes/scene.movie_time/activate", guest.cookie);
  expect(ok.json).toMatchObject({ ok: true, confirmed: true });
  expect(t.ha.calls.at(-1)).toMatchObject({ domain: "scene", service: "turn_on", entityId: "scene.movie_time" });
  expect((await j("POST", "/api/scenes/scene.nope/activate", member.cookie)).status).toBe(404);
  t.ha.setStale(true);
  expect((await j("POST", "/api/scenes/scene.movie_time/activate", member.cookie)).status).toBe(503);
});

test("scenes can be created from current device state, edited and deleted (managed ones only)", async () => {
  const { t, member, guest, j } = await home();
  const c = await j("POST", "/api/scenes", member.cookie, { name: "Cozy", entityIds: ["light.kitchen", "switch.plug", "fan.bedroom"] });
  expect(c.status).toBe(200);
  const cfg = [...t.ha.configs.entries()].find(([k]) => k.startsWith("scene/alice_"))![1];
  expect(cfg).toEqual({ name: "Cozy", entities: { "light.kitchen": { state: "on", brightness: 128 }, "switch.plug": { state: "on" }, "fan.bedroom": { state: "off" } } });
  const list = (await j("GET", "/api/scenes", member.cookie)).json.scenes;
  expect(list.find((s: Body) => s.id === c.json.id)).toMatchObject({ name: "Cozy", managed: true });
  expect(list.find((s: Body) => s.id === "scene.movie_time").managed).toBe(false);
  expect((await j("PUT", `/api/scenes/${c.json.id}`, member.cookie, { name: "Cozy evening", entityIds: ["light.kitchen"] })).status).toBe(200);
  expect((await j("GET", "/api/scenes", member.cookie)).json.scenes.find((s: Body) => s.id === c.json.id).name).toBe("Cozy evening");
  expect((await j("PUT", "/api/scenes/scene.movie_time", member.cookie, { name: "x", entityIds: ["light.kitchen"] })).status).toBe(404); // not ours to edit
  expect((await j("DELETE", "/api/scenes/scene.movie_time", member.cookie)).status).toBe(404);
  expect((await j("DELETE", `/api/scenes/${c.json.id}`, member.cookie)).status).toBe(200);
  expect([...t.ha.configs.keys()].some((k) => k.startsWith("scene/alice_"))).toBe(false);
  expect((await j("POST", "/api/scenes", guest.cookie, { name: "No", entityIds: ["light.kitchen"] })).status).toBe(403);
});

test("scene creation rejects what it can't restore reliably, and never claims a failed write worked", async () => {
  const { t, member, guest, admin, j } = await home();
  expect((await j("POST", "/api/scenes", member.cookie, { name: "A", entityIds: ["lock.front"] })).status).toBe(400); // unsupported
  expect((await j("POST", "/api/scenes", member.cookie, { name: "A", entityIds: ["switch.heater"] })).status).toBe(409); // offline
  expect((await j("POST", "/api/scenes", member.cookie, { name: "A", entityIds: ["nope.nope"] })).status).toBe(404);
  expect((await j("POST", "/api/scenes", member.cookie, { name: "", entityIds: ["light.kitchen"] })).status).toBe(400);
  await t.call("PUT", `/api/admin/users/${guest.userId}/permissions`, { cookie: admin, body: { overrides: { "scenes.manage": true } } });
  expect((await j("POST", "/api/scenes", guest.cookie, { name: "A", entityIds: ["light.kitchen"] })).status).toBe(404); // can't use that device
  t.ha.configFails = "ha_not_admin";
  const r = await j("POST", "/api/scenes", member.cookie, { name: "Cozy", entityIds: ["light.kitchen"] });
  expect(r.status).toBe(502);
  expect(r.json.message).toContain("contact support");
  expect((await j("GET", "/api/scenes", member.cookie)).json.scenes.length).toBe(1);
  t.ha.configFails = null;
  t.ha.setStale(true);
  expect((await j("POST", "/api/scenes", member.cookie, { name: "Cozy", entityIds: ["light.kitchen"] })).status).toBe(503);
});

// ---------- routines ----------

test("suggested routines are clearly separate and nothing is configured or run until a person does it", async () => {
  const { t, member, guest, j } = await home();
  const r = (await j("GET", "/api/routines", member.cookie)).json;
  expect(r.routines).toEqual([]);
  expect(r.suggested.map((s: Body) => s.key)).toEqual(["good_morning", "good_night", "leaving_home", "arriving_home"]);
  expect(r.suggested.every((s: Body) => s.configured === false)).toBe(true);
  expect((await j("GET", "/api/routines", guest.cookie)).json.suggested).toEqual([]); // only people who can set them up
  expect(t.ha.calls.length).toBe(0);
  expect(t.ha.configs.size).toBe(0);
});

test("a routine is built into a Home Assistant script, summarised in plain words, and never auto-run", async () => {
  const { t, member, j } = await home();
  const c = await j("POST", "/api/routines", member.cookie, { template: "good_night", name: "Good Night", steps: nightSteps });
  expect(c.status).toBe(200);
  const [key, cfg] = [...t.ha.configs.entries()].find(([k]) => k.startsWith("script/alice_routine_"))!;
  expect(cfg.alias).toBe("Good Night");
  expect(cfg.sequence).toEqual([
    { action: "light.turn_off", target: { entity_id: "light.kitchen" }, data: {} },
    { delay: { seconds: 5 } },
    { action: "light.turn_on", target: { entity_id: "light.desk" }, data: {} },
    { action: "input_select.select_option", target: { entity_id: MODE_ENTITY }, data: { option: "night" } },
  ]);
  const view = (await j("GET", "/api/routines", member.cookie)).json;
  expect(view.routines[0].summary).toBe("Turn off kitchen, then Wait 5 seconds, then Turn on desk, then Set the household mode to Night");
  expect(view.routines[0].needsAttention).toBe(false);
  expect(view.suggested.map((s: Body) => s.key)).not.toContain("good_night");
  expect(t.ha.calls.some((x) => x.service === "turn_on" && x.domain === "script")).toBe(false); // configured, not run
  expect(t.ha.entities.get("light.kitchen")!.state).toBe("on");
  expect(key).toContain("alice_routine_");
  expect((await j("POST", "/api/routines", member.cookie, { template: "good_night", name: "Again", steps: nightSteps })).status).toBe(409);
});

test("running a routine starts the HA script and only claims 'started'", async () => {
  const { t, member, guest, grant, j } = await home();
  const c = await j("POST", "/api/routines", member.cookie, { name: "Movie night", steps: nightSteps });
  expect((await j("POST", `/api/routines/${c.json.id}/run`, guest.cookie)).status).toBe(404);
  await grant(guest.userId, [`routine:${c.json.id}`]);
  expect((await j("GET", "/api/routines", guest.cookie)).json.routines.length).toBe(1);
  const r = await j("POST", `/api/routines/${c.json.id}/run`, guest.cookie);
  expect(r.json).toMatchObject({ ok: true, started: true, confirmed: true });
  const run = t.ha.calls.find((x) => x.domain === "script" && x.service === "turn_on")!;
  expect(run.entityId).toMatch(/^script\.alice_routine_/);
  t.ha.setStale(true);
  expect((await j("POST", `/api/routines/${c.json.id}/run`, member.cookie)).status).toBe(503);
});

test("routine steps are validated against what the author may use and what devices support", async () => {
  const { t, member, guest, admin, j } = await home();
  const make = (steps: unknown[], cookie = member.cookie) => j("POST", "/api/routines", cookie, { name: "R", steps });
  const bad = async (steps: unknown[], status: number, cookie?: string) => { const r = await make(steps, cookie); expect(r.status).toBe(status); return r; };
  const r = await bad([{ type: "delay", seconds: 1 }, { type: "device", entityId: "light.hall", action: "set_brightness", value: 50 }], 400);
  expect(r.json.step).toBe(1); // says which step is wrong
  await bad([{ type: "device", entityId: "lock.front", action: "unlock" }], 400); // doors are never unlocked by a stored routine
  await bad([{ type: "device", entityId: "switch.heater", action: "turn_on" }], 409); // offline
  await bad([{ type: "device", entityId: "nope.x", action: "turn_on" }], 404);
  await bad([{ type: "delay", seconds: 0 }], 400);
  await bad([{ type: "delay", seconds: 601 }], 400);
  await bad([{ type: "mode", mode: "party" }], 400);
  await bad([{ type: "scene", entityId: "light.kitchen" }], 404);
  await bad([{ type: "teleport" }], 400);
  await bad([], 400);
  await bad(Array.from({ length: 31 }, () => ({ type: "delay", seconds: 1 })), 400);
  await t.call("PUT", `/api/admin/users/${guest.userId}/permissions`, { cookie: admin, body: { overrides: { "scenes.manage": true } } });
  await bad([{ type: "device", entityId: "light.kitchen", action: "turn_off" }], 404, guest.cookie); // author can't use that device
  expect(t.ha.configs.size).toBe(0);
  expect((await j("POST", "/api/routines", member.cookie, { name: "R", template: "nonsense", steps: [{ type: "delay", seconds: 1 }] })).status).toBe(400);
});

test("a rejected or unconfirmed routine is never saved", async () => {
  const { t, member, j } = await home();
  t.ha.configFails = "ha_rejected";
  const r = await j("POST", "/api/routines", member.cookie, { name: "R", steps: nightSteps });
  expect(r.status).toBe(502);
  expect(t.db.query("SELECT COUNT(*) c FROM routines").get()).toEqual({ c: 0 });
  t.ha.configFails = null;
  t.ha.setStale(true);
  expect((await j("POST", "/api/routines", member.cookie, { name: "R", steps: nightSteps })).status).toBe(503);
  expect(t.db.query("SELECT COUNT(*) c FROM routines").get()).toEqual({ c: 0 });
});

test("routines can be edited and deleted, and a missing device is flagged", async () => {
  const { t, member, j } = await home();
  const c = await j("POST", "/api/routines", member.cookie, { name: "Evening", steps: nightSteps });
  expect((await j("PUT", `/api/routines/${c.json.id}`, member.cookie, { name: "Evening v2", steps: [{ type: "mode", mode: "home" }] })).status).toBe(200);
  const cfg = [...t.ha.configs.values()].find((x) => x.alias === "Evening v2");
  expect(cfg.sequence.length).toBe(1);
  expect((await j("GET", "/api/routines", member.cookie)).json.routines[0].summary).toBe("Set the household mode to Home");
  await j("PUT", `/api/routines/${c.json.id}`, member.cookie, { name: "Evening v3", steps: nightSteps });
  t.ha.entities.delete("light.desk");
  expect((await j("GET", "/api/routines", member.cookie)).json.routines[0].needsAttention).toBe(true);
  expect((await j("DELETE", `/api/routines/${c.json.id}`, member.cookie)).status).toBe(200);
  expect(t.ha.configs.size).toBe(0);
  expect((await j("GET", "/api/routines", member.cookie)).json.routines).toEqual([]);
  expect((await j("DELETE", `/api/routines/${c.json.id}`, member.cookie)).status).toBe(404);
});

test("modes show which routines they're connected to, only those the viewer may use", async () => {
  const { member, guest, j } = await home();
  await j("POST", "/api/routines", member.cookie, { template: "good_night", name: "Good Night", steps: nightSteps });
  const m = (await j("GET", "/api/mode", member.cookie)).json;
  expect(m.linkedRoutines.night).toEqual(["Good Night"]);
  expect(m.linkedRoutines.away).toEqual([]);
  expect(m.note).toContain("doesn't switch any devices by itself");
  expect((await j("GET", "/api/mode", guest.cookie)).json.linkedRoutines.night).toEqual([]);
});

test("search finds scenes and routines the person may use", async () => {
  const { member, guest, grant, j } = await home();
  const c = await j("POST", "/api/routines", member.cookie, { name: "Movie night", steps: nightSteps });
  const q = async (cookie: string, s: string) => (await j("GET", `/api/search?q=${s}`, cookie)).json;
  expect((await q(member.cookie, "movie")).scenes.map((x: Body) => x.id)).toEqual(["scene.movie_time"]);
  expect((await q(member.cookie, "movie")).routines.map((x: Body) => x.name)).toEqual(["Movie night"]);
  expect((await q(guest.cookie, "movie")).scenes).toEqual([]);
  expect((await q(guest.cookie, "movie")).routines).toEqual([]);
  await grant(guest.userId, [`routine:${c.json.id}`]);
  expect((await q(guest.cookie, "movie")).routines.length).toBe(1);
});

test("admins can share scenes and routines with individual people; unknown targets are rejected", async () => {
  const { t, admin, guest, member, j } = await home();
  const c = await j("POST", "/api/routines", member.cookie, { name: "R", steps: nightSteps });
  const a = (await j("GET", "/api/admin/actions", admin)).json;
  expect(a.routines).toEqual([{ id: `routine:${c.json.id}`, name: "R" }]);
  expect(a.scenes.map((s: Body) => s.id)).toContain("scene.movie_time");
  expect((await j("GET", "/api/admin/actions", member.cookie)).status).toBe(403);
  expect((await t.call("PUT", `/api/admin/users/${guest.userId}/devices`, { cookie: admin, body: { allow: ["routine:nope"] } })).status).toBe(400);
});

test("every suggested routine carries real actions from the home's own devices", async () => {
  const { t, member, j } = await home();
  const by = (await j("GET", "/api/routines", member.cookie)).json.suggested.reduce((m: Body, s: Body) => ({ ...m, [s.key]: s }), {});
  const kinds = (k: string) => by[k].defaultSteps.map((s: Body) => `${s.type}:${s.entityId ?? s.mode}:${s.action ?? ""}`);
  expect(kinds("good_morning")).toEqual(["device:light.desk:turn_on", "device:light.hall:turn_on", "device:light.kitchen:turn_on", "mode:home:"]);
  // plugs are switched off at night, but the unavailable heater is left out
  expect(kinds("good_night")).toEqual(["device:light.desk:turn_off", "device:light.hall:turn_off", "device:light.kitchen:turn_off", "device:switch.plug:turn_off", "mode:night:"]);
  expect(by.good_night.complete).toBe(true);
  expect(by.good_night.summary).toContain("Turn off desk");
  // a suggestion can be saved exactly as offered
  const c = await j("POST", "/api/routines", member.cookie, { template: "good_morning", name: "Good Morning", steps: by.good_morning.defaultSteps });
  expect(c.status).toBe(200);
  expect(t.ha.calls.some((x) => x.domain !== "script")).toBe(false); // saving never runs anything
});

test("a suggestion says so when the home has nothing for it, rather than quietly being incomplete", async () => {
  const { t, member, j } = await home();
  for (const id of [...t.ha.entities.keys()]) if (id.startsWith("light.") || id.startsWith("switch.")) t.ha.entities.delete(id);
  const s = (await j("GET", "/api/routines", member.cookie)).json.suggested.find((x: Body) => x.key === "good_morning");
  expect(s.complete).toBe(false);
  expect(s.missing).toContain("No lights");
  expect(s.defaultSteps).toEqual([{ type: "mode", mode: "home" }]);
});

test("plugs that look like heaters, routers or fridges are never switched off by a suggestion", async () => {
  const { t, member, j } = await home();
  t.ha.entities.set("switch.router", { entity_id: "switch.router", state: "on", attributes: { friendly_name: "Router plug" } });
  t.ha.entities.set("switch.heater", { entity_id: "switch.heater", state: "on", attributes: { friendly_name: "Heater" } });
  const s = (await j("GET", "/api/routines", member.cookie)).json.suggested.find((x: Body) => x.key === "leaving_home");
  const ids = s.defaultSteps.filter((x: Body) => x.type === "device").map((x: Body) => x.entityId);
  expect(ids).toContain("switch.plug");
  expect(ids).not.toContain("switch.router");
  expect(ids).not.toContain("switch.heater");
});
