import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { audit } from "./audit";
import { describe } from "./capabilities";
import { authorize } from "./guard";
import { friendlyName, type HaApi, type HaEntity } from "./ha";
import type { DeviceMeta, DeviceService } from "./devices";
import { asObject, asList, cleanName, denyWith as deny, type Failure } from "./http";
import type { SessionUser } from "./session";

const APP_PREFIX = "alice_";

/** Capture what a device is doing right now, for the few device types we can restore reliably. */
export function snapshot(e: HaEntity): Record<string, unknown> | { error: string } {
  if (e.state === "unavailable") return { error: "device_unavailable" };
  const a = e.attributes, d = describe(e);
  switch (d.domain) {
    case "light": {
      const out: Record<string, unknown> = { state: e.state };
      if (e.state === "on") {
        if (typeof a.brightness === "number") out.brightness = a.brightness;
        if (a.color_mode === "color_temp" && typeof a.color_temp_kelvin === "number") out.color_temp_kelvin = a.color_temp_kelvin;
        if (a.color_mode === "hs" && Array.isArray(a.hs_color)) out.hs_color = a.hs_color;
      }
      return out;
    }
    case "switch": return { state: e.state };
    case "fan": return e.state === "on" && typeof a.percentage === "number" ? { state: "on", percentage: a.percentage } : { state: e.state };
    default: return { error: "unsupported" };
  }
}

export function createSceneService(ha: HaApi, svc: DeviceService) {
  const sceneView = (e: HaEntity, m: DeviceMeta | undefined) => ({
    id: e.entity_id, name: m?.name || friendlyName(e),
    managed: String(e.attributes.id ?? "").startsWith(APP_PREFIX), // created in this app, so it can be edited here
    deviceIds: asList(e.attributes.entity_id)?.filter((x): x is string => typeof x === "string") ?? [],
  });
  function visible(u: SessionUser) {
    const ok = svc.accessor(u), meta = svc.meta(u.householdId);
    return [...ha.entities.values()].filter((e) => e.entity_id.startsWith("scene.") && ok(e.entity_id) && !meta.get(e.entity_id)?.hidden)
      .map((e) => sceneView(e, meta.get(e.entity_id))).sort((a, b) => a.name.localeCompare(b.name));
  }
  return { visible, search: (u: SessionUser, q: string) => visible(u).filter((s) => s.name.toLowerCase().includes(q)).slice(0, 10).map(({ id, name }) => ({ id, name })) };
}
export type SceneService = ReturnType<typeof createSceneService>;

export function sceneRoutes(db: Database, ha: HaApi, secure: boolean, svc: DeviceService, scenes: SceneService) {
  type SceneConfig = { name: string; entities: Record<string, unknown> };

  /** Validate the chosen devices (the author must be able to use each) and snapshot them. */
  function build(u: SessionUser, nm: unknown, input: unknown): Failure | { config: SceneConfig } {
    const n = cleanName(nm), ids = asList(input);
    if (!n || !ids?.length || ids.length > 40 || !ids.every((x): x is string => typeof x === "string")) return { status: 400, error: "invalid_input" };
    const entities: Record<string, unknown> = {};
    for (const id of new Set(ids)) {
      const dev = svc.deviceFor(u, id);
      if (!dev) return { status: 404, error: "not_found" };
      const s = snapshot(dev.entity);
      if ("error" in s) return { status: s.error === "unsupported" ? 400 : 409, error: String(s.error) };
      entities[id] = s;
    }
    return { config: { name: n, entities } };
  }

  async function write(configId: string, config: unknown, ready: (e: HaEntity) => boolean): Promise<Failure | { entity: HaEntity }> {
    if (ha.isStale()) return { status: 503, error: "ha_unavailable" };
    const w = await ha.config("POST", `/api/config/scene/config/${configId}`, config);
    if (!w.ok) return { status: 502, error: w.error ?? "ha_rejected" };
    await ha.callService("scene", "reload");
    const e = await ha.waitFor(ready, 3000);
    return e ? { entity: e } : { status: 502, error: "ha_not_loading" };
  }
  const managedOr404 = (u: SessionUser, id: string) => {
    const e = ha.entities.get(id);
    return e && id.startsWith("scene.") && svc.accessor(u)(id) && String(e.attributes.id ?? "").startsWith(APP_PREFIX) ? e : null;
  };

  return new Elysia({ name: "scenes" })
    .get("/api/scenes", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { scenes: scenes.visible(g.user), canManage: g.user.permissions.includes("scenes.manage") };
    })
    .post("/api/scenes/:id/activate", async ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["scene.activate"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const s = scenes.visible(g.user).find((x) => x.id === params.id);
      if (!s) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const before = ha.entities.get(s.id);
      const r = await ha.callService("scene", "turn_on", {}, s.id);
      if (!r.ok) return deny(set, r.error === "ha_unavailable" ? 503 : 409, r.error);
      // HA applies a scene asynchronously across devices, so "confirmed" means HA registered the activation.
      return { ok: true, confirmed: await ha.waitForChange(s.id, before, 1500) };
    })
    .post("/api/scenes", async ({ request, body, set }) => {
      const g = authorize(db, request, secure, ["scenes.manage", "device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const input = asObject(body), b = build(g.user, input.name, input.entityIds);
      if ("error" in b) return deny(set, b.status, b.error);
      const id = APP_PREFIX + randomBytes(5).toString("hex");
      const r = await write(id, b.config, (e) => e.entity_id.startsWith("scene.") && e.attributes.id === id);
      if ("error" in r) {
        if (r.error === "not_confirmed" || r.error === "ha_not_loading") { await ha.config("DELETE", `/api/config/scene/config/${id}`); await ha.callService("scene", "reload"); }
        return deny(set, r.status, r.error);
      }
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "scene.create", target: r.entity.entity_id, outcome: "success" });
      return { ok: true, id: r.entity.entity_id };
    })
    .put("/api/scenes/:id", async ({ request, params, body, set }) => {
      const g = authorize(db, request, secure, ["scenes.manage", "device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const e = managedOr404(g.user, params.id); if (!e) return deny(set, 404, "not_found");
      const input = asObject(body), b = build(g.user, input.name, input.entityIds);
      if ("error" in b) return deny(set, b.status, b.error);
      const r = await write(String(e.attributes.id), b.config, (x) => x.entity_id === e.entity_id && x.attributes.friendly_name === b.config.name);
      if ("error" in r) return deny(set, r.status, r.error);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "scene.update", target: e.entity_id, outcome: "success" });
      return { ok: true };
    })
    .delete("/api/scenes/:id", async ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["scenes.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const e = managedOr404(g.user, params.id); if (!e) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const w = await ha.config("DELETE", `/api/config/scene/config/${e.attributes.id}`);
      if (!w.ok) return deny(set, 502, w.error ?? "ha_rejected");
      await ha.callService("scene", "reload");
      db.query("DELETE FROM device_access WHERE entity_id = ?").run(e.entity_id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "scene.delete", target: e.entity_id, outcome: "success" });
      return { ok: true };
    });
}
