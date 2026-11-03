import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { activity, audit } from "./audit";
import { authorize } from "./guard";
import type { HaApi } from "./ha";
import type { DeviceMeta } from "./devices";
import { asObject, denyWith as deny } from "./http";
import { all, scalar } from "./sql";

export type RoomRow = { id: string; name: string; color: string | null; icon: string | null; ha_area_id: string | null };

/**
 * Rooms that mirror a Home Assistant area take their name from it, so a rename there shows up here.
 * Colour, icon and order stay the household's own.
 */
export function roomRows(db: Database, ha: HaApi, household: string): (RoomRow & { floor: string | null })[] {
  return all<RoomRow>(db, "SELECT id, name, color, icon, ha_area_id FROM rooms WHERE household_id = ? ORDER BY position, name", household).map((r) => {
    const area = r.ha_area_id ? ha.areas?.get(r.ha_area_id) : undefined;
    return { ...r, name: area?.name ?? r.name, floor: (area?.floorId && ha.floors?.get(area.floorId)?.name) || null };
  });
}

/**
 * The household's own placement of each device, with Home Assistant's area filling in wherever the household has not chosen.
 * The household always wins: a device it put in the den stays there, whatever the hub says.
 */
export function withAreaRooms(db: Database, ha: HaApi, household: string, own: Map<string, DeviceMeta>): Map<string, DeviceMeta> {
  if (!ha.areaOf?.size) return own;
  const room = new Map(all<{ ha_area_id: string; id: string }>(db, "SELECT ha_area_id, id FROM rooms WHERE household_id = ? AND ha_area_id IS NOT NULL", household).map((r) => [r.ha_area_id, r.id]));
  if (!room.size) return own;
  const out = new Map(own);
  for (const [entityId, areaId] of ha.areaOf) {
    const roomId = room.get(areaId), m = out.get(entityId);
    if (!roomId || m?.room_id) continue;
    out.set(entityId, { entity_id: entityId, name: null, hidden: 0, icon: null, ...m, room_id: roomId });
  }
  return out;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Bringing the hub's areas in as rooms: shown first, applied only when an admin says so, and never deleting anything. */
export function haRoomRoutes(db: Database, ha: HaApi, secure: boolean) {
  const org = (req: Request) => authorize(db, req, secure, ["admin.access", "rooms.manage"]);

  function plan(household: string) {
    const rooms = all<RoomRow>(db, "SELECT id, name, color, icon, ha_area_id FROM rooms WHERE household_id = ?", household);
    const linked = new Map(rooms.filter((r) => r.ha_area_id).map((r) => [r.ha_area_id as string, r]));
    const byName = new Map(rooms.filter((r) => !r.ha_area_id).map((r) => [norm(r.name), r]));
    const count = new Map<string, number>();
    for (const a of ha.areaOf?.values() ?? []) count.set(a, (count.get(a) ?? 0) + 1);
    return [...(ha.areas?.values() ?? [])].map((a) => {
      const l = linked.get(a.id), m = l ? undefined : byName.get(norm(a.name));
      return {
        id: a.id, name: a.name, floor: (a.floorId && ha.floors?.get(a.floorId)?.name) || null, devices: count.get(a.id) ?? 0,
        state: l ? ("linked" as const) : m ? ("match" as const) : ("new" as const), roomId: (l ?? m)?.id ?? null,
      };
    }).sort((x, y) => Number(x.floor === null) - Number(y.floor === null) || (x.floor ?? "").localeCompare(y.floor ?? "") || x.name.localeCompare(y.name)); // rooms on a floor first
  }

  return new Elysia({ name: "ha-rooms" })
    .get("/api/admin/rooms/ha-areas", ({ request, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { available: !ha.isStale() && !!ha.areas?.size, areas: plan(g.user.householdId) };
    })
    .post("/api/admin/rooms/ha-import", ({ request, body, set }) => {
      const g = org(request); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      const h = g.user.householdId, want = asObject(body).areaIds;
      if (want !== undefined && !(Array.isArray(want) && want.every((x) => typeof x === "string"))) return deny(set, 400, "invalid_input");
      const pick = new Set<string>(want as string[] | undefined);
      let created = 0, linked = 0;
      db.transaction(() => {
        for (const a of plan(h)) {
          if (a.state === "linked" || (want && !pick.has(a.id))) continue;
          if (a.state === "match" && a.roomId) { db.query("UPDATE rooms SET ha_area_id = ? WHERE id = ? AND household_id = ?").run(a.id, a.roomId, h); linked++; }
          else {
            const pos = scalar(db, "SELECT COALESCE(MAX(position),0)+1 FROM rooms WHERE household_id = ?", 1, h);
            db.query("INSERT INTO rooms (id, household_id, name, position, ha_area_id) VALUES (?,?,?,?,?)").run(randomUUID(), h, a.name, pos, a.id); created++;
          }
        }
      })();
      audit(db, { householdId: h, actorType: "user", actorId: g.user.id, action: "room.ha_import", target: "home_assistant", outcome: "success", reason: `created=${created} linked=${linked}` });
      if (created + linked) activity(db, h, "rooms", `Rooms were brought in from Home Assistant (${created} new, ${linked} matched)`);
      return { ok: true, created, linked };
    });
}
