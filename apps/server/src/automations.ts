import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { audit } from "./audit";
import { authorize } from "./guard";
import { MODES, MODE_ENTITY, type Mode } from "./modes";
import { friendlyName, type HaApi, type HaEntity } from "./ha";
import type { DeviceService } from "./devices";
import type { RoutineService, Step } from "./routines";
import type { SessionUser } from "./session";
import { all, one } from "./sql";
import { asList, asObject, cleanName, denyWith as deny, oneOf, type Failure, type StatusSetter } from "./http";

type AutomationRow = { id: string; household_id: string; name: string; triggers: string; conditions: string; actions: string; ha_id: string; created_at: number };
type Outcome = Failure | { ok: true };

export const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const DAY_NAME: Record<string, string> = { mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun" };
export const STATES = ["on", "off", "locked", "unlocked", "playing", "paused", "idle", "home", "not_home"] as const;

export type Trigger =
  | { type: "device_state"; entityId: string; to: string; forSeconds?: number }
  | { type: "sensor"; entityId: string; above?: number; below?: number; forSeconds?: number }
  | { type: "time"; at: string }
  | { type: "sun"; event: "sunrise" | "sunset"; offsetMinutes?: number }
  | { type: "mode"; mode: string };
export type Condition =
  | { type: "device_state"; entityId: string; is: string }
  | { type: "sensor"; entityId: string; above?: number; below?: number }
  | { type: "time"; after: string; before: string }
  | { type: "mode"; mode: string }
  | { type: "days"; days: string[] };

/** A starting point: when it runs, and which of the home's real devices it acts on. */
type Recipe = { lights?: "turn_on" | "turn_off"; plugs?: "turn_off" };
export type AutomationTemplate = { key: string; name: string; blurb: string; triggers: Trigger[]; conditions: Condition[]; recipe: Recipe };

/** Starting points only. Nothing is configured, and nothing runs, until a person finishes and saves one. */
export const AUTOMATION_TEMPLATES: readonly AutomationTemplate[] = [
  { key: "bedtime_off", name: "Switch things off at bedtime", blurb: "Every night at 23:00, turn off the lights and plugs.", triggers: [{ type: "time", at: "23:00" }], conditions: [], recipe: { lights: "turn_off", plugs: "turn_off" } },
  { key: "sunset_on", name: "Lights on at sunset", blurb: "When it gets dark, turn on the lights.", triggers: [{ type: "sun", event: "sunset" }], conditions: [], recipe: { lights: "turn_on" } },
  { key: "away_off", name: "Switch things off when away", blurb: "When the house is set to Away, turn off the lights and plugs.", triggers: [{ type: "mode", mode: "away" }], conditions: [], recipe: { lights: "turn_off", plugs: "turn_off" } },
];

const hhmm = (v: unknown): v is string => typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && Math.abs(v) <= 1_000_000;
const dur = (v: unknown): v is number | undefined => v === undefined || (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 86_400);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const hms = (t: string) => `${t}:00`;
const isMode = (m: unknown): m is Mode => oneOf(MODES, m);

/** Optional numeric `above`/`below` limits: at least one, both finite, and `above` under `below` when both are given. */
function bounds(a: unknown, b: unknown): { above?: number; below?: number } | null {
  if (a !== undefined && !num(a)) return null;
  if (b !== undefined && !num(b)) return null;
  if (a === undefined && b === undefined) return null;
  if (a !== undefined && b !== undefined && a >= b) return null;
  return { ...(a !== undefined && { above: a }), ...(b !== undefined && { below: b }) };
}

type Bad = { status: number; error: string; where: "trigger" | "condition" | "action"; index: number };
export type Compiled = { triggers: Trigger[]; conditions: Condition[]; actions: Step[]; ha: { triggers: unknown[]; conditions: unknown[]; actions: unknown[] } };

export function createAutomationService(db: Database, ha: HaApi, svc: DeviceService, rt: RoutineService) {
  const nameOf = (id: string) => friendlyName(ha.entities.get(id), "an unavailable device");
  const unitOf = (id: string) => { const u = ha.entities.get(id)?.attributes.unit_of_measurement; return u ? String(u) : ""; };
  const span = (s: number) => (s % 3600 === 0 ? `${s / 3600} hour${s === 3600 ? "" : "s"}` : s % 60 === 0 ? `${s / 60} minute${s === 60 ? "" : "s"}` : `${s} seconds`);
  const range = (id: string, a?: number, b?: number) => {
    const u = unitOf(id);
    return a !== undefined && b !== undefined ? `is between ${a}${u} and ${b}${u}` : a !== undefined ? `is above ${a}${u}` : `is below ${b}${u}`;
  };

  /** One plain-language phrase per trigger or condition, derived from what is saved. */
  const triggerText = (t: Trigger): string =>
    t.type === "device_state" ? `${nameOf(t.entityId)} ${t.forSeconds ? `stays ${t.to} for ${span(t.forSeconds)}` : `turns ${t.to}`}`
    : t.type === "sensor" ? `${nameOf(t.entityId)} ${t.above !== undefined && t.below === undefined ? "goes above " + t.above + unitOf(t.entityId) : t.below !== undefined && t.above === undefined ? "goes below " + t.below + unitOf(t.entityId) : range(t.entityId, t.above, t.below)}${t.forSeconds ? ` for ${span(t.forSeconds)}` : ""}`
    : t.type === "time" ? `it is ${t.at}`
    : t.type === "sun" ? (t.offsetMinutes ? `${Math.abs(t.offsetMinutes)} minutes ${t.offsetMinutes < 0 ? "before" : "after"} ${t.event}` : t.event === "sunset" ? "the sun sets" : "the sun rises")
    : `the household mode changes to ${cap(t.mode)}`;
  const conditionText = (c: Condition): string =>
    c.type === "device_state" ? `${nameOf(c.entityId)} is ${c.is}`
    : c.type === "sensor" ? `${nameOf(c.entityId)} ${range(c.entityId, c.above, c.below)}`
    : c.type === "time" ? `the time is between ${c.after} and ${c.before}`
    : c.type === "mode" ? `the household mode is ${cap(c.mode)}`
    : c.days.join() === "mon,tue,wed,thu,fri" ? "it is a weekday" : c.days.join() === "sat,sun" ? "it is a weekend day" : `it is ${c.days.map((d) => DAY_NAME[d]).join(", ")}`;
  const summarise = (t: Trigger[], c: Condition[], a: Step[]) =>
    `When ${t.map(triggerText).join(" or ")}${c.length ? `, and only if ${c.map(conditionText).join(" and ")}` : ""}: ${a.map((x, i) => (i ? rt.text(x).replace(/^./, (c) => c.toLowerCase()) : rt.text(x))).join(", then ")}`;

  const usable = (u: SessionUser, id: unknown): HaEntity | null => {
    const e = typeof id === "string" ? ha.entities.get(id) : undefined;
    return e && svc.accessor(u)(e.entity_id) && svc.deviceFor(u, e.entity_id) ? e : null;
  };

  /** Check what the author may use, and translate to Home Assistant's automation format. */
  function compile(u: SessionUser, body: unknown): Compiled | Bad {
    const input = asObject(body), T = asList(input.triggers), C = asList(input.conditions ?? []);
    if (!T || T.length < 1 || T.length > 5) return { status: 400, error: "invalid_trigger", where: "trigger", index: 0 };
    if (!C || C.length > 5) return { status: 400, error: "invalid_condition", where: "condition", index: 0 };
    const triggers: Trigger[] = [], conditions: Condition[] = [], hT: unknown[] = [], hC: unknown[] = [];
    for (const [i, raw] of T.entries()) {
      const bad = (error = "invalid_trigger", status = 400): Bad => ({ status, error, where: "trigger", index: i });
      const t = asObject(raw); // anything that isn't an object has no `type`, and falls through to bad()
      if (t.type === "device_state") {
        const e = usable(u, t.entityId); if (!e) return bad("not_found", 404);
        const to = t.to, forSeconds = t.forSeconds;
        if (!oneOf(STATES, to) || !dur(forSeconds)) return bad();
        triggers.push({ type: "device_state", entityId: e.entity_id, to, ...(forSeconds ? { forSeconds } : {}) });
        hT.push({ trigger: "state", entity_id: e.entity_id, to, ...(forSeconds ? { for: { seconds: forSeconds } } : {}) });
      } else if (t.type === "sensor") {
        const e = usable(u, t.entityId); if (!e || !e.entity_id.startsWith("sensor.")) return bad("not_found", 404);
        const limits = bounds(t.above, t.below), forSeconds = t.forSeconds;
        if (!limits || !dur(forSeconds)) return bad();
        triggers.push({ type: "sensor", entityId: e.entity_id, ...limits, ...(forSeconds ? { forSeconds } : {}) });
        hT.push({ trigger: "numeric_state", entity_id: e.entity_id, ...limits, ...(forSeconds ? { for: { seconds: forSeconds } } : {}) });
      } else if (t.type === "time") {
        const at = t.at;
        if (!hhmm(at)) return bad();
        triggers.push({ type: "time", at }); hT.push({ trigger: "time", at: hms(at) });
      } else if (t.type === "sun") {
        const event = t.event, off = t.offsetMinutes ?? 0;
        if ((event !== "sunrise" && event !== "sunset") || typeof off !== "number" || !Number.isInteger(off) || Math.abs(off) > 180) return bad();
        triggers.push({ type: "sun", event, ...(off ? { offsetMinutes: off } : {}) });
        const m = Math.abs(off);
        hT.push({ trigger: "sun", event, offset: `${off < 0 ? "-" : ""}${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}:00` });
      } else if (t.type === "mode") {
        const mode = t.mode;
        if (!isMode(mode)) return bad();
        triggers.push({ type: "mode", mode }); hT.push({ trigger: "state", entity_id: MODE_ENTITY, to: mode });
      } else return bad();
    }
    for (const [i, raw] of C.entries()) {
      const bad = (error = "invalid_condition", status = 400): Bad => ({ status, error, where: "condition", index: i });
      const c = asObject(raw);
      if (c.type === "device_state") {
        const e = usable(u, c.entityId); if (!e) return bad("not_found", 404);
        const is = c.is;
        if (!oneOf(STATES, is)) return bad();
        conditions.push({ type: "device_state", entityId: e.entity_id, is }); hC.push({ condition: "state", entity_id: e.entity_id, state: is });
      } else if (c.type === "sensor") {
        const e = usable(u, c.entityId); if (!e || !e.entity_id.startsWith("sensor.")) return bad("not_found", 404);
        const limits = bounds(c.above, c.below);
        if (!limits) return bad();
        conditions.push({ type: "sensor", entityId: e.entity_id, ...limits });
        hC.push({ condition: "numeric_state", entity_id: e.entity_id, ...limits });
      } else if (c.type === "time") {
        const { after, before } = c;
        if (!hhmm(after) || !hhmm(before) || after === before) return bad();
        conditions.push({ type: "time", after, before }); hC.push({ condition: "time", after: hms(after), before: hms(before) });
      } else if (c.type === "mode") {
        const mode = c.mode;
        if (!isMode(mode)) return bad();
        conditions.push({ type: "mode", mode }); hC.push({ condition: "state", entity_id: MODE_ENTITY, state: mode });
      } else if (c.type === "days") {
        const chosen = asList(c.days);
        if (!chosen || chosen.length < 1 || !chosen.every((d) => oneOf(DAYS, d))) return bad();
        const days = DAYS.filter((d) => chosen.includes(d));
        if (days.length < 7) { conditions.push({ type: "days", days: [...days] }); hC.push({ condition: "time", weekday: [...days] }); } // every day means no restriction
      } else return bad();
    }
    const a = rt.compile(u, input.actions);
    if ("error" in a) return { status: a.status, error: a.error, where: "action", index: a.step ?? 0 };
    return { triggers, conditions, actions: a.steps, ha: { triggers: hT, conditions: hC, actions: a.sequence } };
  }

  const rows = (h: string) => all<AutomationRow>(db, "SELECT * FROM automations WHERE household_id = ? ORDER BY created_at", h);
  const parsed = (r: Pick<AutomationRow, "triggers" | "conditions" | "actions">) => ({ triggers: JSON.parse(r.triggers) as Trigger[], conditions: JSON.parse(r.conditions) as Condition[], actions: JSON.parse(r.actions) as Step[] });
  /** Every device or scene id an automation touches. */
  const refs = (p: ReturnType<typeof parsed>) => [...p.triggers, ...p.conditions].flatMap((x) => ("entityId" in x ? [x.entityId] : []))
    .concat(p.actions.flatMap((s) => (s.type === "device" || s.type === "scene" ? [s.entityId] : [])));
  const entityOf = (r: Pick<AutomationRow, "ha_id">) => [...ha.entities.values()].find((e) => e.entity_id.startsWith("automation.") && e.attributes.id === r.ha_id);

  /** Someone sees an automation only if they could use everything it touches. */
  const mine = (u: SessionUser, id: string) => {
    const r = one<AutomationRow>(db, "SELECT * FROM automations WHERE id = ? AND household_id = ?", id, u.householdId);
    if (!r) return null;
    const ok = svc.accessor(u);
    return refs(parsed(r)).every(ok) ? r : null;
  };
  function view(r: AutomationRow) {
    const p = parsed(r), e = entityOf(r);
    const missing = refs(p).some((id) => !ha.entities.has(id));
    const lt = e?.attributes.last_triggered;
    return {
      id: r.id, name: r.name, summary: summarise(p.triggers, p.conditions, p.actions),
      triggers: p.triggers.map((t) => ({ ...t, text: triggerText(t) })), conditions: p.conditions.map((c) => ({ ...c, text: conditionText(c) })),
      actions: p.actions.map((s) => ({ ...s, text: rt.text(s) })),
      // null = Home Assistant doesn't currently list it, so we can't say whether it is on
      enabled: e ? e.state === "on" : null, lastTriggered: typeof lt === "string" && lt !== "null" ? lt : null,
      needsAttention: missing || !e,
    };
  }
  const visible = (u: SessionUser) => rows(u.householdId).filter((r) => mine(u, r.id)).map(view);
  /** The templates with real actions filled in from the devices this person may use, or a plain note on what is missing. */
  const suggest = (u: SessionUser) => AUTOMATION_TEMPLATES.map(({ recipe, ...t }) => {
    const r = rt.resolve(u, { ...recipe, mode: undefined });
    return { ...t, actions: r.steps, complete: r.complete, missing: r.missing, summary: summarise(t.triggers, t.conditions, r.steps), configured: false };
  });
  return { compile, summarise, suggest, rows, mine, view, visible, entityOf, parsed };
}
export type AutomationService = ReturnType<typeof createAutomationService>;

export function automationRoutes(db: Database, ha: HaApi, secure: boolean, svc: AutomationService) {
  const cfgPath = (id: string) => `/api/config/automation/config/${id}`;

  async function publish(haId: string, name: string, c: Compiled): Promise<Outcome> {
    if (ha.isStale()) return { status: 503, error: "ha_unavailable" };
    const w = await ha.config("POST", cfgPath(haId), { alias: name, description: "Managed by Smart Home Companion", mode: "single", max_exceeded: "silent", triggers: c.ha.triggers, conditions: c.ha.conditions, actions: c.ha.actions });
    if (!w.ok) return { status: 502, error: w.error ?? "ha_rejected" };
    await ha.callService("automation", "reload");
    const e = await ha.waitFor((x) => x.entity_id.startsWith("automation.") && x.attributes.id === haId && x.attributes.friendly_name === name, 3000);
    return e ? { ok: true } : { status: 502, error: "ha_not_loading" }; // saved, but the hub never loaded it
  }
  async function unpublish(haId: string) { await ha.config("DELETE", cfgPath(haId)); await ha.callService("automation", "reload"); }
  /** Switch on/off and wait for Home Assistant to say it took. */
  async function setEnabled(haId: string, enabled: boolean): Promise<Outcome> {
    const e = [...ha.entities.values()].find((x) => x.entity_id.startsWith("automation.") && x.attributes.id === haId);
    if (!e) return { status: 409, error: "ha_rejected" };
    const r = await ha.callService("automation", enabled ? "turn_on" : "turn_off", {}, e.entity_id);
    if (!r.ok) return { status: r.error === "ha_unavailable" ? 503 : 409, error: r.error };
    const done = await ha.waitFor((x) => x.entity_id === e.entity_id && x.state === (enabled ? "on" : "off"), 3000);
    return done ? { ok: true } : { status: 502, error: "not_confirmed" };
  }
  const bodyErr = (set: StatusSetter, c: Bad) => deny(set, c.status, c.error, { where: c.where, index: c.index });
  const log = (u: SessionUser, action: string, target: string) => audit(db, { householdId: u.householdId, actorType: "user", actorId: u.id, action, target, outcome: "success" });

  async function create(u: SessionUser, name: string, c: Compiled, enabled: boolean): Promise<Failure | { ok: true; id: string }> {
    const id = randomUUID(), haId = "alice_auto_" + randomBytes(5).toString("hex");
    let r = await publish(haId, name, c);
    if (!("error" in r) && !enabled) r = await setEnabled(haId, false);
    if ("error" in r) { if (r.error === "not_confirmed" || r.error === "ha_not_loading" || enabled === false) await unpublish(haId); return r; }
    db.query("INSERT INTO automations (id, household_id, name, triggers, conditions, actions, ha_id, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, u.householdId, name, JSON.stringify(c.triggers), JSON.stringify(c.conditions), JSON.stringify(c.actions), haId, Date.now());
    return { ok: true, id };
  }

  return new Elysia({ name: "automations" })
    .get("/api/automations", ({ request, set }) => {
      const g = authorize(db, request, secure, ["automation.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { automations: svc.visible(g.user), suggested: svc.suggest(g.user) };
    })
    .get("/api/automations/:id", ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["automation.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const r = svc.mine(g.user, params.id); return r ? svc.view(r) : deny(set, 404, "not_found");
    })
    // Validates and explains without touching Home Assistant, so the builder can show the sentence as people edit.
    .post("/api/automations/preview", ({ request, body, set }) => {
      const g = authorize(db, request, secure, ["automation.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const c = svc.compile(g.user, body);
      return "error" in c ? bodyErr(set, c) : { ok: true, summary: svc.summarise(c.triggers, c.conditions, c.actions) };
    })
    .post("/api/automations", async ({ request, body, set }) => {
      const g = authorize(db, request, secure, ["automation.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const name = cleanName(asObject(body).name); if (!name) return deny(set, 400, "invalid_input");
      const c = svc.compile(g.user, body); if ("error" in c) return bodyErr(set, c);
      const r = await create(g.user, name, c, asObject(body).enabled !== false);
      if ("error" in r) return deny(set, r.status, r.error);
      log(g.user, "automation.create", r.id);
      return { ok: true, id: r.id };
    })
    .put("/api/automations/:id", async ({ request, params, body, set }) => {
      const g = authorize(db, request, secure, ["automation.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = svc.mine(g.user, params.id); if (!row) return deny(set, 404, "not_found");
      const name = cleanName(asObject(body).name); if (!name) return deny(set, 400, "invalid_input");
      const c = svc.compile(g.user, body); if ("error" in c) return bodyErr(set, c);
      const wasOff = svc.entityOf(row)?.state === "off";
      let r = await publish(row.ha_id, name, c);
      if (!("error" in r) && wasOff) r = await setEnabled(row.ha_id, false); // editing never switches it back on
      if ("error" in r) return deny(set, r.status, r.error);
      db.query("UPDATE automations SET name = ?, triggers = ?, conditions = ?, actions = ? WHERE id = ?")
        .run(name, JSON.stringify(c.triggers), JSON.stringify(c.conditions), JSON.stringify(c.actions), row.id);
      log(g.user, "automation.update", row.id);
      return { ok: true };
    })
    .post("/api/automations/:id/enabled", async ({ request, params, body, set }) => {
      const g = authorize(db, request, secure, ["automation.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = svc.mine(g.user, params.id); if (!row) return deny(set, 404, "not_found");
      const enabled = asObject(body).enabled;
      if (typeof enabled !== "boolean") return deny(set, 400, "invalid_input");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const r = await setEnabled(row.ha_id, enabled);
      if ("error" in r) return deny(set, r.status, r.error);
      log(g.user, enabled ? "automation.enable" : "automation.disable", row.id);
      return { ok: true, enabled };
    })
    // "Try it now": run the steps once, ignoring the trigger and conditions. Home Assistant does the work.
    .post("/api/automations/:id/run", async ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["automation.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = svc.mine(g.user, params.id); if (!row) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const e = svc.entityOf(row); if (!e) return deny(set, 409, "ha_rejected");
      const r = await ha.callService("automation", "trigger", { skip_condition: true }, e.entity_id);
      if (!r.ok) return deny(set, r.error === "ha_unavailable" ? 503 : 409, r.error);
      log(g.user, "automation.run", row.id);
      return { ok: true, started: true };
    })
    .post("/api/automations/:id/duplicate", async ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["automation.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = svc.mine(g.user, params.id); if (!row) return deny(set, 404, "not_found");
      const c = svc.compile(g.user, svc.parsed(row)); if ("error" in c) return bodyErr(set, c);
      const name = `${row.name.slice(0, 52)} (copy)`;
      const r = await create(g.user, name, c, false); // a copy starts switched off, so nothing doubles up by surprise
      if ("error" in r) return deny(set, r.status, r.error);
      log(g.user, "automation.duplicate", r.id);
      return { ok: true, id: r.id };
    })
    .delete("/api/automations/:id", async ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["automation.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = svc.mine(g.user, params.id); if (!row) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const w = await ha.config("DELETE", cfgPath(row.ha_id));
      if (!w.ok) return deny(set, 502, w.error ?? "ha_rejected");
      await ha.callService("automation", "reload");
      db.query("DELETE FROM automations WHERE id = ?").run(row.id);
      log(g.user, "automation.delete", row.id);
      return { ok: true };
    });
}
