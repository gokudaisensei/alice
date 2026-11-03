import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { audit } from "./audit";
import { authorize } from "./guard";
import { friendlyName, type HaApi } from "./ha";
import type { AutomationService } from "./automations";
import type { DeviceService } from "./devices";
import { asObject, denyWith as deny } from "./http";
import { all } from "./sql";

type Run = { run_id?: string; timestamp?: { start?: string; finish?: string | null }; script_execution?: string | null; state?: string; error?: string | null };
type Step = { result?: { result?: boolean } };
type TraceGet = { trace?: Record<string, Step[]> };
export type Outcome = "ran" | "skipped" | "stopped" | "error";
export type TraceRun = { at: number; outcome: Outcome; why: string | null };

/** A run's ending, in words. `script_execution` is how Home Assistant says how it ended. */
const outcomeOf = (x: string | null | undefined): Outcome =>
  x === "finished" ? "ran" : x === "failed_conditions" || x === "failed_single" || x === "failed_max_runs" ? "skipped" : x === "error" ? "error" : "stopped";

/** Which condition stopped a run: the first step the hub recorded as false. Conditions are saved in the order they were written. */
export const failedCondition = (t: TraceGet | null): number | null => {
  for (const [key, steps] of Object.entries(t?.trace ?? {})) {
    const m = /^condition\/(\d+)(?:\/|$)/.exec(key);
    if (m && steps.some((s) => s.result?.result === false)) return Number(m[1]);
  }
  return null;
};

/** The "why" behind an automation, its use by other things, and the hub's own automations and scripts: what Home Assistant knows that this app does not. */
export function automationInsightRoutes(db: Database, ha: HaApi, secure: boolean, svc: AutomationService, devices: DeviceService) {
  const manage = (req: Request) => authorize(db, req, secure, ["automation.manage"]);
  const managedIds = (h: string) => new Set(all<{ ha_id: string }>(db, "SELECT ha_id FROM automations WHERE household_id = ?", h).map((r) => r.ha_id));
  const managedScripts = (h: string) => new Set(all<{ script_id: string }>(db, "SELECT script_id FROM routines WHERE household_id = ?", h).map((r) => `script.${r.script_id}`));
  const lastTriggered = (e: { attributes: Record<string, unknown> }) => (typeof e.attributes.last_triggered === "string" && e.attributes.last_triggered !== "null" ? e.attributes.last_triggered : null);

  return new Elysia({ name: "automation-insight" })
    // "Why didn't it run?" The hub keeps a trace of every time an automation woke up; this reads the last few.
    .get("/api/automations/:id/trace", async ({ request, params, set }) => {
      const g = manage(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row = svc.mine(g.user, params.id); if (!row) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const e = svc.entityOf(row);
      const l = await ha.ws({ type: "trace/list", domain: "automation", item_id: row.ha_id });
      if (!l.success || !Array.isArray(l.result)) return deny(set, 502, "ha_rejected");
      const conditions = svc.parsed(row).conditions;
      const recent = (l.result as Run[]).filter((r) => r.timestamp?.start).sort((a, b) => Date.parse(b.timestamp!.start!) - Date.parse(a.timestamp!.start!)).slice(0, 5);
      const runs: TraceRun[] = await Promise.all(recent.map(async (r) => {
        const outcome = outcomeOf(r.script_execution), at = Date.parse(r.timestamp!.start!);
        if (r.script_execution === "failed_conditions") {
          const t = await ha.ws({ type: "trace/get", domain: "automation", item_id: row.ha_id, run_id: r.run_id });
          const i = failedCondition(t.success ? (t.result as TraceGet) : null), c = i === null ? undefined : conditions[i];
          return { at, outcome, why: c ? `It started, but ${svc.conditionText(c)} wasn't true.` : "It started, but one of its limits wasn't met." };
        }
        if (outcome === "skipped") return { at, outcome, why: "It was already running, so this start was ignored." };
        if (outcome === "error") return { at, outcome, why: "One of its steps failed. A device may have been offline." };
        if (outcome === "stopped") return { at, outcome, why: "It was stopped before it finished." };
        return { at, outcome, why: null };
      }));
      const on = e?.state === "on";
      const summary = !e ? "The home hub isn't listing this automation right now."
        : !on ? "It is switched off, so it won't run."
        : !runs.length ? "It hasn't started yet: nothing has matched what it waits for."
        : runs[0]!.outcome === "ran" ? "It last ran as it should."
        : runs[0]!.why ?? "Its last start didn't finish.";
      return { enabled: e ? on : null, summary, runs };
    })
    // What else uses this device, so hiding or renaming it holds no surprise.
    .get("/api/devices/:id/used-by", async ({ request, params, set }) => {
      const g = manage(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (!devices.deviceFor(g.user, params.id)) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const r = await ha.ws({ type: "search/related", item_type: "entity", item_id: params.id });
      if (!r.success || !r.result || typeof r.result !== "object") return { items: [] };
      const mine = managedIds(g.user.householdId), found = r.result as Record<string, unknown>;
      const items = (["automation", "script", "scene"] as const).flatMap((kind) => {
        const list = Array.isArray(found[kind]) ? (found[kind] as unknown[]).filter((x): x is string => typeof x === "string") : [];
        return list.map((ref) => {
          // Home Assistant answers with entity ids, or with the id an item was saved under; both lead to the same thing.
          const e = ha.entities.get(ref) ?? [...ha.entities.values()].find((x) => x.entity_id.startsWith(kind + ".") && x.attributes.id === ref);
          return { kind, name: friendlyName(e, ref), madeHere: !!e && typeof e.attributes.id === "string" && (mine.has(e.attributes.id) || e.attributes.id.startsWith("alice_")) };
        });
      });
      return { items };
    })
    // The people the hub knows, for "when someone arrives home".
    .get("/api/automations/people", ({ request, set }) => {
      const g = manage(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { people: svc.persons().map((id) => ({ id, name: friendlyName(ha.entities.get(id), id), home: ha.entities.get(id)?.state === "home" })) };
    })
    // Automations and scripts made in Home Assistant itself: shown, switched and started here, never edited here.
    .get("/api/automations/native", ({ request, set }) => {
      const g = manage(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const ok = devices.accessor(g.user), mine = managedIds(g.user.householdId), scripts = managedScripts(g.user.householdId);
      const list = [...ha.entities.values()].filter((e) => ok(e.entity_id));
      return {
        automations: list.filter((e) => e.entity_id.startsWith("automation.") && !mine.has(String(e.attributes.id)) && !String(e.attributes.id ?? "").startsWith("alice_"))
          .map((e) => ({ id: e.entity_id, name: friendlyName(e), enabled: e.state === "on", lastTriggered: lastTriggered(e) })).sort((a, b) => a.name.localeCompare(b.name)),
        scripts: list.filter((e) => e.entity_id.startsWith("script.") && !scripts.has(e.entity_id) && !e.entity_id.startsWith("script.alice_") && !String(e.attributes.id ?? "").startsWith("alice_"))
          .map((e) => ({ id: e.entity_id, name: friendlyName(e), running: e.state === "on", lastTriggered: lastTriggered(e) })).sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .post("/api/automations/native/run", async ({ request, body, set }) => {
      const g = manage(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const id = asObject(body).entityId;
      if (typeof id !== "string" || !/^(automation|script)\./.test(id) || !ha.entities.has(id) || !devices.accessor(g.user)(id)) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const r = id.startsWith("script.") ? await ha.callService("script", "turn_on", {}, id) : await ha.callService("automation", "trigger", { skip_condition: true }, id);
      if (!r.ok) return deny(set, r.error === "ha_unavailable" ? 503 : 409, r.error);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "ha_native.run", target: id, outcome: "success" });
      return { ok: true, started: true };
    })
    .post("/api/automations/native/enabled", async ({ request, body, set }) => {
      const g = manage(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const b = asObject(body), id = b.entityId;
      if (typeof id !== "string" || !id.startsWith("automation.") || !ha.entities.has(id) || !devices.accessor(g.user)(id)) return deny(set, 404, "not_found");
      if (typeof b.enabled !== "boolean") return deny(set, 400, "invalid_input");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const r = await ha.callService("automation", b.enabled ? "turn_on" : "turn_off", {}, id);
      if (!r.ok) return deny(set, r.error === "ha_unavailable" ? 503 : 409, r.error);
      const done = await ha.waitFor((x) => x.entity_id === id && x.state === (b.enabled ? "on" : "off"), 3000);
      if (!done) return deny(set, 502, "not_confirmed");
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: b.enabled ? "ha_native.enable" : "ha_native.disable", target: id, outcome: "success" });
      return { ok: true, enabled: b.enabled };
    });
}
