import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { audit } from "./audit";
import { describe, toServiceCall, type Category, type Command, type Control, type Descriptor, type Reading } from "./capabilities";
import { authorize } from "./guard";
import type { HaApi, HaEntity } from "./ha";
import { SESSION, lookupSession, type SessionUser } from "./session";
import { readCookie } from "./auth";
import { MODE_ENTITY } from "./modes";

export type DeviceView = {
  id: string; name: string; category: Category; roomId: string | null;
  /** false when the device is offline OR Home Assistant is unreachable; `reason` says which */
  available: boolean; reason: "device_offline" | "home_assistant_unavailable" | null;
  state: string; controls: Control[]; reading: Reading;
  attrs: Record<string, number | string | number[] | null>;
};

const round = (n: unknown) => (typeof n === "number" ? Math.round(n) : null);

function attrsOf(d: Descriptor, e: HaEntity) {
  const a = e.attributes ?? {};
  const out: DeviceView["attrs"] = {};
  if (d.domain === "light") {
    out.brightnessPct = typeof a.brightness === "number" ? Math.round((a.brightness / 255) * 100) : null;
    out.colorTempK = round(a.color_temp_kelvin); out.hs = Array.isArray(a.hs_color) ? a.hs_color : null;
  } else if (d.domain === "fan") out.speedPct = round(a.percentage);
  else if (d.domain === "climate") { out.target = typeof a.temperature === "number" ? a.temperature : null; out.hvacAction = a.hvac_action ?? null; }
  else if (d.domain === "media_player") { out.volumePct = typeof a.volume_level === "number" ? Math.round(a.volume_level * 100) : null; out.title = a.media_title ?? null; }
  return out;
}

export function createDeviceService(db: Database, ha: HaApi) {
  const meta = (household: string) => new Map((db.query("SELECT entity_id, name, room_id, hidden FROM device_meta WHERE household_id = ?").all(household) as any[]).map((r) => [r.entity_id, r]));

  /** Role default, overridable per user. Guests start with nothing. */
  const accessor = (u: SessionUser) => {
    const rows = new Map((db.query("SELECT entity_id, allowed FROM device_access WHERE user_id = ?").all(u.id) as any[]).map((r) => [r.entity_id, !!r.allowed]));
    return (id: string) => rows.get(id) ?? u.role !== "guest";
  };

  function viewOf(e: HaEntity, m: any): DeviceView | null {
    const d = describe(e);
    if (!d.ordinary || m?.hidden) return null;
    const stale = ha.isStale(), offline = e.state === "unavailable";
    return {
      id: e.entity_id, name: m?.name || d.name, category: d.category, roomId: m?.room_id ?? null,
      available: !stale && !offline, reason: stale ? "home_assistant_unavailable" : offline ? "device_offline" : null,
      state: e.state, controls: d.controls, reading: d.reading, attrs: attrsOf(d, e),
    };
  }

  function visibleDevices(u: SessionUser): DeviceView[] {
    const ok = accessor(u), m = meta(u.householdId), out: DeviceView[] = [];
    for (const e of ha.entities.values()) { const v = ok(e.entity_id) ? viewOf(e, m.get(e.entity_id)) : null; if (v) out.push(v); }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  function deviceFor(u: SessionUser, id: string): { entity: HaEntity; view: DeviceView } | null {
    const e = ha.entities.get(id);
    if (!e || !accessor(u)(id)) return null; // same answer for "missing" and "not yours"
    const view = viewOf(e, meta(u.householdId).get(id));
    return view ? { entity: e, view } : null;
  }

  const MESSAGES: Record<string, string> = {
    ha_unavailable: "The home hub isn't reachable right now, so nothing can be controlled. Check that it is powered on and connected to your network.",
    device_unavailable: "This device is offline. Check that it has power and Wi-Fi, then try again.",
    unsupported: "This device doesn't support that.", invalid_value: "That value isn't allowed for this device.",
  };
  const say = (code: string, name: string) => (code === "device_unavailable" ? `${name} is offline. Check that it has power and Wi-Fi, then try again.` : MESSAGES[code] ?? "The device didn't accept the command.");

  /** Execute one command honestly: never queued, never assumed successful. */
  async function run(u: SessionUser, id: string, cmd: Command) {
    const dev = deviceFor(u, id);
    if (!dev) return { status: 404, body: { error: "not_found" } };
    const { view, entity } = dev;
    if (ha.isStale()) return { status: 503, body: { error: "ha_unavailable", message: say("ha_unavailable", view.name) } };
    if (!view.available) return { status: 409, body: { error: "device_unavailable", message: say("device_unavailable", view.name) } };
    const call = toServiceCall(describe(entity), cmd);
    if ("error" in call) return { status: 400, body: { error: call.error, message: say(call.error, view.name) } };
    if (call.sensitive && Date.now() - u.reauthAt > SESSION.reauthMs) return { status: 401, body: { error: "reauth_required" } };
    const res = await ha.callService(call.domain, call.service, call.data, id);
    if (call.domain === "lock") audit(db, { householdId: u.householdId, actorType: "user", actorId: u.id, action: `lock.${call.service}`, target: id, outcome: res.ok ? "success" : "failure" });
    if (!res.ok) return { status: res.error === "ha_unavailable" ? 503 : 409, body: { error: res.error, message: say(res.error, view.name) } };
    let confirmed = await ha.waitForChange(id, entity, 1500);
    const now = ha.entities.get(id);
    // Asking for what is already true (turn on a light that is on) produces no state change in Home Assistant. That is confirmed too.
    const want: Record<string, string> = { turn_on: "on", turn_off: "off", lock: "locked", unlock: "unlocked" };
    if (!confirmed && now && want[call.service] === now.state && entity.state === now.state && ["light", "switch", "fan", "lock"].includes(call.domain)) confirmed = true;
    return { status: 200, body: { ok: true, confirmed, device: now ? viewOf(now, meta(u.householdId).get(id)) : view } };
  }

  function groupsFor(u: SessionUser) {
    const ok = accessor(u);
    const groups = db.query("SELECT id, name FROM device_groups WHERE household_id = ? ORDER BY name").all(u.householdId) as any[];
    return groups.map((g) => {
      const all = (db.query("SELECT entity_id FROM group_members WHERE group_id = ?").all(g.id) as any[]).map((r) => r.entity_id);
      const mine = all.filter((id) => ok(id) && ha.entities.has(id));
      return { id: g.id, name: g.name, deviceIds: mine, hidden: all.length - mine.length };
    }).filter((g) => g.deviceIds.length > 0);
  }

  return { visibleDevices, deviceFor, run, groupsFor, accessor, meta, viewOf };
}
export type DeviceService = ReturnType<typeof createDeviceService>;

export function deviceRoutes(db: Database, ha: HaApi, secure: boolean, svc: DeviceService, extraSearch: (u: SessionUser, q: string) => Record<string, unknown[]> = () => ({})) {
  const deny = (set: any, status: number, error: string) => { set.status = status; return { error }; };
  const openStreams = new Map<string, number>();

  return new Elysia({ name: "devices" })
    .get("/api/devices", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { haHealth: ha.health(), stale: ha.isStale(), devices: svc.visibleDevices(g.user) };
    })
    .post("/api/devices/:id/command", async ({ request, params, body, set }: any) => {
      const g = authorize(db, request, secure, ["device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const r = await svc.run(g.user, params.id, { action: String(body?.action ?? ""), value: body?.value });
      set.status = r.status; return r.body;
    })
    .get("/api/devices/:id/snapshot", async ({ request, params, set }: any) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const dev = svc.deviceFor(g.user, params.id);
      if (!dev || dev.view.category !== "camera") return deny(set, 404, "not_found");
      if (!dev.view.available) return deny(set, 409, "device_unavailable");
      const img = await ha.snapshot?.(params.id);
      if (!img) return deny(set, 502, "snapshot_failed");
      return new Response(img.body, { headers: { "content-type": img.type, "cache-control": "no-store" } });
    })
    .get("/api/rooms", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const rooms = db.query("SELECT id, name FROM rooms WHERE household_id = ? ORDER BY position, name").all(g.user.householdId) as { id: string; name: string }[];
      if (g.user.permissions.includes("rooms.manage")) return { rooms };
      // Everyone else only learns about rooms that contain something they can use.
      const used = new Set(svc.visibleDevices(g.user).map((d) => d.roomId));
      return { rooms: rooms.filter((r) => used.has(r.id)) };
    })
    .get("/api/groups", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { groups: svc.groupsFor(g.user).map(({ hidden, ...x }) => x) };
    })
    .post("/api/groups/:id/command", async ({ request, params, body, set }: any) => {
      const g = authorize(db, request, secure, ["device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const action = String(body?.action ?? "");
      if (action === "lock" || action === "unlock") return deny(set, 400, "unsupported");
      const grp = svc.groupsFor(g.user).find((x) => x.id === params.id);
      if (!grp) return deny(set, 404, "not_found");
      const results = await Promise.all(grp.deviceIds.map(async (id) => {
        const r = await svc.run(g.user, id, { action, value: body?.value });
        const name = svc.deviceFor(g.user, id)?.view.name ?? id;
        return r.status === 200 ? { id, name, ok: true, confirmed: !!(r.body as any).confirmed } : { id, name, ok: false, error: (r.body as any).error, message: (r.body as any).message };
      }));
      const okCount = results.filter((r) => r.ok).length;
      // Members this user may not control are never touched, and never named; they still make the outcome "partial".
      const summary = okCount === results.length && grp.hidden === 0 ? "all" : okCount === 0 ? "none" : "partial";
      return { summary, results, notPermitted: grp.hidden };
    })
    .get("/api/search", ({ request, query, set }: any) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const q = String(query?.q ?? "").trim().toLowerCase().slice(0, 60);
      if (!q) return { devices: [], rooms: [], scenes: [], routines: [] };
      const rooms = db.query("SELECT id, name FROM rooms WHERE household_id = ?").all(g.user.householdId) as any[];
      const roomName = new Map(rooms.map((r) => [r.id, String(r.name).toLowerCase()]));
      const words: Record<Category, string> = { light: "light lights lamp", switch: "switch plug outlet socket", fan: "fan", climate: "thermostat climate air conditioner ac heating", sensor: "sensor", lock: "lock door", camera: "camera", media: "media tv television speaker player", energy: "energy power meter" };
      const matches = (d: DeviceView) => d.name.toLowerCase().includes(q) || (!!d.roomId && !!roomName.get(d.roomId)?.includes(q)) || words[d.category].split(" ").some((w) => w.startsWith(q));
      const devices = svc.visibleDevices(g.user).filter(matches).slice(0, 20);
      return { devices: devices.map((d) => ({ id: d.id, name: d.name, category: d.category, roomId: d.roomId })), rooms: rooms.filter((r) => String(r.name).toLowerCase().includes(q)).slice(0, 10), ...extraSearch(g.user, q) };
    })
    .get("/api/stream", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const uid = g.user.id, token = readCookie(request, secure ? "__Host-sid" : "sid");
      if ((openStreams.get(uid) ?? 0) >= 5) return deny(set, 429, "too_many_streams");
      openStreams.set(uid, (openStreams.get(uid) ?? 0) + 1);
      const enc = new TextEncoder();
      let cleanup = () => {};
      const stream = new ReadableStream({
        start(ctrl) {
          const send = (ev: string, data: unknown) => { try { ctrl.enqueue(enc.encode(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`)); } catch {} };
          let closed = false;
          const off = ha.subscribe((e) => {
            const user = lookupSession(db, token); // re-check on every event: revoked users stop receiving immediately
            if (!user) { cleanup(); try { ctrl.close(); } catch {} return; }
            if (e.type === "conn") return send("ha", { haHealth: ha.health(), stale: ha.isStale() });
            if (e.entityId === MODE_ENTITY) return send("mode", { mode: ha.entities.get(MODE_ENTITY)?.state ?? null });
            const dev = svc.deviceFor(user, e.entityId);
            if (dev) send("device", dev.view);
          });
          const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(":\n\n")); } catch {} }, 25_000);
          cleanup = () => { if (closed) return; closed = true; off(); clearInterval(ping); openStreams.set(uid, Math.max(0, (openStreams.get(uid) ?? 1) - 1)); };
          request.signal.addEventListener("abort", cleanup);
          send("hello", { haHealth: ha.health(), stale: ha.isStale() });
        },
        cancel() { cleanup(); },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no" } });
    });
}
