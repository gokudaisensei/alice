export type HaConn = "connecting" | "connected" | "auth_failed" | "disconnected";
/** Whatever the device reports. Read it through {@link attrString}, {@link attrNumber}, or narrow it yourself. */
export type HaAttributes = Record<string, unknown>;
export type HaEntity = { entity_id: string; state: string; attributes: HaAttributes; last_updated?: string; last_changed?: string };

/** The entity's `friendly_name`, falling back to `fallback` (its id by default). */
export const friendlyName = (e: HaEntity | undefined, fallback = e?.entity_id ?? ""): string => String(e?.attributes.friendly_name ?? fallback);
export const attrString = (e: HaEntity | undefined, key: string): string | undefined => {
  const v = e?.attributes[key];
  return typeof v === "string" ? v : undefined;
};

/** Messages on the Home Assistant WebSocket that this client reads. Anything else is ignored. */
type HaMessage =
  | { type: "auth_required" | "auth_invalid" | "auth_ok" }
  | { type: "event"; event?: { event_type?: string; data: { entity_id: string; new_state: HaEntity | null } } }
  | HaReply;
/** The answer to a command we sent, matched by `id`. */
export type HaReply = { type?: "result"; id?: number; success: boolean; error?: { code?: string; message?: string }; result?: unknown };
/** The physical device an entity is a part of. `label` is what the entity is called within it; `cls` is its device class. */
/** An area (room) and floor as the hub's registry has them. */
export type HaArea = { id: string; name: string; floorId: string | null };
export type HaFloor = { id: string; name: string; level: number | null };
export type Parent = { deviceId: string; deviceName: string; label: string | null; cls: string | null };

export interface HaHealth { health(): "ok" | "unreachable" | "auth_failed" }
export type HaEvent = { type: "entity"; entityId: string } | { type: "conn" };
/** Changes to the registries that describe the home (what is a device, what room it is in). Any of them means the cached structure is out of date. */
export const REGISTRY_EVENTS = ["entity_registry_updated", "device_registry_updated", "area_registry_updated", "floor_registry_updated", "label_registry_updated"] as const;
/** What the hub says about itself: used to word things the way the household does (units, time zone) and to spot an old version. */
export type HaInfo = { version: string | null; timeZone: string | null; locationName: string | null; metric: boolean | null };
export type HaOptions = {
  /** how often to check the link is alive */ pingMs?: number;
  /** how long a reply may take before the link counts as dead */ replyMs?: number;
  /** wait after a registry change before re-reading, so a burst is read once */ registryDebounceMs?: number;
};
export type CallResult = { ok: true } | { ok: false; error: string };
export interface HaApi extends HaHealth {
  entities: ReadonlyMap<string, HaEntity>;
  /** Entities the hub marks as configuration, diagnostics, hidden or disabled: parts of a device, not things to show as devices. */
  secondary?: ReadonlySet<string>;
  /** Version, time zone and unit system, once the hub has said. */
  info?: HaInfo;
  /** The hub's areas and floors, and which area each entity is in (its own, else its device's). */
  areas?: ReadonlyMap<string, HaArea>;
  floors?: ReadonlyMap<string, HaFloor>;
  areaOf?: ReadonlyMap<string, string>;
  /** Which physical device an entity belongs to, from the hub's registries (name as the person sees it, and the entity's own label). */
  parents?: ReadonlyMap<string, Parent>;
  isStale(): boolean;
  callService(domain: string, service: string, data?: Record<string, unknown>, entityId?: string): Promise<CallResult>;
  /** Resolves true if HA reports a new state for the entity within `ms` (i.e. the device actually responded). */
  waitForChange(entityId: string, before: HaEntity | undefined, ms: number): Promise<boolean>;
  subscribe(cb: (e: HaEvent) => void): () => void;
  /** Write/delete HA's own config (scenes, scripts). Needs an HA admin token; see docs/SECURITY.md. */
  config(method: "POST" | "DELETE", path: string, body?: unknown): Promise<{ ok: boolean; error?: string }>;
  /** Raw WebSocket command (used for creating the mode helper). */
  ws(msg: Record<string, unknown>): Promise<HaReply>;
  /** Resolves with the first entity (now or soon) matching `pred`, or null on timeout. */
  waitFor(pred: (e: HaEntity) => boolean, ms: number): Promise<HaEntity | null>;
  snapshot?(entityId: string): Promise<{ body: ArrayBuffer; type: string } | null>;
  /** State changes for one entity over the last `hours`, oldest first. */
  history?(entityId: string, hours: number): Promise<{ t: number; state: string }[] | null>;
}

type HistoryRow = { state: unknown; last_changed?: string; last_updated?: string };

/** Single persistent WebSocket to Home Assistant. State cache is in memory only; HA stays the source of truth. */
export class HaClient implements HaApi {
  conn: HaConn = "disconnected";
  entities = new Map<string, HaEntity>();
  secondary = new Set<string>();
  parents = new Map<string, Parent>();
  areas = new Map<string, HaArea>();
  floors = new Map<string, HaFloor>();
  areaOf = new Map<string, string>();
  info: HaInfo = { version: null, timeZone: null, locationName: null, metric: null };
  lastMessageAt = 0;
  private pinger: ReturnType<typeof setInterval> | null = null;
  private registryTimer: ReturnType<typeof setTimeout> | null = null;
  private registryGen = 0;
  private sock: WebSocket | null = null;
  private nextId = 1;
  private waiting = new Map<number, (m: HaReply) => void>();
  private backoff = 1000;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private listeners = new Set<(e: HaEvent) => void>();

  subscribe(cb: (e: HaEvent) => void) { this.listeners.add(cb); return () => { this.listeners.delete(cb); }; }
  private emit(e: HaEvent) { for (const l of this.listeners) { try { l(e); } catch {} } }
  waitForChange(entityId: string, before: HaEntity | undefined, ms: number): Promise<boolean> {
    if (this.entities.get(entityId) !== before) return Promise.resolve(true); // the update may already have arrived
    return new Promise((resolve) => {
      const done = (v: boolean) => { clearTimeout(t); off(); resolve(v); };
      const off = this.subscribe((e) => { if (e.type === "entity" && e.entityId === entityId && this.entities.get(entityId) !== before) done(true); });
      const t = setTimeout(() => done(false), ms);
    });
  }

  private readonly url: string;
  private readonly token: string;
  private readonly pingMs: number;
  private readonly replyMs: number;
  private readonly registryDebounceMs: number;
  constructor(url: string, token: string, opts: HaOptions = {}) {
    this.url = url; this.token = token;
    this.pingMs = opts.pingMs ?? 30_000; this.replyMs = opts.replyMs ?? 10_000; this.registryDebounceMs = opts.registryDebounceMs ?? 400;
  }

  health() { return this.conn === "connected" ? "ok" : this.conn === "auth_failed" ? "auth_failed" : "unreachable"; }
  /** Cached state can't be trusted while disconnected. Callers must show it as stale. */
  isStale() { return this.conn !== "connected"; }

  start() { this.stopped = false; this.connect(); }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); if (this.registryTimer) clearTimeout(this.registryTimer); this.stopPinger(); this.sock?.close(); }

  /** A link can die without a close event (a router dropping the connection). A ping that gets no answer is how we find out. */
  private startPinger() {
    this.stopPinger();
    this.pinger = setInterval(async () => {
      const sock = this.sock;
      if (this.conn !== "connected" || !sock) return;
      const r = await this.send({ type: "ping" });
      if (!r.success && r.error?.code === "timeout" && this.sock === sock) sock.close();
    }, this.pingMs);
  }
  private stopPinger() { if (this.pinger) clearInterval(this.pinger); this.pinger = null; }

  /** Re-read the registries soon: once for a burst of changes. */
  private scheduleRegistry() {
    if (this.registryTimer) clearTimeout(this.registryTimer);
    this.registryTimer = setTimeout(() => { this.registryTimer = null; void this.loadRegistry(); }, this.registryDebounceMs);
  }

  private connect() {
    this.conn = "connecting";
    const ws = new WebSocket(new URL("/api/websocket", this.url.replace(/^http/, "ws")).toString());
    this.sock = ws;
    ws.onmessage = (ev) => {
      let m: HaMessage;
      try { m = JSON.parse(String(ev.data)) as HaMessage; } catch { return; } // one malformed frame must not take the link down
      void this.onMessage(m);
    };
    ws.onclose = () => this.onClose();
    ws.onerror = () => {};
  }

  private onClose() {
    this.stopPinger();
    for (const [, r] of this.waiting) r({ success: false, error: { code: "disconnected", message: "Lost connection to Home Assistant" } });
    this.waiting.clear();
    if (this.conn !== "auth_failed") this.conn = "disconnected";
    this.emit({ type: "conn" });
    if (this.stopped) return;
    const wait = this.conn === "auth_failed" ? 60_000 : this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.timer = setTimeout(() => this.connect(), wait);
  }

  private async onMessage(m: HaMessage) {
    this.lastMessageAt = Date.now();
    if (m.type === "auth_required") return this.sock?.send(JSON.stringify({ type: "auth", access_token: this.token }));
    if (m.type === "auth_invalid") { this.conn = "auth_failed"; return this.sock?.close(); }
    if (m.type === "auth_ok") {
      this.backoff = 1000;
      await this.send({ type: "subscribe_events", event_type: "state_changed" });
      for (const t of [...REGISTRY_EVENTS, "core_config_updated"]) await this.send({ type: "subscribe_events", event_type: t });
      const r = await this.send({ type: "get_states" });
      if (r.success) { this.entities = new Map((r.result as HaEntity[]).map((e) => [e.entity_id, e])); this.conn = "connected"; this.emit({ type: "conn" }); this.startPinger(); }
      await this.loadInfo();
      await this.loadRegistry();
      return;
    }
    if (m.type === "event" && m.event?.event_type && (REGISTRY_EVENTS as readonly string[]).includes(m.event.event_type)) return this.scheduleRegistry();
    if (m.type === "event" && m.event?.event_type === "core_config_updated") return void this.loadInfo();
    if (m.type === "event" && m.event?.event_type === "state_changed") {
      const { entity_id, new_state } = m.event.data;
      if (new_state) this.entities.set(entity_id, new_state); else this.entities.delete(entity_id);
      this.emit({ type: "entity", entityId: entity_id });
      return;
    }
    if ("id" in m && typeof m.id === "number") { this.waiting.get(m.id)?.(m); this.waiting.delete(m.id); }
  }

  private async loadInfo() {
    const c = await this.send({ type: "get_config" });
    if (!c.success || !c.result || typeof c.result !== "object") return;
    const r = c.result as { version?: unknown; time_zone?: unknown; location_name?: unknown; unit_system?: { temperature?: unknown } };
    const t = r.unit_system?.temperature;
    this.info = {
      version: typeof r.version === "string" ? r.version : null, timeZone: typeof r.time_zone === "string" ? r.time_zone : null,
      locationName: typeof r.location_name === "string" ? r.location_name : null, metric: typeof t === "string" ? t === "°C" : null,
    };
  }

  /** Which entities are only parts of a device, and which physical device each belongs to. Read at connect and again whenever the hub's registries change. */
  private async loadRegistry() {
    const gen = ++this.registryGen;
    const reg = await this.send({ type: "config/entity_registry/list" });
    if (!reg.success || !Array.isArray(reg.result)) return; // without the registry every entity is shown, as before
    type Row = { entity_id?: string; device_id?: string | null; name?: string | null; original_name?: string | null; device_class?: string | null; original_device_class?: string | null; area_id?: string | null; entity_category?: string | null; hidden_by?: string | null; disabled_by?: string | null };
    type Dev = { id?: string; area_id?: string | null; name?: string | null; name_by_user?: string | null; via_device_id?: string | null; connections?: [string, string][] };
    const rows = reg.result as Row[];
    const dev = await this.send({ type: "config/device_registry/list" });
    if (gen !== this.registryGen) return; // a newer read has started; it has the last word
    const devices = dev.success && Array.isArray(dev.result) ? (dev.result as Dev[]) : [];
    // Areas and floors are optional: an older hub lacks floors, and a failed read leaves what we had.
    const [ar, fl] = [await this.send({ type: "config/area_registry/list" }), await this.send({ type: "config/floor_registry/list" })];
    if (gen !== this.registryGen) return;
    if (ar.success && Array.isArray(ar.result)) this.areas = new Map((ar.result as { area_id?: string; name?: string; floor_id?: string | null }[]).flatMap((a) => (a.area_id && a.name ? [[a.area_id, { id: a.area_id, name: a.name, floorId: a.floor_id ?? null }] as const] : [])));
    if (fl.success && Array.isArray(fl.result)) this.floors = new Map((fl.result as { floor_id?: string; name?: string; level?: number | null }[]).flatMap((f) => (f.floor_id && f.name ? [[f.floor_id, { id: f.floor_id, name: f.name, level: f.level ?? null }] as const] : [])));
    const deviceArea = new Map(devices.flatMap((d) => (d.id && d.area_id ? [[d.id, d.area_id] as const] : [])));
    this.areaOf = new Map(rows.flatMap((x) => { const a = x.area_id || (x.device_id ? deviceArea.get(x.device_id) : undefined); return x.entity_id && a && this.areas.has(a) ? [[x.entity_id, a] as const] : []; }));
    // A bulb's "do not disturb" switch is a part of the bulb, not a device of its own.
    this.secondary = new Set(rows.filter((x) => x.entity_id && (x.entity_category || x.hidden_by || x.disabled_by)).map((x) => x.entity_id as string));
    const names = new Map<string, string>(), via = new Map<string, string>();
    for (const d of devices) { const n = d.name_by_user || d.name; if (d.id && n) names.set(d.id, n); if (d.id && d.via_device_id) via.set(d.id, d.via_device_id); }
    // The same hardware can be registered twice by different integrations (an ESPHome device that is also an AirPlay receiver); they share a MAC address.
    const macs = new Map<string, string[]>();
    for (const d of devices) for (const [k, v] of d.connections ?? []) if (k === "mac" && d.id && !d.via_device_id) macs.set(v.toLowerCase(), [...(macs.get(v.toLowerCase()) ?? []), d.id]);
    const parentsOf = new Set(via.values()), sameAs = new Map<string, string>();
    for (const ids of macs.values()) { const main = ids.find((i) => parentsOf.has(i)) ?? ids[0]!; for (const i of ids) sameAs.set(i, main); }
    // A device that is part of another (an ESPHome device's camera or microphone) belongs to the one at the top.
    const root = (id: string) => { let r = id; for (let i = 0; i < 5 && via.has(r) && names.has(via.get(r)!); i++) r = via.get(r)!; return sameAs.get(r) ?? r; };
    this.parents = new Map(rows.flatMap((x): [string, Parent][] => {
      const top = x.device_id ? root(x.device_id) : undefined, n = top ? names.get(top) : undefined;
      return x.entity_id && x.device_id && n ? [[x.entity_id, { deviceId: top!, deviceName: n, label: x.name || x.original_name || null, cls: x.device_class || x.original_device_class || null }]] : [];
    }));
    this.emit({ type: "conn" }); // clients re-read their devices
  }

  ws(msg: Record<string, unknown>) { return this.send(msg); }

  waitFor(pred: (e: HaEntity) => boolean, ms: number): Promise<HaEntity | null> {
    const now = [...this.entities.values()].find(pred);
    if (now) return Promise.resolve(now);
    return new Promise((resolve) => {
      const done = (v: HaEntity | null) => { clearTimeout(t); off(); resolve(v); };
      const off = this.subscribe((e) => { if (e.type === "entity") { const x = this.entities.get(e.entityId); if (x && pred(x)) done(x); } });
      const t = setTimeout(() => done(null), ms);
    });
  }

  async config(method: "POST" | "DELETE", path: string, body?: unknown) {
    if (this.conn !== "connected") return { ok: false, error: "ha_unavailable" };
    try {
      const r = await fetch(new URL(path, this.url), {
        method, headers: { Authorization: `Bearer ${this.token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(8000),
      });
      return r.ok ? { ok: true } : { ok: false, error: r.status === 401 || r.status === 403 ? "ha_not_admin" : "ha_rejected" };
    } catch { return { ok: false, error: "ha_unavailable" }; }
  }

  private send(msg: Record<string, unknown>): Promise<HaReply> {
    return new Promise((resolve) => {
      if (this.sock?.readyState !== WebSocket.OPEN) return resolve({ success: false, error: { code: "disconnected", message: "Home Assistant is not connected" } });
      const id = this.nextId++;
      const t = setTimeout(() => { this.waiting.delete(id); resolve({ success: false, error: { code: "timeout", message: "Home Assistant did not respond" } }); }, this.replyMs);
      this.waiting.set(id, (m) => { clearTimeout(t); resolve(m); });
      this.sock.send(JSON.stringify({ id, ...msg }));
    });
  }

  /** Camera still via HA's REST proxy; the token never leaves the server. */
  async snapshot(entityId: string) {
    try {
      const r = await fetch(new URL(`/api/camera_proxy/${encodeURIComponent(entityId)}`, this.url), { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(5000) });
      return r.ok ? { body: await r.arrayBuffer(), type: r.headers.get("content-type") ?? "image/jpeg" } : null;
    } catch { return null; }
  }

  /** Recent state changes via HA's REST history (no attributes, minimal response). */
  async history(entityId: string, hours: number) {
    try {
      const start = new Date(Date.now() - hours * 3600_000).toISOString();
      const r = await fetch(new URL(`/api/history/period/${start}?filter_entity_id=${encodeURIComponent(entityId)}&minimal_response&no_attributes`, this.url), { headers: { Authorization: `Bearer ${this.token}` }, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const rows = ((await r.json()) as HistoryRow[][])[0] ?? [];
      return rows.map((x) => ({ t: Date.parse(x.last_changed ?? x.last_updated ?? ""), state: String(x.state) })).filter((x) => Number.isFinite(x.t));
    } catch { return null; }
  }

  /** Never queued, never retried: the result reflects what HA actually reported. */
  async callService(domain: string, service: string, data: Record<string, unknown> = {}, entityId?: string): Promise<CallResult> {
    if (this.conn !== "connected") return { ok: false, error: "ha_unavailable" };
    const e = entityId ? this.entities.get(entityId) : undefined;
    if (entityId && (!e || e.state === "unavailable")) return { ok: false, error: "device_unavailable" };
    const r = await this.send({ type: "call_service", domain, service, service_data: data, ...(entityId ? { target: { entity_id: entityId } } : {}) });
    return r.success ? { ok: true } : { ok: false, error: String(r.error?.code ?? "failed") };
  }
}
