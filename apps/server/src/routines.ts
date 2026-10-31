import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { audit } from "./audit";
import { describe, toServiceCall } from "./capabilities";
import { authorize } from "./guard";
import { say } from "./messages";
import { MODES, MODE_ENTITY } from "./modes";
import type { HaApi } from "./ha";
import type { DeviceService } from "./devices";
import type { SessionUser } from "./session";

export type Step =
  | { type: "device"; entityId: string; action: string; value?: unknown }
  | { type: "scene"; entityId: string }
  | { type: "mode"; mode: string }
  | { type: "delay"; seconds: number };

/** Starting points only. Nothing is configured, and nothing runs, until a person sets one up. */
export const TEMPLATES = [
  { key: "good_morning", name: "Good Morning", blurb: "Start the day: lights on, house set to Home.", defaultSteps: [{ type: "mode", mode: "home" }] },
  { key: "good_night", name: "Good Night", blurb: "Wind down: switch things off and set the house to Night.", defaultSteps: [{ type: "mode", mode: "night" }] },
  { key: "leaving_home", name: "Leaving Home", blurb: "Heading out: switch things off and set the house to Away.", defaultSteps: [{ type: "mode", mode: "away" }] },
  { key: "arriving_home", name: "Arriving Home", blurb: "Welcome back: lights on and set the house to Home.", defaultSteps: [{ type: "mode", mode: "home" }] },
] as const;

const ACTION_TEXT: Record<string, (v: any) => string> = {
  turn_on: () => "Turn on", turn_off: () => "Turn off", set_brightness: (v) => `Set brightness to ${v}% on`,
  set_color_temp: (v) => `Set warmth to ${v}K on`, set_color: () => "Change the color of", set_speed: (v) => `Set speed to ${v}% on`,
  set_temperature: (v) => `Set the temperature to ${v}° on`, set_hvac_mode: (v) => `Set mode to ${v} on`, lock: () => "Lock",
  media_play: () => "Play", media_pause: () => "Pause", set_volume: (v) => `Set volume to ${v}% on`,
};
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

export function createRoutineService(db: Database, ha: HaApi, svc: DeviceService) {
  const nameOf = (id: string) => String(ha.entities.get(id)?.attributes?.friendly_name ?? "an unavailable device");

  /** One plain-language sentence per step, derived from what is saved. */
  const text = (s: Step): string =>
    s.type === "device" ? `${(ACTION_TEXT[s.action] ?? (() => cap(s.action)))(s.value)} ${nameOf(s.entityId)}`
    : s.type === "scene" ? `Activate the scene “${nameOf(s.entityId)}”`
    : s.type === "mode" ? `Set the household mode to ${cap(s.mode)}`
    : `Wait ${s.seconds} second${s.seconds === 1 ? "" : "s"}`;

  /** Check a step list against what the author may use, and translate it to an HA script sequence. */
  function compile(u: SessionUser, steps: unknown): { sequence: unknown[]; steps: Step[] } | { status: number; error: string; step?: number } {
    if (!Array.isArray(steps) || steps.length < 1 || steps.length > 30) return { status: 400, error: "invalid_input" };
    const ok = svc.accessor(u), sequence: unknown[] = [], clean: Step[] = [];
    for (const [i, s] of (steps as any[]).entries()) {
      const bad = (error = "invalid_step", status = 400) => ({ status, error, step: i });
      if (!s || typeof s !== "object") return bad();
      if (s.type === "device") {
        const e = typeof s.entityId === "string" ? ha.entities.get(s.entityId) : undefined;
        if (!e || !ok(e.entity_id) || !svc.deviceFor(u, e.entity_id)) return bad("not_found", 404); // can't use it, can't put it in a routine
        if (e.state === "unavailable") return bad("device_unavailable", 409);
        const call = toServiceCall(describe(e), { action: String(s.action), value: s.value });
        if ("error" in call) return bad(call.error);
        if (call.sensitive) return bad("invalid_step"); // doors are never unlocked by a stored routine
        sequence.push({ action: `${call.domain}.${call.service}`, target: { entity_id: e.entity_id }, data: call.data });
        clean.push({ type: "device", entityId: e.entity_id, action: String(s.action), ...(s.value !== undefined ? { value: s.value } : {}) });
      } else if (s.type === "scene") {
        const e = typeof s.entityId === "string" ? ha.entities.get(s.entityId) : undefined;
        if (!e || !e.entity_id.startsWith("scene.") || !ok(e.entity_id)) return bad("not_found", 404);
        sequence.push({ action: "scene.turn_on", target: { entity_id: e.entity_id } });
        clean.push({ type: "scene", entityId: e.entity_id });
      } else if (s.type === "mode") {
        if (!(MODES as readonly string[]).includes(s.mode)) return bad();
        sequence.push({ action: "input_select.select_option", target: { entity_id: MODE_ENTITY }, data: { option: s.mode } });
        clean.push({ type: "mode", mode: s.mode });
      } else if (s.type === "delay") {
        if (!Number.isInteger(s.seconds) || s.seconds < 1 || s.seconds > 600) return bad();
        sequence.push({ delay: { seconds: s.seconds } });
        clean.push({ type: "delay", seconds: s.seconds });
      } else return bad();
    }
    return { sequence, steps: clean };
  }

  const rows = (h: string) => db.query("SELECT id, template, name, steps, script_id FROM routines WHERE household_id = ? ORDER BY created_at").all(h) as any[];
  function view(r: any) {
    const steps: Step[] = JSON.parse(r.steps);
    const missing = steps.filter((s) => (s.type === "device" || s.type === "scene") && !ha.entities.has(s.entityId)).length;
    return { id: r.id, name: r.name, template: r.template, steps: steps.map((s) => ({ ...s, text: text(s) })), summary: steps.map(text).join(", then ").replace(/^./, (c) => c), needsAttention: missing > 0 };
  }
  const visible = (u: SessionUser) => { const ok = svc.accessor(u); return rows(u.householdId).filter((r) => ok(`routine:${r.id}`)).map(view); };

  return { compile, text, rows, view, visible, search: (u: SessionUser, q: string) => visible(u).filter((r) => r.name.toLowerCase().includes(q)).slice(0, 10).map(({ id, name }) => ({ id, name })) };
}
export type RoutineService = ReturnType<typeof createRoutineService>;

export function routineRoutes(db: Database, ha: HaApi, secure: boolean, svc: DeviceService, rt: RoutineService) {
  const deny = (set: any, status: number, error: string, extra: object = {}) => { set.status = status; return { error, message: say(error), ...extra }; };
  const scriptEntity = (scriptId: string) => `script.${scriptId}`;

  async function publish(scriptId: string, name: string, sequence: unknown[]) {
    if (ha.isStale()) return { status: 503, error: "ha_unavailable" };
    const w = await ha.config("POST", `/api/config/script/config/${scriptId}`, { alias: name, description: "Managed by Smart Home Companion", mode: "single", sequence });
    if (!w.ok) return { status: 502, error: w.error ?? "ha_rejected" };
    await ha.callService("script", "reload");
    const e = await ha.waitFor((x) => x.entity_id === scriptEntity(scriptId) && x.attributes.friendly_name === name, 3000);
    return e ? { ok: true } : { status: 502, error: "ha_not_loading" };
  }
  const nm = (v: unknown) => { const s = String(v ?? "").trim(); return s && s.length <= 60 ? s : null; };

  return new Elysia({ name: "routines" })
    .get("/api/routines", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const mine = rt.visible(g.user), canManage = g.user.permissions.includes("scenes.manage");
      const done = new Set(rt.rows(g.user.householdId).map((r) => r.template));
      return {
        canManage, routines: mine,
        // Suggestions are clearly separate from configured routines, and only offered to people who can set them up.
        suggested: canManage ? TEMPLATES.filter((t) => !done.has(t.key)).map((t) => ({ ...t, configured: false })) : [],
      };
    })
    .post("/api/routines", async ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, ["scenes.manage", "device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const template = body?.template ?? null, name = nm(body?.name);
      if (!name || (template !== null && !TEMPLATES.some((t) => t.key === template))) return deny(set, 400, "invalid_input");
      if (template && rt.rows(g.user.householdId).some((r) => r.template === template)) return deny(set, 409, "invalid_input");
      const c = rt.compile(g.user, body?.steps);
      if ("error" in c) return deny(set, c.status, c.error, { step: c.step });
      const id = randomUUID(), scriptId = "alice_routine_" + randomBytes(5).toString("hex");
      const r = await publish(scriptId, name, c.sequence);
      if ("error" in r) {
        if (r.error === "not_confirmed" || r.error === "ha_not_loading") { await ha.config("DELETE", `/api/config/script/config/${scriptId}`); await ha.callService("script", "reload"); }
        return deny(set, r.status!, r.error!);
      }
      db.query("INSERT INTO routines (id, household_id, template, name, steps, script_id, created_at) VALUES (?,?,?,?,?,?,?)")
        .run(id, g.user.householdId, template, name, JSON.stringify(c.steps), scriptId, Date.now());
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "routine.create", target: id, outcome: "success" });
      return { ok: true, id };
    })
    .put("/api/routines/:id", async ({ request, params, body, set }: any) => {
      const g = authorize(db, request, secure, ["scenes.manage", "device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row: any = db.query("SELECT * FROM routines WHERE id = ? AND household_id = ?").get(params.id, g.user.householdId);
      if (!row || !svc.accessor(g.user)(`routine:${row.id}`)) return deny(set, 404, "not_found");
      const name = nm(body?.name); if (!name) return deny(set, 400, "invalid_input");
      const c = rt.compile(g.user, body?.steps);
      if ("error" in c) return deny(set, c.status, c.error, { step: c.step });
      const r = await publish(row.script_id, name, c.sequence);
      if ("error" in r) return deny(set, r.status!, r.error!);
      db.query("UPDATE routines SET name = ?, steps = ? WHERE id = ?").run(name, JSON.stringify(c.steps), row.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "routine.update", target: row.id, outcome: "success" });
      return { ok: true };
    })
    .delete("/api/routines/:id", async ({ request, params, set }: any) => {
      const g = authorize(db, request, secure, ["scenes.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row: any = db.query("SELECT * FROM routines WHERE id = ? AND household_id = ?").get(params.id, g.user.householdId);
      if (!row || !svc.accessor(g.user)(`routine:${row.id}`)) return deny(set, 404, "not_found");
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
    .post("/api/routines/:id/run", async ({ request, params, set }: any) => {
      const g = authorize(db, request, secure, ["scene.activate"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row: any = db.query("SELECT * FROM routines WHERE id = ? AND household_id = ?").get(params.id, g.user.householdId);
      if (!row || !svc.accessor(g.user)(`routine:${row.id}`)) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const id = scriptEntity(row.script_id), before = ha.entities.get(id);
      if (!before) return deny(set, 409, "ha_rejected");
      const r = await ha.callService("script", "turn_on", {}, id);
      if (!r.ok) return deny(set, r.error === "ha_unavailable" ? 503 : 409, r.error);
      // HA runs the steps itself. We can only say it was started, never that every step worked.
      return { ok: true, started: true, confirmed: await ha.waitForChange(id, before, 1500) };
    });
}
