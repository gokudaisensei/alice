// The simulated home: runs the world, keeps Home Assistant in step with it, and serves the 3D viewer.
import { join } from "node:path";
import { createHa } from "./ha";
import { domainOf, place, ROOMS } from "./layout";
import { FAULTS, World, hourOf, isFaultKind, sunAt, type Out } from "./world";

const HA_URL = process.env.HA_URL ?? "http://127.0.0.1:8123", HA_TOKEN = process.env.HA_TOKEN ?? "", PORT = Number(process.env.PORT ?? 3100);
if (!HA_TOKEN) { console.error("Set HA_TOKEN to a Home Assistant long-lived access token."); process.exit(1); }
// When SIM_KEY is set (it must be when the page is reachable from outside), nothing works without it: open /?key=... once and a cookie remembers you.
const KEY = process.env.SIM_KEY ?? "";
const cookieOk = (req: Request) => !KEY || (req.headers.get("cookie") ?? "").split(/;\s*/).includes(`simkey=${KEY}`);
const sameOrigin = (req: Request) => { const o = req.headers.get("origin"); return !o || new URL(o).host === req.headers.get("host"); };
/** A request body that isn't a JSON object reads as empty. */
const asRecord = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const ha = createHa(HA_URL, HA_TOKEN);
const placed = place();
const publicDir = join(import.meta.dir, "..", "public");

await ha.refresh();
const world = new World(Date.now(), Number(process.env.SEED ?? 7));
world.speed = Number(process.env.SPEED ?? 1);
world.adopt(ha.view);
world.init(ha.out);

// Service calls are collapsed per tick so a fast clock can't ask for the same thing a hundred times.
let seen = new Set<string>();
const out: Out = {
	number: ha.out.number, bool: ha.out.bool,
	call: (d, s, e, data) => { const k = `${d}.${s}.${e}`; if (seen.has(k)) return; seen.add(k); ha.out.call(d, s, e, data); },
};

const snapshot = () => ({
	t: world.t, hour: hourOf(world.t), speed: world.speed, paused: world.paused, sun: sunAt(hourOf(world.t)), cloud: world.weather.cloud,
	outdoor: world.weather.temp(hourOf(world.t)), wind: world.weather.wind, humidity: world.weather.humidity(hourOf(world.t)),
	power: world.power, hvac: world.hvac,
	rooms: Object.fromEntries(Object.entries(world.rooms).map(([n, r]) => [n, { T: Math.round(r.T * 10) / 10, hum: Math.round(r.hum), co2: Math.round(r.co2) }])),
	people: world.people.map((p) => ({ name: p.name, x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, room: world.roomAt(p.x, p.z), act: p.act, walking: p.path.length > 0, pose: world.poseOf(p) })),
	devices: Object.fromEntries(placed.map((d) => { const s = ha.view(d.entity); return [d.entity, { s: s?.state ?? "unavailable", b: s?.attrs.brightness ?? null, pct: s?.attrs.percentage ?? null }]; })),
	covers: Object.fromEntries(["cover.kitchen_window", "cover.living_room_window", "cover.hall_window", "cover.garage_door", "cover.pergola_roof"].map((id) => { const s = ha.view(id); return [id, { s: s?.state ?? "closed", pos: s?.attrs.current_position ?? (s?.state === "open" ? 100 : 0), tilt: s?.attrs.current_tilt_position ?? null }]; })),
	media: Object.fromEntries(["media_player.living_room", "media_player.bedroom", "media_player.kitchen"].map((id) => [id, ha.view(id)?.state ?? "off"])),
	climate: (() => { const c = ha.view("climate.ecobee"); return c ? { mode: c.state, low: c.attrs.target_temp_low, high: c.attrs.target_temp_high, fan: c.attrs.fan_mode } : null; })(),
	watts: world.watts, faults: world.faults.map((f) => ({ id: f.id, kind: f.kind, label: FAULTS[f.kind].label, left: Math.max(0, Math.round((f.endsAt - world.t) / 60000)) })),
	events: world.events.slice(-12),
	thermostat: ha.view("climate.ecobee")?.state ?? null,
});

let busy = false;
async function tick() {
	if (busy) return; busy = true;
	try {
		await ha.refresh();
		if (!world.paused) {
			let left = world.speed; const n = Math.max(1, Math.ceil(left / 30));
			seen = new Set();
			for (let i = 0; i < n; i++) { const dt = left / (n - i); world.step(dt, ha.view, out); left -= dt; }
			await ha.flush();
		}
		const msg = JSON.stringify(snapshot());
		server.publish("world", msg);
	} catch (e) { console.error(new Date().toISOString(), String(e)); } finally { busy = false; }
}

const server = Bun.serve({
	port: PORT,
	async fetch(req, srv) {
		const url = new URL(req.url);
		if (KEY && url.searchParams.get("key") === KEY) return new Response(null, { status: 302, headers: { location: "/", "set-cookie": `simkey=${KEY}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${url.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https" ? "; Secure" : ""}` } });
		if (!cookieOk(req)) return new Response("This page needs its access link.", { status: 401 });
		if (req.method === "POST" && !sameOrigin(req)) return new Response("wrong origin", { status: 403 });
		if (url.pathname === "/ws" && !sameOrigin(req)) return new Response("wrong origin", { status: 403 });
		if (url.pathname === "/ws") return srv.upgrade(req) ? undefined : new Response("upgrade needed", { status: 400 });
		if (req.method === "POST") {
			const b = asRecord(await req.json().catch(() => ({})));
			if (url.pathname === "/api/act") {
				const d = placed.find((x) => x.entity === b.entity); if (!d) return Response.json({ error: "unknown" }, { status: 404 });
				const dom = domainOf(d.entity), on = ha.view(d.entity)?.state;
				const level = typeof b.level === "number" ? b.level : null;
				if (dom === "lock") await ha.call("lock", on === "locked" ? "unlock" : "lock", d.entity);
				else if (dom === "light" && level !== null) await ha.call("light", "turn_on", d.entity, { brightness: Math.round((Math.min(100, Math.max(1, level)) / 100) * 255) });
				else if (dom === "fan" && level !== null) await (level <= 0 ? ha.call("fan", "turn_off", d.entity) : ha.call("fan", "set_percentage", d.entity, { percentage: Math.min(100, level) }));
				else if (["light", "switch", "fan"].includes(dom)) await ha.call(dom, on === "on" ? "turn_off" : "turn_on", d.entity);
				else return Response.json({ error: "not_controllable" }, { status: 400 });
				return Response.json({ ok: true });
			}
			if (url.pathname === "/api/speed") { if (typeof b.speed === "number" && b.speed > 0 && b.speed <= 3600) world.speed = b.speed; if (typeof b.paused === "boolean") world.paused = b.paused; return Response.json({ speed: world.speed, paused: world.paused }); }
			if (url.pathname === "/api/fault") { if (!isFaultKind(b.kind)) return Response.json({ error: "unknown" }, { status: 400 }); world.trigger(b.kind, out); await ha.flush(); return Response.json({ ok: true }); }
			return new Response("not found", { status: 404 });
		}
		if (url.pathname === "/api/layout") return Response.json({ rooms: ROOMS, devices: placed.map(({ entity, name, room, kind, x, y, z }) => ({ entity, name, room, kind, x, y, z })), faults: Object.entries(FAULTS).map(([k, v]) => ({ kind: k, label: v.label })) });
		if (url.pathname === "/api/state") return Response.json(snapshot());
		const file = Bun.file(join(publicDir, url.pathname === "/" ? "index.html" : url.pathname.slice(1).replace(/\.\./g, "")));
		return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
	},
	websocket: { open: (ws) => { ws.subscribe("world"); ws.send(JSON.stringify(snapshot())); }, message() {}, close() {} },
});
setInterval(() => void tick(), 1000);
console.log(`Home simulator at http://localhost:${PORT}  (clock x${world.speed}, ${placed.length} devices)`);
