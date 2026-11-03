// The Alice integration inside a REAL Home Assistant, driven with a key that is NOT an administrator's.
// Skipped unless set:  HA_REAL_URL=http://127.0.0.1:18125 HA_REAL_TOKEN=<admin key> HA_REAL_APP_TOKEN=<non-admin key> bun test src/real-component.test.ts
// deploy/ha/test-container.sh starts a throwaway Home Assistant with the integration and sets all of this up.
import { afterAll, beforeAll, expect, test } from "bun:test";
import type { Body } from "./testkit";

const URL_ = process.env.HA_REAL_URL, ADMIN = process.env.HA_REAL_TOKEN, APP = process.env.HA_REAL_APP_TOKEN;
const real = URL_ && ADMIN && APP ? test : test.skip;
type Conn = { ask: (m: Record<string, unknown>, ms?: number) => Promise<Body>; events: Body[]; close: () => void };
const connect = (token: string) => new Promise<Conn>((res) => {
  const ws = new WebSocket(URL_!.replace(/^http/, "ws") + "/api/websocket"); let id = 1; const waiting = new Map<number, (m: Body) => void>(), events: Body[] = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    if (m.type === "auth_required") ws.send(JSON.stringify({ type: "auth", access_token: token }));
    else if (m.type === "auth_ok") res({ events, close: () => ws.close(), ask: (msg, ms = 8000) => new Promise((r) => { const i = id++, t = setTimeout(() => r({ success: false, error: { code: "timeout" } }), ms); waiting.set(i, (x) => { clearTimeout(t); r(x); }); ws.send(JSON.stringify({ id: i, ...msg })); }) });
    else if (m.type === "event") events.push(m.event); else if (typeof m.id === "number") waiting.get(m.id)?.(m);
  };
});
let admin: Conn, app: Conn;
beforeAll(async () => { if (URL_ && ADMIN && APP) { admin = await connect(ADMIN); app = await connect(APP); } });
afterAll(() => { admin?.close(); app?.close(); });
const states = async () => ((await admin.ask({ type: "get_states" })).result as Body[]);
const until = async (f: () => Promise<boolean>, ms = 8000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await f()) return true; await Bun.sleep(200); } return false; };

real("the key really is not an administrator's, and the integration answers it", async () => {
  expect((await app.ask({ type: "auth/current_user" })).result.is_admin).toBe(false);
  expect((await app.ask({ type: "config/area_registry/create", name: "x" })).error.code).toBe("unauthorized");
  expect((await app.ask({ type: "alice/hello" })).result).toEqual({ version: expect.any(String), protocol: 1 });
});

real("a routine and an automation are written, loaded and removed with that key, entity and all", async () => {
  const script = { alias: "Real routine", description: "t", mode: "single", sequence: [{ action: "light.turn_on", target: { entity_id: "light.bed_light" }, data: { brightness_pct: 40 } }, { delay: { seconds: 1 } }] };
  expect((await app.ask({ type: "alice/config_write", kind: "script", item_id: "alice_routine_real1", config: script })).success).toBe(true);
  const auto = { alias: "Real automation", description: "t", mode: "single", max_exceeded: "silent", triggers: [{ trigger: "time", at: "03:00:00" }], conditions: [{ condition: "time", weekday: ["mon"] }], actions: [{ action: "script.turn_on", target: { entity_id: "script.alice_routine_real1" } }] };
  expect((await app.ask({ type: "alice/config_write", kind: "automation", item_id: "alice_auto_real1", config: auto })).error.code).toBe("invalid_config"); // script.turn_on is not something the app writes
  const ok = { ...auto, actions: [{ action: "scene.turn_on", target: { entity_id: "scene.alice_real1" } }] };
  expect((await app.ask({ type: "alice/config_write", kind: "automation", item_id: "alice_auto_real1", config: ok })).success).toBe(true);
  expect((await app.ask({ type: "alice/config_write", kind: "scene", item_id: "alice_real1", config: { name: "Real scene", entities: { "light.bed_light": { state: "on", brightness: 120 } } } })).success).toBe(true);
  expect(await until(async () => { const s = await states(); return ["script.alice_routine_real1", "scene.real_scene"].every((id) => s.some((x) => x.entity_id === id)) && s.some((x) => x.attributes.id === "alice_auto_real1"); })).toBe(true);
  // The routine really runs, with a key that cannot reload anything itself.
  expect((await app.ask({ type: "call_service", domain: "script", service: "turn_on", target: { entity_id: "script.alice_routine_real1" } })).success).toBe(true);
  expect(await until(async () => (await states()).find((x) => x.entity_id === "light.bed_light")?.attributes.brightness === 102)).toBe(true); // 40% of 255
  for (const [kind, id] of [["script", "alice_routine_real1"], ["automation", "alice_auto_real1"], ["scene", "alice_real1"]] as const) expect((await app.ask({ type: "alice/config_delete", kind, item_id: id })).result).toEqual({ ok: true, found: true });
  expect(await until(async () => !(await states()).some((x) => /alice_routine_real1|real_scene|real_automation/.test(x.entity_id)))).toBe(true);
});

real("everything it should not do is refused, and nothing is written", async () => {
  const bad: [string, Body][] = [
    ["an id that is not Alice's", { kind: "script", item_id: "evil", config: { alias: "x", sequence: [{ delay: { seconds: 1 } }] } }],
    ["unlocking a door", { kind: "script", item_id: "alice_x", config: { alias: "x", sequence: [{ action: "lock.unlock", target: { entity_id: "lock.front_door" } }] } }],
    ["a service outside the list", { kind: "script", item_id: "alice_x", config: { alias: "x", sequence: [{ action: "homeassistant.restart", target: { entity_id: "light.bed_light" } }] } }],
    ["a template", { kind: "script", item_id: "alice_x", config: { alias: "x", sequence: [{ action: "light.turn_on", target: { entity_id: "light.bed_light" }, data: { a: "{{ 1 }}" } }] } }],
    ["a template trigger", { kind: "automation", item_id: "alice_x", config: { alias: "x", triggers: [{ trigger: "template", value_template: "{{ true }}" }], actions: [{ delay: { seconds: 1 } }] } }],
    ["opening the garage", { kind: "script", item_id: "alice_x", config: { alias: "x", sequence: [{ action: "cover.open_cover", target: { entity_id: "cover.garage_door" } }] } }],
  ];
  for (const [name, msg] of bad) { const r = await app.ask({ type: "alice/config_write", ...msg }); expect([name, r.success, r.error?.code]).toEqual([name, false, "invalid_config"]); }
  expect((await app.ask({ type: "alice/config_delete", kind: "script", item_id: "not_ours" })).error.code).toBe("invalid_config");
  expect((await states()).some((x) => x.entity_id === "script.alice_x")).toBe(false);
});

real("a message from an automation is heard through the alice.notify service, and over-long ones are refused", async () => {
  await admin.ask({ type: "subscribe_events", event_type: "alice_notify" });
  expect((await app.ask({ type: "call_service", domain: "alice", service: "notify", service_data: { message: "The washer has finished", title: "Laundry", severity: "critical", audience: "admins" } })).success).toBe(true);
  expect(await until(async () => admin.events.some((e) => e.event_type === "alice_notify" && e.data.message === "The washer has finished" && e.data.severity === "critical"))).toBe(true);
  expect((await app.ask({ type: "call_service", domain: "alice", service: "notify", service_data: { message: "x".repeat(400) } })).success).toBe(false);
});
