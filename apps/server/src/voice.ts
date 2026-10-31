import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { activity, audit } from "./audit";
import { describe } from "./capabilities";
import { authorize } from "./guard";
import { say } from "./messages";
import type { HaApi } from "./ha";

const ASSISTANTS = ["cloud.alexa", "cloud.google_assistant"];
const ALLOWED = ["light", "switch", "fan", "climate", "media"]; // never locks, cameras, covers or sensors

/** Which things may be controlled by voice through Home Assistant Cloud. Nothing is on until a household admin turns it on, one item at a time. */
export function voiceRoutes(db: Database, ha: HaApi, secure: boolean) {
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error, message: say(error) }; };
  function candidates(h: string) {
    const out = new Map<string, { id: string; name: string; kind: "device" | "scene" | "routine" }>();
    for (const e of ha.entities.values()) {
      if (e.entity_id.startsWith("scene.")) out.set(e.entity_id, { id: e.entity_id, name: String(e.attributes.friendly_name ?? e.entity_id), kind: "scene" });
      else if (!e.entity_id.startsWith("script.") && !e.entity_id.startsWith("automation.")) {
        const d = describe(e);
        if (d.ordinary && ALLOWED.includes(d.category)) out.set(e.entity_id, { id: e.entity_id, name: (db.query("SELECT name FROM device_meta WHERE household_id = ? AND entity_id = ? AND name != ''").get(h, e.entity_id) as any)?.name ?? d.name, kind: "device" });
      }
    }
    for (const r of db.query("SELECT name, script_id FROM routines WHERE household_id = ?").all(h) as any[]) out.set(`script.${r.script_id}`, { id: `script.${r.script_id}`, name: r.name, kind: "routine" });
    return out;
  }
  return new Elysia({ name: "voice" })
    .get("/api/admin/voice", async ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const on = new Set((db.query("SELECT entity_id FROM voice_exposure WHERE household_id = ?").all(g.user.householdId) as any[]).map((r) => r.entity_id));
      const cs = await ha.ws({ type: "cloud/status" });
      return {
        cloud: cs.success ? { loggedIn: !!cs.result?.logged_in } : null,
        items: [...candidates(g.user.householdId).values()].map((c) => ({ ...c, enabled: on.has(c.id) })).sort((a, b) => a.name.localeCompare(b.name)),
      };
    })
    .put("/api/admin/voice", async ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const c = typeof body?.entityId === "string" ? candidates(g.user.householdId).get(body.entityId) : undefined;
      if (!c || typeof body?.enabled !== "boolean") return deny(set, c === undefined && typeof body?.entityId === "string" ? 404 : 400, c === undefined ? "not_found" : "invalid_input");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const r = await ha.ws({ type: "homeassistant/expose_entity", assistants: ASSISTANTS, entity_ids: [c.id], should_expose: body.enabled });
      if (!r.success) return deny(set, 502, "ha_rejected"); // Home Assistant is the source of truth: if it didn't accept, nothing is recorded
      if (body.enabled) db.query("INSERT OR IGNORE INTO voice_exposure (household_id, entity_id) VALUES (?,?)").run(g.user.householdId, c.id);
      else db.query("DELETE FROM voice_exposure WHERE household_id = ? AND entity_id = ?").run(g.user.householdId, c.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: body.enabled ? "voice.enable" : "voice.disable", target: c.id, outcome: "success" });
      activity(db, g.user.householdId, "voice", `Voice control ${body.enabled ? "turned on" : "turned off"} for ${c.name}`);
      return { ok: true };
    });
}
