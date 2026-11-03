import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { audit } from "./audit";
import { authorize } from "./guard";
import { friendlyName, haError, type HaApi, type HaEntity } from "./ha";
import type { DeviceService } from "./devices";
import { RateLimiter } from "./ratelimit";
import { asObject, denyWith as deny } from "./http";
import { scalar } from "./sql";

/** Things that let something in, or switch protection off. Home Assistant's own Assist does not ask for a passkey, so it must not reach them. */
export function sensitiveEntity(e: HaEntity | undefined, id = e?.entity_id ?? ""): boolean {
  const [domain = ""] = id.split("."), cls = typeof e?.attributes.device_class === "string" ? e.attributes.device_class : "";
  return domain === "lock" || domain === "alarm_control_panel" || (domain === "cover" && ["garage", "gate", "door"].includes(cls)) || (domain === "valve" && ["water", "gas"].includes(cls));
}

const ACT = "(?:unlock|disarm|deactivate|release|open|turn\\s+off|switch\\s+off|shut\\s+off|stop|cancel)";
/** What we refuse to pass on at all: the plain phrasings of "let someone in" and "switch the alarm off". Exposure is the real guard; this is the first. */
const FIXED = /\b(?:unlock|disarm|let\s+(?:me|us|him|her|them|someone)\s+in|open\s+(?:the\s+)?(?:front\s+|back\s+|garage\s+|main\s+)?(?:door|gate|garage)|(?:turn|switch|shut)\s+off\s+(?:the\s+)?alarm|alarm\s+off|deactivate\s+(?:the\s+)?alarm)\b/i;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Refuses to pass on a request that would unlock, disarm or open something that guards the home. Questions ("is the front door locked?") go through. */
export function refusedByPolicy(text: string, sensitiveNames: string[]): boolean {
  if (FIXED.test(text)) return true;
  return sensitiveNames.some((n) => n.length > 2 && new RegExp(`\\b${ACT}\\b[^.?!]*\\b${esc(n)}\\b|\\b${esc(n)}\\b[^.?!]*\\b${ACT}\\b`, "i").test(text) && !/^\s*(?:is|are|was|were|did|does|do)\b/i.test(text));
}

type Target = { id?: string; name?: string; type?: string };
const asTargets = (v: unknown): Target[] => (Array.isArray(v) ? v.filter((x): x is Target => !!x && typeof x === "object") : []);

/** Home Assistant's own text assistant, for what the app's plain rules don't understand, behind the same limits as everything else. */
export function assistRoutes(db: Database, ha: HaApi, secure: boolean, svc: DeviceService, now: () => number = Date.now) {
  const limiter = new RateLimiter(15, 60_000, now);
  const exposedToAssist = async (): Promise<Set<string> | { error: string }> => {
    const r = await ha.ws({ type: "homeassistant/expose_entity/list" });
    if (!r.success) return { error: haError(r) };
    const m = asObject(asObject(r.result).exposed_entities);
    return new Set(Object.entries(m).filter(([, v]) => (Array.isArray(v) ? v.includes("conversation") : asObject(v).conversation === true)).map(([id]) => id));
  };

  return new Elysia({ name: "assist" })
    .post("/api/assist", async ({ request, body, set }) => {
      const g = authorize(db, request, secure, ["device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const u = g.user, b = asObject(body), text = typeof b.text === "string" ? b.text.trim() : "";
      if (!text || text.length > 200) return deny(set, 400, "invalid_input");
      // Assist acts with the home's own key, not with this person's access, so it is for people with no limits on their devices.
      if (u.role === "guest" || scalar(db, "SELECT COUNT(*) FROM device_access WHERE user_id = ? AND allowed = 0", 0, u.id) > 0) return deny(set, 403, "assist_unavailable");
      if (!limiter.take(u.id)) return deny(set, 429, "rate_limited");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const names = [...ha.entities.values()].filter((e) => sensitiveEntity(e)).map((e) => friendlyName(e));
      if (refusedByPolicy(text, names)) { audit(db, { householdId: u.householdId, actorType: "user", actorId: u.id, action: "assist.refused", target: "home_assistant", outcome: "denied" }); return deny(set, 403, "assist_refused"); }
      const language = typeof b.language === "string" && /^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(b.language) ? b.language : ha.info?.language ?? "en";
      const r = await ha.ws({ type: "conversation/process", text, language });
      if (!r.success) return deny(set, 502, "ha_rejected");
      const res = asObject(asObject(r.result).response), data = asObject(res.data);
      const speech = String(asObject(asObject(asObject(res.speech).plain)).speech ?? "").replace(/\s+/g, " ").trim().slice(0, 400);
      const reached = asTargets(data.success).filter((t) => t.id);
      // What it changed, named only if this person could see it. Anything it should not have reached is recorded for the admins.
      const changed = reached.flatMap((t) => { const d = svc.deviceFor(u, t.id!); return d ? [d.view.name] : []; });
      const touched = reached.filter((t) => sensitiveEntity(ha.entities.get(t.id!), t.id!));
      audit(db, { householdId: u.householdId, actorType: "user", actorId: u.id, action: touched.length ? "assist.sensitive" : "assist.ask", target: "home_assistant", outcome: res.response_type === "error" ? "failure" : "success", ...(touched.length ? { reason: touched.map((t) => t.id).join(",") } : {}) });
      return {
        ok: res.response_type !== "error", speech: speech || (changed.length ? "Done." : "I didn't catch that."), changed,
        ...(touched.length ? { warning: "That reached something that guards the home. Ask an admin to protect it under Voice control." } : {}),
      };
    })
    // Which things Home Assistant's Assist can touch, and which of those should never be reachable that way.
    .get("/api/admin/assist", async ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const ex = await exposedToAssist();
      if (!(ex instanceof Set)) return { available: false, exposed: 0, risky: [], ...(ex.error === "ha_not_admin" ? { reason: "needs_admin_key" } : {}) };
      const risky = [...ex].filter((id) => sensitiveEntity(ha.entities.get(id), id)).map((id) => ({ id, name: friendlyName(ha.entities.get(id), id) })).sort((a, b) => a.name.localeCompare(b.name));
      return { available: true, exposed: ex.size, risky };
    })
    .post("/api/admin/assist/protect", async ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const ex = await exposedToAssist();
      if (!(ex instanceof Set)) return deny(set, 502, ex.error);
      const ids = [...ex].filter((id) => sensitiveEntity(ha.entities.get(id), id));
      if (ids.length) {
        const r = await ha.ws({ type: "homeassistant/expose_entity", assistants: ["conversation", "cloud.alexa", "cloud.google_assistant"], entity_ids: ids, should_expose: false });
        if (!r.success) return deny(set, 502, haError(r));
      }
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "assist.protect", target: "home_assistant", outcome: "success", reason: `hidden=${ids.length}` });
      return { ok: true, hidden: ids.length };
    });
}
