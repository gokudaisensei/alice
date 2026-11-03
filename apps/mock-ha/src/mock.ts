// Minimal Home Assistant stand-in: REST ping/states + WebSocket (auth, get_states, subscribe, call_service).
import type { ServerWebSocket } from "bun";

type Entity = { entity_id: string; state: string; attributes: Record<string, unknown> };
type ServiceData = { brightness_pct?: number; temperature?: number; percentage?: number; color_temp_kelvin?: number; hs_color?: number[]; volume_level?: number; option?: string; hvac_mode?: string };
type ScriptStep = { action?: string; target?: { entity_id?: string }; data?: { option?: string } };
/** What HA keeps for a UI-managed scene (`name`, `entities`), script (`alias`, `sequence`) or automation (`alias`). */
type Config = { alias?: string; name?: string; entities?: Record<string, { state: string } & Record<string, unknown>>; sequence?: ScriptStep[] };
type Command = {
  id?: number; type: string; access_token?: string; name?: string; initial?: string; options?: string[];
  domain?: string; service?: string; service_data?: ServiceData; target?: { entity_id?: string };
};
type Kind = "scene" | "script" | "automation";

const isKind = (v: string | undefined): v is Kind => v === "scene" || v === "script" || v === "automation";

export function startMockHa(port: number, token = "dev-token") {
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
  const subs = new Set<ServerWebSocket<unknown>>();
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
        return req.json().then((b) => { configs.set(key, b as Config); return Response.json({ result: "ok" }); });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) { ws.send(JSON.stringify({ type: "auth_required" })); },
      close(ws) { subs.delete(ws); },
      message(ws, raw) { handle(ws, raw); },
    },
  });
  function handle(ws: ServerWebSocket<unknown>, raw: string | Buffer) {
    const m = JSON.parse(String(raw)) as Command;
    if (m.type === "auth") return ws.send(JSON.stringify({ type: m.access_token === token ? "auth_ok" : "auth_invalid" }));
    const ok = (result: unknown = null) => ws.send(JSON.stringify({ id: m.id, type: "result", success: true, result }));
    const fail = (code: string, message: string) => ws.send(JSON.stringify({ id: m.id, type: "result", success: false, error: { code, message } }));
    if (m.type === "subscribe_events") { subs.add(ws); return ok(); }
    if (m.type === "get_states") return ok(states);
    if (m.type === "config/entity_registry/list") return ok([]);
    if (m.type === "input_select/create") { const ent = e("input_select." + slug(m.name ?? ""), m.initial ?? "", { options: m.options, friendly_name: m.name }); states.push(ent); broadcast(ent); return ok(); }
    if (m.type === "call_service" && m.service === "reload" && isKind(m.domain)) { reload(m.domain); return ok(); }
    if (m.type === "call_service") {
      const found = states.find((s) => s.entity_id === m.target?.entity_id);
      if (!found || found.state === "unavailable") return fail("not_found", "unavailable");
      let ent = found;
      const svc = m.service, d = m.service_data ?? {};
      if (svc === "turn_off") ent.state = "off"; else if (svc === "lock") ent.state = "locked"; else if (svc === "unlock") ent.state = "unlocked";
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
    return fail("unknown_command", "?");
  }
  return { server, states, stop: () => server.stop(true) };
}
