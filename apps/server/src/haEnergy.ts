import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { authorize } from "./guard";
import { friendlyName, type HaApi } from "./ha";
import type { DeviceService } from "./devices";
import { denyWith as deny, oneOf } from "./http";

export const RANGES = ["week", "month", "year"] as const;
export type Range = (typeof RANGES)[number];
const DAY = 86400_000, CACHE_MS = 60_000, TOP_DEVICES = 10;

type Flow = { stat_energy_from?: string; stat_energy_to?: string };
type Source = { type?: string; stat_energy_from?: string; stat_energy_to?: string; flow_from?: Flow[]; flow_to?: Flow[] };
type Prefs = { energy_sources?: Source[]; device_consumption?: { stat_consumption?: string }[] };
type Stat = { start?: number | string; change?: number | null };
type Meta = { statistic_id?: string; display_unit_of_measurement?: string; statistics_unit_of_measurement?: string };

const ids = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => typeof x === "string" && x.length > 0))];
/** Electricity is reported by the hub in Wh, kWh or MWh depending on the meter; everything here is kWh. */
const toKwh = (unit: string | undefined) => (unit === "Wh" ? 0.001 : unit === "MWh" ? 1000 : 1);
const r2 = (n: number) => Math.round(n * 100) / 100;

export type EnergyBucket = { date: string; import: number; export: number; solar: number; batteryIn: number; batteryOut: number; consumption: number };
export type HaEnergy =
  | { available: false; reason: "ha_unavailable" | "not_configured" | "no_statistics" }
  | {
      available: true; range: Range; bucket: "day" | "month"; buckets: EnergyBucket[]; totals: Omit<EnergyBucket, "date">;
      /** which parts of the home's energy picture are set up in Home Assistant */
      has: { grid: boolean; solar: boolean; battery: boolean };
      devices: { id: string; name: string; kwh: number }[];
      other: { kind: "gas" | "water"; total: number; unit: string }[];
    };

/** Energy as Home Assistant's Energy dashboard knows it: its sources and its recorded statistics, which reach back long before this app was installed. */
export function createHaEnergy(ha: HaApi, now: () => number = Date.now) {
  const cache = new Map<Range, { at: number; value: HaEnergy }>();
  const tz = () => ha.info?.timeZone ?? undefined;
  const dayOf = (ms: number, bucket: "day" | "month") => { const d = new Date(ms).toLocaleDateString("en-CA", { timeZone: tz() }); return bucket === "month" ? d.slice(0, 7) : d; };

  async function stats(statIds: string[], range: Range, bucket: "day" | "month"): Promise<Map<string, Stat[]> | null> {
    if (!statIds.length) return new Map();
    const start = now() - (range === "week" ? 7 : range === "month" ? 30 : 366) * DAY;
    const r = await ha.ws({ type: "recorder/statistics_during_period", start_time: new Date(start).toISOString(), statistic_ids: statIds, period: bucket === "month" ? "month" : "day", types: ["change"] });
    if (!r.success || !r.result || typeof r.result !== "object") return null;
    return new Map(Object.entries(r.result as Record<string, Stat[]>));
  }
  async function units(statIds: string[]): Promise<Map<string, string>> {
    const r = statIds.length ? await ha.ws({ type: "recorder/get_statistics_metadata", statistic_ids: statIds }) : null;
    const rows = r?.success && Array.isArray(r.result) ? (r.result as Meta[]) : [];
    return new Map(rows.flatMap((m) => (m.statistic_id ? [[m.statistic_id, m.display_unit_of_measurement ?? m.statistics_unit_of_measurement ?? ""] as const] : [])));
  }

  async function load(range: Range): Promise<HaEnergy> {
    if (ha.isStale()) return { available: false, reason: "ha_unavailable" };
    const p = await ha.ws({ type: "energy/get_prefs" });
    const prefs = p.success && p.result && typeof p.result === "object" ? (p.result as Prefs) : null;
    const sources = prefs?.energy_sources ?? [];
    if (!sources.length && !prefs?.device_consumption?.length) return { available: false, reason: "not_configured" };

    const grid = sources.filter((s) => s.type === "grid"), solar = sources.filter((s) => s.type === "solar"), battery = sources.filter((s) => s.type === "battery");
    const gridIn = ids(grid.flatMap((s) => [s.stat_energy_from, ...(s.flow_from ?? []).map((f) => f.stat_energy_from)]));
    const gridOut = ids(grid.flatMap((s) => [s.stat_energy_to, ...(s.flow_to ?? []).map((f) => f.stat_energy_to)]));
    const solarIds = ids(solar.map((s) => s.stat_energy_from));
    const batOut = ids(battery.map((s) => s.stat_energy_from)), batIn = ids(battery.map((s) => s.stat_energy_to));
    const gas = ids(sources.filter((s) => s.type === "gas").map((s) => s.stat_energy_from)), water = ids(sources.filter((s) => s.type === "water").map((s) => s.stat_energy_from));
    const devs = ids((prefs?.device_consumption ?? []).map((d) => d.stat_consumption));

    const bucket = range === "year" ? "month" : "day";
    const all = ids([...gridIn, ...gridOut, ...solarIds, ...batOut, ...batIn, ...gas, ...water, ...devs]);
    const [data, unit] = await Promise.all([stats(all, range, bucket), units(all)]);
    if (!data) return { available: false, reason: "ha_unavailable" };
    if (![...data.values()].some((v) => v.length)) return { available: false, reason: "no_statistics" };

    const by = new Map<string, Map<string, number>>(); // statistic id -> bucket -> kWh
    const stamp = (v: Stat["start"]) => (typeof v === "number" ? v : Date.parse(String(v ?? "")));
    for (const [id, rows] of data) {
      const f = toKwh(unit.get(id)), m = new Map<string, number>();
      for (const row of rows) { const t = stamp(row.start); if (Number.isFinite(t) && typeof row.change === "number") m.set(dayOf(t, bucket), (m.get(dayOf(t, bucket)) ?? 0) + row.change * f); }
      by.set(id, m);
    }
    const sum = (group: string[], key: string) => group.reduce((n, id) => n + (by.get(id)?.get(key) ?? 0), 0);
    const keys = [...new Set([...by.values()].flatMap((m) => [...m.keys()]))].sort();
    const buckets = keys.map((date): EnergyBucket => {
      const i = sum(gridIn, date), e = sum(gridOut, date), s = sum(solarIds, date), bo = sum(batOut, date), bi = sum(batIn, date);
      return { date, import: r2(i), export: r2(e), solar: r2(s), batteryIn: r2(bi), batteryOut: r2(bo), consumption: r2(Math.max(0, i + s + bo - e - bi)) };
    });
    const tot = (k: keyof Omit<EnergyBucket, "date">) => r2(buckets.reduce((n, b) => n + b[k], 0));
    const total = (group: string[]) => group.reduce((n, id) => n + [...(by.get(id)?.values() ?? [])].reduce((a, b) => a + b, 0), 0);
    const other = [
      ...(gas.length ? [{ kind: "gas" as const, total: r2(gas.reduce((n, id) => n + (data.get(id) ?? []).reduce((a, x) => a + (x.change ?? 0), 0), 0)), unit: unit.get(gas[0]!) || "" }] : []),
      ...(water.length ? [{ kind: "water" as const, total: r2(water.reduce((n, id) => n + (data.get(id) ?? []).reduce((a, x) => a + (x.change ?? 0), 0), 0)), unit: unit.get(water[0]!) || "" }] : []),
    ];
    return {
      available: true, range, bucket, buckets,
      totals: { import: tot("import"), export: tot("export"), solar: tot("solar"), batteryIn: tot("batteryIn"), batteryOut: tot("batteryOut"), consumption: tot("consumption") },
      has: { grid: gridIn.length > 0, solar: solarIds.length > 0, battery: batOut.length + batIn.length > 0 },
      devices: devs.map((id) => ({ id, name: friendlyName(ha.entities.get(id), id), kwh: r2(total([id])) })).filter((d) => d.kwh > 0).sort((a, b) => b.kwh - a.kwh),
      other,
    };
  }

  /** Cached for a minute: the page asks for it on every visit, and the hub's statistics only move hourly. */
  async function energy(range: Range): Promise<HaEnergy> {
    const hit = cache.get(range);
    if (hit && now() - hit.at < CACHE_MS) return hit.value;
    const value = await load(range);
    if (value.available || value.reason !== "ha_unavailable") cache.set(range, { at: now(), value });
    return value;
  }
  return { energy };
}
export type HaEnergyService = ReturnType<typeof createHaEnergy>;

export function haEnergyRoutes(db: Database, secure: boolean, svc: DeviceService, svcEnergy: HaEnergyService) {
  return new Elysia({ name: "ha-energy" }).get("/api/energy/ha", async ({ request, query, set }) => {
    const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
    if (g.user.role === "guest") return deny(set, 403, "forbidden");
    const range = query.range === undefined ? "week" : query.range;
    if (!oneOf(RANGES, range)) return deny(set, 400, "invalid_input");
    const e = await svcEnergy.energy(range);
    if (!e.available) return e;
    // Whole-home figures are for the household; a single device appears only to someone who may use it.
    return { ...e, devices: e.devices.filter((d) => !!svc.deviceFor(g.user, d.id)).slice(0, TOP_DEVICES) };
  });
}
