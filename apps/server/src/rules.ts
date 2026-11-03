import type { Database } from "bun:sqlite";
import { describe } from "./capabilities";
import { friendlyName, type HaApi } from "./ha";
import { one } from "./sql";
import type { Notifier } from "./notify";
import { createPowerLimits, switchFor, wattsOf, type PowerLimits } from "./power";

export type Delays = { offlineMs: number; lockMs: number; hubMs: number; powerMs?: number };
export const DEFAULT_DELAYS: Required<Delays> = { offlineMs: 5 * 60_000, lockMs: 10 * 60_000, hubMs: 2 * 60_000, powerMs: 5 * 60_000 };
const mins = (ms: number) => { const m = Math.round(ms / 60_000); return m >= 1 ? `${m} minute${m === 1 ? "" : "s"}` : "a short while"; };

/**
 * Plain, deterministic rules over Home Assistant's own state. A problem has to last before anyone hears about it,
 * so a flaky bulb doesn't buzz a phone. Nothing here ever acts on a device.
 */
export function startRules(db: Database, ha: HaApi, nf: Notifier, delays: Delays = DEFAULT_DELAYS, limits: PowerLimits = createPowerLimits(db)) {
  const powerMs = delays.powerMs ?? DEFAULT_DELAYS.powerMs;
  const fmtW = (w: number) => (w >= 1000 ? `${Math.round(w / 100) / 10} kW` : `${Math.round(w)} W`);
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  let hubAlerted = false;
  const household = () => one<{ id: string }>(db, "SELECT id FROM households LIMIT 1")?.id;
  const nameOf = (id: string) => one<{ name: string }>(db, "SELECT name FROM device_meta WHERE entity_id = ? AND name != ''", id)?.name ?? friendlyName(ha.entities.get(id), id);
  const arm = (key: string, ms: number, still: () => boolean, fire: () => void) => {
    if (timers.has(key)) return;
    timers.set(key, setTimeout(() => { timers.delete(key); if (still()) fire(); }, ms));
  };
  const disarm = (key: string) => { const t = timers.get(key); if (t) clearTimeout(t); timers.delete(key); };

  function check(id: string) {
    const e = ha.entities.get(id);
    if (!e) return disarm(`offline:${id}`), disarm(`lock:${id}`);
    const d = describe(e);
    if (d.ordinary && !id.startsWith("scene.") && !id.startsWith("script.") && !id.startsWith("automation.")) {
      if (e.state === "unavailable") arm(`offline:${id}`, delays.offlineMs, () => ha.entities.get(id)?.state === "unavailable" && !ha.isStale(), () => {
        const h = household(); if (!h) return;
        void nf.emit({ householdId: h, kind: "device_offline", entityId: id, dedupeKey: `offline:${id}`, title: `${nameOf(id)} is offline`, body: `It hasn't responded for ${mins(delays.offlineMs)}. Check that it has power and Wi-Fi.` });
      });
      else disarm(`offline:${id}`);
    }
    // A limit you set by hand: only a reading that stays above it, for a few minutes, is worth a buzz.
    const limit = limits.get(id), w = wattsOf(e);
    if (limit !== undefined && w !== null && w > limit) arm(`power:${id}`, powerMs, () => { const now = wattsOf(ha.entities.get(id)); return now !== null && now > (limits.get(id) ?? Infinity); }, () => {
      const h = household(); if (!h) return;
      const sw = switchFor(ha, id), cur = wattsOf(ha.entities.get(id)) ?? w;
      void nf.emit({ householdId: h, kind: "power", entityId: id, ...(sw ? { actions: [{ action: "turn_off", title: "Switch off" }], switchId: sw } : {}), dedupeKey: `power:${id}`,
        title: `${nameOf(id).replace(/ power$/i, "")} is using ${fmtW(cur)}`, body: `It has been above your ${fmtW(limit)} limit for ${mins(powerMs)}.${sw ? " You can switch it off from here." : ""}` });
    });
    else disarm(`power:${id}`);
    if (d.domain === "lock") {
      if (e.state === "unlocked") arm(`lock:${id}`, delays.lockMs, () => ha.entities.get(id)?.state === "unlocked", () => {
        const h = household(); if (!h) return;
        void nf.emit({ householdId: h, kind: "lock_open", entityId: id, actions: [{ action: "lock", title: "Lock" }], dedupeKey: `lock:${id}`, title: `${nameOf(id)} is unlocked`, body: `It has been unlocked for ${mins(delays.lockMs)}.` });
      });
      else disarm(`lock:${id}`);
    }
  }
  const scan = () => { for (const id of ha.entities.keys()) check(id); };

  const offLimits = limits.onChange((id) => { disarm(`power:${id}`); check(id); }); // a changed or removed limit starts the clock again
  const off = ha.subscribe((e) => {
    if (e.type === "entity") return check(e.entityId);
    if (ha.isStale()) {
      arm("hub", delays.hubMs, () => ha.isStale(), () => {
        const h = household(); if (!h) return;
        hubAlerted = true;
        void nf.emit({ householdId: h, kind: "hub", dedupeKey: "hub", title: "Home hub unreachable", body: `The app has lost contact with your home hub for ${mins(delays.hubMs)}. Devices can't be controlled from here until it is back.` });
      });
    } else {
      disarm("hub");
      scan(); // a reconnect refreshes every state without events
      if (hubAlerted) {
        hubAlerted = false;
        const h = household();
        if (h) void nf.emit({ householdId: h, kind: "hub", dedupeKey: "hub_back", title: "Home hub is back", body: "The app is connected to your home hub again." });
      }
    }
  });
  if (!ha.isStale()) scan();
  return () => { off(); offLimits(); for (const t of timers.values()) clearTimeout(t); timers.clear(); };
}
