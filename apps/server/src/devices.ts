import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { audit } from "./audit";
import { describe, toServiceCall, type Category, type Command, type Control, type Descriptor, type Reading } from "./capabilities";
import { authorize } from "./guard";
import { roomRows, withAreaRooms } from "./haRooms";
import type { HaApi, HaEntity, Parent } from "./ha";
import { SESSION, lookupSession, type SessionUser } from "./session";
import { readCookie } from "./auth";
import { MODE_ENTITY } from "./modes";
import { all, one } from "./sql";
import { asObject, deny, text, type ErrorBody } from "./http";

/** The readings a screen needs from a device, which ones depend on its kind. The hub's raw attributes never leave the server. */
export type DeviceAttrs = {
  brightnessPct?: number | null; colorTempK?: number | null; hs?: number[] | null; // lights
  speedPct?: number | null; // fans
  target?: number | null; hvacAction?: string | null; // thermostats
  volumePct?: number | null; title?: string | null; source?: string | null; // media players
  positionPct?: number | null; tiltPct?: number | null; // covers and valves
  speed?: string | null; batteryPct?: number | null; // vacuums
  humidityPct?: number | null; targetHumidityPct?: number | null; mode?: string | null; // humidifiers
  codeRequired?: boolean; // alarm panels
  value?: number | null; option?: string | null; // numbers and selects
  condition?: string | null; // weather
};

export type DeviceView = {
  id: string; name: string; category: Category; roomId: string | null;
  /** false when the device is offline OR Home Assistant is unreachable; `reason` says which */
  available: boolean; reason: "device_offline" | "home_assistant_unavailable" | null;
  state: string; controls: Control[]; reading: Reading;
  attrs: DeviceAttrs;
  /** the icon a person chose for it, or null to let the app pick one */
  icon: string | null;
  /** when the state last changed, as reported by the hub (ms since 1970) */
  changedAt: number | null;
  /** the hub's device class (outlet, speaker, …) when it gives one, so a plain switch is not mistaken for a plug */
  deviceClass: string | null;
  /** "Spaceship · Speaker": only for a physical device that shows as more than one card here */
  subtitle: string | null;
};

const sentence = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const FUNCTIONS: Partial<Record<Category, string>> = { light: "Light", fan: "Fan", climate: "Thermostat", lock: "Lock", camera: "Camera" };
const MEDIA: Record<string, string> = { speaker: "Speaker", tv: "TV", receiver: "Receiver" };
const SWITCH: Record<string, string> = { outlet: "Outlet", switch: "Switch" };

/** What a card is within its device, from what the hub says it is (never from its name): "Speaker", "Camera", or its own label when the hub gives no class. */
export function partOf(category: Category, p: Parent, friendly: string, attrCls?: unknown): string {
  const cls = p.cls ?? (typeof attrCls === "string" ? attrCls : "");
  const own = () => {
    const l = p.label ?? friendly;
    const lower = l.toLowerCase(), dn = p.deviceName.toLowerCase();
    return sentence((lower.startsWith(dn + " ") ? l.slice(dn.length + 1) : l).trim());
  };
  if (category === "media") return MEDIA[cls] ?? "Media player";
  if (category === "switch") return SWITCH[cls] ?? own();
  if (category === "sensor" || category === "energy") return cls ? sentence(cls.replace(/_/g, " ")) : own();
  return FUNCTIONS[category] ?? own();
}

export type DeviceMeta = { entity_id: string; name: string | null; room_id: string | null; hidden: number; icon: string | null; /** shown although it is a helper or a part of another device */ pinned: number };
/** What kind of thing an entity is for the household: a device, a setting of a device ("part"), or a free-standing helper value. Only devices are shown unless someone pins the rest. */
export type Kind = "device" | "part" | "helper";
/** A device that has one of these is a thing in its own right; its switches and buttons are only its settings. */
const PRIMARY: Category[] = ["light", "media", "camera", "climate", "fan", "lock", "cover", "vacuum", "humidifier", "waterheater", "valve", "alarm", "siren"];
type RunResult =
  | { status: 200; body: { ok: true; confirmed: boolean; device: DeviceView | null } }
  | { status: 400 | 401 | 404 | 409 | 503; body: ErrorBody };

const round = (n: unknown) => (typeof n === "number" ? Math.round(n) : null);

function attrsOf(d: Descriptor, e: HaEntity): DeviceAttrs {
  const a = e.attributes;
  const out: DeviceAttrs = {};
  if (d.domain === "light") {
    out.brightnessPct = typeof a.brightness === "number" ? Math.round((a.brightness / 255) * 100) : null;
    out.colorTempK = round(a.color_temp_kelvin); out.hs = Array.isArray(a.hs_color) ? a.hs_color.filter((x): x is number => typeof x === "number") : null;
  } else if (d.domain === "fan") out.speedPct = round(a.percentage);
  else if (d.domain === "cover" || d.domain === "valve") { out.positionPct = round(a.current_position); out.tiltPct = round(a.current_tilt_position); }
  else if (d.domain === "vacuum") { out.speed = typeof a.fan_speed === "string" ? a.fan_speed : null; out.batteryPct = round(a.battery_level); }
  else if (d.domain === "humidifier") { out.humidityPct = round(a.current_humidity); out.targetHumidityPct = round(a.humidity); out.mode = typeof a.mode === "string" ? a.mode : null; }
  else if (d.domain === "water_heater") { out.target = typeof a.temperature === "number" ? a.temperature : null; out.mode = typeof a.operation_mode === "string" ? a.operation_mode : null; }
  else if (d.domain === "alarm_control_panel") out.codeRequired = a.code_format === "number" || a.code_format === "text";
  else if (d.domain === "number" || d.domain === "input_number") out.value = Number.isFinite(Number(e.state)) ? Number(e.state) : null;
  else if (d.domain === "select" || d.domain === "input_select") out.option = e.state;
  else if (d.domain === "weather") { out.condition = e.state; out.target = typeof a.temperature === "number" ? a.temperature : null; out.humidityPct = round(a.humidity); }
  else if (d.domain === "climate") { out.target = typeof a.temperature === "number" ? a.temperature : null; out.hvacAction = typeof a.hvac_action === "string" ? a.hvac_action : null; }
  else if (d.domain === "media_player") { out.volumePct = typeof a.volume_level === "number" ? Math.round(a.volume_level * 100) : null; out.title = typeof a.media_title === "string" ? a.media_title : null; out.source = typeof a.source === "string" ? a.source : null; }
  return out;
}

export function createDeviceService(db: Database, ha: HaApi) {
  const meta = (household: string) => withAreaRooms(db, ha, household, new Map(all<DeviceMeta>(db, "SELECT entity_id, name, room_id, hidden, icon, pinned FROM device_meta WHERE household_id = ?", household).map((r) => [r.entity_id, r])));

  // Which physical devices have a main function (a light, a speaker, a camera…). Worked out again only when the hub's entities or registry change.
  let primary: { parents: unknown; n: number; set: Set<string> } | null = null;
  function primaryDevices(): Set<string> {
    if (primary && primary.parents === ha.parents && primary.n === ha.entities.size) return primary.set;
    const set = new Set<string>();
    for (const e of ha.entities.values()) { const p = ha.parents?.get(e.entity_id); if (p && !ha.secondary?.has(e.entity_id) && PRIMARY.includes(describe(e).category)) set.add(p.deviceId); }
    primary = { parents: ha.parents, n: ha.entities.size, set };
    return set;
  }
  function kindOf(e: HaEntity): Kind {
    const d = describe(e), p = ha.parents?.get(e.entity_id);
    if (d.category === "input") return p ? "part" : "helper";
    if (d.category === "switch" && p && primaryDevices().has(p.deviceId) && p.cls !== "outlet") return "part";
    return "device";
  }

  /** Role default, overridable per user. Guests start with nothing. */
  const accessor = (u: Pick<SessionUser, "id" | "role">) => {
    const rows = new Map(all<{ entity_id: string; allowed: number }>(db, "SELECT entity_id, allowed FROM device_access WHERE user_id = ?", u.id).map((r) => [r.entity_id, !!r.allowed]));
    return (id: string) => {
      // Guests never see energy use, whatever they were granted: it says when the house is empty and what is in it.
      if (u.role === "guest") { const e = ha.entities.get(id); if (e && describe(e).category === "energy") return false; }
      return rows.get(id) ?? u.role !== "guest";
    };
  };

  function viewOf(e: HaEntity, m: DeviceMeta | undefined): DeviceView | null {
    const d = describe(e);
    if (!d.ordinary || m?.hidden || ha.secondary?.has(e.entity_id)) return null;
    if (!m?.pinned && kindOf(e) !== "device") return null; // a setting or helper stays out of sight until someone chooses to show it
    const stale = ha.isStale(), offline = e.state === "unavailable";
    return {
      id: e.entity_id, name: m?.name || d.name, category: d.category, roomId: m?.room_id ?? null,
      available: !stale && !offline, reason: stale ? "home_assistant_unavailable" : offline ? "device_offline" : null,
      state: e.state, controls: d.controls, reading: d.reading, attrs: attrsOf(d, e),
      changedAt: Date.parse(e.last_changed ?? e.last_updated ?? "") || null, icon: m?.icon ?? null,
      deviceClass: ha.parents?.get(e.entity_id)?.cls ?? (typeof e.attributes.device_class === "string" ? e.attributes.device_class : null), subtitle: null,
    };
  }

  /** Names a card after its physical device when that device shows as two or more cards ("Spaceship · Speaker"); a lone card keeps its own name. */
  function withSubtitles(views: DeviceView[], named: Map<string, DeviceMeta>): DeviceView[] {
    const parents = ha.parents; if (!parents?.size) return views;
    const count = new Map<string, number>();
    for (const v of views) { const p = parents.get(v.id); if (p) count.set(p.deviceId, (count.get(p.deviceId) ?? 0) + 1); }
    // One speaker can show up as several players (its own, AirPlay, Cast). One card is enough: the one that can do the most.
    const best = new Map<string, DeviceView>();
    const score = (v: DeviceView) => { const m = v.controls.find((c) => c.type === "media"); return m ? Number(m.playback) + Number(m.volume) + Number(m.power) + Number(m.browse) + m.sources.length + (v.deviceClass === "speaker" ? 0.5 : 0) : 0; };
    for (const v of views) if (v.category === "media") { const k = parents.get(v.id)?.deviceId; if (k) { const cur = best.get(k); if (!cur || score(v) > score(cur) || (score(v) === score(cur) && v.id < cur.id)) best.set(k, v); } }
    views = views.filter((v) => { if (v.category !== "media") return true; const k = parents.get(v.id)?.deviceId; return !k || best.get(k) === v; });
    return views.map((v) => {
      const p = parents.get(v.id);
      if (!p || (count.get(p.deviceId) ?? 0) < 2) return v;
      // The hub's own name for a part repeats its device ("spaceship microphone Microphone mute"); inside a group the part's own label is enough.
      const own = !named.get(v.id)?.name && p.label ? sentence(p.label) : null;
      return { ...v, ...(own ? { name: own } : {}), subtitle: `${sentence(p.deviceName)} · ${partOf(v.category, p, String(ha.entities.get(v.id)?.attributes.friendly_name ?? v.id), ha.entities.get(v.id)?.attributes.device_class)}` };
    });
  }

  function visibleDevices(u: SessionUser): DeviceView[] {
    const ok = accessor(u), m = meta(u.householdId), out: DeviceView[] = [];
    for (const e of ha.entities.values()) { const v = ok(e.entity_id) ? viewOf(e, m.get(e.entity_id)) : null; if (v) out.push(v); }
    return withSubtitles(out, m).sort((a, b) => a.name.localeCompare(b.name));
  }

  function deviceFor(u: SessionUser, id: string): { entity: HaEntity; view: DeviceView } | null {
    const e = ha.entities.get(id);
    if (!e || !accessor(u)(id)) return null; // same answer for "missing" and "not yours"
    const view = viewOf(e, meta(u.householdId).get(id));
    if (!view) return null;
    const p = ha.parents?.get(id);
    // Counting siblings needs every card of that device, so only do the work for entities that have a parent.
    if (p) { const m = meta(u.householdId), ok = accessor(u); const sibs = [...ha.entities.values()].filter((x) => ha.parents?.get(x.entity_id)?.deviceId === p.deviceId && ok(x.entity_id)).map((x) => viewOf(x, m.get(x.entity_id))).filter((x): x is DeviceView => !!x); return { entity: e, view: withSubtitles(sibs, m).find((x) => x.id === id) ?? view }; }
    return { entity: e, view };
  }

  const MESSAGES: Record<string, string> = {
    ha_unavailable: "The home hub isn't reachable right now, so nothing can be controlled. Check that it is powered on and connected to your network.",
    device_unavailable: "This device is offline. Check that it has power and Wi-Fi, then try again.",
    unsupported: "This device doesn't support that.", invalid_value: "That value isn't allowed for this device.",
  };
  const say = (code: string, name: string) => (code === "device_unavailable" ? `${name} is offline. Check that it has power and Wi-Fi, then try again.` : MESSAGES[code] ?? "The device didn't accept the command.");

  /** Execute one command honestly: never queued, never assumed successful. */
  async function run(u: SessionUser, id: string, cmd: Command): Promise<RunResult> {
    const dev = deviceFor(u, id);
    if (!dev) return { status: 404, body: { error: "not_found" } };
    const { view, entity } = dev;
    if (ha.isStale()) return { status: 503, body: { error: "ha_unavailable", message: say("ha_unavailable", view.name) } };
    if (!view.available) return { status: 409, body: { error: "device_unavailable", message: say("device_unavailable", view.name) } };
    const call = toServiceCall(describe(entity), cmd);
    if ("error" in call) return { status: 400, body: { error: call.error, message: say(call.error, view.name) } };
    if (call.sensitive && Date.now() - u.reauthAt > SESSION.reauthMs) return { status: 401, body: { error: "reauth_required" } };
    const res = await ha.callService(call.domain, call.service, call.data, id);
    if (call.domain === "lock" || call.sensitive) audit(db, { householdId: u.householdId, actorType: "user", actorId: u.id, action: call.domain === "lock" ? `lock.${call.service}` : `${call.domain}.${call.service}`, target: id, outcome: res.ok ? "success" : "failure" });
    if (!res.ok) return { status: res.error === "ha_unavailable" ? 503 : 409, body: { error: res.error, message: say(res.error, view.name) } };
    let confirmed = await ha.waitForChange(id, entity, 1500);
    const now = ha.entities.get(id);
    // Asking for what is already true (turn on a light that is on) produces no state change in Home Assistant. That is confirmed too.
    const want: Record<string, string> = { turn_on: "on", turn_off: "off", lock: "locked", unlock: "unlocked" };
    if (!confirmed && now && want[call.service] === now.state && entity.state === now.state && ["light", "switch", "fan", "lock"].includes(call.domain)) confirmed = true;
    db.query("INSERT INTO device_usage (user_id, entity_id, count, last_used) VALUES (?,?,1,?) ON CONFLICT(user_id, entity_id) DO UPDATE SET count = count + 1, last_used = excluded.last_used").run(u.id, id, Date.now());
    return { status: 200, body: { ok: true, confirmed, device: now ? viewOf(now, meta(u.householdId).get(id)) : view } };
  }

  function groupsFor(u: SessionUser) {
    const ok = accessor(u);
    const groups = all<{ id: string; name: string; ha_label_id: string | null }>(db, "SELECT id, name, ha_label_id FROM device_groups WHERE household_id = ? ORDER BY name", u.householdId);
    return groups.map((g) => {
      // A group that mirrors a hub label has whatever carries the label there, besides anything added by hand.
      const labelled = g.ha_label_id ? [...(ha.labelsOf ?? [])].filter(([, l]) => l.includes(g.ha_label_id as string)).map(([id]) => id) : [];
      const members = [...new Set([...all<{ entity_id: string }>(db, "SELECT entity_id FROM group_members WHERE group_id = ?", g.id).map((r) => r.entity_id), ...labelled])];
      const mine = members.filter((id) => ok(id) && ha.entities.has(id));
      return { id: g.id, name: (g.ha_label_id && ha.labels?.get(g.ha_label_id)) || g.name, deviceIds: mine, hidden: members.length - mine.length };
    }).filter((g) => g.deviceIds.length > 0);
  }

  /** Is this something the household sees as a device? (Alerts and lists use it, so they say nothing about a setting or a helper.) */
  const shown = (household: string, id: string) => { const e = ha.entities.get(id); return !!e && viewOf(e, meta(household).get(id)) !== null; };
  return { visibleDevices, deviceFor, run, groupsFor, accessor, meta, viewOf, kindOf, shown };
}
export type DeviceService = ReturnType<typeof createDeviceService>;

export function deviceRoutes(db: Database, ha: HaApi, secure: boolean, svc: DeviceService, extraSearch: (u: SessionUser, q: string) => Record<string, unknown[]> = () => ({})) {
  const openStreams = new Map<string, number>();
  /** Hourly averages from the hub's long-term statistics, for readings (temperature, power) it keeps them for. */
  async function longHistory(id: string, hours: number): Promise<{ t: number; state: string }[] | null> {
    const r = await ha.ws({ type: "recorder/statistics_during_period", start_time: new Date(Date.now() - hours * 3600_000).toISOString(), statistic_ids: [id], period: "hour", types: ["mean"] });
    const rows = r.success && r.result && typeof r.result === "object" ? ((r.result as Record<string, { start?: number | string; mean?: number | null }[]>)[id] ?? []) : [];
    const pts = rows.flatMap((x) => { const t = typeof x.start === "number" ? x.start : Date.parse(String(x.start ?? "")); return Number.isFinite(t) && typeof x.mean === "number" ? [{ t, state: String(Math.round(x.mean * 100) / 100) }] : []; });
    return pts.length >= 2 ? pts : null;
  }

  return new Elysia({ name: "devices" })
    .get("/api/devices", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { haHealth: ha.health(), stale: ha.isStale(), devices: svc.visibleDevices(g.user) };
    })
    .post("/api/devices/:id/command", async ({ request, params, body, set }) => {
      const g = authorize(db, request, secure, ["device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const input = asObject(body);
      const r = await svc.run(g.user, params.id, { action: text(input.action), value: input.value });
      set.status = r.status; return r.body;
    })
    // What the hub's registry knows about the thing behind a card.
    .get("/api/devices/:id/about", ({ request, params, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const dev = svc.deviceFor(g.user, params.id);
      if (!dev) return deny(set, 404, "not_found");
      const p = ha.parents?.get(params.id), info = p ? ha.deviceInfo?.get(p.deviceId) : undefined;
      const area = ha.areaOf?.get(params.id), a = area ? ha.areas?.get(area) : undefined;
      const mates = p ? [...ha.entities.values()].filter((x) => ha.parents?.get(x.entity_id)?.deviceId === p.deviceId) : [dev.entity];
      const bat = mates.find((x) => x.attributes.device_class === "battery" && Number.isFinite(Number(x.state)) && x.attributes.unit_of_measurement === "%");
      const level = bat ? Number(bat.state) : typeof dev.entity.attributes.battery_level === "number" ? dev.entity.attributes.battery_level : null;
      return {
        device: p?.deviceName ?? null, manufacturer: info?.manufacturer ?? null, model: info?.model ?? null, firmware: info?.firmware ?? null,
        integration: ha.platformOf?.get(params.id) ?? null, room: a?.name ?? null, floor: (a?.floorId && ha.floors?.get(a.floorId)?.name) || null,
        battery: level === null ? null : Math.round(level), labels: (ha.labelsOf?.get(params.id) ?? []).map((l) => ha.labels?.get(l)).filter(Boolean),
      };
    })
    .get("/api/devices/:id/snapshot", async ({ request, params, set }) => {
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
      const rooms = roomRows(db, ha, g.user.householdId).map(({ id, name, color, icon, floor }) => ({ id, name, color, icon, floor }));
      if (g.user.permissions.includes("rooms.manage")) return { rooms };
      // Everyone else only learns about rooms that contain something they can use.
      const used = new Set(svc.visibleDevices(g.user).map((d) => d.roomId));
      return { rooms: rooms.filter((r) => used.has(r.id)) };
    })
    .get("/api/groups", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { groups: svc.groupsFor(g.user).map(({ hidden, ...x }) => x) };
    })
    .post("/api/groups/:id/command", async ({ request, params, body, set }) => {
      const g = authorize(db, request, secure, ["device.control"]); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const input = asObject(body), action = text(input.action);
      if (action === "lock" || action === "unlock") return deny(set, 400, "unsupported");
      const grp = svc.groupsFor(g.user).find((x) => x.id === params.id);
      if (!grp) return deny(set, 404, "not_found");
      const results = await Promise.all(grp.deviceIds.map(async (id) => {
        const r = await svc.run(g.user, id, { action, value: input.value });
        const name = svc.deviceFor(g.user, id)?.view.name ?? id;
        return r.status === 200 ? { id, name, ok: true, confirmed: r.body.confirmed } : { id, name, ok: false, error: r.body.error, message: r.body.message };
      }));
      const okCount = results.filter((r) => r.ok).length;
      // Members this user may not control are never touched, and never named; they still make the outcome "partial".
      const summary = okCount === results.length && grp.hidden === 0 ? "all" : okCount === 0 ? "none" : "partial";
      return { summary, results, notPermitted: grp.hidden };
    })
    .get("/api/search", ({ request, query, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const q = text(query.q).trim().toLowerCase().slice(0, 60);
      if (!q) return { devices: [], rooms: [], scenes: [], routines: [] };
      const rooms = roomRows(db, ha, g.user.householdId).map(({ id, name }) => ({ id, name }));
      const roomName = new Map(rooms.map((r) => [r.id, r.name.toLowerCase()]));
      const words: Record<Category, string> = { light: "light lights lamp", switch: "switch plug outlet socket", fan: "fan", climate: "thermostat climate air conditioner ac heating", sensor: "sensor", lock: "lock door", camera: "camera", media: "media tv television speaker player", energy: "energy power meter", cover: "cover blind blinds curtain shade garage gate shutter", vacuum: "vacuum robot cleaner", humidifier: "humidifier humidity", valve: "valve water gas", waterheater: "water heater geyser boiler", siren: "siren alarm", alarm: "alarm security", input: "helper switch number option button", weather: "weather forecast" };
      const matches = (d: DeviceView) => d.name.toLowerCase().includes(q) || (!!d.roomId && !!roomName.get(d.roomId)?.includes(q)) || words[d.category].split(" ").some((w) => w.startsWith(q));
      const devices = svc.visibleDevices(g.user).filter(matches).slice(0, 20);
      return { devices: devices.map((d) => ({ id: d.id, name: d.name, category: d.category, roomId: d.roomId })), rooms: rooms.filter((r) => r.name.toLowerCase().includes(q)).slice(0, 10), ...extraSearch(g.user, q) };
    })
    // Today's story for one device: state changes over the last day, thinned out to a size a phone can draw.
    .get("/api/devices/:id/history", async ({ request, params, query, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const dev = svc.deviceFor(g.user, params.id);
      if (!dev) return deny(set, 404, "not_found");
      const hours = Math.min(720, Math.max(1, Math.round(Number(query.hours ?? 24)) || 24));
      // Beyond three days the hub keeps hourly statistics, not every change; a reading with none falls back to the raw history it still has.
      let pts = hours > 72 ? await longHistory(params.id, hours) : null;
      pts ??= ha.history ? await ha.history(params.id, hours) : null;
      if (!pts) return deny(set, 503, "ha_unavailable");
      const numeric = pts.length > 0 && pts.every((p) => Number.isFinite(Number(p.state)));
      const step = Math.max(1, Math.ceil(pts.length / 200));
      return { kind: numeric ? "numeric" : "state", points: pts.filter((_, i) => i % step === 0 || i === pts.length - 1), now: Date.now(), hours };
    })
    // Who last changed a device from this app. A change the app did not make (made in Home Assistant or at the device) has no name.
    .get("/api/devices/:id/last-change", ({ request, params, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const dev = svc.deviceFor(g.user, params.id);
      if (!dev) return deny(set, 404, "not_found");
      const row = one<{ name: string; at: number }>(db, "SELECT u.display_name AS name, d.last_used AS at FROM device_usage d JOIN users u ON u.id = d.user_id WHERE d.entity_id = ? AND u.household_id = ? ORDER BY d.last_used DESC LIMIT 1", params.id, g.user.householdId);
      const changed = Date.parse(dev.entity.last_changed ?? dev.entity.last_updated ?? "") || null;
      // Our own record counts only if it sits right beside the hub's last change; otherwise something else changed it since.
      const ours = !!row && !!changed && Math.abs(row.at - changed) < 20_000;
      return { at: changed, by: ours ? (g.user.role === "guest" ? "someone in the home" : row!.name) : null };
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
            if (e.type !== "entity") return;
            if (e.entityId === MODE_ENTITY) return send("mode", { mode: ha.entities.get(MODE_ENTITY)?.state ?? null });
            const dev = svc.deviceFor(user, e.entityId);
            if (dev) send("device", dev.view);
          });
          const ping = setInterval(() => { try { ctrl.enqueue(enc.encode(":\n\n")); } catch {} }, 15_000);
          cleanup = () => { if (closed) return; closed = true; off(); clearInterval(ping); openStreams.set(uid, Math.max(0, (openStreams.get(uid) ?? 1) - 1)); };
          request.signal.addEventListener("abort", cleanup);
          send("hello", { haHealth: ha.health(), stale: ha.isStale() });
        },
        cancel() { cleanup(); },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", "x-accel-buffering": "no" } });
    });
}
