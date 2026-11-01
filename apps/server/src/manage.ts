import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { audit, activity } from "./audit";
import { describe } from "./capabilities";
import { authorize } from "./guard";
import type { HaApi } from "./ha";
import { effectivePermissions, type Role } from "./policy";

const name = (v: unknown) => { const s = String(v ?? "").trim(); return s && s.length <= 60 ? s : null; };

/** Household organisation: rooms, device placement, groups, per-user device access. Admin area only. */
export function manageRoutes(db: Database, ha: HaApi, secure: boolean) {
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error }; };
  const org = (req: Request) => authorize(db, req, secure, ["admin.access", "rooms.manage"]);
  const roomOk = (h: string, id: unknown) => typeof id === "string" && !!db.query("SELECT 1 FROM rooms WHERE id = ? AND household_id = ?").get(id, h);
  const entityOk = (id: unknown) => typeof id === "string" && ha.entities.has(id);
  /** Devices, scenes (HA entities) or routines ("routine:<id>") can all be granted to a person. */
  const targetOk = (h: string, id: unknown) => entityOk(id) || (typeof id === "string" && id.startsWith("routine:") && !!db.query("SELECT 1 FROM routines WHERE id = ? AND household_id = ?").get(id.slice(8), h));

  return new Elysia({ name: "manage" })
    // Every HA entity, including ones unsuitable for the household UI (those are flagged, never controllable there).
    // Searchable and paged, so a home with hundreds of devices never has to be scrolled through. `all=1` also lists unsuitable entities.
    .get("/api/admin/devices", ({ request, query, set }: any) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const meta = new Map((db.query("SELECT entity_id, name, room_id, hidden FROM device_meta WHERE household_id = ?").all(g.user.householdId) as any[]).map((r) => [r.entity_id, r]));
      const q = String(query?.q ?? "").trim().toLowerCase(), room = String(query?.room ?? ""), notRoom = String(query?.notRoom ?? ""), all = query?.all === "1";
      const limit = Math.min(200, Math.max(1, Number(query?.limit) || 100)), offset = Math.max(0, Number(query?.offset) || 0);
      const rows = [...ha.entities.values()].map((e) => {
        const d = describe(e), m: any = meta.get(e.entity_id);
        return { id: e.entity_id, name: m?.name || d.name, haName: d.name, category: d.category, ordinary: d.ordinary, roomId: m?.room_id ?? null, hidden: !!m?.hidden, state: e.state };
      }).filter((r) => (all || r.ordinary) && (!q || r.name.toLowerCase().includes(q) || r.haName.toLowerCase().includes(q) || r.category.includes(q) || r.id.toLowerCase().includes(q))
        && (room === "" || (room === "none" ? r.roomId === null : r.roomId === room)) && (!notRoom || r.roomId !== notRoom)).sort((a, b) => a.name.localeCompare(b.name));
      return { stale: ha.isStale(), total: rows.length, devices: rows.slice(offset, offset + limit) };
    })
    .put("/api/admin/devices/:id", ({ request, params, body, set }: any) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (!entityOk(params.id)) return deny(set, 404, "not_found");
      const h = g.user.householdId;
      const cur: any = db.query("SELECT name, room_id, hidden FROM device_meta WHERE household_id = ? AND entity_id = ?").get(h, params.id) ?? { name: null, room_id: null, hidden: 0 };
      const next = { ...cur };
      if ("name" in (body ?? {})) { next.name = body.name === null ? null : name(body.name); if (body.name !== null && !next.name) return deny(set, 400, "invalid_input"); }
      if ("roomId" in (body ?? {})) { if (body.roomId !== null && !roomOk(h, body.roomId)) return deny(set, 400, "invalid_input"); next.room_id = body.roomId; }
      if ("hidden" in (body ?? {})) next.hidden = body.hidden ? 1 : 0;
      db.query("INSERT INTO device_meta (household_id, entity_id, name, room_id, hidden) VALUES (?,?,?,?,?) ON CONFLICT(household_id, entity_id) DO UPDATE SET name=excluded.name, room_id=excluded.room_id, hidden=excluded.hidden")
        .run(h, params.id, next.name, next.room_id, next.hidden);
      audit(db, { householdId: h, actorType: "user", actorId: g.user.id, action: "device.organise", target: params.id, outcome: "success" });
      return { ok: true };
    })
    .post("/api/admin/rooms", ({ request, body, set }: any) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const n = name(body?.name); if (!n) return deny(set, 400, "invalid_input");
      const id = randomUUID(), pos = (db.query("SELECT COALESCE(MAX(position),0)+1 p FROM rooms WHERE household_id = ?").get(g.user.householdId) as any).p;
      db.query("INSERT INTO rooms (id, household_id, name, position) VALUES (?,?,?,?)").run(id, g.user.householdId, n, pos);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "room.create", target: id, outcome: "success" });
      activity(db, g.user.householdId, "rooms", `Room "${n}" was added`);
      return { id, name: n };
    })
    .patch("/api/admin/rooms/:id", ({ request, params, body, set }: any) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const n = name(body?.name); if (!n) return deny(set, 400, "invalid_input");
      const r = db.query("UPDATE rooms SET name = ? WHERE id = ? AND household_id = ?").run(n, params.id, g.user.householdId);
      return r.changes ? { ok: true } : deny(set, 404, "not_found");
    })
    // Put devices into a room or take them out, in one go.
    .put("/api/admin/rooms/:id/devices", ({ request, params, body, set }: any) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const h = g.user.householdId, add: unknown = body?.add ?? [], remove: unknown = body?.remove ?? [];
      if (!roomOk(h, params.id) || ![add, remove].every((x) => Array.isArray(x) && x.length <= 200 && x.every(entityOk))) return deny(set, 400, "invalid_input");
      db.transaction(() => {
        for (const e of add as string[]) db.query("INSERT INTO device_meta (household_id, entity_id, room_id, hidden) VALUES (?,?,?,0) ON CONFLICT(household_id, entity_id) DO UPDATE SET room_id = excluded.room_id").run(h, e, params.id);
        for (const e of remove as string[]) db.query("UPDATE device_meta SET room_id = NULL WHERE household_id = ? AND entity_id = ? AND room_id = ?").run(h, e, params.id);
      })();
      audit(db, { householdId: h, actorType: "user", actorId: g.user.id, action: "room.devices", target: params.id, outcome: "success", reason: `add=${(add as string[]).length} remove=${(remove as string[]).length}` });
      return { ok: true };
    })
    .delete("/api/admin/rooms/:id", ({ request, params, set }: any) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const r = db.query("DELETE FROM rooms WHERE id = ? AND household_id = ?").run(params.id, g.user.householdId);
      if (!r.changes) return deny(set, 404, "not_found");
      db.query("DELETE FROM user_favorites WHERE kind='room' AND ref = ?").run(params.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "room.delete", target: params.id, outcome: "success" });
      return { ok: true };
    })
    .post("/api/admin/groups", ({ request, body, set }: any) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const n = name(body?.name), ids: unknown = body?.entityIds;
      if (!n || !Array.isArray(ids) || !ids.length || ids.length > 50 || !ids.every(entityOk)) return deny(set, 400, "invalid_input");
      const id = randomUUID();
      db.transaction(() => {
        db.query("INSERT INTO device_groups (id, household_id, name) VALUES (?,?,?)").run(id, g.user.householdId, n);
        for (const e of new Set(ids as string[])) db.query("INSERT INTO group_members (group_id, entity_id) VALUES (?,?)").run(id, e);
      })();
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "group.create", target: id, outcome: "success" });
      return { id };
    })
    .get("/api/admin/groups", ({ request, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { groups: (db.query("SELECT id, name FROM device_groups WHERE household_id = ? ORDER BY name").all(g.user.householdId) as any[]).map((r) => ({ ...r, entityIds: (db.query("SELECT entity_id FROM group_members WHERE group_id = ?").all(r.id) as any[]).map((m) => m.entity_id) })) };
    })
    .put("/api/admin/groups/:id", ({ request, params, body, set }: any) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const row: any = db.query("SELECT id FROM device_groups WHERE id = ? AND household_id = ?").get(params.id, g.user.householdId);
      if (!row) return deny(set, 404, "not_found");
      const n = body?.name === undefined ? undefined : name(body.name), ids: unknown = body?.entityIds;
      if ((body?.name !== undefined && !n) || (ids !== undefined && (!Array.isArray(ids) || !ids.length || ids.length > 50 || !ids.every(entityOk)))) return deny(set, 400, "invalid_input");
      db.transaction(() => {
        if (n) db.query("UPDATE device_groups SET name = ? WHERE id = ?").run(n, params.id);
        if (ids) { db.query("DELETE FROM group_members WHERE group_id = ?").run(params.id); for (const e of new Set(ids as string[])) db.query("INSERT INTO group_members (group_id, entity_id) VALUES (?,?)").run(params.id, e); }
      })();
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "group.update", target: params.id, outcome: "success" });
      return { ok: true };
    })
    .delete("/api/admin/groups/:id", ({ request, params, set }: any) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const r = db.query("DELETE FROM device_groups WHERE id = ? AND household_id = ?").run(params.id, g.user.householdId);
      return r.changes ? { ok: true } : deny(set, 404, "not_found");
    })
    // Per-user device access (guests start with none). Needs users.manage and a fresh re-authentication.
    .put("/api/admin/users/:id/devices", ({ request, params, body, set }: any) => {
      const g = authorize(db, request, secure, ["admin.access", "users.manage"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const t: any = db.query("SELECT id, role FROM users WHERE id = ? AND household_id = ?").get(params.id, g.user.householdId);
      if (!t) return deny(set, 404, "not_found");
      if (t.role === "admin" && g.user.role !== "admin") return deny(set, 403, "forbidden");
      const { allow = [], deny: den = [], reset = [] } = body ?? {};
      const all = [...allow, ...den, ...reset];
      if (![allow, den, reset].every(Array.isArray) || all.length > 200 || !all.every((x) => targetOk(g.user.householdId, x))) return deny(set, 400, "invalid_input");
      db.transaction(() => {
        for (const e of allow) db.query("INSERT INTO device_access (user_id, entity_id, allowed) VALUES (?,?,1) ON CONFLICT(user_id, entity_id) DO UPDATE SET allowed=1").run(t.id, e);
        for (const e of den) db.query("INSERT INTO device_access (user_id, entity_id, allowed) VALUES (?,?,0) ON CONFLICT(user_id, entity_id) DO UPDATE SET allowed=0").run(t.id, e);
        for (const e of reset) db.query("DELETE FROM device_access WHERE user_id = ? AND entity_id = ?").run(t.id, e);
      })();
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "user.device_access", target: t.id, outcome: "success", reason: `allow=${allow.length} deny=${den.length} reset=${reset.length}` });
      return { ok: true };
    })
    // Scenes and routines that can be shared with individual people.
    .get("/api/admin/actions", ({ request, set }) => {
      const g = authorize(db, request, secure, ["admin.access", "users.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return {
        scenes: [...ha.entities.values()].filter((e) => e.entity_id.startsWith("scene.")).map((e) => ({ id: e.entity_id, name: String(e.attributes.friendly_name ?? e.entity_id) })),
        routines: (db.query("SELECT id, name FROM routines WHERE household_id = ?").all(g.user.householdId) as any[]).map((r) => ({ id: `routine:${r.id}`, name: r.name })),
      };
    })
    // Everything the access screen needs for one person, already narrowed to what matters for their role.
    .get("/api/admin/users/:id/access", ({ request, params, set }: any) => {
      const g = authorize(db, request, secure, ["admin.access", "users.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const h = g.user.householdId, t: any = db.query("SELECT id, display_name, role FROM users WHERE id = ? AND household_id = ?").get(params.id, h);
      if (!t) return deny(set, 404, "not_found");
      const role = t.role as Role, guest = role === "guest";
      const grants = new Map((db.query("SELECT entity_id, allowed FROM device_access WHERE user_id = ?").all(t.id) as any[]).map((r) => [r.entity_id, !!r.allowed]));
      const can = (id: string) => grants.get(id) ?? !guest;
      const meta = new Map((db.query("SELECT entity_id, name, room_id, hidden FROM device_meta WHERE household_id = ?").all(h) as any[]).map((r) => [r.entity_id, r]));
      const nameOf = (id: string) => String((meta.get(id) as any)?.name || ha.entities.get(id)?.attributes?.friendly_name || id);
      const devices = [...ha.entities.values()].map((e) => { const d = describe(e), m: any = meta.get(e.entity_id); return { e, d, m }; })
        .filter((x) => x.d.ordinary && !x.m?.hidden && !(guest && x.d.category === "energy")).map((x) => ({ id: x.e.entity_id, name: x.m?.name || x.d.name, category: x.d.category, roomId: x.m?.room_id ?? null, allowed: can(x.e.entity_id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const rooms = db.query("SELECT id, name FROM rooms WHERE household_id = ? ORDER BY position, name").all(h) as any[];
      const scenes = [...ha.entities.values()].filter((e) => e.entity_id.startsWith("scene.") && !(meta.get(e.entity_id) as any)?.hidden)
        .map((e) => ({ id: e.entity_id, name: String(e.attributes.friendly_name ?? e.entity_id), allowed: can(e.entity_id) })).sort((a, b) => a.name.localeCompare(b.name));
      const routines = (db.query("SELECT id, name FROM routines WHERE household_id = ? ORDER BY name").all(h) as any[]).map((r) => ({ id: `routine:${r.id}`, name: r.name, allowed: can(`routine:${r.id}`) }));
      const touched = (r: any) => {
        const out: string[] = [];
        for (const x of [...JSON.parse(r.triggers), ...JSON.parse(r.conditions)]) if (x.entityId) out.push(x.entityId);
        for (const a of JSON.parse(r.actions)) if (a.type === "device" || a.type === "scene") out.push(a.entityId);
        return [...new Set(out)];
      };
      const perms = effectivePermissions(role, Object.fromEntries((db.query("SELECT permission, granted FROM permission_overrides WHERE user_id = ?").all(t.id) as any[]).map((r) => [r.permission, !!r.granted])));
      // Automations aren't granted one by one: someone sees one only when they could use everything it touches.
      const automations = perms.includes("automation.manage") ? (db.query("SELECT id, name, triggers, conditions, actions FROM automations WHERE household_id = ? ORDER BY name").all(h) as any[]).map((r) => {
        const blocked = touched(r).filter((id) => !can(id)).map(nameOf);
        return { id: r.id, name: r.name, visible: !blocked.length, blockedBy: blocked.slice(0, 4) };
      }) : [];
      const base = effectivePermissions(role, {}), abilities = (guest ? ["device.control", "scene.activate"] : ["device.control", "scene.activate", "scenes.manage", "automation.manage", "modes.set"]).map((p) => ({ id: p, on: perms.includes(p as any), byDefault: base.includes(p as any) }));
      return { user: { id: t.id, name: t.display_name, role }, roleDefault: guest ? "none" : "all", rooms, devices, scenes, routines, automations, abilities, tabs: guest ? ["rooms", "devices", "scenes", "routines", "abilities"] : ["rooms", "devices", "scenes", "routines", "automations", "abilities"] };
    })
    .get("/api/admin/users/:id/devices", ({ request, params, set }: any) => {
      const g = authorize(db, request, secure, ["admin.access", "users.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const t: any = db.query("SELECT id, role FROM users WHERE id = ? AND household_id = ?").get(params.id, g.user.householdId);
      if (!t) return deny(set, 404, "not_found");
      return { roleDefault: t.role === "guest" ? "none" : "all", overrides: db.query("SELECT entity_id AS id, allowed FROM device_access WHERE user_id = ?").all(t.id) };
    });
}
