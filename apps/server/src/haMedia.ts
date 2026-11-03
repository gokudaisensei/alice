import { Elysia } from "elysia";
import type { Database } from "bun:sqlite";
import { audit } from "./audit";
import { authorize } from "./guard";
import { haError, type HaApi } from "./ha";
import type { DeviceService } from "./devices";
import { asObject, denyWith as deny } from "./http";

const BASE_MS = 4 * 60_000, SEEN_MS = 5 * 60_000, MAX_CAMERAS = 2, MAX_OPEN = 8;
/** What a player or playlist may ask for: path pieces only. Never a full address, never "..". */
const PIECE = /^[A-Za-z0-9_][A-Za-z0-9_./-]{0,119}$/;
/** The only query parts the hub's live playlists use (low-latency "wait for the next part"). */
const QUERY = new Set(["_HLS_msn", "_HLS_part", "_HLS_skip"]);

/** Live camera video and a media player's library, both through the app, so a phone never talks to Home Assistant itself. */
export function mediaRoutes(db: Database, ha: HaApi, secure: boolean, svc: DeviceService, now: () => number = Date.now) {
  const bases = new Map<string, { base: string; until: number }>();
  const seen = new Map<string, Map<string, number>>(); // person -> camera -> last time they watched
  const open = new Map<string, number>(); // person -> requests in flight

  /** Ask the hub for a live stream of this camera; its answer is a path with a short-lived token inside. */
  async function baseFor(id: string, fresh = false): Promise<string | null> {
    const hit = bases.get(id);
    if (hit && !fresh && hit.until > now()) return hit.base;
    const r = await ha.ws({ type: "camera/stream", entity_id: id, format: "hls" });
    const url = r.success ? asObject(r.result).url : null;
    if (typeof url !== "string") return null;
    let path: string;
    try { path = new URL(url, "http://hub.invalid").pathname; } catch { return null; }
    const m = /^(\/api\/hls\/[A-Za-z0-9_-]{8,128})\/master_playlist\.m3u8$/.exec(path);
    if (!m) return null;
    bases.set(id, { base: m[1]!, until: now() + BASE_MS });
    return m[1]!;
  }

  return new Elysia({ name: "media" })
    .get("/api/devices/:id/live/*", async ({ request, params, query, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const u = g.user, dev = svc.deviceFor(u, params.id);
      if (!dev || dev.view.category !== "camera") return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      if (!dev.view.available) return deny(set, 409, "device_unavailable");
      const rest = String((params as Record<string, unknown>)["*"] ?? "");
      if (!PIECE.test(rest) || rest.includes("..") || rest.includes("//")) return deny(set, 400, "invalid_input");
      const q = Object.entries(query as Record<string, unknown>).filter(([k]) => QUERY.has(k));
      if (q.some(([, v]) => typeof v !== "string" || !/^[A-Za-z0-9]{1,10}$/.test(v))) return deny(set, 400, "invalid_input");
      // A few cameras at a time per person: a stream costs the hub real work.
      const mine = seen.get(u.id) ?? new Map<string, number>();
      for (const [cam, t] of mine) if (now() - t > SEEN_MS) mine.delete(cam);
      if (!mine.has(params.id) && mine.size >= MAX_CAMERAS) return deny(set, 429, "too_many_streams");
      if ((open.get(u.id) ?? 0) >= MAX_OPEN) return deny(set, 429, "too_many_streams");
      if (!mine.has(params.id)) audit(db, { householdId: u.householdId, actorType: "user", actorId: u.id, action: "camera.live", target: params.id, outcome: "success" });
      mine.set(params.id, now()); seen.set(u.id, mine);
      open.set(u.id, (open.get(u.id) ?? 0) + 1);
      try {
        const qs = q.length ? "?" + q.map(([k, v]) => `${k}=${v}`).join("&") : "";
        let base = await baseFor(params.id);
        if (!base) return deny(set, 502, "stream_unavailable");
        let r = await ha.streamPart?.(`${base}/${rest}${qs}`);
        if (r && (r.status === 404 || r.status === 401) && rest === "master_playlist.m3u8") { base = await baseFor(params.id, true); r = base ? await ha.streamPart?.(`${base}/${rest}${qs}`) : null; } // the token ran out
        if (!r || r.status >= 500) return deny(set, 502, "stream_unavailable");
        if (r.status !== 200) return deny(set, r.status === 404 ? 404 : 502, r.status === 404 ? "not_found" : "stream_unavailable");
        return new Response(r.body, { headers: { "content-type": r.type, "cache-control": "no-store" } });
      } finally { open.set(u.id, Math.max(0, (open.get(u.id) ?? 1) - 1)); }
    })
    // A media player's library, one level at a time.
    .get("/api/devices/:id/browse", async ({ request, params, query, set }) => {
      const g = authorize(db, request, secure, []); if (!("user" in g)) return deny(set, g.status, g.body.error);
      const dev = svc.deviceFor(g.user, params.id);
      const media = dev?.view.controls.find((c) => c.type === "media");
      if (!dev || dev.view.category !== "media" || !media || !media.browse) return deny(set, 404, "not_found");
      if (ha.isStale()) return deny(set, 503, "ha_unavailable");
      if (!dev.view.available) return deny(set, 409, "device_unavailable");
      const id = typeof query.id === "string" ? query.id : undefined, type = typeof query.type === "string" ? query.type : undefined;
      if ((id !== undefined && (id.length > 500 || id.length === 0)) || (type !== undefined && !/^[A-Za-z0-9_./:-]{1,60}$/.test(type)) || (id === undefined) !== (type === undefined)) return deny(set, 400, "invalid_input");
      const r = await ha.ws({ type: "media_player/browse_media", entity_id: params.id, ...(id !== undefined ? { media_content_id: id, media_content_type: type } : {}) });
      if (!r.success) return deny(set, 502, haError(r));
      const res = asObject(r.result), kids = Array.isArray(res.children) ? res.children : [];
      const item = (x: unknown) => { const o = asObject(x); return { title: String(o.title ?? "").slice(0, 120), id: String(o.media_content_id ?? ""), type: String(o.media_content_type ?? ""), canPlay: o.can_play === true, canExpand: o.can_expand === true }; };
      return { ...item(res), children: kids.slice(0, 100).map(item).filter((x) => x.id && x.type && x.title) };
    });
}
