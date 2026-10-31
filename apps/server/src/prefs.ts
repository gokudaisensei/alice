import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { authorize } from "./guard";
import type { DeviceService } from "./devices";

const TEMPLATES = ["comfort", "minimal"], APPEARANCE = ["light", "dark", "system"], SECTIONS = ["favorites", "rooms", "sensors"];
const strList = (v: unknown, max = 100): string[] | null => Array.isArray(v) && v.length <= max && v.every((x) => typeof x === "string" && x.length < 200) ? [...new Set(v as string[])] : null;

/** Personal settings. Every query is keyed by the caller's own user id: nobody can read or change another member's. */
export function prefsRoutes(db: Database, secure: boolean, svc: DeviceService) {
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error }; };
  const load = (userId: string, user: any) => {
    const p: any = db.query("SELECT template, appearance, sections, room_order FROM user_prefs WHERE user_id = ?").get(userId) ?? { template: "comfort", appearance: "system", sections: '["favorites","rooms"]', room_order: "[]" };
    const ok = svc.accessor(user);
    const rooms = new Set((db.query("SELECT id FROM rooms WHERE household_id = ?").all(user.householdId) as any[]).map((r) => r.id));
    const fav = (kind: string) => (db.query("SELECT ref FROM user_favorites WHERE user_id = ? AND kind = ? ORDER BY position").all(userId, kind) as any[]).map((r) => r.ref);
    return {
      template: p.template, appearance: p.appearance, sections: JSON.parse(p.sections),
      roomOrder: (JSON.parse(p.room_order) as string[]).filter((r) => rooms.has(r)),
      favorites: { devices: fav("device").filter((id) => ok(id)), rooms: fav("room").filter((r) => rooms.has(r)) },
      // What this person reaches for most (their own taps only). Needs a habit, not a one-off, before it shows.
      frequent: (db.query("SELECT entity_id FROM device_usage WHERE user_id = ? AND count >= 3 ORDER BY count DESC, last_used DESC LIMIT 12").all(userId) as any[]).map((r) => r.entity_id as string).filter((id) => ok(id) && !fav("device").includes(id)).slice(0, 6),
    };
  };

  return new Elysia({ name: "prefs" })
    .get("/api/me/prefs", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return load(g.user.id, g.user);
    })
    .put("/api/me/prefs", ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, ["prefs.edit"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const b = body ?? {}, cur = load(g.user.id, g.user);
      const template = b.template ?? cur.template, appearance = b.appearance ?? cur.appearance;
      const sections = b.sections === undefined ? cur.sections : strList(b.sections, 10);
      const roomOrder = b.roomOrder === undefined ? cur.roomOrder : strList(b.roomOrder);
      if (!TEMPLATES.includes(template) || !APPEARANCE.includes(appearance) || !sections || !sections.every((s: string) => SECTIONS.includes(s)) || !roomOrder) return deny(set, 400, "invalid_input");
      db.query(`INSERT INTO user_prefs (user_id, template, appearance, sections, room_order) VALUES (?,?,?,?,?)
        ON CONFLICT(user_id) DO UPDATE SET template=excluded.template, appearance=excluded.appearance, sections=excluded.sections, room_order=excluded.room_order`)
        .run(g.user.id, template, appearance, JSON.stringify(sections), JSON.stringify(roomOrder));
      return load(g.user.id, g.user);
    })
    .put("/api/me/favorites", ({ request, body, set }: any) => {
      const g = authorize(db, request, secure, ["prefs.edit"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const devices = strList(body?.devices), rooms = strList(body?.rooms);
      if (!devices || !rooms) return deny(set, 400, "invalid_input");
      const ok = svc.accessor(g.user);
      const validRooms = new Set((db.query("SELECT id FROM rooms WHERE household_id = ?").all(g.user.householdId) as any[]).map((r) => r.id));
      // Only things this user can actually see may be favourited; the order given is kept.
      const keepDevices = devices.filter((id) => svc.deviceFor(g.user, id) && ok(id)), keepRooms = rooms.filter((r) => validRooms.has(r));
      db.transaction(() => {
        db.query("DELETE FROM user_favorites WHERE user_id = ?").run(g.user.id);
        keepDevices.forEach((ref, i) => db.query("INSERT INTO user_favorites (user_id, kind, ref, position) VALUES (?,?,?,?)").run(g.user.id, "device", ref, i));
        keepRooms.forEach((ref, i) => db.query("INSERT INTO user_favorites (user_id, kind, ref, position) VALUES (?,?,?,?)").run(g.user.id, "room", ref, i));
      })();
      return load(g.user.id, g.user);
    });
}
