import { expect, test } from "bun:test";
import { describe, toServiceCall, type Command } from "./capabilities";
import { ent, setup } from "./testkit";

const call = (e: ReturnType<typeof ent>, c: Command) => toServiceCall(describe(e), c);

test("covers: open, close, position; a garage or gate opening needs a fresh check, a blind does not", () => {
  const blind = ent("cover.blind2", "closed", { supported_features: 15, device_class: "blind", current_position: 0 });
  const garage = ent("cover.garage", "closed", { supported_features: 3, device_class: "garage" });
  expect(describe(blind)).toMatchObject({ category: "cover", ordinary: true });
  expect(call(blind, { action: "open" })).toEqual({ domain: "cover", service: "open_cover", data: {} });
  expect(call(blind, { action: "set_position", value: 40 })).toEqual({ domain: "cover", service: "set_cover_position", data: { position: 40 } });
  expect(call(blind, { action: "set_position", value: 140 })).toEqual({ error: "invalid_value" });
  expect(call(garage, { action: "set_position", value: 40 })).toEqual({ error: "unsupported" }); // no position support
  expect(call(garage, { action: "open" })).toEqual({ domain: "cover", service: "open_cover", data: {}, sensitive: true });
  expect(call(garage, { action: "close" })).toEqual({ domain: "cover", service: "close_cover", data: {} });
  expect(call(garage, { action: "stop" })).toEqual({ error: "unsupported" });
  expect(call(ent("cover.gate", "closed", { supported_features: 15, device_class: "gate" }), { action: "set_position", value: 10 })).toMatchObject({ sensitive: true });
  expect(call(ent("cover.gate", "closed", { supported_features: 15, device_class: "gate" }), { action: "set_position", value: 0 })).not.toHaveProperty("sensitive");
  expect(describe(ent("cover.odd", "open", { supported_features: 0 })).ordinary).toBe(false);
});

test("alarm panels: only the modes the panel offers; disarming is checked and carries the code", () => {
  const panel = ent("alarm_control_panel.home", "disarmed", { supported_features: 1 | 2 | 32, code_format: "number" });
  expect(describe(panel)).toMatchObject({ category: "alarm", controls: [{ type: "alarm", modes: ["home", "away", "vacation"], code: true }] });
  expect(call(panel, { action: "arm", value: { mode: "away", code: "1234" } })).toEqual({ domain: "alarm_control_panel", service: "alarm_arm_away", data: { code: "1234" } });
  expect(call(panel, { action: "arm", value: { mode: "night" } })).toEqual({ error: "invalid_value" });
  expect(call(panel, { action: "arm", value: { mode: "home", code: "x".repeat(40) } })).toEqual({ error: "invalid_value" });
  expect(call(panel, { action: "disarm", value: { code: "1234" } })).toEqual({ domain: "alarm_control_panel", service: "alarm_disarm", data: { code: "1234" }, sensitive: true });
  expect(call(panel, { action: "disarm" })).toMatchObject({ sensitive: true, data: {} });
  expect(call(ent("light.x", "on", {}), { action: "disarm" })).toEqual({ error: "unsupported" });
});

test("valves, water heaters, humidifiers, vacuums", () => {
  expect(call(ent("valve.main", "closed", { supported_features: 3, device_class: "water" }), { action: "open" })).toMatchObject({ service: "open_valve", sensitive: true });
  const heater = ent("water_heater.tank", "eco", { supported_features: 1 | 2 | 8, min_temp: 35, max_temp: 65, operation_list: ["eco", "electric"], temperature: 50 });
  expect(describe(heater)).toMatchObject({ category: "waterheater" });
  expect(call(heater, { action: "set_temperature", value: 55 })).toEqual({ domain: "water_heater", service: "set_temperature", data: { temperature: 55 } });
  expect(call(heater, { action: "set_temperature", value: 90 })).toEqual({ error: "invalid_value" });
  expect(call(heater, { action: "set_hvac_mode", value: "electric" })).toEqual({ domain: "water_heater", service: "set_operation_mode", data: { operation_mode: "electric" } });
  expect(call(heater, { action: "turn_off" })).toMatchObject({ service: "turn_off" });
  const hum = ent("humidifier.bed", "on", { supported_features: 1, min_humidity: 30, max_humidity: 80, available_modes: ["auto", "sleep"] });
  expect(call(hum, { action: "set_humidity", value: 55 })).toEqual({ domain: "humidifier", service: "set_humidity", data: { humidity: 55 } });
  expect(call(hum, { action: "set_humidity", value: 10 })).toEqual({ error: "invalid_value" });
  expect(call(hum, { action: "set_mode", value: "sleep" })).toEqual({ domain: "humidifier", service: "set_mode", data: { mode: "sleep" } });
  const vac = ent("vacuum.robo", "docked", { supported_features: 8192 | 4 | 16 | 32 | 512, fan_speed_list: ["quiet", "max"] });
  expect(call(vac, { action: "vacuum_start" })).toEqual({ domain: "vacuum", service: "start", data: {} });
  expect(call(vac, { action: "vacuum_dock" })).toMatchObject({ service: "return_to_base" });
  expect(call(vac, { action: "set_vacuum_speed", value: "max" })).toMatchObject({ service: "set_fan_speed", data: { fan_speed: "max" } });
  expect(call(vac, { action: "set_vacuum_speed", value: "turbo" })).toEqual({ error: "invalid_value" });
  expect(call(ent("vacuum.basic", "docked", { supported_features: 8192 }), { action: "vacuum_locate" })).toEqual({ error: "unsupported" });
});

test("helpers: numbers within range, options from the list, buttons; the household mode is not a device", () => {
  const n = ent("input_number.target", "21", { min: 10, max: 30, step: 0.5, unit_of_measurement: "°C" });
  expect(call(n, { action: "set_number", value: 22.5 })).toEqual({ domain: "input_number", service: "set_value", data: { value: 22.5 } });
  expect(call(n, { action: "set_number", value: 99 })).toEqual({ error: "invalid_value" });
  const sel = ent("select.mode", "a", { options: ["a", "b"] });
  expect(call(sel, { action: "set_option", value: "b" })).toEqual({ domain: "select", service: "select_option", data: { option: "b" } });
  expect(call(sel, { action: "set_option", value: "c" })).toEqual({ error: "invalid_value" });
  expect(call(ent("button.ring", "unknown"), { action: "press" })).toEqual({ domain: "button", service: "press", data: {} });
  expect(describe(ent("input_select.alice_household_mode", "home", { options: ["home", "away"] })).ordinary).toBe(false);
  expect(call(ent("input_boolean.guest", "off"), { action: "turn_on" })).toMatchObject({ service: "turn_on" });
  expect(describe(ent("weather.home", "sunny", { temperature: 21 }))).toMatchObject({ category: "weather", ordinary: true, controls: [] });
  expect(describe(ent("vacuum.lonely", "docked", {})).ordinary).toBe(false); // can do nothing: not offered
  expect(describe(ent("todo.shopping", "3")).ordinary).toBe(false); // no entry: kept out of the way
});

test("through the app: a garage door opens only after a fresh passkey check, and the alarm code is never recorded", async () => {
  const t = setup();
  t.ha.entities.set("cover.garage", ent("cover.garage", "closed", { supported_features: 3, device_class: "garage" }));
  t.ha.entities.set("alarm_control_panel.home", ent("alarm_control_panel.home", "armed_away", { supported_features: 3, code_format: "number" }));
  const admin = await t.bootstrapAdmin("a1");
  t.db.query("UPDATE sessions SET reauth_at = 0").run(); // as if they signed in a while ago
  const go = (id: string, action: string, value?: unknown) => t.call("POST", `/api/devices/${id}/command`, { cookie: admin.cookie!, body: { action, value } });
  expect((await go("cover.garage", "open")).json.error).toBe("reauth_required");
  expect((await go("cover.garage", "close")).status).toBe(200); // closing is never gated
  expect((await go("alarm_control_panel.home", "disarm", { code: "4321" })).json.error).toBe("reauth_required");
  expect(t.ha.calls.some((c) => c.service === "open_cover" || c.service === "alarm_disarm")).toBe(false);
  await t.reauth(admin.cookie!, "a1");
  expect((await go("cover.garage", "open")).status).toBe(200);
  expect((await go("alarm_control_panel.home", "disarm", { code: "4321" })).status).toBe(200);
  expect(t.ha.calls.find((c) => c.service === "alarm_disarm")?.data).toEqual({ code: "4321" });
  const logged = JSON.stringify(t.db.query("SELECT * FROM security_audit").all());
  expect(logged).toContain("alarm_control_panel.alarm_disarm");
  expect(logged).not.toContain("4321");
});
