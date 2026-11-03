import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { activity, audit } from "./audit";
import { describe } from "./capabilities";
import { authorize } from "./guard";
import { friendlyName, haError, type HaApi } from "./ha";
import { all, one } from "./sql";
import { asObject, denyWith as deny } from "./http";

const ASSISTANTS = ["cloud.alexa", "cloud.google_assistant"];
const ALLOWED = ["light", "switch", "fan", "climate", "media"]; // never locks, cameras, covers or sensors

/** Which things may be controlled by voice through Home Assistant Cloud. Nothing is on until a household admin turns it on, one item at a time. */
export function voiceRoutes(db: Database, ha: HaApi, secure: boolean) {
  function candidates(h: string) {
    const out = new Map<string, { id: string; name: string; kind: "device" | "scene" | "routine" }>();
    for (const e of ha.entities.values()) {
      if (e.entity_id.startsWith("scene.")) out.set(e.entity_id, { id: e.entity_id, name: friendlyName(e), kind: "scene" });
      else if (!e.entity_id.startsWith("script.") && !e.entity_id.startsWith("automation.")) {
        const d = describe(e);
        if (d.ordinary && ALLOWED.includes(d.category)) out.set(e.entity_id, { id: e.entity_id, name: one<{ name: string }>(db, "SELECT name FROM device_meta WHERE household_id = ? AND entity_id = ? AND name != ''", h, e.entity_id)?.name ?? d.name, kind: "device" });
      }
    }
    for (const r of all<{ name: string; script_id: string }>(db, "SELECT name, script_id FROM routines WHERE household_id = ?", h)) out.set(`script.${r.script_id}`, { id: `script.${r.script_id}`, name: r.name, kind: "routine" });
    return out;
  }
  return new Elysia({ name: "voice" })
    .get("/api/admin/voice", async ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const on = new Set(all<{ entity_id: string }>(db, "SELECT entity_id FROM voice_exposure WHERE household_id = ?", g.user.householdId).map((r) => r.entity_id));
      const cs = await ha.ws({ type: "cloud/status" });
      return {
        cloud: cs.success ? { loggedIn: !!asObject(cs.result).logged_in } : null,
        items: [...candidates(g.user.householdId).values()].map((c) => ({ ...c, enabled: on.has(c.id) })).sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .put("/api/admin/voice", async ({ request, body, set }) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const { entityId, enabled } = asObject(body);
      const c = typeof entityId === "string" ? candidates(g.user.householdId).get(entityId) : undefined;
      if (!c || typeof enabled !== "boolean") return deny(set, c === undefined && typeof entityId === "string" ? 404 : 400, c === undefined ? "not_found" : "invalid_input");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const r = await ha.ws({ type: "homeassistant/expose_entity", assistants: ASSISTANTS, entity_ids: [c.id], should_expose: enabled });
      if (!r.success) return deny(set, 502, haError(r)); // Home Assistant is the source of truth: if it didn't accept, nothing is recorded
      if (enabled) db.query("INSERT OR IGNORE INTO voice_exposure (household_id, entity_id) VALUES (?,?)").run(g.user.householdId, c.id);
      else db.query("DELETE FROM voice_exposure WHERE household_id = ? AND entity_id = ?").run(g.user.householdId, c.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: enabled ? "voice.enable" : "voice.disable", target: c.id, outcome: "success" });
      activity(db, g.user.householdId, "voice", `Voice control ${enabled ? "turned on" : "turned off"} for ${c.name}`);
      return { ok: true };
    });
}
