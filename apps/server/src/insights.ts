import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { describe } from "./capabilities";
import { authorize } from "./guard";
import { friendlyName, type HaApi } from "./ha";
import type { DeviceService } from "./devices";
import type { Notifier } from "./notify";
import type { SessionUser } from "./session";
import { INSIGHT_DEDUPE_MS } from "./notify";
import { all, one } from "./sql";
import { asObject, denyWith as deny } from "./http";

export const SAMPLE_MS = 15 * 60_000, KEEP_MS = 35 * 86400_000, DISMISS_MS = 14 * 86400_000;
const HOUR = 3600_000;
const dayKey = (ts: number) => new Date(ts).toLocaleDateString("en-CA"); // local calendar day, YYYY-MM-DD
const r1 = (n: number) => Math.round(n * 10) / 10;

/** Records a number per device every 15 minutes: watts or kWh for energy meters, 1/0 for lights, switches and fans. */
export function createSampler(db: Database, ha: HaApi, now: () => number = Date.now) {
  function sampleOnce() {
    const ts = now(), ins = db.query("INSERT OR REPLACE INTO samples (entity_id, ts, value) VALUES (?,?,?)");
    db.transaction(() => {
      for (const e of ha.entities.values()) {
        if (e.state === "unavailable" || e.state === "unknown") continue; // gaps stay gaps; nothing is invented
        const d = describe(e);
        if (!d.ordinary) continue;
        if (d.category === "energy") { const v = Number(e.state); if (Number.isFinite(v)) ins.run(e.entity_id, ts, v); }
        else if (["light", "switch", "fan"].includes(d.category)) ins.run(e.entity_id, ts, e.state === "on" ? 1 : 0);
      }
      db.query("DELETE FROM samples WHERE ts < ?").run(ts - KEEP_MS);
    })();
  }
  let timer: ReturnType<typeof setInterval> | null = null;
  return { sampleOnce, start(ms = SAMPLE_MS) { if (!ha.isStale()) sampleOnce(); timer = setInterval(() => { if (!ha.isStale()) sampleOnce(); }, ms); }, stop() { if (timer) clearInterval(timer); } };
}

export type Insight = { key: string; kind: "long_on" | "standby" | "energy_up"; title: string; body: string; entityId: string; suggestion: { label: string; href: string } };

export function createInsights(db: Database, ha: HaApi, svc: DeviceService, now: () => number = Date.now) {
  const nameOf = (id: string, household?: string) => (household ? one<{ name: string }>(db, "SELECT name FROM device_meta WHERE household_id = ? AND entity_id = ? AND name != ''", household, id)?.name : null) ?? friendlyName(ha.entities.get(id), id);
  const series = (id: string, since: number) => all<{ ts: number; value: number }>(db, "SELECT ts, value FROM samples WHERE entity_id = ? AND ts >= ? ORDER BY ts", id, since);
  const automate = (id: string) => ({ label: "Create an automation", href: `/automations/new?device=${encodeURIComponent(id)}` });

  /** Kilowatt-hours per local day from a running total, counting each rise between neighbouring readings (resets are ignored). */
  function dailyKwh(id: string, days: number) {
    const rows = series(id, now() - (days + 1) * 24 * HOUR), out = new Map<string, number>();
    for (let i = 1; i < rows.length; i++) {
      const prev = rows[i - 1], cur = rows[i];
      if (!prev || !cur || cur.ts - prev.ts > 3 * SAMPLE_MS) continue; // a gap in sampling: don't guess across it
      const d = cur.value - prev.value;
      if (d > 0) out.set(dayKey(cur.ts), (out.get(dayKey(cur.ts)) ?? 0) + d);
    }
    return out;
  }
  const isKwh = (id: string) => ha.entities.get(id)?.attributes.unit_of_measurement === "kWh";
  const isWatts = (id: string) => ha.entities.get(id)?.attributes.unit_of_measurement === "W";

  /** Every insight is a plain fact plus a suggestion. It is never acted on automatically, and with too little data there is none. */
  function compute(canSee: (id: string) => boolean, household?: string): Insight[] {
    const t = now(), out: Insight[] = [];
    for (const e of ha.entities.values()) {
      if (!canSee(e.entity_id)) continue;
      const d = describe(e); if (!d.ordinary) continue;
      const id = e.entity_id, name = nameOf(id, household);

      if (["light", "fan", "switch"].includes(d.category) && e.state === "on") {
        const rows = series(id, t - 48 * HOUR), last = rows.at(-1);
        if (last && t - last.ts <= 2 * SAMPLE_MS && last.value === 1) {
          // Walk back while it stayed on with no gap in sampling.
          let first = last;
          for (let i = rows.length - 1; i > 0; i--) {
            const prev = rows[i - 1], cur = rows[i];
            if (!prev || !cur || prev.value !== 1 || cur.ts - prev.ts > 2 * SAMPLE_MS) break;
            first = prev;
          }
          const hours = (last.ts - first.ts) / HOUR;
          if (hours >= 8) out.push({ key: `long_on:${id}`, kind: "long_on", entityId: id, title: `${name} has been on for about ${Math.round(hours)} hours`, body: "If that isn't intended, you could switch it off, or set up an automation to do it at a set time.", suggestion: automate(id) });
        }
      }
      if (d.category === "energy" && isWatts(id)) {
        const rows = series(id, t - 24 * HOUR);
        if (rows.length >= 72 && (rows.at(-1)?.ts ?? 0) > t - 2 * SAMPLE_MS) { // at least three quarters of the last day
          const min = Math.min(...rows.map((r) => r.value));
          if (min >= 5) out.push({ key: `standby:${id}`, kind: "standby", entityId: id, title: `${name} uses at least ${Math.round(min)} W around the clock`, body: `Even at its quietest in the last 24 hours it drew ${Math.round(min)} W, roughly ${r1((min * 24) / 1000)} kWh a day. If it doesn't need to stay on, consider switching it off or scheduling it.`, suggestion: id.startsWith("sensor.") ? { label: "See energy", href: "/energy" } : automate(id) }); // a meter can't be switched off, a plug can
        }
      }
      if (d.category === "energy" && isKwh(id)) {
        const days = dailyKwh(id, 9), y = dayKey(t - 24 * HOUR), yesterday = days.get(y);
        const before = [...days].filter(([k]) => k < y && k !== dayKey(t)).map(([, v]) => v);
        if (yesterday !== undefined && before.length >= 3) {
          const avg = before.reduce((a, b) => a + b, 0) / before.length;
          if (yesterday >= avg * 1.3 && yesterday - avg >= 1) out.push({ key: `energy_up:${id}:${y}`, kind: "energy_up", entityId: id, title: `${name} used more than usual yesterday`, body: `${r1(yesterday)} kWh yesterday, against a usual ${r1(avg)} kWh over the previous ${before.length} days.`, suggestion: { label: "See energy", href: "/energy" } });
        }
      }
    }
    return out;
  }
  function forUser(u: SessionUser): Insight[] {
    const ok = svc.accessor(u), gone = new Set(all<{ key: string }>(db, "SELECT key FROM insight_dismissals WHERE user_id = ? AND until > ?", u.id, now()).map((r) => r.key));
    return compute((id) => ok(id) && !!svc.deviceFor(u, id), u.householdId).filter((i) => !gone.has(i.key));
  }
  /** Daily: tell the people who can see each device, at most once every three days per finding. */
  async function sweep(nf: Notifier) {
    const h = one<{ id: string }>(db, "SELECT id FROM households LIMIT 1")?.id; if (!h) return 0;
    let n = 0;
    for (const i of compute(() => true, h)) { const r = await nf.emit({ householdId: h, kind: "insight", entityId: i.entityId, dedupeKey: i.key, dedupeMs: INSIGHT_DEDUPE_MS, title: i.title, body: i.body }); n += r.recipients; }
    return n;
  }

  /** What the energy page shows: only meters this person can see, with honest coverage. */
  function energy(u: SessionUser) {
    const t = now(), today = dayKey(t), devs = svc.visibleDevices(u).filter((d) => d.category === "energy");
    const first = one<{ m: number | null }>(db, "SELECT MIN(ts) m FROM samples")?.m ?? null;
    const meters = devs.map((d) => {
      const base = { id: d.id, name: d.name, available: d.available, unit: d.reading?.unit ?? "", now: d.reading ? Number(d.reading.value) : null };
      if (isKwh(d.id)) {
        const days = dailyKwh(d.id, 7), list = [...days].sort(([a], [b]) => a.localeCompare(b)).slice(-7).map(([date, kwh]) => ({ date, kwh: r1(kwh) }));
        const todayKwh = days.get(today);
        return { ...base, kind: "energy" as const, todayKwh: todayKwh === undefined ? null : r1(todayKwh), days: list };
      }
      if (isWatts(d.id)) {
        const rows = series(d.id, t - 24 * HOUR);
        return { ...base, kind: "power" as const, peak24h: rows.length ? Math.round(Math.max(...rows.map((r) => r.value))) : null, low24h: rows.length ? Math.round(Math.min(...rows.map((r) => r.value))) : null };
      }
      return { ...base, kind: "other" as const };
    });
    // Highest draw first; a whole-home meter and a plug can both appear, so we never add them together.
    meters.sort((a, b) => (b.kind === "power" ? b.now ?? 0 : -1) - (a.kind === "power" ? a.now ?? 0 : -1));
    return { meters, sampledSince: first, note: "Readings are sampled every 15 minutes, so figures are estimates and start from when sampling began." };
  }
  return { compute, forUser, sweep, energy };
}
export type InsightService = ReturnType<typeof createInsights>;

export function insightRoutes(db: Database, secure: boolean, ins: InsightService, now: () => number = Date.now) {
  return new Elysia({ name: "insights" })
    .get("/api/insights", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      return { insights: g.user.role === "guest" ? [] : ins.forUser(g.user) };
    })
    .post("/api/insights/dismiss", ({ request, body, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const key = asObject(body).key;
      if (typeof key !== "string" || key.length > 200) return deny(set, 400, "invalid_input");
      db.query("INSERT INTO insight_dismissals (user_id, key, until) VALUES (?,?,?) ON CONFLICT(user_id, key) DO UPDATE SET until=excluded.until").run(g.user.id, key, now() + DISMISS_MS);
      return { ok: true };
    })
    .get("/api/energy", ({ request, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      if (g.user.role === "guest") return deny(set, 403, "forbidden");
      return ins.energy(g.user);
    });
}
