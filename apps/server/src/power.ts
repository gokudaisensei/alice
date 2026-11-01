import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { audit } from "./audit";
import { describe } from "./capabilities";
import type { DeviceService } from "./devices";
import { authorize } from "./guard";
import type { HaApi, HaEntity } from "./ha";

/** A reading in watts (kilowatt meters are converted), or null when the meter isn't a power meter or has no number. */
export function wattsOf(e: HaEntity | undefined): number | null {
  if (!e || describe(e).category !== "energy") return null;
  const unit = e.attributes?.unit_of_measurement;
  if (e.attributes?.device_class !== "power" && unit !== "W" && unit !== "kW") return null;
  const v = Number(e.state);
  return Number.isFinite(v) ? (unit === "kW" ? v * 1000 : v) : null;
}
export const isPowerMeter = (e: HaEntity | undefined) => !!e && describe(e).category === "energy" && (e.attributes?.device_class === "power" || ["W", "kW"].includes(e.attributes?.unit_of_measurement));

/** The plug's own on/off switch, found by name ("Kettle Power" → "Kettle" or "Kettle Plug"). Best effort: null when there isn't a clear match. */
export function switchFor(ha: HaApi, sensorId: string): string | null {
  const name = String(ha.entities.get(sensorId)?.attributes?.friendly_name ?? "").trim().toLowerCase();
  const base = name.replace(/\s+power$/, "");
  if (!base || base === name) return null;
  const want = new Set([base, `${base} plug`, base.replace(/\s+plug$/, "")]);
  for (const e of ha.entities.values()) {
    if (!e.entity_id.startsWith("switch.") && !e.entity_id.startsWith("light.")) continue;
    if (want.has(String(e.attributes?.friendly_name ?? "").trim().toLowerCase())) return e.entity_id;
  }
  return null;
}

type Limit = { watts: number; enabled: boolean };
/** Limits held in memory so the rule can check every reading without touching the database. */
export function createPowerLimits(db: Database, now: () => number = Date.now) {
  const cache = new Map<string, Limit>();
  const listeners = new Set<(id: string) => void>();
  try { for (const r of db.query("SELECT entity_id, watts, enabled FROM power_limits").all() as any[]) cache.set(r.entity_id, { watts: r.watts, enabled: !!r.enabled }); } catch { /* a database without the table yet (some tests): no limits */ }
  const tell = (id: string) => { for (const l of listeners) l(id); };
  return {
    get: (id: string) => { const l = cache.get(id); return l?.enabled ? l.watts : undefined; },
    raw: (id: string) => cache.get(id),
    ids: () => [...cache.keys()],
    set(h: string, id: string, watts: number, enabled: boolean) {
      db.query("INSERT INTO power_limits (household_id, entity_id, watts, enabled, updated_at) VALUES (?,?,?,?,?) ON CONFLICT(household_id, entity_id) DO UPDATE SET watts=excluded.watts, enabled=excluded.enabled, updated_at=excluded.updated_at").run(h, id, watts, enabled ? 1 : 0, now());
      cache.set(id, { watts, enabled }); tell(id);
    },
    remove(h: string, id: string) { db.query("DELETE FROM power_limits WHERE household_id = ? AND entity_id = ?").run(h, id); cache.delete(id); tell(id); },
    onChange(fn: (id: string) => void) { listeners.add(fn); return () => listeners.delete(fn); },
  };
}
export type PowerLimits = ReturnType<typeof createPowerLimits>;

/** Setting an alert limit on a plug's power reading. Admins and members; the limit is only ever a number you chose. */
export function powerRoutes(db: Database, ha: HaApi, secure: boolean, limits: PowerLimits, svc: DeviceService) {
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error }; };
  const guard = (req: Request) => authorize(db, req, secure, ["automation.manage"]);
  return new Elysia({ name: "power" })
    .get("/api/power-limits", ({ request, set }: any) => {
      const g = guard(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const ok = svc.accessor(g.user);
      return { limits: limits.ids().filter((id) => ok(id) && ha.entities.has(id)).map((id) => ({ entityId: id, ...limits.raw(id)! })) };
    })
    .put("/api/power-limits/:id", ({ request, params, body, set }: any) => {
      const g = guard(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const e = ha.entities.get(params.id);
      if (!e || !svc.accessor(g.user)(params.id)) return deny(set, 404, "not_found");
      if (!isPowerMeter(e)) return deny(set, 400, "invalid_input");
      const watts = body?.watts, enabled = body?.enabled ?? true;
      if (!Number.isInteger(watts) || watts < 1 || watts > 100_000 || typeof enabled !== "boolean") return deny(set, 400, "invalid_input");
      limits.set(g.user.householdId, params.id, watts, enabled);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "power.limit", target: params.id, outcome: "success", reason: `${watts}W ${enabled ? "on" : "off"}` });
      return { ok: true, entityId: params.id, watts, enabled };
    })
    .delete("/api/power-limits/:id", ({ request, params, set }: any) => {
      const g = guard(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (!svc.accessor(g.user)(params.id)) return deny(set, 404, "not_found");
      limits.remove(g.user.householdId, params.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "power.limit_removed", target: params.id, outcome: "success" });
      return { ok: true };
    });
}
