import type { HaAttributes, HaEntity } from "./ha";
import { asObject, oneOf } from "./http";
import { MODE_ENTITY } from "./modes";

/** The icons a person can pick for a device. The web app draws each one. */
export const DEVICE_ICONS = ["bulb", "lamp", "plug", "coffee", "kettle", "heater", "fan", "tv", "speaker", "lock", "door", "window", "garage", "camera", "thermometer", "water", "bolt", "motion", "smoke", "washer", "fridge", "oven", "bed", "sofa"] as const;

/** How a room can look: colours and icons the household chooses from. The web app draws each one. */
export const ROOM_COLORS = ["blue", "teal", "green", "amber", "orange", "red", "pink", "purple", "grey"] as const;
export const ROOM_ICONS = ["sofa", "bed", "kitchen", "bath", "desk", "car", "tree", "door", "stairs", "tv", "baby", "dining"] as const;

export type Category =
  | "light" | "switch" | "fan" | "climate" | "sensor" | "lock" | "camera" | "media" | "energy"
  | "cover" | "vacuum" | "humidifier" | "valve" | "waterheater" | "siren" | "alarm" | "input" | "weather";

export type Control =
  | { type: "power" }
  | { type: "brightness" }
  | { type: "color_temp"; minK: number; maxK: number }
  | { type: "color" }
  | { type: "fan_speed"; step: number }
  | { type: "thermostat"; min: number; max: number; step: number; modes: string[]; unit: string }
  | { type: "lock" }
  | { type: "media"; playback: boolean; volume: boolean; power: boolean; /** can be pointed at something from its media library */ browse: boolean; /** can be told to play something it was pointed at */ playMedia: boolean; /** inputs it can switch between */ sources: string[] }
  | { type: "camera" }
  | { type: "cover"; position: boolean; tilt: boolean; stop: boolean; cls: string | null }
  | { type: "vacuum"; start: boolean; pause: boolean; dock: boolean; locate: boolean; speeds: string[] }
  | { type: "humidifier"; min: number; max: number; modes: string[] }
  | { type: "valve"; position: boolean; stop: boolean; cls: string | null }
  | { type: "alarm"; modes: AlarmMode[]; code: boolean }
  | { type: "number"; min: number; max: number; step: number; unit: string | null }
  | { type: "select"; options: string[] }
  | { type: "press" };
export const ALARM_MODES = ["home", "away", "night", "vacation"] as const;
export type AlarmMode = (typeof ALARM_MODES)[number];

/** `cls` is the hub's device class (door, window, motion, temperature…), which says how to word an on/off reading. */
export type Reading = { value: string; unit: string | null; kind: "measurement"; cls?: string | null } | null;

export type Descriptor = {
  entityId: string; domain: string; category: Category; name: string;
  /** false = shown only in the admin device area (unsupported or not meaningful as a household control) */
  ordinary: boolean; controls: Control[]; reading: Reading;
};

/** The strings of a list-valued attribute; anything else reads as empty. */
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

const COLOR_MODES = ["hs", "xy", "rgb", "rgbw", "rgbww"];
const BRIGHT_MODES = [...COLOR_MODES, "brightness", "color_temp", "white"];
const ENERGY_CLASSES = ["energy", "power", "current", "voltage"];

const hasFeature = (features: unknown, bit: number) => typeof features === "number" && (features & bit) === bit;

type Base = Omit<Descriptor, "category">;
type Describer = (e: HaEntity, a: HaAttributes, base: Base) => Descriptor;
const nums = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);
const cls = (a: HaAttributes) => (typeof a.device_class === "string" ? a.device_class : null);

/** One entry per Home Assistant domain: what it is and what it can do, from what the hub reports. A domain with no entry stays out of the household's way. */
const DESCRIBERS: Record<string, Describer> = {
  light: (_e, a, base) => {
    const modes = strings(a.supported_color_modes);
    const controls: Control[] = [{ type: "power" }];
    if (modes.some((m) => BRIGHT_MODES.includes(m))) controls.push({ type: "brightness" });
    if (modes.includes("color_temp")) controls.push({ type: "color_temp", minK: Number(a.min_color_temp_kelvin ?? 2000), maxK: Number(a.max_color_temp_kelvin ?? 6500) });
    if (modes.some((m) => COLOR_MODES.includes(m))) controls.push({ type: "color" });
    return { ...base, category: "light", controls };
  },
  switch: (_e, _a, base) => ({ ...base, category: "switch", controls: [{ type: "power" }] }),
  input_boolean: (_e, _a, base) => ({ ...base, category: "input", controls: [{ type: "power" }] }),
  siren: (_e, _a, base) => ({ ...base, category: "siren", controls: [{ type: "power" }] }),
  fan: (_e, a, base) => {
    const controls: Control[] = [{ type: "power" }];
    if (hasFeature(a.supported_features, 1)) controls.push({ type: "fan_speed", step: Number(a.percentage_step ?? 1) });
    return { ...base, category: "fan", controls };
  },
  climate: (_e, a, base) => {
    const controls: Control[] = [];
    const modes = strings(a.hvac_modes);
    if (hasFeature(a.supported_features, 1) || modes.length)
      controls.push({ type: "thermostat", min: Number(a.min_temp ?? 7), max: Number(a.max_temp ?? 35), step: Number(a.target_temp_step ?? 0.5), modes, unit: "°C" });
    const cur = a.current_temperature;
    return { ...base, category: "climate", controls, reading: cur != null ? { value: String(cur), unit: "°C", kind: "measurement" } : null, ordinary: controls.length > 0 };
  },
  // A water heater is a thermostat with operation modes instead of heating modes.
  water_heater: (_e, a, base) => {
    const controls: Control[] = [];
    if (hasFeature(a.supported_features, 8)) controls.push({ type: "power" });
    if (hasFeature(a.supported_features, 1)) controls.push({ type: "thermostat", min: nums(a.min_temp, 30), max: nums(a.max_temp, 70), step: nums(a.target_temp_step, 1), modes: hasFeature(a.supported_features, 2) ? strings(a.operation_list) : [], unit: "°C" });
    const cur = a.current_temperature;
    return { ...base, category: "waterheater", controls, reading: cur != null ? { value: String(cur), unit: "°C", kind: "measurement" } : null, ordinary: controls.length > 0 };
  },
  lock: (_e, _a, base) => ({ ...base, category: "lock", controls: [{ type: "lock" }] }),
  camera: (_e, _a, base) => ({ ...base, category: "camera", controls: [{ type: "camera" }] }),
  media_player: (_e, a, base) => {
    const f = a.supported_features;
    const playback = hasFeature(f, 1) || hasFeature(f, 16384), volume = hasFeature(f, 4), power = hasFeature(f, 128) && hasFeature(f, 256);
    const browse = hasFeature(f, 131072), playMedia = hasFeature(f, 512), sources = hasFeature(f, 2048) ? strings(a.source_list) : [];
    return { ...base, category: "media", controls: [{ type: "media", playback, volume, power, browse, playMedia, sources }], ordinary: playback || volume || power || browse || sources.length > 0 };
  },
  cover: (_e, a, base) => {
    const f = a.supported_features, c: Control = { type: "cover", position: hasFeature(f, 4), tilt: hasFeature(f, 128), stop: hasFeature(f, 8), cls: cls(a) };
    return { ...base, category: "cover", controls: [c], ordinary: hasFeature(f, 1) || hasFeature(f, 2) || c.position };
  },
  valve: (_e, a, base) => {
    const f = a.supported_features, c: Control = { type: "valve", position: hasFeature(f, 4), stop: hasFeature(f, 8), cls: cls(a) };
    return { ...base, category: "valve", controls: [c], ordinary: hasFeature(f, 1) || hasFeature(f, 2) || c.position };
  },
  vacuum: (_e, a, base) => {
    const f = a.supported_features;
    const c: Control = { type: "vacuum", start: hasFeature(f, 8192) || hasFeature(f, 1), pause: hasFeature(f, 4), dock: hasFeature(f, 16), locate: hasFeature(f, 512), speeds: hasFeature(f, 32) ? strings(a.fan_speed_list) : [] };
    return { ...base, category: "vacuum", controls: [c], ordinary: c.start || c.pause || c.dock };
  },
  humidifier: (_e, a, base) => ({
    ...base, category: "humidifier",
    controls: [{ type: "power" }, { type: "humidifier", min: nums(a.min_humidity, 0), max: nums(a.max_humidity, 100), modes: hasFeature(a.supported_features, 1) ? strings(a.available_modes) : [] }],
  }),
  alarm_control_panel: (_e, a, base) => {
    const f = a.supported_features, m = a.code_format;
    const modes = ALARM_MODES.filter((x) => hasFeature(f, { home: 1, away: 2, night: 4, vacation: 32 }[x]));
    return { ...base, category: "alarm", controls: [{ type: "alarm", modes, code: m === "number" || m === "text" }], ordinary: modes.length > 0 };
  },
  number: numberLike, input_number: numberLike,
  select: selectLike, input_select: selectLike,
  button: (_e, _a, base) => ({ ...base, category: "input", controls: [{ type: "press" }] }),
  input_button: (_e, _a, base) => ({ ...base, category: "input", controls: [{ type: "press" }] }),
  weather: (e, a, base) => ({ ...base, category: "weather", reading: { value: e.state, unit: null, kind: "measurement", cls: "weather" }, ordinary: a.temperature != null || e.state !== "unavailable" }),
  sensor: sensorLike, binary_sensor: sensorLike,
};
function numberLike(_e: HaEntity, a: HaAttributes, base: Base): Descriptor {
  return { ...base, category: "input", controls: [{ type: "number", min: nums(a.min, 0), max: nums(a.max, 100), step: nums(a.step, 1), unit: typeof a.unit_of_measurement === "string" ? a.unit_of_measurement : null }] };
}
function selectLike(e: HaEntity, a: HaAttributes, base: Base): Descriptor {
  // The household mode lives in an input_select of ours; it has its own screen and is not a device.
  return { ...base, category: "input", controls: [{ type: "select", options: strings(a.options) }], ordinary: e.entity_id !== MODE_ENTITY };
}
function sensorLike(e: HaEntity, a: HaAttributes, base: Base): Descriptor {
  const [domain = ""] = e.entity_id.split(".");
  const energy = domain === "sensor" && ENERGY_CLASSES.includes(String(a.device_class));
  const unit = a.unit_of_measurement == null ? null : String(a.unit_of_measurement);
  // Plain readings only. Timestamps ("last backup"), dates and enum text states are the hub's own housekeeping, not things in a home.
  const housekeeping = (domain === "binary_sensor" && !a.device_class) || domain === "sensor" && (["timestamp", "date", "enum", "duration"].includes(String(a.device_class)) || (!unit && !a.device_class) || a.friendly_name === undefined);
  return { ...base, category: energy ? "energy" : "sensor", ordinary: !housekeeping, reading: { value: e.state, unit, kind: "measurement", cls: typeof a.device_class === "string" ? a.device_class : null } };
}

/** Build a capability descriptor from what HA actually reports. Never assumes a category implies a control. */
export function describe(e: HaEntity): Descriptor {
  const [domain = ""] = e.entity_id.split(".");
  const base: Base = { entityId: e.entity_id, domain, name: String(e.attributes.friendly_name ?? e.entity_id), ordinary: true, controls: [], reading: null };
  // Anything we have no entry for (and anything new in Home Assistant) is kept out of the household's way.
  return DESCRIBERS[domain]?.(e, e.attributes, base) ?? { ...base, category: "sensor", ordinary: false };
}

/** Every command a device can be given. `toServiceCall` handles each one, and the compiler checks it does. */
export const ACTIONS = [
  "turn_on", "turn_off", "set_brightness", "set_color_temp", "set_color", "set_speed", "set_temperature", "set_hvac_mode",
  "lock", "unlock", "media_play", "media_pause", "set_volume",
  "open", "close", "stop", "set_position", "set_tilt",
  "vacuum_start", "vacuum_pause", "vacuum_dock", "vacuum_locate", "set_vacuum_speed",
  "set_humidity", "set_mode", "arm", "disarm", "set_number", "set_option", "press",
  "play_media", "select_source",
] as const;
export type Action = (typeof ACTIONS)[number];
export const isAction = (value: unknown): value is Action => oneOf(ACTIONS, value);

/** Commands arrive from clients, so `action` is any string until `toServiceCall` has checked it. */
export type Command = { action: string; value?: unknown };
export type ServiceCall = { domain: string; service: string; data: Record<string, unknown>; sensitive?: boolean };
export type CommandError = { error: "unsupported" | "invalid_value" };

const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);

/** The device's control of type `T`, narrowed to that member of the union. */
const control = <const T extends Control["type"]>(d: Descriptor, type: T) =>
  d.controls.find((x): x is Extract<Control, { type: T }> => x.type === type);

const UNSUPPORTED: CommandError = { error: "unsupported" };
const INVALID: CommandError = { error: "invalid_value" };

/** Doors, gates, garages and water or gas lines: opening one lets something in. */
const opensTheHouse = (domain: string, cls: string | null) => (domain === "cover" ? ["garage", "gate", "door"] : ["water", "gas"]).includes(cls ?? "");
/** An alarm code is digits or text a person typed: kept short and never logged or stored here. */
const codeOf = (v: unknown): string | undefined | CommandError => (v === undefined || v === "" ? undefined : typeof v === "string" && v.length <= 12 ? v : INVALID);

/** Validate a command against the device's real capabilities and translate it to an HA service call. */
export function toServiceCall(d: Descriptor, c: Command): ServiceCall | CommandError {
  if (!isAction(c.action)) return UNSUPPORTED;
  const { domain } = d;
  const call = (service: string, data: Record<string, unknown> = {}, sensitive?: true): ServiceCall => ({ domain, service, data, ...(sensitive && { sensitive }) });
  switch (c.action) {
    case "turn_on": case "turn_off":
      return control(d, "power") || control(d, "media")?.power ? call(c.action) : UNSUPPORTED;
    case "set_brightness": {
      if (!control(d, "brightness")) return UNSUPPORTED;
      const v = num(c.value, 1, 100);
      return v === null ? INVALID : call("turn_on", { brightness_pct: Math.round(v) });
    }
    case "set_color_temp": {
      const t = control(d, "color_temp");
      if (!t) return UNSUPPORTED;
      const v = num(c.value, t.minK, t.maxK);
      return v ? call("turn_on", { color_temp_kelvin: Math.round(v) }) : INVALID;
    }
    case "set_color": {
      if (!control(d, "color")) return UNSUPPORTED;
      const value = asObject(c.value), h = num(value.h, 0, 360), s = num(value.s, 0, 100);
      return h !== null && s !== null ? call("turn_on", { hs_color: [h, s] }) : INVALID;
    }
    case "set_speed": {
      if (!control(d, "fan_speed")) return UNSUPPORTED;
      const v = num(c.value, 0, 100);
      if (v === null) return INVALID;
      return v === 0 ? call("turn_off") : call("turn_on", { percentage: Math.round(v) });
    }
    case "set_temperature": {
      const t = control(d, "thermostat");
      if (!t) return UNSUPPORTED;
      const v = num(c.value, t.min, t.max);
      return v === null ? INVALID : call("set_temperature", { temperature: v });
    }
    case "set_hvac_mode": {
      const t = control(d, "thermostat");
      if (!t) return UNSUPPORTED;
      if (typeof c.value !== "string" || !t.modes.includes(c.value)) return INVALID;
      return d.domain === "water_heater" ? call("set_operation_mode", { operation_mode: c.value }) : call("set_hvac_mode", { hvac_mode: c.value });
    }
    case "lock": return control(d, "lock") ? call("lock") : UNSUPPORTED;
    case "unlock": return control(d, "lock") ? call("unlock", {}, true) : UNSUPPORTED;
    case "media_play": case "media_pause":
      return control(d, "media")?.playback ? call(c.action) : UNSUPPORTED;
    case "set_volume": {
      const m = control(d, "media");
      if (!m?.volume) return UNSUPPORTED;
      const v = num(c.value, 0, 100);
      return v === null ? INVALID : call("volume_set", { volume_level: v / 100 });
    }
    case "open": case "close": case "stop": {
      const x = control(d, "cover") ?? control(d, "valve");
      if (!x || (c.action === "stop" && !x.stop)) return UNSUPPORTED;
      // Opening something that lets people or water in is a deliberate act, checked like unlocking.
      return call(`${c.action}_${d.domain}`, {}, c.action === "open" && opensTheHouse(d.domain, x.cls) ? true : undefined);
    }
    case "set_position": {
      const x = control(d, "cover") ?? control(d, "valve");
      if (!x?.position) return UNSUPPORTED;
      const v = num(c.value, 0, 100);
      return v === null ? INVALID : call(`set_${d.domain}_position`, { position: Math.round(v) }, v > 0 && opensTheHouse(d.domain, x.cls) ? true : undefined);
    }
    case "set_tilt": {
      const x = control(d, "cover");
      if (!x?.tilt) return UNSUPPORTED;
      const v = num(c.value, 0, 100);
      return v === null ? INVALID : call("set_cover_tilt_position", { tilt_position: Math.round(v) });
    }
    case "vacuum_start": return control(d, "vacuum")?.start ? call("start") : UNSUPPORTED;
    case "vacuum_pause": return control(d, "vacuum")?.pause ? call("pause") : UNSUPPORTED;
    case "vacuum_dock": return control(d, "vacuum")?.dock ? call("return_to_base") : UNSUPPORTED;
    case "vacuum_locate": return control(d, "vacuum")?.locate ? call("locate") : UNSUPPORTED;
    case "set_vacuum_speed": {
      const v = control(d, "vacuum");
      if (!v?.speeds.length) return UNSUPPORTED;
      return typeof c.value === "string" && v.speeds.includes(c.value) ? call("set_fan_speed", { fan_speed: c.value }) : INVALID;
    }
    case "set_humidity": {
      const h = control(d, "humidifier");
      if (!h) return UNSUPPORTED;
      const v = num(c.value, h.min, h.max);
      return v === null ? INVALID : call("set_humidity", { humidity: Math.round(v) });
    }
    case "set_mode": {
      const h = control(d, "humidifier");
      if (!h?.modes.length) return UNSUPPORTED;
      return typeof c.value === "string" && h.modes.includes(c.value) ? call("set_mode", { mode: c.value }) : INVALID;
    }
    case "arm": {
      const a = control(d, "alarm");
      if (!a) return UNSUPPORTED;
      const value = asObject(c.value), mode = value.mode, code = codeOf(value.code);
      if (typeof mode !== "string" || !oneOf(a.modes, mode) || code === INVALID) return INVALID;
      return call(`alarm_arm_${mode}`, code ? { code } : {});
    }
    case "disarm": {
      const a = control(d, "alarm");
      if (!a) return UNSUPPORTED;
      const code = codeOf(asObject(c.value).code);
      return code === INVALID ? INVALID : call("alarm_disarm", code ? { code } : {}, true);
    }
    case "set_number": {
      const n = control(d, "number");
      if (!n) return UNSUPPORTED;
      const v = num(c.value, n.min, n.max);
      return v === null ? INVALID : call("set_value", { value: v });
    }
    case "set_option": {
      const o = control(d, "select");
      if (!o) return UNSUPPORTED;
      return typeof c.value === "string" && o.options.includes(c.value) ? call("select_option", { option: c.value }) : INVALID;
    }
    case "press": return control(d, "press") ? call("press") : UNSUPPORTED;
    case "play_media": {
      if (!control(d, "media")?.playMedia) return UNSUPPORTED;
      const v = asObject(c.value), id = v.id, type = v.type;
      return typeof id === "string" && id.length > 0 && id.length <= 500 && typeof type === "string" && /^[A-Za-z0-9_./:-]{1,60}$/.test(type) ? call("play_media", { media_content_id: id, media_content_type: type }) : INVALID;
    }
    case "select_source": {
      const m = control(d, "media");
      if (!m?.sources.length) return UNSUPPORTED;
      return typeof c.value === "string" && m.sources.includes(c.value) ? call("select_source", { source: c.value }) : INVALID;
    }
  }
}
