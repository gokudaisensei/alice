export type HaConn = "connecting" | "connected" | "auth_failed" | "disconnected";
export type HaEntity = { entity_id: string; state: string; attributes: Record<string, any>; last_updated?: string };
export interface HaHealth { health(): "ok" | "unreachable" | "auth_failed" }
export type HaEvent = { type: "entity"; entityId: string } | { type: "conn" };
export type CallResult = { ok: true } | { ok: false; error: string };
export interface HaApi extends HaHealth {
  entities: ReadonlyMap<string, HaEntity>;
  isStale(): boolean;
  callService(domain: string, service: string, data?: Record<string, unknown>, entityId?: string): Promise<CallResult>;
  /** Resolves true if HA reports a new state for the entity within `ms` (i.e. the device actually responded). */
  waitForChange(entityId: string, before: HaEntity | undefined, ms: number): Promise<boolean>;
  subscribe(cb: (e: HaEvent) => void): () => void;
  /** Write/delete HA's own config (scenes, scripts). Needs an HA admin token; see docs/SECURITY.md. */
  config(method: "POST" | "DELETE", path: string, body?: unknown): Promise<{ ok: boolean; error?: string }>;
  /** Raw WebSocket command (used for creating the mode helper). */
  ws(msg: Record<string, unknown>): Promise<{ success: boolean; error?: any; result?: any }>;
  /** Resolves with the first entity (now or soon) matching `pred`, or null on timeout. */
  waitFor(pred: (e: HaEntity) => boolean, ms: number): Promise<HaEntity | null>;
  snapshot?(entityId: string): Promise<{ body: ArrayBuffer; type: string } | null>;
}

/** Single persistent WebSocket to Home Assistant. State cache is in memory only; HA stays the source of truth. */
export class HaClient implements HaApi {
  conn: HaConn = "disconnected";
  entities = new Map<string, HaEntity>();
  lastMessageAt = 0;
  private sock: WebSocket | null = null;
  private nextId = 1;
  private waiting = new Map<number, (m: any) => void>();
  private backoff = 1000;
  private timer: Timer | null = null;
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

  constructor(private url: string, private token: string) {}

  health() { return this.conn === "connected" ? "ok" : this.conn === "auth_failed" ? "auth_failed" : "unreachable"; }
  /** Cached state can't be trusted while disconnected. Callers must show it as stale. */
  isStale() { return this.conn !== "connected"; }

  start() { this.stopped = false; this.connect(); }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.sock?.close(); }

  private connect() {
    this.conn = "connecting";
    const ws = new WebSocket(new URL("/api/websocket", this.url.replace(/^http/, "ws")).toString());
    this.sock = ws;
    ws.onmessage = (ev) => this.onMessage(JSON.parse(String(ev.data)));
    ws.onclose = () => this.onClose();
    ws.onerror = () => {};
  }

  private onClose() {
    for (const [, r] of this.waiting) r({ success: false, error: { code: "disconnected", message: "Lost connection to Home Assistant" } });
    this.waiting.clear();
    if (this.conn !== "auth_failed") this.conn = "disconnected";
    this.emit({ type: "conn" });
    if (this.stopped) return;
    const wait = this.conn === "auth_failed" ? 60_000 : this.backoff;
    this.backoff = Math.min(this.backoff * 2, 30_000);
    this.timer = setTimeout(() => this.connect(), wait);
  }

  private async onMessage(m: any) {
    this.lastMessageAt = Date.now();
    if (m.type === "auth_required") return this.sock!.send(JSON.stringify({ type: "auth", access_token: this.token }));
    if (m.type === "auth_invalid") { this.conn = "auth_failed"; return this.sock?.close(); }
    if (m.type === "auth_ok") {
      this.backoff = 1000;
      await this.send({ type: "subscribe_events", event_type: "state_changed" });
      const r = await this.send({ type: "get_states" });
      if (r.success) { this.entities = new Map((r.result as HaEntity[]).map((e) => [e.entity_id, e])); this.conn = "connected"; this.emit({ type: "conn" }); }
      return;
    }
    if (m.type === "event" && m.event?.event_type === "state_changed") {
      const { entity_id, new_state } = m.event.data;
      new_state ? this.entities.set(entity_id, new_state) : this.entities.delete(entity_id);
      this.emit({ type: "entity", entityId: entity_id });
      return;
    }
    if (typeof m.id === "number") { this.waiting.get(m.id)?.(m); this.waiting.delete(m.id); }
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

  private send(msg: Record<string, unknown>): Promise<any> {
    return new Promise((resolve) => {
      if (this.sock?.readyState !== WebSocket.OPEN) return resolve({ success: false, error: { code: "disconnected", message: "Home Assistant is not connected" } });
      const id = this.nextId++;
      const t = setTimeout(() => { this.waiting.delete(id); resolve({ success: false, error: { code: "timeout", message: "Home Assistant did not respond" } }); }, 10_000);
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

  /** Never queued, never retried: the result reflects what HA actually reported. */
  async callService(domain: string, service: string, data: Record<string, unknown> = {}, entityId?: string): Promise<CallResult> {
    if (this.conn !== "connected") return { ok: false, error: "ha_unavailable" };
    const e = entityId ? this.entities.get(entityId) : undefined;
    if (entityId && (!e || e.state === "unavailable")) return { ok: false, error: "device_unavailable" };
    const r = await this.send({ type: "call_service", domain, service, service_data: data, ...(entityId ? { target: { entity_id: entityId } } : {}) });
    return r.success ? { ok: true } : { ok: false, error: String(r.error?.code ?? "failed") };
  }
}
