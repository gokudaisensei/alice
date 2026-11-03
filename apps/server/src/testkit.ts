import { createApp } from "./app";
import { createBackups } from "./backup";
import { createUpdates } from "./updates";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate, openDb } from "./db";
import { ensureBootstrapCode, issueEnrollmentToken } from "./auth";
import { realWebAuthn, type WebAuthnService } from "./webauthn";
import type { CallResult, HaApi, HaAttributes, HaEntity, HaEvent, HaReply } from "./ha";
import { asObject } from "./http";

/**
 * The one deliberate `any` in the test kit: parsed JSON responses and the configs the app publishes to HA.
 * Tests probe these shapes with `expect`, so a wrong guess should fail the assertion rather than stop the file compiling.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = any;

// Fake authenticator: a response is valid iff response.ok === true. Real WebAuthn is exercised on-device.
export const fakeWebAuthn: WebAuthnService = {
  async regOptions() { return { options: {}, challenge: "c" + Math.random() }; },
  async regVerify(r) { const { ok, id } = asObject(r); return ok ? { credentialId: String(id), publicKey: "pk", counter: 0, transports: [] } : null; },
  async authOptions() { return { options: {}, challenge: "c" + Math.random() }; },
  async authVerify(r, _c, cred) { return asObject(r).ok ? cred.counter + 1 : null; },
};

let ipN = 0;
export const ent = (entity_id: string, state: string, attributes: HaAttributes = {}): HaEntity => ({ entity_id, state, attributes: { friendly_name: (entity_id.split(".")[1] ?? entity_id).replace(/_/g, " "), ...attributes } });

export function fixtureEntities(): HaEntity[] {
  return [
    ent("light.kitchen", "on", { supported_color_modes: ["brightness"], brightness: 128 }),
    ent("light.hall", "on", { supported_color_modes: ["onoff"] }),
    ent("light.desk", "off", { supported_color_modes: ["color_temp", "hs"], min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6000 }),
    ent("switch.heater", "unavailable"),
    ent("switch.plug", "on"),
    ent("fan.bedroom", "off", { supported_features: 1, percentage_step: 25 }),
    ent("climate.living", "heat", { supported_features: 1, hvac_modes: ["off", "heat"], temperature: 21, current_temperature: 20, min_temp: 10, max_temp: 30, target_temp_step: 0.5 }),
    ent("lock.front", "locked"),
    ent("camera.porch", "idle"),
    ent("media_player.tv", "off", { supported_features: 128 | 256 | 4 | 16384 }),
    ent("sensor.temp", "21.5", { unit_of_measurement: "°C", device_class: "temperature" }),
    ent("sensor.plug_power", "42", { unit_of_measurement: "W", device_class: "power" }),
    ent("cover.blind", "closed"),
    ent("scene.movie_time", "unknown", { id: "legacy_movie" }),
    ent("person.alex", "home"),
    ent("person.sam", "home"),
  ];
}

/** In-memory Home Assistant. Records calls; can be told to fail, ignore commands, or go offline. */
export class FakeHa implements HaApi {
  entities = new Map<string, HaEntity>(fixtureEntities().map((e) => [e.entity_id, e]));
  secondary = new Set<string>();
  stale = false;
  calls: { domain: string; service: string; data: Record<string, unknown>; entityId?: string }[] = [];
  failing = new Set<string>();
  ignoring = new Set<string>(); // accepts the command but the device never changes state
  private ls = new Set<(e: HaEvent) => void>();
  health() { return this.stale ? ("unreachable" as const) : ("ok" as const); }
  isStale() { return this.stale; }
  subscribe(cb: (e: HaEvent) => void) { this.ls.add(cb); return () => { this.ls.delete(cb); }; }
  emit(e: HaEvent) { for (const l of this.ls) l(e); }
  set(id: string, state: string, attributes: HaAttributes = {}) {
    const cur = this.entities.get(id);
    if (!cur) throw new Error(`FakeHa has no entity ${id}`);
    this.entities.set(id, { ...cur, state, attributes: { ...cur.attributes, ...attributes } });
    this.emit({ type: "entity", entityId: id });
  }
  setStale(v: boolean) { this.stale = v; this.emit({ type: "conn" }); }
  configs = new Map<string, Body>(); // "scene/<id>" | "script/<id>" -> config
  configFails: string | null = null;
  wsCalls: Body[] = [];
  exposeFails = false;
  private slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  async config(method: "POST" | "DELETE", path: string, body?: unknown) {
    if (this.stale) return { ok: false, error: "ha_unavailable" };
    if (this.configFails) return { ok: false, error: this.configFails };
    const m = path.match(/^\/api\/config\/(scene|script|automation)\/config\/(.+)$/);
    if (!m) return { ok: false, error: "ha_rejected" };
    const key = `${m[1]}/${m[2]}`;
    if (method === "POST") this.configs.set(key, body); else this.configs.delete(key);
    return { ok: true };
  }
  async ws(msg: Record<string, unknown>): Promise<HaReply> {
    this.wsCalls.push(msg);
    if (msg.type === "input_select/create") {
      const { name, initial, options } = msg as { name: string; initial?: string; options: string[] };
      const id = "input_select." + this.slug(name);
      this.entities.set(id, ent(id, initial ?? options[0] ?? "", { options, friendly_name: name }));
      this.emit({ type: "entity", entityId: id });
      return { success: true, result: {} };
    }
    if (msg.type === "cloud/status") return { success: true, result: { logged_in: true } };
    if (msg.type === "homeassistant/expose_entity") return this.exposeFails ? { success: false, error: { code: "failed" } } : { success: true, result: {} };
    return { success: false, error: { code: "unknown_command" } };
  }
  async waitFor(pred: (e: HaEntity) => boolean, ms: number) {
    const now = [...this.entities.values()].find(pred);
    if (now) return now;
    return new Promise<HaEntity | null>((resolve) => {
      const t = setTimeout(() => { off(); resolve(null); }, Math.min(ms, 80));
      const off = this.subscribe((e) => { if (e.type === "entity") { const x = this.entities.get(e.entityId); if (x && pred(x)) { clearTimeout(t); off(); resolve(x); } } });
    });
  }
  notLoading = false; // HA saves the file but is not configured to load it
  private reload(kind: "scene" | "script" | "automation") {
    if (this.notLoading) return;
    const live = new Set<string>();
    for (const [key, cfg] of this.configs) {
      const [k, id = ""] = key.split("/"); if (k !== kind) continue;
      const known = [...this.entities.values()].find((e) => e.attributes.id === id); // HA keeps an entity's id across renames
      const entityId = known?.entity_id ?? (kind === "script" ? `script.${id}` : kind === "automation" ? `automation.${this.slug(cfg.alias)}` : `scene.${this.slug(cfg.name)}`);
      live.add(entityId);
      const existing = this.entities.get(entityId);
      if (existing && existing.attributes.id === id) { this.entities.set(entityId, { ...existing, attributes: { ...existing.attributes, friendly_name: kind === "scene" ? cfg.name : cfg.alias } }); this.emit({ type: "entity", entityId }); }
      if (!existing) {
        this.entities.set(entityId, ent(entityId, kind === "scene" ? "unknown" : kind === "automation" ? "on" : "off", { friendly_name: kind === "scene" ? cfg.name : cfg.alias, id }));
        this.emit({ type: "entity", entityId });
      }
    }
    for (const [id, entity] of [...this.entities]) if (id.startsWith(kind + ".") && String(entity.attributes.id ?? "").startsWith("alice_") && !live.has(id)) { this.entities.delete(id); this.emit({ type: "entity", entityId: id }); }
  }
  async callService(domain: string, service: string, data: Record<string, unknown> = {}, entityId?: string): Promise<CallResult> {
    if (this.stale) return { ok: false, error: "ha_unavailable" };
    if (service === "reload" && (domain === "scene" || domain === "script" || domain === "automation")) { this.calls.push({ domain, service, data }); this.reload(domain); return { ok: true }; }
    this.calls.push({ domain, service, data, entityId });
    if (!entityId || this.failing.has(entityId)) return { ok: false, error: "failed" };
    if (!this.ignoring.has(entityId)) {
      if (domain === "script" && service === "turn_on") { queueMicrotask(() => this.set(entityId, "off", { last_triggered: String(Date.now()) })); return { ok: true }; }
      if (domain === "scene" && service === "turn_on") { queueMicrotask(() => this.set(entityId, new Date().toISOString())); return { ok: true }; }
      if (service === "select_option") { queueMicrotask(() => this.set(entityId, String(data.option))); return { ok: true }; }
      const state = service === "turn_off" ? "off" : service === "lock" ? "locked" : service === "unlock" ? "unlocked" : service === "turn_on" ? "on" : this.entities.get(entityId)?.state ?? "unknown";
      const attrs: HaAttributes = { ...data };
      if (typeof data.brightness_pct === "number") attrs.brightness = Math.round((data.brightness_pct / 100) * 255);
      if (data.hs_color) attrs.hs_color = data.hs_color;
      queueMicrotask(() => this.set(entityId, state, attrs));
    }
    return { ok: true };
  }
  waitForChange(id: string, before: HaEntity | undefined, ms: number) {
    return new Promise<boolean>((resolve) => {
      if (this.entities.get(id) !== before) return resolve(true);
      const t = setTimeout(() => { off(); resolve(false); }, Math.min(ms, 60));
      const off = this.subscribe((e) => { if (e.type === "entity" && e.entityId === id && this.entities.get(id) !== before) { clearTimeout(t); off(); resolve(true); } });
    });
  }
  historyFor = new Map<string, { t: number; state: string }[]>();
  async history(id: string, _hours: number) { return this.stale ? null : (this.historyFor.get(id) ?? []); }
  async snapshot(id: string) { return id === "camera.porch" ? { body: new Uint8Array([0xff, 0xd8, 0xff]).buffer as ArrayBuffer, type: "image/jpeg" } : null; }
}

export class FakePush {
  sent: { endpoint: string; payload: Body }[] = [];
  results = new Map<string, "ok" | "gone" | "failed">();
  publicKey() { return "BFakePublicKey"; }
  async send(sub: { endpoint: string }, payload: object) { this.sent.push({ endpoint: sub.endpoint, payload }); return this.results.get(sub.endpoint) ?? "ok"; }
}

export const realWa = () => realWebAuthn({ rpID: "home.test", rpName: "Test", origin: "https://home.test" });

export function setup(ha: HaApi = new FakeHa(), webauthn: WebAuthnService = fakeWebAuthn) {
  const db = openDb(":memory:"); migrate(db);
  const push = new FakePush(), clock = { t: Date.now() };
  const root = mkdtempSync(join(tmpdir(), "alice-test-")), backups = createBackups(db, [{ name: "This device", dir: join(root, "local"), local: true }, { name: "USB drive", dir: join(root, "usb"), local: false }], () => clock.t);
  const upOut = join(root, "up-out"), upIn = join(root, "up-in"); mkdirSync(upOut); mkdirSync(upIn);
  const updates = createUpdates(db, { out: upOut, in: upIn }, "1.0.0", () => clock.t);
  const app = createApp({ db, ha, webauthn, push, backups, updates, version: "1.0.0", now: () => clock.t, origin: "https://home.test", cookieSecure: false });
  async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; ip?: string; headers?: Record<string, string> } = {}) {
    const res = await app.handle(new Request("http://localhost" + path, {
      method,
      headers: { "content-type": "application/json", "x-requested-with": "alice", "x-forwarded-for": opts.ip ?? `10.0.0.${++ipN}`, ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    }));
    const text = await res.text();
    let json: Body = null; try { json = JSON.parse(text); } catch {}
    const sc = res.headers.get("set-cookie");
    return { status: res.status, json, cookie: sc ? sc.split(";")[0] : undefined, headers: res.headers };
  }
  /** Run an enrollment code through options+verify; returns the session cookie. */
  async function enroll(code: string, credId: string, displayName = "Someone") {
    const o = await call("POST", "/api/auth/enroll/options", { body: { token: code, displayName } });
    const v = await call("POST", "/api/auth/enroll/verify", { body: { challengeId: o.json?.challengeId, response: { id: credId, ok: true } } });
    return { status: v.status, cookie: v.cookie };
  }
  async function login(credId: string, ok = true, ip?: string) {
    const o = await call("POST", "/api/auth/login/options", { ip });
    return call("POST", "/api/auth/login/verify", { ip, body: { challengeId: o.json.challengeId, response: { id: credId, ok } } });
  }
  async function bootstrapAdmin(credId = "admin-cred") {
    const code = ensureBootstrapCode(db);
    if (!code) throw new Error("the household is already set up");
    return { ...(await enroll(code, credId, "Alex")), code };
  }
  async function reauth(cookie: string, credId: string) {
    const o = await call("POST", "/api/auth/reauth/options", { cookie });
    return call("POST", "/api/auth/reauth/verify", { cookie, body: { challengeId: o.json.challengeId, response: { id: credId, ok: true } } });
  }
  /** Admin invites a user and the invitee enrolls; returns the invitee's cookie. */
  async function addUser(adminCookie: string, role: string, credId: string) {
    const inv = await call("POST", "/api/admin/users", { cookie: adminCookie, body: { displayName: credId, role } });
    const e = await enroll(inv.json.enrollmentCode, credId, credId);
    return { userId: inv.json.userId as string, cookie: e.cookie! };
  }
  return { db, app, push, clock, backups, root, updates, upOut, upIn, ha: ha as FakeHa, call, enroll, login, bootstrapAdmin, reauth, addUser, issueEnrollmentToken: (purpose: Parameters<typeof issueEnrollmentToken>[1], userId: string | null) => issueEnrollmentToken(db, purpose, userId) };
}
