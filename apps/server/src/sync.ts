import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { authorize } from "./guard";
import { MODE_ENTITY } from "./modes";
import type { HaApi } from "./ha";
import type { DeviceService } from "./devices";

/**
 * Changes as a numbered log, so any device can ask "what happened since #N?".
 * Plain long-polling: it works through every proxy, including Cloudflare's quick tunnels, which don't pass server-sent events.
 */
export function createSync(ha: HaApi) {
  let rev = 0;
  const log: { rev: number; kind: "entity" | "mode" | "ha" | "data"; id?: string }[] = [];
  const waiters = new Set<() => void>();
  const push = (kind: "entity" | "mode" | "ha" | "data", id?: string) => {
    log.push({ rev: ++rev, kind, id });
    if (log.length > 1000) log.splice(0, log.length - 1000);
    for (const w of [...waiters]) w();
  };
  ha.subscribe((e) => { if (e.type === "conn") push("ha"); else if (e.entityId === MODE_ENTITY) push("mode"); else if (e.entityId) push("entity", e.entityId); });
  return {
    get rev() { return rev; },
    /** Something the app itself stores changed (rooms, groups, scenes, routines, automations, access). */
    bump: () => push("data"),
    since: (n: number) => (log.length && log[0].rev > n + 1 ? null : log.filter((x) => x.rev > n)),
    wait: (ms: number, signal: AbortSignal) => new Promise<void>((resolve) => {
      const done = () => { clearTimeout(t); waiters.delete(done); signal.removeEventListener("abort", done); resolve(); };
      const t = setTimeout(done, ms); waiters.add(done); signal.addEventListener("abort", done);
    }),
  };
}
export type Sync = ReturnType<typeof createSync>;

export function syncRoutes(db: Database, secure: boolean, sync: Sync, svc: DeviceService, waitMs = 25_000) {
  const open = new Map<string, number>();
  return new Elysia({ name: "sync" }).get("/api/sync", async ({ request, query, set }: any) => {
    const g = authorize(db, request, secure, []); if (!("user" in g)) { set.status = g.status; return g.body; }
    const uid = g.user.id, n = Number(query?.rev);
    if (!Number.isInteger(n) || n < 0 || n > sync.rev) return { rev: sync.rev, resync: true, devices: [], mode: false, ha: false, data: false };
    if ((open.get(uid) ?? 0) >= 6) { set.status = 429; return { error: "too_many_streams" }; }
    open.set(uid, (open.get(uid) ?? 0) + 1);
    try {
      const deadline = Date.now() + waitMs; let cursor = n;
      for (;;) {
        let events = sync.since(cursor);
        if (!events) return { rev: sync.rev, resync: true, devices: [], mode: false, ha: false, data: false };
        const ids = [...new Set(events.filter((e) => e.kind === "entity").map((e) => e.id!))];
        const devices = ids.flatMap((id) => { const d = svc.deviceFor(g.user, id); return d ? [d.view] : []; });
        const mode = events.some((e) => e.kind === "mode"), ha = events.some((e) => e.kind === "ha"), data = events.some((e) => e.kind === "data");
        const left = deadline - Date.now();
        if (devices.length || mode || ha || data || left <= 0 || request.signal.aborted) return { rev: sync.rev, resync: false, devices, mode, ha, data };
        cursor = sync.rev; await sync.wait(left, request.signal); // nothing this person can see changed: keep waiting
      }
    } finally { open.set(uid, Math.max(0, (open.get(uid) ?? 1) - 1)); }
  });
}
