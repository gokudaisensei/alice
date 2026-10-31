// Minimal Home Assistant stand-in: REST ping/states + WebSocket (auth, get_states, subscribe, call_service).
export function startMockHa(port: number, token = "dev-token") {
  const e = (id: string, state: string, a: any = {}) => ({ entity_id: id, state, attributes: { friendly_name: id.split(".")[1].replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase()), ...a } });
  const states: any[] = [
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
  const subs = new Set<any>();
  const configs = new Map<string, any>();
  const slug = (n: string) => n.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const broadcast = (ent: any) => { for (const s of subs) s.send(JSON.stringify({ type: "event", event: { event_type: "state_changed", data: { entity_id: ent.entity_id, new_state: ent } } })); };
  const reload = (kind: "scene" | "script" | "automation") => {
    const live = new Set<string>();
    for (const [key, cfg] of configs) {
      const [k, id] = key.split("/"); if (k !== kind) continue;
      const known = states.find((x) => x.attributes.id === id);
      const eid = known?.entity_id ?? (kind === "script" ? `script.${id}` : kind === "automation" ? `automation.${slug(cfg.alias)}` : `scene.${slug(cfg.name)}`);
      live.add(eid);
      const ent = e(eid, known?.state ?? (kind === "scene" ? "unknown" : kind === "automation" ? "on" : "off"), { friendly_name: kind === "scene" ? cfg.name : cfg.alias, id, ...(kind === "scene" ? { entity_id: Object.keys(cfg.entities ?? {}) } : {}) });
      const i = states.findIndex((x) => x.entity_id === eid);
      if (i >= 0) states[i] = ent; else states.push(ent);
      broadcast(ent);
    }
    for (let i = states.length - 1; i >= 0; i--) {
      const x = states[i];
      if (x.entity_id.startsWith(kind + ".") && String(x.attributes.id ?? "").startsWith("alice_") && !live.has(x.entity_id)) { states.splice(i, 1); broadcast({ entity_id: x.entity_id, state: "unavailable", attributes: {} }); }
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
      const cfg = pathname.match(/^\/api\/config\/(scene|script|automation)\/config\/(.+)$/);
      if (cfg) {
        if (req.method === "DELETE") { configs.delete(`${cfg[1]}/${cfg[2]}`); return Response.json({ result: "ok" }); }
        return req.json().then((b) => { configs.set(`${cfg[1]}/${cfg[2]}`, b); return Response.json({ result: "ok" }); });
      }
      return new Response("not found", { status: 404 });
    },
    websocket: {
      open(ws) { ws.send(JSON.stringify({ type: "auth_required" })); },
      close(ws) { subs.delete(ws); },
      message(ws, raw) { handle(ws, raw); },
    },
  });
  function handle(ws: any, raw: string | Buffer) {
        const m = JSON.parse(String(raw));
        if (m.type === "auth") return ws.send(JSON.stringify({ type: m.access_token === token ? "auth_ok" : "auth_invalid" }));
        const ok = (result: unknown = null) => ws.send(JSON.stringify({ id: m.id, type: "result", success: true, result }));
        if (m.type === "subscribe_events") { subs.add(ws); return ok(); }
        if (m.type === "get_states") return ok(states);
        if (m.type === "input_select/create") { const ent = e("input_select." + slug(m.name), m.initial, { options: m.options, friendly_name: m.name }); states.push(ent); broadcast(ent); return ok(); }
        if (m.type === "call_service" && m.service === "reload" && (m.domain === "scene" || m.domain === "script" || m.domain === "automation")) { reload(m.domain); return ok(); }
        if (m.type === "call_service") {
          let e = states.find((s) => s.entity_id === m.target?.entity_id);
          if (!e || e.state === "unavailable") return ws.send(JSON.stringify({ id: m.id, type: "result", success: false, error: { code: "not_found", message: "unavailable" } }));
          const svc = m.service;
          if (svc === "turn_off") e.state = "off"; else if (svc === "lock") e.state = "locked"; else if (svc === "unlock") e.state = "unlocked";
          else if (m.domain === "scene" && svc === "turn_on") {
            // apply the saved device states
            const cfg = [...configs.entries()].find(([k, c]) => k.startsWith("scene/") && k.endsWith(e.attributes.id))?.[1];
            for (const [eid, st] of Object.entries<any>(cfg?.entities ?? {})) { const t = states.find((x) => x.entity_id === eid); if (t) { const n = { ...t, state: st.state, attributes: { ...t.attributes, ...Object.fromEntries(Object.entries(st).filter(([k]) => k !== "state")) } }; states[states.indexOf(t)] = n; broadcast(n); } }
            e.state = new Date().toISOString();
          }
          else if (m.domain === "script" && svc === "turn_on") {
            const cfg = configs.get("script/" + e.entity_id.slice(7));
            for (const step of cfg?.sequence ?? []) {
              if (!step.action) continue;
              const [dom, sv] = step.action.split("."); const tid = step.target?.entity_id; const t = states.find((x) => x.entity_id === tid); if (!t) continue;
              const n = { ...t, state: sv === "turn_off" ? "off" : sv === "turn_on" ? "on" : sv === "select_option" ? step.data.option : t.state, attributes: { ...t.attributes } };
              if (dom === "input_select") n.state = step.data.option; states[states.indexOf(t)] = n; broadcast(n);
            }
            e.attributes.last_triggered = String(Date.now());
          }
          else if (svc === "select_option") e.state = m.service_data.option;
          else if (svc === "turn_on") e.state = "on"; else if (svc === "set_hvac_mode") e.state = m.service_data.hvac_mode;
          const d = m.service_data ?? {};
          if (d.brightness_pct != null) e.attributes.brightness = Math.round((d.brightness_pct / 100) * 255);
          if (d.temperature != null) e.attributes.temperature = d.temperature;
          if (d.percentage != null) e.attributes.percentage = d.percentage;
          if (d.color_temp_kelvin != null) e.attributes.color_temp_kelvin = d.color_temp_kelvin;
          if (d.hs_color) e.attributes.hs_color = d.hs_color;
          if (d.volume_level != null) e.attributes.volume_level = d.volume_level;
          e = { ...e, attributes: { ...e.attributes } }; states[states.findIndex((s) => s.entity_id === e.entity_id)] = e;
          for (const s of subs) s.send(JSON.stringify({ type: "event", event: { event_type: "state_changed", data: { entity_id: e.entity_id, new_state: e } } }));
          return ok();
        }
        ws.send(JSON.stringify({ id: m.id, type: "result", success: false, error: { code: "unknown_command", message: "?" } }));
  }
  return { server, states, stop: () => server.stop(true) };
}
