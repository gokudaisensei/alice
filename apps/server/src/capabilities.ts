import type { HaEntity } from "./ha";
import { asObject, oneOf } from "./http";

/** The icons a person can pick for a device. The web app draws each one. */
export const DEVICE_ICONS = ["bulb", "lamp", "plug", "coffee", "kettle", "heater", "fan", "tv", "speaker", "lock", "door", "window", "garage", "camera", "thermometer", "water", "bolt", "motion", "smoke", "washer", "fridge", "oven", "bed", "sofa"] as const;

/** How a room can look: colours and icons the household chooses from. The web app draws each one. */
export const ROOM_COLORS = ["blue", "teal", "green", "amber", "orange", "red", "pink", "purple", "grey"] as const;
export const ROOM_ICONS = ["sofa", "bed", "kitchen", "bath", "desk", "car", "tree", "door", "stairs", "tv", "baby", "dining"] as const;

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

/** Build a capability descriptor from what HA actually reports. Never assumes a category implies a control. */
export function describe(e: HaEntity): Descriptor {
  const [domain = ""] = e.entity_id.split(".");
  const a = e.attributes;
  const base = { entityId: e.entity_id, domain, name: String(a.friendly_name ?? e.entity_id), ordinary: true, controls: [] as Control[], reading: null as Reading };
  switch (domain) {
    case "light": {
      const modes = strings(a.supported_color_modes);
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
      if (hasFeature(a.supported_features, 1)) controls.push({ type: "fan_speed", step: Number(a.percentage_step ?? 1) });
      return { ...base, category: "fan", controls };
    }
    case "climate": {
      const controls: Control[] = [];
      const modes = strings(a.hvac_modes);
      if (hasFeature(a.supported_features, 1) || modes.length)
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
      const playback = hasFeature(f, 1) || hasFeature(f, 16384), volume = hasFeature(f, 4), power = hasFeature(f, 128) && hasFeature(f, 256);
      return { ...base, category: "media", controls: [{ type: "media", playback, volume, power }], ordinary: playback || volume || power };
    }
    case "sensor":
    case "binary_sensor": {
      const energy = domain === "sensor" && ENERGY_CLASSES.includes(String(a.device_class));
      const unit = a.unit_of_measurement == null ? null : String(a.unit_of_measurement);
      // Plain readings only. Timestamps ("last backup"), dates and enum text states are the hub's own housekeeping, not things in a home.
      const housekeeping = domain === "sensor" && (["timestamp", "date", "enum", "duration"].includes(String(a.device_class)) || (!unit && !a.device_class && !Number.isFinite(Number(e.state)) && e.state !== "unavailable" && e.state !== "unknown"));
      return { ...base, category: energy ? "energy" : "sensor", ordinary: !housekeeping, reading: { value: e.state, unit, kind: "measurement", cls: typeof a.device_class === "string" ? a.device_class : null } };
    }
    default:
      // covers, blinds, curtains (excluded from v1) and anything else
      return { ...base, category: "sensor", ordinary: false };
  }
}

/** Every command a device can be given. `toServiceCall` handles each one, and the compiler checks it does. */
export const ACTIONS = [
  "turn_on", "turn_off", "set_brightness", "set_color_temp", "set_color", "set_speed", "set_temperature", "set_hvac_mode",
  "lock", "unlock", "media_play", "media_pause", "set_volume",
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
      return typeof c.value === "string" && t.modes.includes(c.value) ? call("set_hvac_mode", { hvac_mode: c.value }) : INVALID;
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
  }
}
