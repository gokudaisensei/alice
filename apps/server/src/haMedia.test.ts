import { expect, test } from "bun:test";
import { describe, toServiceCall } from "./capabilities";
import { ent, setup, type Body } from "./testkit";

const M3U8 = "application/vnd.apple.mpegurl";
async function home() {
  const t = setup();
  const admin = await t.bootstrapAdmin("a1"); await t.reauth(admin.cookie!, "a1");
  const guest = await t.addUser(admin.cookie!, "guest", "g1");
  for (const id of ["camera.back", "camera.side"]) t.ha.entities.set(id, ent(id, "streaming"));
  let asked = 0;
  t.ha.replies.set("camera/stream", () => ({ url: `/api/hls/tok${++asked}abcdefgh/master_playlist.m3u8` }));
  const serve = (n: number) => { for (const [f, type] of [["master_playlist.m3u8", M3U8], ["playlist.m3u8", M3U8], ["segment/1.m4s", "video/mp4"]] as const) t.ha.streamFiles.set(`/api/hls/tok${n}abcdefgh/${f}`, { status: 200, body: `#EXTM3U ${f}`, type }); };
  serve(1); serve(2);
  const get = (path: string, cookie?: string) => t.call("GET", path, { cookie: cookie ?? admin.cookie! });
  const raw = async (path: string) => { const r = await t.app.handle(new Request("http://localhost" + path, { headers: { cookie: admin.cookie!, "x-requested-with": "alice" } })); return { status: r.status, type: r.headers.get("content-type"), cache: r.headers.get("cache-control"), text: await r.text() }; };
  return { t, admin: admin.cookie!, guest: guest.cookie, guestId: guest.userId, get, raw, asked: () => asked, serve };
}

test("a live stream is passed through the app, never the hub's address or key", async () => {
  const { t, raw, get } = await home();
  const m = await raw("/api/devices/camera.porch/live/master_playlist.m3u8");
  expect([m.status, m.type, m.cache, m.text]).toEqual([200, M3U8, "no-store", "#EXTM3U master_playlist.m3u8"]);
  expect((await raw("/api/devices/camera.porch/live/segment/1.m4s")).type).toBe("video/mp4");
  expect(t.ha.streamHits.every((p) => p.startsWith("/api/hls/tok1abcdefgh/"))).toBe(true);
  expect(JSON.stringify(m)).not.toContain("tok1"); // the stream token stays here
  // only the hub's "wait for the next part" query is passed on
  await raw("/api/devices/camera.porch/live/playlist.m3u8?_HLS_msn=12&_HLS_part=1&evil=1");
  expect(t.ha.streamHits.at(-1)).toBe("/api/hls/tok1abcdefgh/playlist.m3u8?_HLS_msn=12&_HLS_part=1");
  expect((await get("/api/devices/camera.porch/live/playlist.m3u8?_HLS_msn=../x")).status).toBe(400);
});

test("only plain path pieces, only cameras, only people who may see them", async () => {
  const { t, get, guest, guestId, admin } = await home();
  for (const bad of ["..%2Fsecret", "a/../b", "%2Fetc%2Fpasswd", "a//b", "x%00y", "http%3A%2F%2Fevil", "a b"]) expect([400, 404]).toContain((await get(`/api/devices/camera.porch/live/${bad}`)).status); // never served
  expect((await get("/api/devices/light.kitchen/live/master_playlist.m3u8")).status).toBe(404);
  expect((await get("/api/devices/camera.nope/live/master_playlist.m3u8")).status).toBe(404);
  expect((await t.call("GET", "/api/devices/camera.porch/live/master_playlist.m3u8")).status).toBe(401);
  expect((await get("/api/devices/camera.porch/live/master_playlist.m3u8", guest)).status).toBe(404); // a guest has nothing until it is granted
  await t.call("PUT", `/api/admin/users/${guestId}/devices`, { cookie: admin, body: { allow: ["camera.porch"] } });
  expect((await get("/api/devices/camera.porch/live/master_playlist.m3u8", guest)).status).toBe(200);
  await t.call("PUT", `/api/admin/users/${guestId}/devices`, { cookie: admin, body: { deny: ["camera.porch"] } });
  expect((await get("/api/devices/camera.porch/live/master_playlist.m3u8", guest)).status).toBe(404);
  t.ha.setStale(true);
  expect((await get("/api/devices/camera.porch/live/master_playlist.m3u8")).status).toBe(503);
});

test("two cameras at a time per person; watching is recorded once, without the picture", async () => {
  const { t, get, raw, serve } = await home();
  expect((await raw("/api/devices/camera.porch/live/master_playlist.m3u8")).status).toBe(200);
  serve(3);
  expect((await raw("/api/devices/camera.back/live/master_playlist.m3u8")).status).toBe(200);
  expect((await get("/api/devices/camera.side/live/master_playlist.m3u8")).json.error).toBe("too_many_streams");
  expect((await raw("/api/devices/camera.porch/live/segment/1.m4s")).status).toBe(200); // the two already open carry on
  t.clock.t += 6 * 60_000; // five quiet minutes later a third is fine
  serve(4); serve(5);
  expect((await raw("/api/devices/camera.side/live/master_playlist.m3u8")).status).toBe(200);
  const rows = t.db.query("SELECT action, target FROM security_audit WHERE action = 'camera.live'").all() as Body[];
  expect(rows.map((r) => r.target)).toEqual(["camera.porch", "camera.back", "camera.side"]);
});

test("when the hub's stream key runs out the app asks for a new one, once", async () => {
  const { t, raw, asked, serve } = await home();
  await raw("/api/devices/camera.porch/live/master_playlist.m3u8");
  expect(asked()).toBe(1);
  await raw("/api/devices/camera.porch/live/playlist.m3u8");
  expect(asked()).toBe(1); // the same key is reused for a few minutes
  t.clock.t += 5 * 60_000;
  serve(2);
  expect((await raw("/api/devices/camera.porch/live/master_playlist.m3u8")).status).toBe(200);
  expect(asked()).toBe(2);
  t.ha.streamFiles.delete("/api/hls/tok2abcdefgh/master_playlist.m3u8"); serve(3);
  expect((await raw("/api/devices/camera.porch/live/master_playlist.m3u8")).status).toBe(200); // 404 on the master: refreshed
  expect(asked()).toBe(3);
});

test("a camera the hub cannot stream says so plainly", async () => {
  const { t, get } = await home();
  t.ha.replies.set("camera/stream", () => { throw new Error("no stream source"); });
  expect((await get("/api/devices/camera.porch/live/master_playlist.m3u8")).json.error).toBe("stream_unavailable");
  t.ha.replies.set("camera/stream", () => ({ url: "https://evil.example/x/master_playlist.m3u8" }));
  expect((await get("/api/devices/camera.porch/live/master_playlist.m3u8")).json.error).toBe("stream_unavailable"); // not a path of the hub's stream
});

// ---------- media players ----------

const PLAYER = { supported_features: 4 | 1 | 16384 | 128 | 256 | 512 | 131072 | 2048, source_list: ["HDMI 1", "Spotify"], source: "Spotify" };
test("a player's library and inputs are controls only when it can really do them", () => {
  const d = describe(ent("media_player.lounge", "playing", PLAYER));
  expect(d.controls).toEqual([{ type: "media", playback: true, volume: true, power: true, browse: true, playMedia: true, sources: ["HDMI 1", "Spotify"] }]);
  expect(describe(ent("media_player.plain", "on", { supported_features: 4 })).controls).toEqual([{ type: "media", playback: false, volume: true, power: false, browse: false, playMedia: false, sources: [] }]);
  expect(describe(ent("media_player.no_play", "on", { supported_features: 4 | 131072, source_list: ["A"] })).controls[0]).toMatchObject({ browse: true, playMedia: false, sources: [] }); // can look, cannot be told to play
  expect(toServiceCall(describe(ent("media_player.no_play", "on", { supported_features: 4 | 131072 })), { action: "play_media", value: { id: "a", type: "music" } })).toEqual({ error: "unsupported" });
  expect(toServiceCall(d, { action: "play_media", value: { id: "spotify://playlist/1", type: "playlist" } })).toEqual({ domain: "media_player", service: "play_media", data: { media_content_id: "spotify://playlist/1", media_content_type: "playlist" } });
  expect(toServiceCall(d, { action: "play_media", value: { id: "x".repeat(501), type: "music" } })).toEqual({ error: "invalid_value" });
  expect(toServiceCall(d, { action: "play_media", value: { id: "a", type: "bad type!" } })).toEqual({ error: "invalid_value" });
  expect(toServiceCall(d, { action: "select_source", value: "HDMI 1" })).toEqual({ domain: "media_player", service: "select_source", data: { source: "HDMI 1" } });
  expect(toServiceCall(d, { action: "select_source", value: "Radio" })).toEqual({ error: "invalid_value" });
  expect(toServiceCall(describe(ent("media_player.plain", "on", { supported_features: 4 })), { action: "play_media", value: { id: "a", type: "music" } })).toEqual({ error: "unsupported" });
});

test("browsing a library shows titles one level at a time, and only for players that can", async () => {
  const { t, get } = await home();
  t.ha.entities.set("media_player.lounge", ent("media_player.lounge", "playing", PLAYER));
  const seen: Body[] = [];
  t.ha.replies.set("media_player/browse_media", (m) => { seen.push(m); return m.media_content_id
    ? { title: "Playlists", media_content_id: "pl", media_content_type: "library", can_play: false, can_expand: true, children: [{ title: "Morning", media_content_id: "spotify://p/1", media_content_type: "playlist", can_play: true, can_expand: false, thumbnail: "http://hub/secret?token=abc" }, { title: "", media_content_id: "x", media_content_type: "y" }] }
    : { title: "Library", media_content_id: "root", media_content_type: "library", can_play: false, can_expand: true, children: [{ title: "Playlists", media_content_id: "pl", media_content_type: "library", can_play: false, can_expand: true }] }; });
  const top = (await get("/api/devices/media_player.lounge/browse")).json;
  expect(top).toEqual({ title: "Library", id: "root", type: "library", canPlay: false, canExpand: true, children: [{ title: "Playlists", id: "pl", type: "library", canPlay: false, canExpand: true }] });
  expect(seen[0]).toEqual({ type: "media_player/browse_media", entity_id: "media_player.lounge" });
  const sub = (await get("/api/devices/media_player.lounge/browse?id=pl&type=library")).json;
  expect(sub.children).toEqual([{ title: "Morning", id: "spotify://p/1", type: "playlist", canPlay: true, canExpand: false }]); // no thumbnails, no hub addresses
  expect(JSON.stringify(sub)).not.toContain("secret");
  expect((await get("/api/devices/media_player.lounge/browse?id=pl")).status).toBe(400);
  expect((await get("/api/devices/media_player.tv/browse")).status).toBe(404); // can't browse
  expect((await get("/api/devices/light.kitchen/browse")).status).toBe(404);
});
