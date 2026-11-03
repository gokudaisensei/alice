// Minimal Home Assistant stand-in: REST ping/states + WebSocket (auth, get_states, subscribe, call_service).
import type { ServerWebSocket } from "bun";

type Entity = { entity_id: string; state: string; attributes: Record<string, unknown> };
type ServiceData = { brightness_pct?: number; temperature?: number; percentage?: number; color_temp_kelvin?: number; hs_color?: number[]; volume_level?: number; option?: string; hvac_mode?: string };
type ScriptStep = { action?: string; target?: { entity_id?: string }; data?: { option?: string } };
/** What HA keeps for a UI-managed scene (`name`, `entities`), script (`alias`, `sequence`) or automation (`alias`). */
type Config = { alias?: string; name?: string; entities?: Record<string, { state: string } & Record<string, unknown>>; sequence?: ScriptStep[] };
type Command = {
  id?: number; type: string; event_type?: string; access_token?: string; name?: string; initial?: string; options?: string[];
  domain?: string; service?: string; service_data?: ServiceData; target?: { entity_id?: string };
};
type Kind = "scene" | "script" | "automation";

const isKind = (v: string | undefined): v is Kind => v === "scene" || v === "script" || v === "automation";

/** `demo` fills the home with what Alice's newer screens need: areas, floors, a label, more kinds of device, and answers for energy, logbook, traces and the hub's own worries. */
export function startMockHa(port: number, token = "dev-token", opts: { demo?: boolean; /** act as a hub with the Alice integration installed, speaking this protocol */ component?: { protocol: number } } = {}) {
  const e = (id: string, state: string, a: Record<string, unknown> = {}): Entity =>
    ({ entity_id: id, state, attributes: { friendly_name: (id.split(".")[1] ?? id).replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), ...a } });
  const states: Entity[] = [
    e("light.living_room", "on", { supported_color_modes: ["color_temp", "hs"], brightness: 180, color_temp_kelvin: 3000, min_color_temp_kelvin: 2200, max_color_temp_kelvin: 6500, hs_color: [30, 60] }),
    e("light.kitchen", "on", { supported_color_modes: ["brightness"], brightness: 128 }),
    e("light.hall", "off", { supported_color_modes: ["onoff"] }),
    e("switch.heater", "unavailable"),
    e("switch.coffee_plug", "off"),
    e("fan.bedroom_fan", "on", { supported_features: 1, percentage: 50, percentage_step: 25 }),
    e("climate.living_room_ac", "cool", { supported_features: 1, hvac_modes: ["off", "cool", "heat"], temperature: 23, current_temperature: 25.5, min_temp: 16, max_temp: 30, target_temp_step: 0.5 }),
    e("lock.front_door", "locked"),
    e("media_player.tv", "playing", { supported_features: 128 | 256 | 4 | 16384, volume_level: 0.3, media_title: "Evening news" }),
    e("sensor.living_temperature", "24.8", { unit_of_measurement: "°C", device_class: "temperature" }),
    e("sensor.washer_power", "412", { unit_of_measurement: "W", device_class: "power" }),
    e("cover.garage_blind", "closed"),
    e("scene.movie_time", "unknown", { id: "legacy_movie" }),
    e("person.alex", "home"),
    e("person.sam", "home"),
  ];
  if (opts.demo) states.push(
    e("cover.garage_door", "closed", { supported_features: 3, device_class: "garage" }),
    e("cover.living_blinds", "open", { supported_features: 15, device_class: "blind", current_position: 70 }),
    e("alarm_control_panel.home", "disarmed", { supported_features: 1 | 2 | 4, code_format: "number" }),
    e("vacuum.robo", "docked", { supported_features: 8192 | 4 | 16 | 32 | 512, fan_speed_list: ["quiet", "standard", "max"], fan_speed: "standard", battery_level: 88 }),
    e("humidifier.bedroom", "on", { supported_features: 1, min_humidity: 30, max_humidity: 80, humidity: 55, current_humidity: 48, available_modes: ["auto", "sleep"], mode: "auto" }),
    e("valve.main_water", "open", { supported_features: 3, device_class: "water" }),
    e("water_heater.tank", "eco", { supported_features: 1 | 2 | 8, min_temp: 35, max_temp: 65, temperature: 50, current_temperature: 47, operation_list: ["eco", "electric", "off"], operation_mode: "eco" }),
    e("siren.hall", "off"),
    e("input_number.night_target", "19", { min: 14, max: 26, step: 0.5, unit_of_measurement: "°C" }),
    e("input_select.guest_scene", "relaxed", { options: ["relaxed", "party", "movie"] }),
    e("button.doorbell_chime", "unknown"),
    e("weather.home", "partlycloudy", { temperature: 27, humidity: 61 }),
    e("binary_sensor.hall_smoke", "off", { device_class: "smoke" }),
    e("binary_sensor.back_door", "off", { device_class: "door" }),
    e("sensor.door_sensor_battery", "11", { device_class: "battery", unit_of_measurement: "%" }),
    // a wall panel like the real one: a speaker seen twice, a camera, and settings, all one physical device
    e("media_player.panel_speaker", "idle", { supported_features: 4 | 1 | 16384 | 128 | 256, device_class: "speaker", friendly_name: "spaceship" }),
    e("media_player.panel_cast", "idle", { supported_features: 4, friendly_name: "spaceship" }),
    e("camera.panel_camera", "idle", { supported_features: 2, friendly_name: "Camera" }),
    e("switch.panel_mic_mute", "on", { friendly_name: "Microphone mute" }),
    e("switch.panel_adb", "off", { friendly_name: "ADB over network" }),
    e("switch.panel_autoanswer", "off", { friendly_name: "Auto-answer calls" }),
    e("button.panel_wake", "unknown", { friendly_name: "Wake" }),
    e("button.panel_favorite", "unknown", { friendly_name: "Favorite current song" }),
    e("sensor.panel_protocol_version", "3", {}),
    // helper values left by a home simulator
    e("input_number.away_temperature", "16", { min: 5, max: 30, step: 1 }),
    e("input_number.bathroom_humidity_level", "55", { min: 0, max: 100, step: 1 }),
    e("input_number.bedroom_light_level", "255", { min: 0, max: 255, step: 1 }),
    e("input_number.living_room_thermostat_target", "21", { min: 5, max: 30, step: 1 }),
    e("input_select.house_mode", "home", { options: ["home", "away"] }),
    e("input_select.home_alarm_mode", "disarmed", { options: ["disarmed", "armed"] }),
    e("automation.porch_light_at_dusk", "on", { id: "1700000000001", last_triggered: "2026-11-02T13:00:00+00:00" }),
    e("script.goodnight_house", "off", {}),
    e("update.home_assistant_core", "on", { title: "Home Assistant Core", installed_version: "2026.10.4", latest_version: "2026.11.0" }),
  );
  const subs = new Set<ServerWebSocket<unknown>>();
  const eventSubs = new Map<string, Set<ServerWebSocket<unknown>>>();
  /** The hub's registries: what is a device, and which part of it each entity is. Tests change these and then call `fire`. */
  const registry = { entities: [] as Record<string, unknown>[], devices: [] as Record<string, unknown>[], areas: [] as Record<string, unknown>[], floors: [] as Record<string, unknown>[], labels: [] as Record<string, unknown>[] };
  const hubConfig = { version: "2026.10.4", time_zone: "Asia/Kolkata", location_name: "Home", language: "en", unit_system: { temperature: "°C" } };
  if (opts.demo) {
    registry.floors.push({ floor_id: "ground", name: "Ground floor", level: 0 }, { floor_id: "first", name: "First floor", level: 1 });
    registry.areas.push({ area_id: "living", name: "Living room", floor_id: "ground" }, { area_id: "kitchen", name: "Kitchen", floor_id: "ground" }, { area_id: "bedroom", name: "Bedroom", floor_id: "first" }, { area_id: "garden", name: "Garden", floor_id: null });
    registry.labels.push({ label_id: "evening", name: "Evening lights" });
    registry.devices.push({ id: "d_living", name: "Living room lights", area_id: "living", manufacturer: "Acme", model: "Strip 2", sw_version: "1.4.2", labels: ["evening"] }, { id: "d_kitchen", name: "Kitchen light", area_id: "kitchen", manufacturer: "Acme", model: "Bulb", sw_version: "2.0", labels: ["evening"] });
    registry.devices.push({ id: "d_panel", name: "spaceship", manufacturer: "EchoLocal", model: "checkers", sw_version: "0.0.13", labels: [] }, { id: "d_coffee", name: "Coffee plug", manufacturer: "Acme", model: "Plug", labels: [] });
    registry.entities.push({ entity_id: "media_player.panel_speaker", device_id: "d_panel", platform: "esphome", original_name: "Speaker", original_device_class: "speaker" }, { entity_id: "media_player.panel_cast", device_id: "d_panel", platform: "cast" }, { entity_id: "camera.panel_camera", device_id: "d_panel", platform: "esphome", original_name: "Camera" },
      { entity_id: "switch.panel_mic_mute", device_id: "d_panel", platform: "esphome", original_name: "Microphone mute" }, { entity_id: "switch.panel_adb", device_id: "d_panel", platform: "esphome", original_name: "ADB over network" }, { entity_id: "switch.panel_autoanswer", device_id: "d_panel", platform: "esphome", original_name: "Auto-answer calls" },
      { entity_id: "button.panel_wake", device_id: "d_panel", platform: "esphome", original_name: "Wake" }, { entity_id: "button.panel_favorite", device_id: "d_panel", platform: "esphome", original_name: "Favorite current song" }, { entity_id: "switch.coffee_plug", device_id: "d_coffee", platform: "zha" });
    registry.entities.push({ entity_id: "light.living_room", device_id: "d_living", platform: "zha" }, { entity_id: "light.kitchen", device_id: "d_kitchen", platform: "zha" }, { entity_id: "light.hall", area_id: "garden", platform: "zha" }, { entity_id: "sensor.door_sensor_battery", device_id: "d_kitchen", platform: "zha" }, { entity_id: "cover.living_blinds", area_id: "living", platform: "zha" });
  }
  /** What each assistant may touch in the demo: Home Assistant exposes doors and garages to its own assistant unless told not to. */
  const exposedTo = new Map<string, Set<string>>(opts.demo ? [["light.kitchen", new Set(["conversation"])], ["lock.front_door", new Set(["conversation"])], ["cover.garage_door", new Set(["conversation", "cloud.alexa"])]] : []);
  let mute = false; // when set, the hub stops answering anything (a half-open link)
  const fire = (eventType: string, data: Record<string, unknown> = {}) => { for (const s of eventSubs.get(eventType) ?? []) s.send(JSON.stringify({ type: "event", event: { event_type: eventType, data } })); };
  /** How config writes reached the hub, in order: through the Alice integration ("ws") or the administrator REST API ("rest"). */
  const writes: string[] = [];
  let componentError: string | null = null;
  const configs = new Map<string, Config>();
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const broadcast = (ent: Entity) => { for (const s of subs) s.send(JSON.stringify({ type: "event", event: { event_type: "state_changed", data: { entity_id: ent.entity_id, new_state: ent } } })); };
  const reload = (kind: Kind) => {
    const live = new Set<string>();
    for (const [key, cfg] of configs) {
      const [k, id = ""] = key.split("/"); if (k !== kind) continue;
      const known = states.find((x) => x.attributes.id === id);
      const eid = known?.entity_id ?? (kind === "script" ? `script.${id}` : kind === "automation" ? `automation.${slug(cfg.alias ?? "")}` : `scene.${slug(cfg.name ?? "")}`);
      live.add(eid);
      const ent = e(eid, known?.state ?? (kind === "scene" ? "unknown" : kind === "automation" ? "on" : "off"), { friendly_name: kind === "scene" ? cfg.name : cfg.alias, id, ...(kind === "scene" ? { entity_id: Object.keys(cfg.entities ?? {}) } : {}) });
      const i = states.findIndex((x) => x.entity_id === eid);
      if (i >= 0) states[i] = ent; else states.push(ent);
      broadcast(ent);
    }
    for (let i = states.length - 1; i >= 0; i--) {
      const x = states[i];
      if (x && x.entity_id.startsWith(kind + ".") && String(x.attributes.id ?? "").startsWith("alice_") && !live.has(x.entity_id)) { states.splice(i, 1); broadcast({ entity_id: x.entity_id, state: "unavailable", attributes: {} }); }
    }
  };
  const server = Bun.serve({
    port,
    fetch(req, srv) {
      const { pathname } = new URL(req.url);
      if (pathname === "/api/websocket") return srv.upgrade(req) ? undefined : new Response("upgrade failed", { status: 400 });
      if (req.headers.get("authorization") !== `Bearer ${token}`) return new Response("unauthorized", { status: 401 });
      if (pathname === "/api/") return Response.json({ message: "API running." });
      if (pathname === "/api/states") return Response.json(states);
      const cfg = /^\/api\/config\/(scene|script|automation)\/config\/(.+)$/.exec(pathname);
      if (cfg) {
        const key = `${cfg[1]}/${cfg[2]}`;
        if (req.method === "DELETE") { configs.delete(key); return Response.json({ result: "ok" }); }
        writes.push("rest");
        return req.json().then((b) => { configs.set(key, b as Config); return Response.json({ result: "ok" }); });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) { ws.send(JSON.stringify({ type: "auth_required" })); },
      close(ws) { subs.delete(ws); for (const v of eventSubs.values()) v.delete(ws); },
      message(ws, raw) { handle(ws, raw); },
    },
  });
  const fnv = (t: string) => { let h = 2166136261; for (const c of t) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return Math.abs(h); };
  type R = { ok: true; result: unknown } | { ok: false; code: string; message: string } | undefined;
  /** Answers for the newer screens: believable numbers, deterministic per id. */
  function demo(m: Record<string, unknown> & { type: string }): R {
    const yes = (result: unknown): R => ({ ok: true, result });
    const days = (since: string) => { const out: number[] = []; for (let t = Date.parse(since); t < Date.now(); t += 864e5) out.push(t); return out; };
    switch (m.type) {
      case "config/area_registry/create": { const a = { area_id: slug(String(m.name)), name: m.name, floor_id: null }; registry.areas.push(a); fire("area_registry_updated"); return yes(a); }
      case "config/area_registry/update": { const a = registry.areas.find((x) => x.area_id === m.area_id); if (!a) return { ok: false, code: "not_found", message: "no such area" }; a.name = m.name ?? a.name; fire("area_registry_updated"); return yes(a); }
      case "config/entity_registry/update": { const r = registry.entities.find((x) => x.entity_id === m.entity_id) ?? (registry.entities.push({ entity_id: m.entity_id }), registry.entities.at(-1)!); r.area_id = m.area_id ?? null; fire("entity_registry_updated"); return yes({ entity_entry: r }); }
      case "energy/get_prefs": return yes({ energy_sources: [{ type: "grid", flow_from: [{ stat_energy_from: "sensor.grid_in" }], flow_to: [{ stat_energy_to: "sensor.grid_out" }] }, { type: "solar", stat_energy_from: "sensor.solar_yield" }, { type: "gas", stat_energy_from: "sensor.gas_total" }], device_consumption: [{ stat_consumption: "sensor.washer_power" }, { stat_consumption: "light.kitchen" }] });
      case "recorder/get_statistics_metadata": return yes((m.statistic_ids as string[]).map((id) => ({ statistic_id: id, display_unit_of_measurement: id.includes("gas") ? "m³" : "kWh" })));
      case "recorder/statistics_during_period": {
        const ids = m.statistic_ids as string[], out: Record<string, unknown[]> = {};
        const step = m.period === "month" ? 30 * 864e5 : m.period === "hour" ? 6 * 3600e3 : 864e5;
        for (const id of ids) {
          const base = 2 + (fnv(id) % 60) / 10, rows: unknown[] = [];
          for (let t = Date.parse(String(m.start_time)); t < Date.now(); t += step) { const k = 1 + 0.4 * Math.sin(t / 3e8 + fnv(id)); rows.push({ start: t, end: t + step, change: Math.round(base * k * (m.period === "month" ? 28 : 1) * 100) / 100, mean: Math.round((18 + 6 * Math.sin(t / 4e7)) * 10) / 10 }); }
          out[id] = rows;
        }
        void days; return yes(out);
      }
      case "logbook/get_events": {
        const ids = (m.entity_ids as string[] | undefined) ?? [], now = Date.now() / 1000, rows: unknown[] = [];
        ids.slice(0, 12).forEach((id, i) => rows.push(i % 3 === 0 ? { when: now - 600 - i * 900, entity_id: id, state: states.find((x) => x.entity_id === id)?.state ?? "on", context_event_type: "automation_triggered", context_name: "Porch light at dusk" } : i % 3 === 1 ? { when: now - 900 - i * 900, entity_id: id, state: "off", context_user_id: "abc", context_service: "turn_off", context_domain: "light" } : { when: now - 1200 - i * 900, entity_id: id, state: "on" }));
        return yes(rows);
      }
      case "trace/list": return yes([{ run_id: "r1", timestamp: { start: new Date(Date.now() - 3600e3).toISOString() }, script_execution: "finished" }, { run_id: "r2", timestamp: { start: new Date(Date.now() - 600e3).toISOString() }, script_execution: "failed_conditions" }]);
      case "trace/get": return yes({ trace: { "trigger/0": [{}], "condition/0": [{ result: { result: false } }] } });
      case "search/related": return yes(m.item_id === "light.kitchen" ? { automation: ["automation.porch_light_at_dusk"], scene: ["scene.movie_time"] } : {});
      case "validate_config": return yes({ triggers: { valid: true, error: null }, conditions: { valid: true, error: null }, actions: { valid: true, error: null } });
      case "repairs/list_issues": return yes({ issues: [{ domain: "zha", issue_id: "radio_firmware", severity: "error", translation_key: "radio_firmware" }] });
      case "persistent_notification/get": return yes({ n1: { notification_id: "n1", title: "Login attempt failed", message: "From **192.168.1.50**", created_at: new Date().toISOString() } });
      case "config_entries/get": return yes([{ entry_id: "e1", domain: "tuya", title: "Tuya", state: "setup_error" }, { entry_id: "e2", domain: "zha", title: "Zigbee", state: "loaded" }]);
      case "backup/info": return yes({ backups: [{ backup_id: "b1", date: new Date(Date.now() - 4 * 864e5).toISOString() }], last_completed_automatic_backup: new Date(Date.now() - 4 * 864e5).toISOString(), next_automatic_backup: new Date(Date.now() + 864e5).toISOString() });
      case "backup/generate": return yes({ backup_job_id: "j1" });
      case "homeassistant/expose_entity/list": return yes({ exposed_entities: Object.fromEntries([...exposedTo].map(([id, set]) => [id, Object.fromEntries([...set].map((a) => [a, true]))])) });
      case "homeassistant/expose_entity": { for (const id of m.entity_ids as string[]) for (const a of m.assistants as string[]) { const set = exposedTo.get(id) ?? new Set<string>(); if (m.should_expose) set.add(a); else set.delete(a); if (set.size) exposedTo.set(id, set); else exposedTo.delete(id); } return yes(null); }
      case "conversation/process": {
        // Understands "turn on/off <name>" for lights, switches and fans, and nothing else: enough to show the app what comes back.
        const mt = /turn\s+(on|off)\s+(?:the\s+)?(.+?)\s*$/i.exec(String(m.text));
        const hit = mt && states.find((x) => /^(light|switch|fan)\./.test(x.entity_id) && String(x.attributes.friendly_name).toLowerCase().includes(mt[2]!.toLowerCase()));
        if (!mt || !hit) return yes({ response: { response_type: "error", speech: { plain: { speech: "Sorry, I couldn't understand that." } }, data: { code: "no_intent_match" } }, conversation_id: "c1" });
        const next = { ...hit, state: mt[1]!.toLowerCase() }; states[states.indexOf(hit)] = next; broadcast(next);
        return yes({ response: { response_type: "action_done", speech: { plain: { speech: `Turned ${mt[1]!.toLowerCase()} ${hit.attributes.friendly_name}` } }, data: { success: [{ id: hit.entity_id, name: hit.attributes.friendly_name, type: "entity" }], failed: [] } }, conversation_id: "c1" });
      }
      default: return undefined;
    }
  }
  function handle(ws: ServerWebSocket<unknown>, raw: string | Buffer) {
    const m = JSON.parse(String(raw)) as Command;
    if (mute && m.type !== "auth") return;
    if (m.type === "auth") return ws.send(JSON.stringify({ type: m.access_token === token ? "auth_ok" : "auth_invalid" }));
    const ok = (result: unknown = null) => ws.send(JSON.stringify({ id: m.id, type: "result", success: true, result }));
    const fail = (code: string, message: string) => ws.send(JSON.stringify({ id: m.id, type: "result", success: false, error: { code, message } }));
    if (m.type === "ping") return ws.send(JSON.stringify({ id: m.id, type: "pong" }));
    if (m.type === "get_config") return ok(hubConfig);
    if (m.type === "subscribe_events") {
      if (!m.event_type || m.event_type === "state_changed") subs.add(ws);
      else eventSubs.set(m.event_type, (eventSubs.get(m.event_type) ?? new Set()).add(ws));
      return ok();
    }
    if (m.type === "get_states") return ok(states);
    if (m.type === "config/entity_registry/list") return ok(registry.entities);
    if (m.type === "config/device_registry/list") return ok(registry.devices);
    if (m.type === "config/area_registry/list") return ok(registry.areas);
    if (m.type === "config/floor_registry/list") return ok(registry.floors);
    if (m.type === "config/label_registry/list") return ok(registry.labels);
    if (m.type === "input_select/create") { const ent = e("input_select." + slug(m.name ?? ""), m.initial ?? "", { options: m.options, friendly_name: m.name }); states.push(ent); broadcast(ent); return ok(); }
    if (m.type === "call_service" && m.service === "reload" && isKind(m.domain)) { reload(m.domain); return ok(); }
    if (m.type === "call_service") {
      const found = states.find((s) => s.entity_id === m.target?.entity_id);
      if (!found || found.state === "unavailable") return fail("not_found", "unavailable");
      let ent = found;
      const svc = m.service, d = m.service_data ?? {};
      const SET: Record<string, string> = { open_cover: "open", close_cover: "closed", open_valve: "open", close_valve: "closed", alarm_disarm: "disarmed", alarm_arm_away: "armed_away", alarm_arm_home: "armed_home", alarm_arm_night: "armed_night", start: "cleaning", return_to_base: "docked", pause: "paused" };
      if (SET[svc ?? ""]) ent.state = SET[svc ?? ""]!;
      else if (svc === "set_operation_mode") ent.state = String((d as Record<string, unknown>).operation_mode ?? ent.state);
      else if (svc === "turn_off") ent.state = "off"; else if (svc === "lock") ent.state = "locked"; else if (svc === "unlock") ent.state = "unlocked";
      else if (m.domain === "scene" && svc === "turn_on") {
        // apply the saved device states
        const cfg = [...configs.entries()].find(([k]) => k.startsWith("scene/") && k.endsWith(String(ent.attributes.id)))?.[1];
        for (const [eid, saved] of Object.entries(cfg?.entities ?? {})) {
          const target = states.find((x) => x.entity_id === eid);
          if (!target) continue;
          const { state, ...attributes } = saved;
          const next: Entity = { ...target, state, attributes: { ...target.attributes, ...attributes } };
          states[states.indexOf(target)] = next; broadcast(next);
        }
        ent.state = new Date().toISOString();
      }
      else if (m.domain === "script" && svc === "turn_on") {
        const cfg = configs.get("script/" + ent.entity_id.slice(7));
        for (const step of cfg?.sequence ?? []) {
          if (!step.action) continue;
          const [dom, sv] = step.action.split("."); const target = states.find((x) => x.entity_id === step.target?.entity_id); if (!target) continue;
          const next: Entity = { ...target, state: sv === "turn_off" ? "off" : sv === "turn_on" ? "on" : sv === "select_option" ? step.data?.option ?? target.state : target.state, attributes: { ...target.attributes } };
          if (dom === "input_select") next.state = step.data?.option ?? next.state;
          states[states.indexOf(target)] = next; broadcast(next);
        }
        ent.attributes.last_triggered = String(Date.now());
      }
      else if (svc === "select_option") ent.state = d.option ?? ent.state;
      else if (svc === "turn_on") ent.state = "on"; else if (svc === "set_hvac_mode") ent.state = d.hvac_mode ?? ent.state;
      if (d.brightness_pct != null) ent.attributes.brightness = Math.round((d.brightness_pct / 100) * 255);
      if (d.temperature != null) ent.attributes.temperature = d.temperature;
      if (d.percentage != null) ent.attributes.percentage = d.percentage;
      if (d.color_temp_kelvin != null) ent.attributes.color_temp_kelvin = d.color_temp_kelvin;
      if (d.hs_color) ent.attributes.hs_color = d.hs_color;
      if (d.volume_level != null) ent.attributes.volume_level = d.volume_level;
      ent = { ...ent, attributes: { ...ent.attributes } };
      const updated = ent;
      states[states.findIndex((s) => s.entity_id === updated.entity_id)] = updated;
      for (const s of subs) s.send(JSON.stringify({ type: "event", event: { event_type: "state_changed", data: { entity_id: updated.entity_id, new_state: updated } } }));
      return ok();
    }
    if (opts.component && m.type.startsWith("alice/")) {
      if (m.type === "alice/hello") return ok({ version: "0.1.0", protocol: opts.component.protocol });
      if (componentError) return fail(componentError, "refused");
      const c = m as unknown as { kind: Kind; item_id: string; config?: Config };
      if (!/^alice_[a-z0-9_]+$/.test(c.item_id ?? "")) return fail("invalid_config", "ids must start with alice_");
      if (m.type === "alice/config_write") { writes.push("ws"); configs.set(`${c.kind}/${c.item_id}`, c.config as Config); reload(c.kind); return ok({ ok: true }); }
      if (m.type === "alice/config_delete") { writes.push("ws"); const found = configs.delete(`${c.kind}/${c.item_id}`); reload(c.kind); return ok({ ok: true, found }); }
    }
    if (opts.demo) { const r = demo(m); if (r !== undefined) return r.ok === false ? fail(r.code, r.message) : ok(r.result); }
    return fail("unknown_command", "?");
  }
  return { server, states, registry, hubConfig, fire, configs, writes, setComponentError: (c: string | null) => { componentError = c; }, goQuiet: (v = true) => { mute = v; }, stop: () => server.stop(true) };
}
