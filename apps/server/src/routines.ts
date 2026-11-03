import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { audit } from "./audit";
import { describe, isAction, toServiceCall, type Action } from "./capabilities";
import { authorize } from "./guard";
import { MODES, MODE_ENTITY } from "./modes";
import { friendlyName, type HaApi } from "./ha";
import type { DeviceService } from "./devices";
import type { SessionUser } from "./session";
import { all, one } from "./sql";
import { asList, asObject, cleanName, denyWith as deny, oneOf, type Failure } from "./http";

type RoutineRow = { id: string; household_id: string; template: string | null; name: string; steps: string; script_id: string; created_at: number };
type Published = Failure | { ok: true };

export type Step =
  | { type: "device"; entityId: string; action: string; value?: unknown }
  | { type: "scene"; entityId: string }
  | { type: "mode"; mode: string }
  | { type: "delay"; seconds: number };

/** What a starting point does to the home's real devices. Lights are required; plugs are an extra and never include heaters or fridges. */
type Recipe = { lights?: "turn_on" | "turn_off"; plugs?: "turn_off"; mode?: string };
export type Template = { key: string; name: string; blurb: string; recipe: Recipe };

/** Starting points only. Nothing is configured, and nothing runs, until a person sets one up. */
export const TEMPLATES: readonly Template[] = [
  { key: "good_morning", name: "Good Morning", blurb: "Start the day: turn on the lights and set the house to Home.", recipe: { lights: "turn_on", mode: "home" } },
  { key: "good_night", name: "Good Night", blurb: "Wind down: turn off the lights and plugs, then set the house to Night.", recipe: { lights: "turn_off", plugs: "turn_off", mode: "night" } },
  { key: "leaving_home", name: "Leaving Home", blurb: "Heading out: turn off the lights and plugs, then set the house to Away.", recipe: { lights: "turn_off", plugs: "turn_off", mode: "away" } },
  { key: "arriving_home", name: "Arriving Home", blurb: "Welcome back: turn on the lights and set the house to Home.", recipe: { lights: "turn_on", mode: "home" } },
];

/** Plugs that are probably meant to stay on. A person can still add them by hand. */
const KEEP_ON = /heat|radiator|boiler|fridge|freezer|router|modem|network|server|nas\b|charger|alarm|camera|pump|aquarium|medical/i;
const MAX_PICKED = 20;

export type Resolved = { steps: Step[]; complete: boolean; missing: string | null };

/** How each action reads in a sentence. `unlock` is absent on purpose: a stored routine never unlocks a door. */
const ACTION_TEXT: Partial<Record<Action, (v: unknown) => string>> = {
  turn_on: () => "Turn on", turn_off: () => "Turn off", set_brightness: (v) => `Set brightness to ${v}% on`,
  set_color_temp: (v) => `Set warmth to ${v}K on`, set_color: () => "Change the color of", set_speed: (v) => `Set speed to ${v}% on`,
  set_temperature: (v) => `Set the temperature to ${v}° on`, set_hvac_mode: (v) => `Set mode to ${v} on`, lock: () => "Lock",
  media_play: () => "Play", media_pause: () => "Pause", set_volume: (v) => `Set volume to ${v}% on`,
};
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export function createRoutineService(db: Database, ha: HaApi, svc: DeviceService) {
  const nameOf = (id: string) => friendlyName(ha.entities.get(id), "an unavailable device");

  /** One plain-language sentence per step, derived from what is saved. */
  const text = (s: Step): string =>
    s.type === "device" ? `${(isAction(s.action) ? ACTION_TEXT[s.action] : undefined)?.(s.value) ?? cap(s.action)} ${nameOf(s.entityId)}`
    : s.type === "scene" ? `Activate the scene “${nameOf(s.entityId)}”`
    : s.type === "mode" ? `Set the household mode to ${cap(s.mode)}`
    : `Wait ${s.seconds} second${s.seconds === 1 ? "" : "s"}`;

  /** Check a step list against what the author may use, and translate it to an HA script sequence. */
  function compile(u: SessionUser, input: unknown): { sequence: unknown[]; steps: Step[] } | (Failure & { step?: number }) {
    const steps = asList(input);
    if (!steps || steps.length < 1 || steps.length > 30) return { status: 400, error: "invalid_input" };
    const ok = svc.accessor(u), sequence: unknown[] = [], clean: Step[] = [];
    for (const [i, raw] of steps.entries()) {
      const bad = (error = "invalid_step", status = 400) => ({ status, error, step: i });
      const s = asObject(raw); // anything that isn't an object has no `type`, and falls through to bad()
      if (s.type === "device") {
        const e = typeof s.entityId === "string" ? ha.entities.get(s.entityId) : undefined;
        if (!e || !ok(e.entity_id) || !svc.deviceFor(u, e.entity_id)) return bad("not_found", 404); // can't use it, can't put it in a routine
        if (e.state === "unavailable") return bad("device_unavailable", 409);
        const call = toServiceCall(describe(e), { action: String(s.action), value: s.value });
        if ("error" in call) return bad(call.error);
        if (call.sensitive) return bad("invalid_step"); // doors are never unlocked by a stored routine
        if (call.domain === "alarm_control_panel") return bad("invalid_step"); // an alarm code must never be written into a stored routine
        sequence.push({ action: `${call.domain}.${call.service}`, target: { entity_id: e.entity_id }, data: call.data });
        clean.push({ type: "device", entityId: e.entity_id, action: String(s.action), ...(s.value !== undefined ? { value: s.value } : {}) });
      } else if (s.type === "scene") {
        const e = typeof s.entityId === "string" ? ha.entities.get(s.entityId) : undefined;
        if (!e || !e.entity_id.startsWith("scene.") || !ok(e.entity_id)) return bad("not_found", 404);
        sequence.push({ action: "scene.turn_on", target: { entity_id: e.entity_id } });
        clean.push({ type: "scene", entityId: e.entity_id });
      } else if (s.type === "mode") {
        const mode = s.mode;
        if (!oneOf(MODES, mode)) return bad();
        sequence.push({ action: "input_select.select_option", target: { entity_id: MODE_ENTITY }, data: { option: mode } });
        clean.push({ type: "mode", mode });
      } else if (s.type === "delay") {
        const seconds = s.seconds;
        if (typeof seconds !== "number" || !Number.isInteger(seconds) || seconds < 1 || seconds > 600) return bad();
        sequence.push({ delay: { seconds } });
        clean.push({ type: "delay", seconds });
      } else return bad();
    }
    return { sequence, steps: clean };
  }

  /** The devices this person may use that fit a recipe's wording, so a template only ever holds real actions. */
  function pick(u: SessionUser, kind: "lights" | "plugs", action: "turn_on" | "turn_off"): Step[] {
    const ok = svc.accessor(u), out: Step[] = [];
    for (const e of [...ha.entities.values()].sort((x, y) => x.entity_id.localeCompare(y.entity_id))) {
      if (out.length >= MAX_PICKED) break;
      if (e.state === "unavailable" || !ok(e.entity_id) || !svc.deviceFor(u, e.entity_id)) continue;
      const cat = describe(e).category;
      if (kind === "lights" ? cat !== "light" : cat !== "switch" || KEEP_ON.test(friendlyName(e, ""))) continue;
      out.push({ type: "device", entityId: e.entity_id, action });
    }
    return out;
  }
  /** Turn a recipe into actions from this home's own devices, and say plainly when something it needs isn't there. */
  function resolve(u: SessionUser, r: Recipe): Resolved {
    const lights = r.lights ? pick(u, "lights", r.lights) : [], plugs = r.plugs ? pick(u, "plugs", r.plugs) : [];
    const steps: Step[] = [...lights, ...plugs, ...(r.mode ? [{ type: "mode" as const, mode: r.mode }] : [])];
    const noLights = !!r.lights && !lights.length, noDevices = noLights && (!r.plugs || !plugs.length);
    const missing = noDevices ? "No lights or plugs that you can use were found, so there is nothing to switch yet. Add the devices you want yourself."
      : noLights ? "No lights that you can use were found, so there are no lights in this one yet. Add what you want yourself." : null;
    return { steps, complete: !noLights, missing };
  }

  const rows = (h: string) => all<RoutineRow>(db, "SELECT id, template, name, steps, script_id FROM routines WHERE household_id = ? ORDER BY created_at", h);
  function view(r: Pick<RoutineRow, "id" | "name" | "template" | "steps">) {
    const steps = JSON.parse(r.steps) as Step[];
    const missing = steps.filter((s) => (s.type === "device" || s.type === "scene") && !ha.entities.has(s.entityId)).length;
    return { id: r.id, name: r.name, template: r.template, steps: steps.map((s) => ({ ...s, text: text(s) })), summary: steps.map(text).join(", then "), needsAttention: missing > 0 };
  }
  const visible = (u: SessionUser) => { const ok = svc.accessor(u); return rows(u.householdId).filter((r) => ok(`routine:${r.id}`)).map(view); };

  return { compile, text, pick, resolve, rows, view, visible, search: (u: SessionUser, q: string) => visible(u).filter((r) => r.name.toLowerCase().includes(q)).slice(0, 10).map(({ id, name }) => ({ id, name })) };
}
export type RoutineService = ReturnType<typeof createRoutineService>;

export function routineRoutes(db: Database, ha: HaApi, secure: boolean, svc: DeviceService, rt: RoutineService) {
  const scriptEntity = (scriptId: string) => `script.${scriptId}`;

  async function publish(scriptId: string, name: string, sequence: unknown[]): Promise<Published> {
    if (ha.isStale()) return { status: 503, error: "ha_unavailable" };
    const w = await ha.config("POST", `/api/config/script/config/${scriptId}`, { alias: name, description: "Managed by Smart Home Companion", mode: "single", sequence });
    if (!w.ok) return { status: 502, error: w.error ?? "ha_rejected" };
    await ha.callService("script", "reload");
    const e = await ha.waitFor((x) => x.entity_id === scriptEntity(scriptId) && x.attributes.friendly_name === name, 3000);
    return e ? { ok: true } : { status: 502, error: "ha_not_loading" };
  }
  const routineOf = (u: SessionUser, id: string) => {
    const row = one<RoutineRow>(db, "SELECT * FROM routines WHERE id = ? AND household_id = ?", id, u.householdId);
    return row && svc.accessor(u)(`routine:${row.id}`) ? row : null;
  };

  return new Elysia({ name: "routines" })
    .get("/api/routines", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const mine = rt.visible(g.user), canManage = g.user.permissions.includes("scenes.manage");
      const done = new Set(rt.rows(g.user.householdId).map((r) => r.template));
      return {
        canManage, routines: mine,
        // Suggestions are clearly separate from configured routines, and only offered to people who can set them up.
        suggested: canManage ? TEMPLATES.filter((t) => !done.has(t.key)).map(({ recipe, ...t }) => { const r = rt.resolve(g.user, recipe); return { ...t, defaultSteps: r.steps, complete: r.complete, missing: r.missing, summary: r.steps.map(rt.text).join(", then "), configured: false }; }) : [],
      };
    })
    .post("/api/routines", async ({ request, body, set }) => {
      const g = authorize(db, request, secure, ["scenes.manage", "device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const input = asObject(body), template = input.template ?? null, name = cleanName(input.name);
      if (!name || (template !== null && !TEMPLATES.some((t) => t.key === template))) return deny(set, 400, "invalid_input");
      if (template && rt.rows(g.user.householdId).some((r) => r.template === template)) return deny(set, 409, "invalid_input");
      const c = rt.compile(g.user, input.steps);
      if ("error" in c) return deny(set, c.status, c.error, { step: c.step });
      const id = randomUUID(), scriptId = "alice_routine_" + randomBytes(5).toString("hex");
      const r = await publish(scriptId, name, c.sequence);
      if ("error" in r) {
        if (r.error === "not_confirmed" || r.error === "ha_not_loading") { await ha.config("DELETE", `/api/config/script/config/${scriptId}`); await ha.callService("script", "reload"); }
        return deny(set, r.status, r.error);
      }
      db.query("INSERT INTO routines (id, household_id, template, name, steps, script_id, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, g.user.householdId, typeof template === "string" ? template : null, name, JSON.stringify(c.steps), scriptId, Date.now());
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "routine.create", target: id, outcome: "success" });
      return { ok: true, id };
    })
    .put("/api/routines/:id", async ({ request, params, body, set }) => {
      const g = authorize(db, request, secure, ["scenes.manage", "device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = routineOf(g.user, params.id);
      if (!row) return deny(set, 404, "not_found");
      const input = asObject(body), name = cleanName(input.name); if (!name) return deny(set, 400, "invalid_input");
      const c = rt.compile(g.user, input.steps);
      if ("error" in c) return deny(set, c.status, c.error, { step: c.step });
      const r = await publish(row.script_id, name, c.sequence);
      if ("error" in r) return deny(set, r.status, r.error);
      db.query("UPDATE routines SET name = ?, steps = ? WHERE id = ?").run(name, JSON.stringify(c.steps), row.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "routine.update", target: row.id, outcome: "success" });
      return { ok: true };
    })
    .delete("/api/routines/:id", async ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["scenes.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = routineOf(g.user, params.id);
      if (!row) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const w = await ha.config("DELETE", `/api/config/script/config/${row.script_id}`);
      if (!w.ok) return deny(set, 502, w.error ?? "ha_rejected");
      await ha.callService("script", "reload");
      db.transaction(() => {
        db.query("DELETE FROM routines WHERE id = ?").run(row.id);
        db.query("DELETE FROM device_access WHERE entity_id = ?").run(`routine:${row.id}`);
      })();
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "routine.delete", target: row.id, outcome: "success" });
      return { ok: true };
    })
    .post("/api/routines/:id/run", async ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["scene.activate"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = routineOf(g.user, params.id);
      if (!row) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const id = scriptEntity(row.script_id), before = ha.entities.get(id);
      if (!before) return deny(set, 409, "ha_rejected");
      const r = await ha.callService("script", "turn_on", {}, id);
      if (!r.ok) return deny(set, r.error === "ha_unavailable" ? 503 : 409, r.error);
      // HA runs the steps itself. We can only say it was started, never that every step worked.
      return { ok: true, started: true, confirmed: await ha.waitForChange(id, before, 1500) };
    });
}
