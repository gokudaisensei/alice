import type { HaEntity } from "./ha";

export type Category = "light" | "switch" | "fan" | "climate" | "sensor" | "lock" | "camera" | "media" | "energy";

export type Control =
  | { type: "power" }
  | { type: "brightness" }
  | { type: "color_temp"; minK: number; maxK: number }
  | { type: "color" }
  | { type: "fan_speed"; step: number }
  | { type: "thermostat"; min: number; max: number; step: number; modes: string[]; unit: string }
  | { type: "lock" }
  | { type: "media"; playback: boolean; volume: boolean; power: boolean }
  | { type: "camera" };

export type Reading = { value: string; unit: string | null; kind: "measurement" } | null;

export type Descriptor = {
  entityId: string; domain: string; category: Category; name: string;
  /** false = shown only in the admin device area (unsupported or not meaningful as a household control) */
  ordinary: boolean; controls: Control[]; reading: Reading;
};

const COLOR_MODES = ["hs", "xy", "rgb", "rgbw", "rgbww"];
const BRIGHT_MODES = [...COLOR_MODES, "brightness", "color_temp", "white"];
const ENERGY_CLASSES = ["energy", "power", "current", "voltage"];

const has = (features: unknown, bit: number) => typeof features === "number" && (features & bit) === bit;

/** Build a capability descriptor from what HA actually reports. Never assumes a category implies a control. */
export function describe(e: HaEntity): Descriptor {
  const [domain] = e.entity_id.split(".");
  const a = e.attributes ?? {};
  const base = { entityId: e.entity_id, domain, name: String(a.friendly_name ?? e.entity_id), ordinary: true, controls: [] as Control[], reading: null as Reading };
  switch (domain) {
    case "light": {
      const modes: string[] = Array.isArray(a.supported_color_modes) ? a.supported_color_modes : [];
      const controls: Control[] = [{ type: "power" }];
      if (modes.some((m) => BRIGHT_MODES.includes(m))) controls.push({ type: "brightness" });
      if (modes.includes("color_temp")) controls.push({ type: "color_temp", minK: Number(a.min_color_temp_kelvin ?? 2000), maxK: Number(a.max_color_temp_kelvin ?? 6500) });
      if (modes.some((m) => COLOR_MODES.includes(m))) controls.push({ type: "color" });
      return { ...base, category: "light", controls };
    }
    case "switch":
      return { ...base, category: "switch", controls: [{ type: "power" }] };
    case "fan": {
      const controls: Control[] = [{ type: "power" }];
      if (has(a.supported_features, 1)) controls.push({ type: "fan_speed", step: Number(a.percentage_step ?? 1) });
      return { ...base, category: "fan", controls };
    }
    case "climate": {
      const controls: Control[] = [];
      const modes: string[] = Array.isArray(a.hvac_modes) ? a.hvac_modes : [];
      if (has(a.supported_features, 1) || modes.length)
        controls.push({ type: "thermostat", min: Number(a.min_temp ?? 7), max: Number(a.max_temp ?? 35), step: Number(a.target_temp_step ?? 0.5), modes, unit: "°C" });
      const cur = a.current_temperature;
      return { ...base, category: "climate", controls, reading: cur != null ? { value: String(cur), unit: "°C", kind: "measurement" } : null, ordinary: controls.length > 0 };
    }
    case "lock":
      return { ...base, category: "lock", controls: [{ type: "lock" }] };
    case "camera":
      return { ...base, category: "camera", controls: [{ type: "camera" }] };
    case "media_player": {
      const f = a.supported_features;
      const playback = has(f, 1) || has(f, 16384), volume = has(f, 4), power = has(f, 128) && has(f, 256);
      return { ...base, category: "media", controls: [{ type: "media", playback, volume, power }], ordinary: playback || volume || power };
    }
    case "sensor":
    case "binary_sensor": {
      const energy = domain === "sensor" && ENERGY_CLASSES.includes(a.device_class);
      const unit = a.unit_of_measurement ?? null;
      // Plain readings only. Timestamps ("last backup"), dates and enum text states are the hub's own housekeeping, not things in a home.
      const housekeeping = domain === "sensor" && (["timestamp", "date", "enum", "duration"].includes(a.device_class) || (!unit && !a.device_class && !Number.isFinite(Number(e.state)) && e.state !== "unavailable" && e.state !== "unknown"));
      return { ...base, category: energy ? "energy" : "sensor", ordinary: !housekeeping, reading: { value: e.state, unit, kind: "measurement" } };
    }
    default:
      // covers, blinds, curtains (excluded from v1) and anything else
      return { ...base, category: "sensor", ordinary: false };
  }
}

export type Command = { action: string; value?: any };
export type ServiceCall = { domain: string; service: string; data: Record<string, unknown>; sensitive?: boolean };

const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** Validate a command against the device's real capabilities and translate it to an HA service call. */
export function toServiceCall(d: Descriptor, c: Command): ServiceCall | { error: string } {
  const has = (t: Control["type"]) => d.controls.find((x) => x.type === t) as any;
  const domain = d.domain;
  const bad = { error: "unsupported" };
  switch (c.action) {
    case "turn_on": case "turn_off":
      return has("power") || (has("media")?.power) ? { domain, service: c.action, data: {} } : bad;
    case "set_brightness": { const v = num(c.value, 1, 100); return has("brightness") && v !== null ? { domain, service: "turn_on", data: { brightness_pct: Math.round(v) } } : has("brightness") ? { error: "invalid_value" } : bad; }
    case "set_color_temp": { const t = has("color_temp"); const v = t && num(c.value, t.minK, t.maxK); return t && v ? { domain, service: "turn_on", data: { color_temp_kelvin: Math.round(v) } } : t ? { error: "invalid_value" } : bad; }
    case "set_color": { const h = num(c.value?.h, 0, 360), s = num(c.value?.s, 0, 100); return has("color") && h !== null && s !== null ? { domain, service: "turn_on", data: { hs_color: [h, s] } } : has("color") ? { error: "invalid_value" } : bad; }
    case "set_speed": { const v = num(c.value, 0, 100); return has("fan_speed") && v !== null ? { domain, service: v === 0 ? "turn_off" : "turn_on", data: v === 0 ? {} : { percentage: Math.round(v) } } : has("fan_speed") ? { error: "invalid_value" } : bad; }
    case "set_temperature": { const t = has("thermostat"); const v = t && num(c.value, t.min, t.max); return t && v !== null && v !== false ? { domain, service: "set_temperature", data: { temperature: v } } : t ? { error: "invalid_value" } : bad; }
    case "set_hvac_mode": { const t = has("thermostat"); return t && t.modes.includes(c.value) ? { domain, service: "set_hvac_mode", data: { hvac_mode: c.value } } : t ? { error: "invalid_value" } : bad; }
    case "lock": return has("lock") ? { domain, service: "lock", data: {} } : bad;
    case "unlock": return has("lock") ? { domain, service: "unlock", data: {}, sensitive: true } : bad;
    case "media_play": case "media_pause": { const m = has("media"); return m?.playback ? { domain, service: c.action, data: {} } : bad; }
    case "set_volume": { const m = has("media"); const v = num(c.value, 0, 100); return m?.volume && v !== null ? { domain, service: "volume_set", data: { volume_level: v / 100 } } : m?.volume ? { error: "invalid_value" } : bad; }
    default: return bad;
  }
}
