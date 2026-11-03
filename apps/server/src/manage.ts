import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { audit, activity } from "./audit";
import { describe, DEVICE_ICONS, ROOM_COLORS, ROOM_ICONS } from "./capabilities";
import type { DeviceMeta } from "./devices";
import { authorize } from "./guard";
import type { HaApi } from "./ha";
import { friendlyName } from "./ha";
import { createAreaInHa, placeEntityInHa, renameAreaInHa, roomRows, withAreaRooms } from "./haRooms";
import { asObject, cleanName, deny, oneOf, text } from "./http";
import { effectivePermissions, type Permission, type Role } from "./policy";
import { all, exists, one, scalar } from "./sql";

const idList = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x): x is string => typeof x === "string") ? v : null);

type UserRow = { id: string; display_name: string; role: Role };
type AutomationRow = { id: string; name: string; triggers: string; conditions: string; actions: string };
/** The parts of a stored trigger, condition or action that name a device or scene. */
type Reference = { type?: string; entityId?: string };

const GUEST_ABILITIES: Permission[] = ["device.control", "scene.activate"];
const MEMBER_ABILITIES: Permission[] = ["device.control", "scene.activate", "scenes.manage", "automation.manage", "modes.set"];

/** Household organisation: rooms, device placement, groups, per-user device access. Admin area only. */
export function manageRoutes(db: Database, ha: HaApi, secure: boolean) {
  const org = (req: Request) => authorize(db, req, secure, ["admin.access", "rooms.manage"]);
  const metaOf = (household: string) => withAreaRooms(db, ha, household, new Map(all<DeviceMeta>(db, "SELECT entity_id, name, room_id, hidden, icon FROM device_meta WHERE household_id = ?", household).map((r) => [r.entity_id, r])));
  const roomOk = (h: string, id: unknown): id is string => typeof id === "string" && exists(db, "SELECT 1 FROM rooms WHERE id = ? AND household_id = ?", id, h);
  const entityOk = (id: unknown): id is string => typeof id === "string" && ha.entities.has(id);
  /** Devices, scenes (HA entities) or routines ("routine:<id>") can all be granted to a person. */
  const targetOk = (h: string, id: unknown): id is string =>
    entityOk(id) || (typeof id === "string" && id.startsWith("routine:") && exists(db, "SELECT 1 FROM routines WHERE id = ? AND household_id = ?", id.slice(8), h));
  const entityIds = (v: unknown, max: number): string[] | null => (Array.isArray(v) && v.length <= max && v.every(entityOk) ? v : null);

  return new Elysia({ name: "manage" })
    // Every HA entity, including ones unsuitable for the household UI (those are flagged, never controllable there).
    // Searchable and paged, so a home with hundreds of devices never has to be scrolled through. `all=1` also lists unsuitable entities.
    .get("/api/admin/devices", ({ request, query, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const meta = metaOf(g.user.householdId);
      const q = text(query.q).trim().toLowerCase(), room = text(query.room), notRoom = text(query.notRoom), includeAll = query.all === "1";
      const limit = Math.min(200, Math.max(1, Number(query.limit) || 100)), offset = Math.max(0, Number(query.offset) || 0);
      const rows = [...ha.entities.values()].map((e) => {
        const d = describe(e), m = meta.get(e.entity_id);
        return { id: e.entity_id, name: m?.name || d.name, haName: d.name, category: d.category, ordinary: d.ordinary, roomId: m?.room_id ?? null, hidden: !!m?.hidden, state: e.state };
      }).filter((r) => (includeAll || r.ordinary) && (!q || r.name.toLowerCase().includes(q) || r.haName.toLowerCase().includes(q) || r.category.includes(q) || r.id.toLowerCase().includes(q))
        && (room === "" || (room === "none" ? r.roomId === null : r.roomId === room)) && (!notRoom || r.roomId !== notRoom)).sort((a, b) => a.name.localeCompare(b.name));
      return { stale: ha.isStale(), total: rows.length, devices: rows.slice(offset, offset + limit) };
    })
    .put("/api/admin/devices/:id", ({ request, params, body, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (!entityOk(params.id)) return deny(set, 404, "not_found");
      const h = g.user.householdId, b = asObject(body);
      const next = one<Pick<DeviceMeta, "name" | "room_id" | "hidden" | "icon">>(db, "SELECT name, room_id, hidden, icon FROM device_meta WHERE household_id = ? AND entity_id = ?", h, params.id) ?? { name: null, room_id: null, hidden: 0, icon: null };
      if ("name" in b) { next.name = b.name === null ? null : cleanName(b.name); if (b.name !== null && !next.name) return deny(set, 400, "invalid_input"); }
      if ("roomId" in b) { if (b.roomId !== null && !roomOk(h, b.roomId)) return deny(set, 400, "invalid_input"); next.room_id = b.roomId as string | null; }
      if ("hidden" in b) next.hidden = b.hidden ? 1 : 0;
      if ("icon" in b) { if (b.icon !== null && !oneOf(DEVICE_ICONS, b.icon)) return deny(set, 400, "invalid_input"); next.icon = b.icon as string | null; }
      db.query("INSERT INTO device_meta (household_id, entity_id, name, room_id, hidden, icon) VALUES (?,?,?,?,?,?) ON CONFLICT(household_id, entity_id) DO UPDATE SET name=excluded.name, room_id=excluded.room_id, hidden=excluded.hidden, icon=excluded.icon")
        .run(h, params.id, next.name, next.room_id, next.hidden, next.icon);
      audit(db, { householdId: h, actorType: "user", actorId: g.user.id, action: "device.organise", target: params.id, outcome: "success" });
      return { ok: true };
    })
    .post("/api/admin/rooms", async ({ request, body, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const b = asObject(body), n = cleanName(b.name); if (!n) return deny(set, 400, "invalid_input");
      // A new room is also made in Home Assistant, so both agree. If the hub won't take it the room still exists here.
      const area = b.inHa === false ? null : await createAreaInHa(ha, n);
      const taken = area !== null && exists(db, "SELECT 1 FROM rooms WHERE household_id = ? AND ha_area_id = ?", g.user.householdId, area);
      const id = randomUUID(), pos = scalar(db, "SELECT COALESCE(MAX(position),0)+1 FROM rooms WHERE household_id = ?", 1, g.user.householdId);
      db.query("INSERT INTO rooms (id, household_id, name, position, ha_area_id) VALUES (?,?,?,?,?)").run(id, g.user.householdId, n, pos, taken ? null : area);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "room.create", target: id, outcome: "success" });
      activity(db, g.user.householdId, "rooms", `Room "${n}" was added`);
      return { id, name: n, inHa: area !== null && !taken };
    })
    .patch("/api/admin/rooms/:id", async ({ request, params, body, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const b = asObject(body), h = g.user.householdId;
      const cur = one<{ name: string; color: string | null; icon: string | null; ha_area_id: string | null }>(db, "SELECT name, color, icon, ha_area_id FROM rooms WHERE id = ? AND household_id = ?", params.id, h);
      if (!cur) return deny(set, 404, "not_found");
      let name = cur.name, color = cur.color, icon = cur.icon;
      if ("name" in b) { const n = cleanName(b.name); if (!n) return deny(set, 400, "invalid_input"); name = n; }
      if ("color" in b) { if (b.color !== null && !oneOf(ROOM_COLORS, b.color)) return deny(set, 400, "invalid_input"); color = b.color as string | null; }
      if ("icon" in b) { if (b.icon !== null && !oneOf(ROOM_ICONS, b.icon)) return deny(set, 400, "invalid_input"); icon = b.icon as string | null; }
      // A room that mirrors a hub area takes its name from there, so the hub must accept the new one first.
      if (cur.ha_area_id && name !== cur.name && !(await renameAreaInHa(ha, cur.ha_area_id, name))) return deny(set, 502, "ha_rejected");
      db.query("UPDATE rooms SET name = ?, color = ?, icon = ? WHERE id = ? AND household_id = ?").run(name, color, icon, params.id, h);
      return { ok: true };
    })
    // Put devices into a room or take them out, in one go.
    .put("/api/admin/rooms/:id/devices", async ({ request, params, body, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const h = g.user.householdId, b = asObject(body), add = entityIds(b.add ?? [], 200), remove = entityIds(b.remove ?? [], 200);
      if (!roomOk(h, params.id) || !add || !remove) return deny(set, 400, "invalid_input");
      db.transaction(() => {
        for (const e of add) db.query("INSERT INTO device_meta (household_id, entity_id, room_id, hidden) VALUES (?,?,?,0) ON CONFLICT(household_id, entity_id) DO UPDATE SET room_id = excluded.room_id").run(h, e, params.id);
        for (const e of remove) db.query("UPDATE device_meta SET room_id = NULL WHERE household_id = ? AND entity_id = ? AND room_id = ?").run(h, e, params.id);
      })();
      // In a room that mirrors a hub area, the hub learns of it too. The household's placement holds either way.
      const area = one<{ ha_area_id: string | null }>(db, "SELECT ha_area_id FROM rooms WHERE id = ?", params.id)?.ha_area_id ?? null;
      let inHa = true;
      if (area) {
        for (const e of add) inHa = (await placeEntityInHa(ha, e, area)) && inHa;
        for (const e of remove) inHa = (await placeEntityInHa(ha, e, null)) && inHa;
      }
      audit(db, { householdId: h, actorType: "user", actorId: g.user.id, action: "room.devices", target: params.id, outcome: "success", reason: `add=${add.length} remove=${remove.length}` });
      return { ok: true, inHa };
    })
    .delete("/api/admin/rooms/:id", ({ request, params, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const r = db.query("DELETE FROM rooms WHERE id = ? AND household_id = ?").run(params.id, g.user.householdId);
      if (!r.changes) return deny(set, 404, "not_found");
      db.query("DELETE FROM user_favorites WHERE kind='room' AND ref = ?").run(params.id);
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "room.delete", target: params.id, outcome: "success" });
      return { ok: true };
    })
    .post("/api/admin/groups", ({ request, body, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const b = asObject(body), n = cleanName(b.name), ids = entityIds(b.entityIds, 50);
      if (!n || !ids?.length) return deny(set, 400, "invalid_input");
      const id = randomUUID();
      db.transaction(() => {
        db.query("INSERT INTO device_groups (id, household_id, name) VALUES (?,?,?)").run(id, g.user.householdId, n);
        for (const e of new Set(ids)) db.query("INSERT INTO group_members (group_id, entity_id) VALUES (?,?)").run(id, e);
      })();
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "group.create", target: id, outcome: "success" });
      return { id };
    })
    .get("/api/admin/groups", ({ request, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return {
        groups: all<{ id: string; name: string }>(db, "SELECT id, name FROM device_groups WHERE household_id = ? ORDER BY name", g.user.householdId)
          .map((r) => ({ ...r, entityIds: all<{ entity_id: string }>(db, "SELECT entity_id FROM group_members WHERE group_id = ?", r.id).map((m) => m.entity_id) })),
      };
    })
    .put("/api/admin/groups/:id", ({ request, params, body, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (!exists(db, "SELECT 1 FROM device_groups WHERE id = ? AND household_id = ?", params.id, g.user.householdId)) return deny(set, 404, "not_found");
      const b = asObject(body), n = b.name === undefined ? undefined : cleanName(b.name), ids = b.entityIds === undefined ? undefined : entityIds(b.entityIds, 50);
      if ((b.name !== undefined && !n) || (b.entityIds !== undefined && !ids?.length)) return deny(set, 400, "invalid_input");
      db.transaction(() => {
        if (n) db.query("UPDATE device_groups SET name = ? WHERE id = ?").run(n, params.id);
        if (ids) { db.query("DELETE FROM group_members WHERE group_id = ?").run(params.id); for (const e of new Set(ids)) db.query("INSERT INTO group_members (group_id, entity_id) VALUES (?,?)").run(params.id, e); }
      })();
      audit(db, { householdId: g.user.householdId, actorType: "user", actorId: g.user.id, action: "group.update", target: params.id, outcome: "success" });
      return { ok: true };
    })
    .delete("/api/admin/groups/:id", ({ request, params, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const r = db.query("DELETE FROM device_groups WHERE id = ? AND household_id = ?").run(params.id, g.user.householdId);
      return r.changes ? { ok: true } : deny(set, 404, "not_found");
    })
    // Per-user device access (guests start with none). Needs users.manage and a fresh re-authentication.
    .put("/api/admin/users/:id/devices", ({ request, params, body, set }) => {
      const g = authorize(db, request, secure, ["admin.access", "users.manage"], true); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const t = one<Pick<UserRow, "id" | "role">>(db, "SELECT id, role FROM users WHERE id = ? AND household_id = ?", params.id, g.user.householdId);
      if (!t) return deny(set, 404, "not_found");
      if (t.role === "admin" && g.user.role !== "admin") return deny(set, 403, "forbidden");
      const b = asObject(body), allow = idList(b.allow ?? []), den = idList(b.deny ?? []), reset = idList(b.reset ?? []);
      if (!allow || !den || !reset || allow.length + den.length + reset.length > 200 || ![...allow, ...den, ...reset].every((x) => targetOk(g.user.householdId, x))) return deny(set, 400, "invalid_input");
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
        scenes: [...ha.entities.values()].filter((e) => e.entity_id.startsWith("scene.")).map((e) => ({ id: e.entity_id, name: friendlyName(e) })),
        routines: all<{ id: string; name: string }>(db, "SELECT id, name FROM routines WHERE household_id = ?", g.user.householdId).map((r) => ({ id: `routine:${r.id}`, name: r.name })),
      };
    })
    // Everything the access screen needs for one person, already narrowed to what matters for their role.
    .get("/api/admin/users/:id/access", ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["admin.access", "users.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const h = g.user.householdId, t = one<UserRow>(db, "SELECT id, display_name, role FROM users WHERE id = ? AND household_id = ?", params.id, h);
      if (!t) return deny(set, 404, "not_found");
      const role = t.role, guest = role === "guest";
      const grants = new Map(all<{ entity_id: string; allowed: number }>(db, "SELECT entity_id, allowed FROM device_access WHERE user_id = ?", t.id).map((r) => [r.entity_id, !!r.allowed]));
      const can = (id: string) => grants.get(id) ?? !guest;
      const meta = metaOf(h);
      const nameOf = (id: string) => meta.get(id)?.name || friendlyName(ha.entities.get(id), id);
      const devices = [...ha.entities.values()].map((e) => ({ e, d: describe(e), m: meta.get(e.entity_id) }))
        .filter((x) => x.d.ordinary && !x.m?.hidden && !(guest && x.d.category === "energy")).map((x) => ({ id: x.e.entity_id, name: x.m?.name || x.d.name, category: x.d.category, roomId: x.m?.room_id ?? null, allowed: can(x.e.entity_id) }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const rooms = roomRows(db, ha, h).map(({ id, name }) => ({ id, name }));
      const scenes = [...ha.entities.values()].filter((e) => e.entity_id.startsWith("scene.") && !meta.get(e.entity_id)?.hidden)
        .map((e) => ({ id: e.entity_id, name: friendlyName(e), allowed: can(e.entity_id) })).sort((a, b) => a.name.localeCompare(b.name));
      const routines = all<{ id: string; name: string }>(db, "SELECT id, name FROM routines WHERE household_id = ? ORDER BY name", h).map((r) => ({ id: `routine:${r.id}`, name: r.name, allowed: can(`routine:${r.id}`) }));
      const touched = (r: AutomationRow) => {
        const out: string[] = [];
        for (const x of [...JSON.parse(r.triggers) as Reference[], ...JSON.parse(r.conditions) as Reference[]]) if (x.entityId) out.push(x.entityId);
        for (const a of JSON.parse(r.actions) as Reference[]) if ((a.type === "device" || a.type === "scene") && a.entityId) out.push(a.entityId);
        return [...new Set(out)];
      };
      const perms = effectivePermissions(role, Object.fromEntries(all<{ permission: string; granted: number }>(db, "SELECT permission, granted FROM permission_overrides WHERE user_id = ?", t.id).map((r) => [r.permission, !!r.granted])));
      // Automations aren't granted one by one: someone sees one only when they could use everything it touches.
      const automations = perms.includes("automation.manage") ? all<AutomationRow>(db, "SELECT id, name, triggers, conditions, actions FROM automations WHERE household_id = ? ORDER BY name", h).map((r) => {
        const blocked = touched(r).filter((id) => !can(id)).map(nameOf);
        return { id: r.id, name: r.name, visible: !blocked.length, blockedBy: blocked.slice(0, 4) };
      }) : [];
      const base = effectivePermissions(role, {}), abilities = (guest ? GUEST_ABILITIES : MEMBER_ABILITIES).map((p) => ({ id: p, on: perms.includes(p), byDefault: base.includes(p) }));
      return { user: { id: t.id, name: t.display_name, role }, roleDefault: guest ? "none" : "all", rooms, devices, scenes, routines, automations, abilities, tabs: guest ? ["rooms", "devices", "scenes", "routines", "abilities"] : ["rooms", "devices", "scenes", "routines", "automations", "abilities"] };
    })
    .get("/api/admin/users/:id/devices", ({ request, params, set }) => {
      const g = authorize(db, request, secure, ["admin.access", "users.manage"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const t = one<Pick<UserRow, "id" | "role">>(db, "SELECT id, role FROM users WHERE id = ? AND household_id = ?", params.id, g.user.householdId);
      if (!t) return deny(set, 404, "not_found");
      return { roleDefault: t.role === "guest" ? "none" : "all", overrides: all(db, "SELECT entity_id AS id, allowed FROM device_access WHERE user_id = ?", t.id) };
    });
}
