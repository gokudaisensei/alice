import { expect, test } from "bun:test";
import { refusedByPolicy, sensitiveEntity } from "./haAssist";
import { ent, setup, type Body } from "./testkit";

const NAMES = ["front door", "garage door", "home alarm", "main water"];

test("what lets something in or switches protection off is refused before Home Assistant hears it", () => {
  for (const t of ["unlock the front door", "Disarm the alarm", "please open the garage door", "let me in", "turn off the alarm", "alarm off", "open the front door", "switch off the home alarm", "could you open main water"])
    expect(refusedByPolicy(t, NAMES)).toBe(true);
  for (const t of ["turn on the kitchen light", "is the front door locked?", "what is the temperature", "lock the front door", "close the garage door", "set the thermostat to 22", "is the home alarm armed", "turn off the lights", "stop the music", "open the blinds"])
    expect(refusedByPolicy(t, NAMES)).toBe(false);
});

test("which entities count as guarding the home", () => {
  expect(sensitiveEntity(ent("lock.front", "locked"))).toBe(true);
  expect(sensitiveEntity(ent("alarm_control_panel.home", "disarmed"))).toBe(true);
  expect(sensitiveEntity(ent("cover.garage", "closed", { device_class: "garage" }))).toBe(true);
  expect(sensitiveEntity(ent("cover.gate", "closed", { device_class: "gate" }))).toBe(true);
  expect(sensitiveEntity(ent("cover.blinds", "open", { device_class: "blind" }))).toBe(false);
  expect(sensitiveEntity(ent("valve.main", "open", { device_class: "water" }))).toBe(true);
  expect(sensitiveEntity(ent("light.kitchen", "on"))).toBe(false);
});

async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1");
  await t.reauth(admin.cookie!, "a1");
  const member = await t.addUser(admin.cookie!, "member", "m1");
  const limited = await t.addUser(admin.cookie!, "member", "m2");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  await t.call("PUT", `/api/admin/users/${limited.userId}/devices`, { cookie: admin.cookie!, body: { deny: ["light.hall"] } });
  const ask = (cookie: string | undefined, text: unknown) => t.call("POST", "/api/assist", { cookie, body: { text } });
  return { t, admin: admin.cookie!, member: member.cookie, limited: limited.cookie, guest: guest.cookie, ask };
}
const reply = (speech: string, extra: Body = {}) => ({ response: { response_type: "action_done", speech: { plain: { speech } }, data: { success: [], failed: [] }, ...extra } });

test("a plain request goes to Home Assistant in the household's language and comes back as words, with only what the person may see named", async () => {
  const { t, member, ask } = await home();
  const seen: Body[] = [];
  t.ha.replies.set("conversation/process", (m) => { seen.push(m); return reply("Turned on the lights", { data: { success: [{ id: "light.kitchen", name: "Kitchen" }, { id: "light.secret", name: "Secret" }], failed: [] } }); });
  const r = await ask(member, "turn on the kitchen lights");
  expect(r.status).toBe(200);
  expect(r.json).toEqual({ ok: true, speech: "Turned on the lights", changed: ["kitchen"] }); // the unknown one is not named
  expect(seen[0]).toMatchObject({ text: "turn on the kitchen lights", language: "en" });
});

test("only the speech and a few names come back; markup and long answers are cut down", async () => {
  const { t, member, ask } = await home();
  t.ha.replies.set("conversation/process", () => reply("x".repeat(900), { card: { secret: "no" }, language: "en" }));
  const r = (await ask(member, "tell me a story")).json;
  expect(Object.keys(r).sort()).toEqual(["changed", "ok", "speech"]);
  expect(r.speech.length).toBe(400);
  t.ha.replies.set("conversation/process", () => ({ response: { response_type: "error", speech: { plain: { speech: "" } }, data: {} } }));
  expect((await ask(member, "blah")).json).toEqual({ ok: false, speech: "I didn't catch that.", changed: [] });
});

test("unlocking and the like never reach Home Assistant, and the refusal is recorded without the words", async () => {
  const { t, member, ask } = await home();
  let called = 0; t.ha.replies.set("conversation/process", () => { called++; return reply("ok"); });
  const r = await ask(member, "unlock the front door");
  expect([r.status, r.json.error]).toEqual([403, "assist_refused"]);
  expect(called).toBe(0);
  const rows = JSON.stringify(t.db.query("SELECT action, reason FROM security_audit WHERE action LIKE 'assist.%'").all());
  expect(rows).toContain("assist.refused");
  expect(rows).not.toContain("front door");
});

test("if Assist reaches something that guards the home anyway, the person is told and the admins have it on record", async () => {
  const { t, member, ask } = await home();
  t.ha.replies.set("conversation/process", () => reply("Done", { data: { success: [{ id: "lock.front", name: "Front" }], failed: [] } }));
  const r = (await ask(member, "tidy up")).json;
  expect(r.warning).toContain("protect it");
  expect((t.db.query("SELECT action, reason FROM security_audit WHERE action = 'assist.sensitive'").all() as Body[])[0]?.reason).toBe("lock.front");
});

test("not for guests, nor for people whose devices are limited: Assist would act with the home's key, past those limits", async () => {
  const { t, guest, limited, ask } = await home();
  let called = 0; t.ha.replies.set("conversation/process", () => { called++; return reply("ok"); });
  expect((await ask(guest, "turn on the light")).json.error).toBe("assist_unavailable");
  expect((await ask(limited, "turn on the light")).json.error).toBe("assist_unavailable");
  expect((await ask(undefined, "hi")).status).toBe(401);
  expect(called).toBe(0);
});

test("bad input, the hub being down, and a flood are handled", async () => {
  const { t, member, ask } = await home();
  t.ha.replies.set("conversation/process", () => reply("ok"));
  expect((await ask(member, "")).status).toBe(400);
  expect((await ask(member, 42)).status).toBe(400);
  expect((await ask(member, "x".repeat(201))).status).toBe(400);
  for (let i = 0; i < 15; i++) await ask(member, "hello " + i);
  expect((await ask(member, "one more")).status).toBe(429);
  t.ha.setStale(true);
  expect((await ask(member, "hello")).status).toBe(429); // still the limiter first for this person
});

test("admins see what Assist can touch, and one action takes the risky ones out", async () => {
  const { t, admin, member } = await home();
  t.ha.entities.set("cover.garage_door", ent("cover.garage_door", "closed", { device_class: "garage", friendly_name: "Garage door" }));
  const exposed = { "light.hall": { conversation: true, "cloud.alexa": true }, "lock.front": { conversation: true }, "cover.garage_door": { conversation: true }, "switch.plug": { "cloud.alexa": true } };
  t.ha.replies.set("homeassistant/expose_entity/list", () => ({ exposed_entities: { "light.hall": exposed["light.hall"], "lock.front": exposed["lock.front"], "cover.garage_door": exposed["cover.garage_door"], "switch.plug": exposed["switch.plug"] } }));
  const r = (await t.call("GET", "/api/admin/assist", { cookie: admin })).json;
  expect(r).toEqual({ available: true, exposed: 3, risky: [{ id: "lock.front", name: "front" }, { id: "cover.garage_door", name: "Garage door" }] });
  expect((await t.call("GET", "/api/admin/assist", { cookie: member })).status).toBe(403);
  t.db.query("UPDATE sessions SET reauth_at = 0").run();
  expect((await t.call("POST", "/api/admin/assist/protect", { cookie: admin })).json.error).toBe("reauth_required");
  await t.reauth(admin, "a1");
  expect((await t.call("POST", "/api/admin/assist/protect", { cookie: admin })).json).toEqual({ ok: true, hidden: 2 });
  const call = t.ha.wsCalls.find((c) => c.type === "homeassistant/expose_entity");
  expect(call.should_expose).toBe(false);
  expect(call.assistants.includes("conversation")).toBe(true);
  expect(JSON.stringify(call.entity_ids)).toBe('["lock.front","cover.garage_door"]'); // the light is left alone
});

test("a hub that cannot list exposure says so instead of guessing", async () => {
  const { admin, t } = await home();
  expect((await t.call("GET", "/api/admin/assist", { cookie: admin })).json).toEqual({ available: false, exposed: 0, risky: [] });
});
