import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { authorize } from "./guard";
import type { HaApi } from "./ha";
import type { DeviceService } from "./devices";
import { denyWith as deny } from "./http";

type Row = {
  when?: number | string; name?: string; message?: string; state?: string; entity_id?: string;
  context_event_type?: string; context_domain?: string; context_service?: string; context_name?: string; context_entity_id_name?: string; context_user_id?: string | null;
};
export type Origin = { kind: "automation" | "script" | "app" | "device"; name: string | null };

/**
 * Who or what made a change, in words a household can use. A person is never named: someone using an app is "from an app",
 * the same rule as everywhere else in this product.
 */
export function originOf(r: Row): Origin {
  if (r.context_event_type === "automation_triggered") return { kind: "automation", name: r.context_name ?? r.context_entity_id_name ?? null };
  if (r.context_domain === "script") return { kind: "script", name: r.context_entity_id_name ?? r.context_name ?? null };
  if (r.context_user_id || r.context_service) return { kind: "app", name: null };
  return { kind: "device", name: null };
}

/** Rows that carry only a state ("on", "playing") are put in a sentence. */
const said = (s: string | undefined) => (!s ? "changed" : s === "on" ? "turned on" : s === "off" ? "turned off" : s === "unavailable" ? "went offline" : s === "unknown" ? "lost its reading" : `is now ${s.replace(/_/g, " ")}`);

const MAX_ENTITIES = 300, MAX_EVENTS = 100;

/** Home Assistant's logbook for the devices this person can see: what changed, and what caused it. */
export function logbookRoutes(db: Database, ha: HaApi, secure: boolean, svc: DeviceService, now: () => number = Date.now) {
  return new Elysia({ name: "logbook" }).get("/api/logbook", async ({ request, query, set }) => {
    const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
    const hours = Math.min(72, Math.max(1, Math.round(Number(query.hours ?? 24)) || 24));
    if (ha.isStale()) return deny(set, 503, "ha_unavailable");
    const views = new Map(svc.visibleDevices(g.user).map((d) => [d.id, d]));
    const entityIds = [...views.keys()].slice(0, MAX_ENTITIES);
    if (!entityIds.length) return { events: [] };
    const r = await ha.ws({ type: "logbook/get_events", start_time: new Date(now() - hours * 3600_000).toISOString(), end_time: new Date(now()).toISOString(), entity_ids: entityIds });
    if (!r.success || !Array.isArray(r.result)) return deny(set, 502, "ha_rejected");
    const stamp = (v: Row["when"]) => (typeof v === "number" ? (v < 1e11 ? v * 1000 : v) : Date.parse(String(v ?? "")));
    const events = (r.result as Row[]).flatMap((x) => {
      const v = x.entity_id ? views.get(x.entity_id) : undefined, at = stamp(x.when);
      return v && Number.isFinite(at) ? [{ at, id: v.id, name: v.name, message: x.message ?? said(x.state), origin: originOf(x) }] : [];
    }).sort((a, b) => b.at - a.at).slice(0, MAX_EVENTS);
    return { events };
  });
}
