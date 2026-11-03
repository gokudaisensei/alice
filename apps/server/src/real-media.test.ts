// Live camera video and a media player's library, through the app, against a REAL Home Assistant.
// Skipped unless set:  HA_REAL_URL=… HA_REAL_TOKEN=… HA_REAL_STREAM_CAMERA=camera.some_camera_that_streams [HA_REAL_BROWSE_PLAYER=media_player.browse] bun test src/real-media.test.ts
// deploy/ha/test-container.sh sets this up with a generated test video.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { HaClient } from "./ha";
import { setup, type Body } from "./testkit";

const URL_ = process.env.HA_REAL_URL, TOKEN = process.env.HA_REAL_TOKEN, CAM = process.env.HA_REAL_STREAM_CAMERA, PLAYER = process.env.HA_REAL_BROWSE_PLAYER ?? "media_player.browse";
const live = URL_ && TOKEN && CAM ? test : test.skip;
const real = URL_ && TOKEN ? test : test.skip;
let ha: HaClient, t: ReturnType<typeof setup>, admin: string;
const until = async (f: () => boolean, ms = 10000) => { const e = Date.now() + ms; while (!f() && Date.now() < e) await Bun.sleep(100); };
const fetchApp = async (path: string) => { const r = await t.app.handle(new Request("http://localhost" + path, { headers: { cookie: admin, "x-requested-with": "alice" } })); return { status: r.status, type: r.headers.get("content-type") ?? "", bytes: new Uint8Array(await r.arrayBuffer()) }; };
const text = (b: Uint8Array) => new TextDecoder().decode(b);

beforeAll(async () => {
  if (!URL_ || !TOKEN) return;
  ha = new HaClient(URL_, TOKEN); ha.start();
  await until(() => ha.health() === "ok");
  t = setup(ha);
  const a = await t.bootstrapAdmin("a1"); await t.reauth(a.cookie!, "a1"); admin = a.cookie!;
  await until(() => ha.entities.size > 5);
});
afterAll(() => { ha?.stop?.(); });

live("a live camera stream plays through the app: playlists, then real video bytes, with nothing of the hub's address in them", async () => {
  const base = `/api/devices/${encodeURIComponent(CAM!)}/live`;
  let master = await fetchApp(`${base}/master_playlist.m3u8`);
  for (let i = 0; i < 20 && master.status !== 200; i++) { await Bun.sleep(1000); master = await fetchApp(`${base}/master_playlist.m3u8`); }
  expect([master.status, master.type]).toEqual([200, expect.stringContaining("mpegurl")]);
  const m = text(master.bytes);
  expect(m.startsWith("#EXTM3U")).toBe(true);
  expect(m.includes("/api/hls/") || m.includes("http://") || m.includes("https://")).toBe(false); // relative pieces only, so a browser stays on the app
  const variant = m.split("\n").find((l) => l.trim() && !l.startsWith("#"))!.trim();
  let pl = await fetchApp(`${base}/${variant}`);
  for (let i = 0; i < 20 && !text(pl.bytes).includes("#EXTINF"); i++) { await Bun.sleep(1000); pl = await fetchApp(`${base}/${variant}`); } // the first segment takes a moment
  const p = text(pl.bytes);
  expect(p).toContain("#EXTINF");
  const init = /#EXT-X-MAP:URI="([^"]+)"/.exec(p)?.[1], seg = p.split("\n").find((l) => l.trim() && !l.startsWith("#"))!.trim();
  const i = init ? await fetchApp(`${base}/${init}`) : null;
  if (i) { expect(i.status).toBe(200); expect(text(i.bytes.slice(4, 8))).toBe("ftyp"); } // an fMP4 initialisation segment
  const s = await fetchApp(`${base}/${seg}`);
  expect(s.status).toBe(200);
  expect(s.bytes.length).toBeGreaterThan(1000);
  expect(["moof", "ftyp", "styp"]).toContain(text(s.bytes.slice(4, 8))); // real video, not an error page
  const rows = t.db.query("SELECT target FROM security_audit WHERE action = 'camera.live'").all() as Body[];
  expect(rows.map((r) => r.target)).toEqual([CAM]); // watched once, written down once
}, 60_000); // a live camera needs a few real seconds before its first segment exists

real("a media player's library can be browsed one level at a time", async () => {
  const dev = ((await t.call("GET", "/api/devices", { cookie: admin })).json.devices as Body[]).find((d) => d.id === PLAYER);
  expect(dev?.controls.find((c: Body) => c.type === "media")?.browse).toBe(true);
  const top = (await t.call("GET", `/api/devices/${PLAYER}/browse`, { cookie: admin })).json;
  expect(top.title.length).toBeGreaterThan(0);
  expect(top.children.length).toBeGreaterThan(0);
  expect(Object.keys(top.children[0]).sort()).toEqual(["canExpand", "canPlay", "id", "title", "type"]);
  // Some folders may be empty or missing on a given hub (HA says so itself); a clean refusal is fine, but one must open, down to an item.
  const folders = top.children.filter((c: Body) => c.canExpand);
  let opened = 0;
  for (const f of folders) {
    const r = await t.call("GET", `/api/devices/${PLAYER}/browse?id=${encodeURIComponent(f.id)}&type=${encodeURIComponent(f.type)}`, { cookie: admin });
    if (r.status !== 200) { expect(r.json.error).toBeTruthy(); continue; }
    expect(r.json.title.length).toBeGreaterThan(0); expect(Array.isArray(r.json.children)).toBe(true); opened++;
  }
  expect(opened).toBeGreaterThan(0);
});
