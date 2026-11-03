// The simulated household. Pure: no network, no clock of its own. The server gives it what Home Assistant currently says and gets back what to write.
import { DEVICES, ROOMS, domainOf, room, route, centre, spot, type Dev, type Pose } from "./layout";

/** Whatever Home Assistant reports about an entity. */
export type HaAttrs = Record<string, unknown>;
export type HaState = { state: string; attrs: HaAttrs };
export type HaView = (entity: string) => HaState | undefined;
export interface Out {
	number(helper: string, v: number): void;
	bool(helper: string, on: boolean): void;
	call(domain: string, service: string, entity: string, data?: HaAttrs): void;
}

export const clamp = (v: number, lo = -Infinity, hi = Infinity) => Math.min(hi, Math.max(lo, v));
/** A small seeded random source so a given day can be replayed. */
export function rng(seed: number) { let s = seed >>> 0 || 1; return () => ((s = (Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9) >>> 0), (s ^ (s >>> 13)) / 4294967296 + 0.5); }
const gauss = (r: () => number) => { let u = 0; for (let i = 0; i < 6; i++) u += r(); return (u - 3) / 0.7; };

export const hourOf = (t: number) => { const d = new Date(t); return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; };
const dayOf = (t: number) => Math.floor((t - new Date(t).getTimezoneOffset() * -60000) / 864e5);
const weekend = (t: number) => [0, 6].includes(new Date(t).getDay());

/** Sun height as 0 to 1, rising at 6:30 and setting at 18:30. */
export const sunAt = (h: number) => (h > 6.5 && h < 18.5 ? Math.sin((Math.PI * (h - 6.5)) / 12) : 0);

// ---------------------------------------------------------------------------------- weather
export class Weather {
	cloud = 0.6; wind = 11; drift = 0; humDrift = 0;
	private readonly r: () => number;
	constructor(r: () => number) { this.r = r; }
	step(dt: number) {
		const k = Math.sqrt(dt / 60);
		this.cloud = clamp(this.cloud + gauss(this.r) * 0.025 * k + (0.55 - this.cloud) * 0.002 * (dt / 60), 0.1, 1);
		this.wind = clamp(this.wind + gauss(this.r) * 0.6 * k + (10 - this.wind) * 0.01 * (dt / 60), 1, 40);
		this.drift = clamp(this.drift + gauss(this.r) * 0.05 * k - this.drift * 0.002 * (dt / 60), -5, 5);
		this.humDrift = clamp(this.humDrift + gauss(this.r) * 0.3 * k - this.humDrift * 0.004 * (dt / 60), -10, 10);
	}
	temp(h: number) { return 14 + 6 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + this.drift; }
	humidity(h: number) { return clamp(68 - 14 * Math.sin(((h - 9) / 24) * 2 * Math.PI) + this.humDrift + this.cloud * 6, 25, 98); }
	solar(h: number) { return 4300 * sunAt(h) * (1 - 0.75 * this.cloud); }
}

// ---------------------------------------------------------------------------------- rooms
type RoomSim = { T: number; hum: number; co2: number; ua: number; c: number; sunGain: number; conditioned: boolean };
const PARAMS: Record<string, Partial<RoomSim>> = {
	"Living Room": { ua: 70, sunGain: 380 }, Kitchen: { ua: 55, sunGain: 220 }, "Master Bedroom": { ua: 55, sunGain: 160 }, "Kids Room": { ua: 45, sunGain: 140 },
	"Home Office": { ua: 40, sunGain: 180 }, Bathroom: { ua: 30, sunGain: 40 }, Hallway: { ua: 40, sunGain: 30 }, Garage: { ua: 160, sunGain: 0, conditioned: false },
};
/** How much of an appliance's power ends up as heat in the room: a water heater warms water, a charger warms a car. */
const HEAT_SHARE: Record<string, number> = { "Water Heater Power": 0.06, "EV Charger Power": 0.03, "Dishwasher Power": 0.2, "Kettle Power": 0.35, "Coffee Machine Power": 0.4, "Front Lawn Sprinkler Power": 0, "Towel Warmer Power": 0.9 };
const WINDOW: Record<string, string[]> = { Kitchen: ["binary_sensor.kitchen_window", "cover.kitchen_window"], "Master Bedroom": ["binary_sensor.bedroom_window"], "Kids Room": ["binary_sensor.kids_room_window"], "Living Room": ["cover.living_room_window"], Hallway: ["cover.hall_window"] };
/** A list that is known to have a first element, so picking from it never comes up empty. */
type NonEmpty<T> = [T, ...T[]];
const choose = <T>(xs: Readonly<NonEmpty<T>>, r: () => number): T => xs[Math.floor(r() * xs.length)] ?? xs[0];
export const WINDOW_FAULTS: NonEmpty<string> = ["binary_sensor.bedroom_window", "binary_sensor.kids_room_window", "cover.kitchen_window", "cover.living_room_window", "cover.hall_window"];
/** How far open a window or door is, 0 to 1, whether a sensor says so or a cover (blind, window, garage door) has been moved by someone. */
export function openness(ha: HaView, entity: string): number {
	const s = ha(entity); if (!s) return 0;
	if (entity.startsWith("cover.")) return s.state === "closed" ? 0 : s.state === "open" ? clamp(Number(s.attrs.current_position ?? 100) / 100, 0, 1) : 0.5;
	return s.state === "on" ? 1 : 0;
}

// ---------------------------------------------------------------------------------- people
export type Act = "sleep" | "shower" | "breakfast" | "work" | "cook" | "dinner" | "tv" | "homework" | "garden" | "idle" | "away" | "nap" | "lunch";
type Step = [h: number, room: string, act: Act];
export type Resident = { name: string; x: number; z: number; room: string; act: Act; path: { x: number; z: number }[]; wander: { x: number; z: number } | null; since: number; lastMove: number; goal: string; off: number };

const WEEKDAY: Record<string, NonEmpty<Step>> = {
	Maya: [[0, "Master Bedroom", "sleep"], [6.75, "Bathroom", "shower"], [7.15, "Kitchen", "breakfast"], [8.25, "Home Office", "work"], [12.75, "Kitchen", "lunch"], [13.4, "Home Office", "work"], [17.4, "Living Room", "idle"], [18.5, "Kitchen", "cook"], [19.4, "Living Room", "dinner"], [20.1, "Living Room", "tv"], [22.2, "Bathroom", "shower"], [22.6, "Master Bedroom", "sleep"]],
	Dev: [[0, "Master Bedroom", "sleep"], [6.5, "Bathroom", "shower"], [6.95, "Kitchen", "breakfast"], [7.6, "Hallway", "idle"], [7.85, "Away", "away"], [18.2, "Garage", "idle"], [18.55, "Living Room", "idle"], [19, "Kitchen", "cook"], [19.4, "Living Room", "dinner"], [20.1, "Living Room", "tv"], [22.3, "Master Bedroom", "sleep"]],
	Kiran: [[0, "Kids Room", "sleep"], [7, "Bathroom", "shower"], [7.3, "Kitchen", "breakfast"], [7.75, "Away", "away"], [15.5, "Kids Room", "homework"], [17.4, "Living Room", "tv"], [19.4, "Living Room", "dinner"], [20.2, "Living Room", "idle"], [20.8, "Bathroom", "shower"], [21.05, "Kids Room", "sleep"]],
	Nani: [[0, "Home Office", "sleep"], [5.9, "Bathroom", "shower"], [6.3, "Garden", "garden"], [7.4, "Kitchen", "breakfast"], [8.4, "Living Room", "tv"], [12.2, "Kitchen", "lunch"], [12.9, "Living Room", "nap"], [15, "Garden", "garden"], [16.4, "Living Room", "tv"], [19.4, "Living Room", "dinner"], [20.1, "Living Room", "tv"], [21.6, "Bathroom", "shower"], [21.95, "Home Office", "sleep"]],
};
const WEEKEND: Record<string, NonEmpty<Step>> = {
	Maya: [[0, "Master Bedroom", "sleep"], [8.3, "Bathroom", "shower"], [8.7, "Kitchen", "breakfast"], [9.6, "Living Room", "idle"], [11, "Garden", "garden"], [12, "Kitchen", "cook"], [13, "Living Room", "dinner"], [15, "Away", "away"], [17.6, "Living Room", "idle"], [18.8, "Kitchen", "cook"], [19.5, "Living Room", "dinner"], [20.2, "Living Room", "tv"], [22.6, "Master Bedroom", "sleep"]],
	Dev: [[0, "Master Bedroom", "sleep"], [8.6, "Kitchen", "breakfast"], [9.6, "Home Office", "work"], [11, "Away", "away"], [12.8, "Kitchen", "cook"], [13.2, "Living Room", "dinner"], [15, "Away", "away"], [17.6, "Garage", "idle"], [18.8, "Kitchen", "cook"], [19.5, "Living Room", "dinner"], [20.2, "Living Room", "tv"], [22.8, "Master Bedroom", "sleep"]],
	Kiran: [[0, "Kids Room", "sleep"], [8.6, "Kitchen", "breakfast"], [9.3, "Living Room", "tv"], [11, "Garden", "garden"], [13.2, "Living Room", "dinner"], [14.2, "Kids Room", "homework"], [17, "Living Room", "tv"], [19.5, "Living Room", "dinner"], [20.5, "Bathroom", "shower"], [21.2, "Kids Room", "sleep"]],
	Nani: [[0, "Home Office", "sleep"], [6.8, "Garden", "garden"], [8, "Kitchen", "breakfast"], [9, "Living Room", "tv"], [12.6, "Kitchen", "lunch"], [13.3, "Living Room", "nap"], [16.2, "Garden", "garden"], [17.4, "Living Room", "tv"], [19.5, "Living Room", "dinner"], [20.2, "Living Room", "tv"], [21.8, "Home Office", "sleep"]],
};

// ---------------------------------------------------------------------------------- faults
export const FAULT_KINDS = ["door_ajar", "window_open", "leak", "smoke", "power_spike", "fridge_door", "garage_open"] as const;
export type FaultKind = (typeof FAULT_KINDS)[number];
export const isFaultKind = (v: unknown): v is FaultKind => typeof v === "string" && (FAULT_KINDS as readonly string[]).includes(v);
export const FAULTS: Record<FaultKind, { label: string; minutes: number }> = {
	door_ajar: { label: "Front door left ajar", minutes: 25 }, window_open: { label: "Window left open", minutes: 180 }, leak: { label: "Leak in the bathroom", minutes: 6 },
	smoke: { label: "Burnt toast", minutes: 0.7 }, power_spike: { label: "A plug draws too much", minutes: 12 }, fridge_door: { label: "Fridge door left open", minutes: 8 }, garage_open: { label: "Garage door left open", minutes: 30 },
};
type ActiveFault = { id: number; kind: FaultKind; start: number; endsAt: number; detail: string };

const byName = (n: string) => DEVICES.find((d) => d.name === n);
const boolHelper = (entity: string) => DEVICES.find((d) => d.entity === entity)?.sim?.helper;

export class World {
	t: number; speed = 1; paused = false;
	weather: Weather;
	rooms: Record<string, RoomSim> = {};
	people: Resident[] = [];
	faults: ActiveFault[] = [];
	hvac = { mode: "off", low: 21, high: 24, heatW: 0, coolW: 0, elecW: 0 };
	power = { home: 0, solar: 0, grid: 0 };
	private r: () => number;
	private nextFault = 0; private faultId = 1;
	private emptySince: Record<string, number> = {};
	private forgot: Record<string, boolean> = {};
	private timers: { at: number; run: () => void }[] = [];
	private flags: Record<string, number> = {};
	private energy: Record<string, number> = {};
	private carKwh = 22; private tank = 52; private fridgeAt = 0; private fridgeOn = false; private dishStart = -1; private printStart = -1; private printEnd = -1; private sprayDay = -1; private day = -2;
	/** the latest values written, so only real changes go to Home Assistant */
	private sent = new Map<string, number | boolean>();
	events: string[] = [];

	constructor(t: number, seed = 7) {
		this.t = t; this.r = rng(seed); this.weather = new Weather(this.r);
		for (const rm of ROOMS) if (rm.indoor) { const p = PARAMS[rm.name] ?? {}; this.rooms[rm.name] = { T: 21, hum: 50, co2: 520, ua: p.ua ?? 50, c: 1.2e6, sunGain: p.sunGain ?? 0, conditioned: p.conditioned ?? true }; }
		for (const name of Object.keys(WEEKDAY)) this.people.push({ name, x: 0, z: 0, room: "Hallway", act: "idle", path: [], wander: null, since: t, lastMove: t, goal: "", off: 0 });
		this.placeAll();
	}

	/** Where a resident should be at each hour today. Everyone in the house has a plan; staying put is only a safety net. */
	private plan(name: string): NonEmpty<Step> { return (weekend(this.t) ? WEEKEND : WEEKDAY)[name] ?? [[0, "Hallway", "idle"]]; }
	/** The state of an indoor room. Asking for one that doesn't exist is a bug, not a missing reading. */
	roomState(name: string): RoomSim {
		const r = this.rooms[name];
		if (!r) throw new Error(`No simulated room called ${name}`);
		return r;
	}
	private placeAll() {
		for (const p of this.people) {
			const [, rm, act] = this.desired(p);
			p.room = rm; p.act = act; p.goal = rm;
			if (rm === "Away") { p.x = -3.5; p.z = 5.75; } else { const c = centre(room(rm)); p.x = c.x; p.z = c.z; }
		}
	}
	private desired(p: Resident): Step {
		const steps = this.plan(p.name), h = (hourOf(this.t) - p.off + 24) % 24;
		let cur = steps[0];
		for (const s of steps) if (s[0] <= h) cur = s;
		return cur;
	}
	/** Standing, sitting or lying: only once they have actually reached their seat or bed. */
	poseOf(p: Resident): Pose {
		if (p.path.length || p.room === "Away") return "stand";
		const sp = spot(p.goal, p.act, p.name);
		return sp && Math.hypot(sp.x - p.x, sp.z - p.z) < 0.2 ? sp.pose : "stand";
	}
	/** Which room a point is in. */
	roomAt(x: number, z: number): string {
		for (const r of ROOMS) if (r.indoor && x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1) return r.name;
		return x < 0 && z > 5 && z < 6.5 ? "Away" : "Garden";
	}

	// -------------------------------------------------------------------------- control from the viewer
	trigger(kind: FaultKind, out: Out, detail = "") { this.startFault(kind, out, detail); }
	private after(sec: number, run: () => void) { this.timers.push({ at: this.t + sec * 1000, run }); }

	// -------------------------------------------------------------------------- one step
	step(dt: number, ha: HaView, out: Out) {
		if (dt <= 0) return;
		this.t += dt * 1000;
		const h = hourOf(this.t);
		const midnight = dayOf(this.t);
		if (midnight !== this.day) { this.day = midnight; this.newDay(); }
		this.weather.step(dt);
		const on = (id: string) => ha(id)?.state === "on";
		const num = (id: string) => Number(ha(id)?.state);
		this.readThermostat(ha);
		this.movePeople(dt, h, ha, out);
		this.runTimers(out);
		this.routines(h, ha, out);
		this.appliances(dt, h, ha, out);
		this.faultTick(ha, out);
		this.thermal(dt, h, ha);
		this.powerFlow(dt, h, ha, out);
		void on; void num;
	}

	private newDay() {
		for (const p of this.people) p.off = (this.r() - 0.5) * 0.5; // each day, each person is a little earlier or later
		if (this.nextFault < this.t) this.nextFault = this.t + (6 + this.r() * 10) * 3600e3;
	}

	private readThermostat(ha: HaView) {
		const c = ha("climate.ecobee"); if (!c) return;
		this.hvac.mode = c.state;
		const lo = Number(c.attrs.target_temp_low ?? c.attrs.temperature ?? 21), hi = Number(c.attrs.target_temp_high ?? c.attrs.temperature ?? 24);
		if (Number.isFinite(lo)) this.hvac.low = lo; if (Number.isFinite(hi)) this.hvac.high = hi;
	}

	// -------------------------------------------------------------------------- people walking about
	private movePeople(dt: number, h: number, ha: HaView, out: Out) {
		for (const p of this.people) {
			const before = this.roomAt(p.x, p.z);
			const [, rm, act] = this.desired(p);
			if (rm !== p.goal && p.path.length === 0) {
				p.path = route(p.room === "Away" ? "Away" : this.roomAt(p.x, p.z), rm);
				p.goal = rm; p.act = act;
				if (p.room === "Away" && rm !== "Away") this.arrive(p, out);
				if (rm === "Away") this.after(30, () => {});
			} else if (rm === p.goal) p.act = act;
			let budget = dt * 1.3;
			for (let w = p.path[0]; budget > 0 && w; w = p.path[0]) {
				const dx = w.x - p.x, dz = w.z - p.z, d = Math.hypot(dx, dz);
				if (d <= budget) { p.x = w.x; p.z = w.z; budget -= d; p.path.shift(); p.lastMove = this.t; } else { p.x += (dx / d) * budget; p.z += (dz / d) * budget; budget = 0; p.lastMove = this.t; }
			}
			if (!p.path.length) {
				if (p.goal === "Away") { if (p.room !== "Away") { p.room = "Away"; this.depart(p, out); } }
				else {
					p.room = p.goal;
					const r = room(p.goal), sp = spot(p.goal, p.act, p.name);
					if (sp) p.wander = { x: sp.x, z: sp.z };
					else if ((p.act as Act) !== "sleep" && (!p.wander || this.r() < dt / 45)) p.wander = { x: r.x0 + 0.9 + this.r() * (r.x1 - r.x0 - 1.8), z: r.z0 + 0.9 + this.r() * (r.z1 - r.z0 - 1.8) }; // moves a little about the room now and then
					if (p.wander) {
						const dx = p.wander.x - p.x, dz = p.wander.z - p.z, d = Math.hypot(dx, dz);
						if (d > 0.04) { const s = Math.min(d, dt * (sp ? 1.1 : 0.5)); p.x += (dx / d) * s; p.z += (dz / d) * s; if (!sp) p.lastMove = this.t; else if (d > 0.3) p.lastMove = this.t; }
					}
				}
			}
			const now = this.roomAt(p.x, p.z);
			if (now !== before && now !== "Away") this.entered(now, p, h, ha, out);
		}
		// empty rooms: after a few minutes someone (usually) switches the lights off
		for (const rm of ROOMS) {
			if (!rm.indoor && rm.name !== "Garden") continue;
			const here = this.people.some((p) => this.roomAt(p.x, p.z) === rm.name);
			const since = this.emptySince[rm.name];
			if (here) { delete this.emptySince[rm.name]; this.forgot[rm.name] ??= false; }
			else if (since === undefined) { this.emptySince[rm.name] = this.t; this.forgot[rm.name] = this.r() < 0.07; }
			else if (this.t - since > 180e3 && since > 0) {
				if (!this.forgot[rm.name]) this.roomLights(rm.name, false, ha, out);
				this.emptySince[rm.name] = -1; // handled for this absence
			}
		}
	}
	private roomLightsOf(name: string): Dev[] { return DEVICES.filter((d) => d.room === name && d.kind === "light"); }
	/** How bright people keep a room at this time of day. */
	private level(h: number, act?: Act) { if (act === "tv") return 30; if (h >= 22 || h < 6) return 25; if (h >= 20) return 55; if (h >= 18) return 80; return 100; }
	private roomLights(name: string, on: boolean, ha: HaView, out: Out, which?: (d: Dev) => boolean, pct = 100) {
		for (const d of this.roomLightsOf(name)) {
			if (which && !which(d)) continue;
			if (name === "Garden") continue;
			const cur = ha(d.entity)?.state === "on";
			if (cur !== on) out.call("light", on ? "turn_on" : "turn_off", d.entity, on ? { brightness: Math.round((pct / 100) * 255) } : undefined);
		}
	}
	private dark(name: string, h: number) {
		if (["Bathroom", "Hallway", "Garage"].includes(name)) return true;
		return sunAt(h) * (1 - 0.7 * this.weather.cloud) < 0.3;
	}
	private entered(name: string, p: Resident, h: number, ha: HaView, out: Out) {
		this.emptySince[name] = 0; delete this.emptySince[name];
		if (this.dark(name, h) && (p.act as Act) !== "sleep") {
			const night = h >= 21 || h < 6;
			const pick = (d: Dev) => {
				if (name === "Living Room") return /floor|sofa/i.test(d.name) || (night && /nook/i.test(d.name));
				if (name === "Kitchen") return /under cabinet/i.test(d.name) || (p.act === "cook" && /pendant/i.test(d.name));
				if (name === "Master Bedroom") return /bedside left|wardrobe/i.test(d.name);
				if (name === "Kids Room") return night ? /night light/i.test(d.name) : /ceiling/i.test(d.name);
				if (name === "Home Office") return /desk|ceiling/i.test(d.name);
				if (name === "Hallway") return /hallway/i.test(d.name) || (night && /stair/i.test(d.name));
				return true;
			};
			this.roomLights(name, true, ha, out, pick, this.level(h, p.act));
		}
		if (name === "Garden" && h > 18) out.call("light", "turn_on", "light.porch_light", { brightness: 200 });
		if (name === "Garden" && ha("lock.back_door_lock")?.state === "locked") { out.call("lock", "unlock", "lock.back_door_lock"); this.flags.backBySim = 1; }
	}
	private arrive(p: Resident, out: Out) {
		this.events.push(`${p.name} arrives home`);
		this.pulse("binary_sensor.front_door_contact", 12, out);
		out.call("lock", "unlock", "lock.front_door_lock");
		this.after(40, () => out.call("lock", "lock", "lock.front_door_lock"));
		if (p.name === "Dev") { out.call("cover", "open_cover", "cover.garage_door"); this.after(40, () => out.call("cover", "close_cover", "cover.garage_door")); this.after(25 * 60, () => out.call("switch", "turn_on", "switch.ev_charger")); }
		if (this.people.filter((q) => q.room !== "Away").length === 1) this.thermostat(21, 24, out);
	}
	private depart(p: Resident, out: Out) {
		this.events.push(`${p.name} leaves`);
		this.pulse("binary_sensor.front_door_contact", 12, out);
		if (p.name === "Dev") { out.call("switch", "turn_off", "switch.ev_charger"); out.call("cover", "open_cover", "cover.garage_door"); this.after(40, () => out.call("cover", "close_cover", "cover.garage_door")); }
		if (!this.people.some((q) => q !== p && q.room !== "Away")) this.after(20, () => out.call("lock", "lock", "lock.front_door_lock"));
	}
	private pulse(entity: string, seconds: number, out: Out) {
		const hp = boolHelper(entity); if (!hp) return;
		out.bool(hp, true); this.sent.set(hp, true);
		this.after(seconds, () => { out.bool(hp, false); this.sent.set(hp, false); });
	}
	private runTimers(out: Out) {
		const due = this.timers.filter((x) => x.at <= this.t);
		this.timers = this.timers.filter((x) => x.at > this.t);
		for (const d of due) d.run();
		void out;
	}

	// -------------------------------------------------------------------------- scheduled and habitual things
	private routines(h: number, ha: HaView, out: Out) {
		const st = (id: string) => ha(id)?.state;
		const set = (entity: string, on: boolean, domain = domainOf(entity)) => { if ((st(entity) === "on") !== on) out.call(domain, on ? "turn_on" : "turn_off", entity); };
		const key = (k: string, minute: number) => { const slot = Math.floor(this.t / 60000); if (this.flags[k] === slot) return false; if (Math.floor(hourOf(this.t) * 60) === minute) { this.flags[k] = slot; return true; } return false; };
		const dusk = 18.4, dawn = 6.6;
		if (key("porch-on", Math.round(dusk * 60))) set("light.porch_light", true);
		if (key("porch-off", Math.round(dawn * 60))) set("light.porch_light", false);
		if (key("path-on", Math.round(dusk * 60) + 10)) set("switch.garden_path_lights", true);
		if (key("path-off", 23 * 60)) set("switch.garden_path_lights", false);
		if (key("sprinkler-on", 6 * 60) && this.day !== this.sprayDay) { this.sprayDay = this.day; if ((this.soil(ha) ?? 40) < 58) { set("switch.front_lawn_sprinkler", true); this.after(15 * 60, () => out.call("switch", "turn_off", "switch.front_lawn_sprinkler")); } }
		// kitchen routine when people are there for breakfast and dinner
		for (const p of this.people) {
			if (p.room === p.goal && p.path.length === 0) {
				if (p.act === "breakfast" && p.room === "Kitchen" && key(`kettle-${p.name}`, Math.floor(hourOf(this.t) * 60))) { if (!weekend(this.t) || p.name !== "Kiran") { set("switch.kettle", true); if (p.name === "Maya" || p.name === "Dev") set("switch.coffee_machine", true); } }
				if (p.act === "cook" && key(`cook-${p.name}`, Math.floor(hourOf(this.t) * 60)) && this.r() < 0.5) set("switch.kettle", true);
				if (p.act === "work" && p.room === "Home Office") { set("switch.workstation_plug", true); set("switch.monitor_plug", true); }
				if (p.act === "tv" && p.room === "Living Room") { if (st("switch.tv_plug") !== "on") { out.call("light", "turn_on", "light.floor_lamp", { brightness: 70 }); out.call("light", "turn_on", "light.tv_backlight", { brightness: 110 }); } set("switch.tv_plug", true); }
				if (p.act === "shower" && p.room === "Bathroom") { if (st("fan.bathroom_exhaust_fan") !== "on" || Number(ha("fan.bathroom_exhaust_fan")?.attrs.percentage ?? 0) < 90) out.call("fan", "set_percentage", "fan.bathroom_exhaust_fan", { percentage: 100 }); if (p.name !== "Kiran") set("switch.towel_warmer", true); this.tank = Math.max(25, this.tank - 0.02); }
			}
		}
		// things switched off again once nobody is around
		const away = (name: string, mins: number, fn: () => void) => { if (!this.people.some((p) => this.roomAt(p.x, p.z) === name)) { const k = `idle-${name}`; if (this.flags[k] === undefined) this.flags[k] = this.t; else if (this.t - this.flags[k] > mins * 60e3) { fn(); this.flags[k] = Infinity; } } else delete this.flags[`idle-${name}`]; };
		away("Home Office", 25, () => { set("switch.workstation_plug", false); set("switch.monitor_plug", false); });
		away("Living Room", 12, () => { set("switch.tv_plug", false); set("light.tv_backlight", false, "light"); });
		away("Garden", 2, () => { if (this.flags.backBySim) { delete this.flags.backBySim; out.call("lock", "lock", "lock.back_door_lock"); } });
		away("Bathroom", 6, () => { if (st("fan.bathroom_exhaust_fan") === "on") out.call("fan", "turn_off", "fan.bathroom_exhaust_fan"); set("switch.towel_warmer", false); });
		if (h < 6.5 || h > 8) set("switch.towel_warmer", false);
		// the family's own bedtime habits
		if (key("humidifier-on", 21 * 60)) set("switch.humidifier", true);
		if (key("humidifier-off", 7 * 60)) set("switch.humidifier", false);
		// ceiling fan: someone asleep in a warm room runs it at a speed that matches the heat
		const T = this.rooms["Master Bedroom"]?.T ?? 21, sleeping = this.people.some((p) => p.room === "Master Bedroom" && p.act === "sleep");
		const want = sleeping ? (T > 27 ? 100 : T > 25.5 ? 67 : T > 24.2 ? 33 : 0) : 0, now = st("fan.bedroom_ceiling_fan") === "on" ? Math.round(Number(ha("fan.bedroom_ceiling_fan")?.attrs.percentage ?? 0)) : 0;
		if (want !== now && !(now > 0 && want > 0 && Math.abs(want - now) < 20)) { if (want === 0) out.call("fan", "turn_off", "fan.bedroom_ceiling_fan"); else out.call("fan", "set_percentage", "fan.bedroom_ceiling_fan", { percentage: want }); }
		// the thermostat gets nudged like a person would: cooler overnight, a setback when the house is empty
		if (key("night-setback", 22 * 60 + 45)) this.thermostat(19.5, 25, out);
		if (key("morning-warm", 6 * 60 + 15)) this.thermostat(21, 24, out);
		const empty = this.people.every((p) => p.room === "Away" && p.path.length === 0);
		if (empty && this.flags.emptyAt === undefined) this.flags.emptyAt = this.t;
		if (!empty) delete this.flags.emptyAt;
		if (this.flags.emptyAt !== undefined && this.flags.emptyAt > 0 && this.t - this.flags.emptyAt > 20 * 60e3) { this.thermostat(17, 27, out); this.flags.emptyAt = -1; }
		if (this.people.every((p) => ["sleep", "away"].includes(p.act) && p.path.length === 0) && h > 22.4 || (h < 5 && h > 0)) {
			if (key("night-lock", 22 * 60 + 40)) { out.call("lock", "lock", "lock.front_door_lock"); out.call("lock", "lock", "lock.back_door_lock"); for (const rm of ["Living Room", "Kitchen", "Hallway", "Bathroom"]) this.roomLights(rm, false, ha, out); }
		}
		if (key("dishwasher", 20 * 60 + 50) && this.people.some((p) => p.room === "Kitchen" || p.room === "Living Room")) { set("switch.dishwasher", true); this.dishStart = this.t; }
		// a long job on the printer now and then
		if (this.printEnd < 0 && this.people.some((p) => p.room === "Home Office") && this.r() < 0.0004) { set("switch.3d_printer", true); this.printStart = this.t; this.printEnd = this.t + (2 + this.r() * 3) * 3600e3; }
		if (this.printEnd > 0 && this.t > this.printEnd) { set("switch.3d_printer", false); this.printEnd = -1; }
		// visitors
		if (h > 9.5 && h < 19 && !weekend(this.t) && this.r() < 0.00004 * (this.speed > 100 ? 1 : 1)) this.visitor(out);
	}
	private thermostat(low: number, high: number, out: Out) { out.call("climate", "set_temperature", "climate.ecobee", { target_temp_low: low, target_temp_high: high }); }
	private soil(ha: HaView) { const n = Number(ha("sensor.garden_soil_moisture")?.state); return Number.isFinite(n) ? n : undefined; }
	private visitor(out: Out) {
		this.events.push("Someone rings the doorbell");
		this.pulse("binary_sensor.doorbell_button", 5, out);
		this.after(30, () => this.pulse("binary_sensor.front_door_contact", 20, out));
	}

	// -------------------------------------------------------------------------- appliances with their own cycles
	private appliances(dt: number, h: number, ha: HaView, out: Out) {
		const on = (e: string) => ha(e)?.state === "on";
		this.watts = {};
		const w = (name: string, v: number) => (this.watts[name] = v);
		const j = (base: number, jit = 0.06) => base * (1 + gauss(this.r) * jit);
		for (const d of DEVICES.filter((x) => x.sim?.gate)) {
			const gate = d.sim!.gate as string;
			if (!on(gate)) { w(d.name, 0); continue; }
			let v = j(d.sim!.base as number, d.sim!.jitter ?? 0.06);
			if (d.name === "Kettle Power") { const k = (this.flags.kettle ??= this.t); if (this.t - k > 170e3) { out.call("switch", "turn_off", gate); delete this.flags.kettle; v = 0; } }
			if (d.name === "Coffee Machine Power") { const k = (this.flags.coffee ??= this.t); const e = (this.t - k) / 1000; if (e > 300) { out.call("switch", "turn_off", gate); delete this.flags.coffee; v = 0; } else v = e < 90 ? j(1250) : j(140); }
			if (d.name === "Dishwasher Power") { const k = this.dishStart > 0 ? this.dishStart : (this.dishStart = this.t); const m = (this.t - k) / 60e3; v = m < 15 ? j(190) : m < 40 ? j(1350) : m < 60 ? j(260) : m < 85 ? j(1450) : m < 105 ? j(120) : 0; if (m > 110) { out.call("switch", "turn_off", gate); this.dishStart = -1; v = 0; } }
			if (d.name === "EV Charger Power") { const full = this.carKwh >= 58; v = full ? 18 : j(7200, 0.01) * (1 - Math.max(0, this.carKwh - 50) / 40); if (!full) this.carKwh += (v * dt) / 3.6e6; }
			if (d.name === "Water Heater Power") { const demand = this.people.some((p) => p.act === "shower" && p.room === "Bathroom") ? 0.01 : 0; this.tank = clamp(this.tank + (v * dt) / 4.2e6 * 0.35 - demand * dt * 0.1 - (this.tank - 20) * 2e-6 * dt, 20, 62); if (this.tank > 58) v = 0; else if (this.tank < 50) v = j(2400, 0.02); else v = this.heating ? j(2400, 0.02) : 0; this.heating = v > 0; }
			if (d.name === "Fridge Freezer Plug Power") { if (this.t > this.fridgeAt) { this.fridgeOn = !this.fridgeOn; this.fridgeAt = this.t + (this.fridgeOn ? 14 : 22) * 60e3 * (0.85 + this.r() * 0.3); } v = this.fridgeOn ? j(125) : j(4, 0.3); }
			if (d.name === "3D Printer Power") { const m = (this.t - this.printStart) / 60e3; v = m < 8 ? j(260) : j(115, 0.1); }
			if (d.name === "Workstation Plug Power") v = j(this.people.some((p) => p.room === "Home Office") ? 165 : 40, 0.15);
			if (d.name === "TV Plug Power") v = j(this.people.some((p) => p.room === "Living Room") ? 95 : 8, 0.1);
			w(d.name, Math.max(0, v));
		}
		if (!on("switch.coffee_machine")) delete this.flags.coffee;
		if (!on("switch.kettle")) delete this.flags.kettle;
		// faults that change draw
		for (const f of this.faults) { const w = this.watts[f.detail]; if (f.kind === "power_spike" && w !== undefined) this.watts[f.detail] = w * 3 + 80; }
		if (this.faults.some((f) => f.kind === "fridge_door") && on("switch.fridge_freezer_plug")) this.watts["Fridge Freezer Plug Power"] = j(150);
		void h;
	}
	watts: Record<string, number> = {};
	private heating = false;

	// -------------------------------------------------------------------------- heat, air and damp
	private thermal(dt: number, h: number, ha: HaView) {
		const out = this.weather.temp(h), sun = sunAt(h) * (1 - 0.8 * this.weather.cloud);
		const rooms = Object.entries(this.rooms), indoor = rooms.filter(([, r]) => r.conditioned);
		const mean = indoor.reduce((a, [, r]) => a + r.T, 0) / indoor.length;
		let heat = 0, cool = 0;
		const sub = Math.max(1, Math.ceil(dt / 30)), d = dt / sub;
		for (let s = 0; s < sub; s++) for (const [n, R] of rooms) {
			const ocup = this.people.filter((p) => this.roomAt(p.x, p.z) === n).length;
			const lights = DEVICES.filter((x) => x.room === n && x.kind === "light" && ha(x.entity)?.state === "on").length;
			const appl = DEVICES.filter((x) => x.room === n && x.sim?.gate).reduce((a, x) => a + (this.watts[x.name] ?? 0) * (HEAT_SHARE[x.name] ?? 0.85), 0);
			let ua = R.ua + (WINDOW[n] ? 90 * Math.max(...WINDOW[n].map((e) => openness(ha, e))) : 0);
			if (n === "Hallway" && ha("binary_sensor.front_door_contact")?.state === "on") ua += 60;
			if (n === "Garage") ua += 200 * Math.max(openness(ha, "cover.garage_door"), openness(ha, "binary_sensor.garage_door_contact"));
			let q = ua * (out - R.T) + 25 * (mean - R.T) + R.sunGain * sun + ocup * 90 + lights * 9 + appl;
			if (n === "Bathroom" && this.people.some((p) => p.act === "shower" && this.roomAt(p.x, p.z) === "Bathroom")) q += 600;
			if (R.conditioned && this.hvac.mode !== "off" && this.hvac.mode !== "fan_only") {
				const lo = this.hvac.low, hi = this.hvac.high, m = this.hvac.mode;
				const wantHeat = ["heat", "heat_cool", "auto"].includes(m), wantCool = ["cool", "heat_cool", "auto"].includes(m);
				if (wantHeat && R.T < lo) { const p = clamp((lo - R.T) * 700, 0, 1400); q += p; heat += p; }
				else if (wantCool && R.T > hi) { const p = clamp((R.T - hi) * 700, 0, 1400); q -= p; cool += p; }
			}
			R.T += (q * d) / R.c;
			// air: people breathe, windows and fans change it, humidity follows the weather with a lag and bumps for showers and cooking
			const vent = (WINDOW[n] && Math.max(...WINDOW[n].map((e) => openness(ha, e))) > 0.1 ? 1 / 500 : 1 / 2600) + (n === "Bathroom" && ha("fan.bathroom_exhaust_fan")?.state === "on" ? 1 / 700 : 0);
			const sleepers = this.people.filter((p) => p.act === "sleep" && this.roomAt(p.x, p.z) === n).length;
			R.co2 = clamp(R.co2 + (ocup * 0.4 - sleepers * 0.14 - (R.co2 - 430) * vent) * d, 400, 3500);
			const humTarget = (n === "Bathroom" ? 58 : 48) + (this.weather.humidity(h) - 68) * 0.2 + (n === "Bathroom" && this.people.some((p) => p.act === "shower" && this.roomAt(p.x, p.z) === n) ? 38 : 0) + (n === "Kitchen" && this.people.some((p) => p.act === "cook" && p.room === "Kitchen") ? 14 : 0) + (ha("switch.humidifier")?.state === "on" && n === "Kids Room" ? 10 : 0);
			R.hum += (humTarget - R.hum) * clamp(d / (n === "Bathroom" ? 500 : 1800), 0, 1);
		}
		this.hvac.heatW = heat / sub; this.hvac.coolW = cool / sub; this.hvac.elecW = (this.hvac.heatW + this.hvac.coolW) / 3;
	}

	// -------------------------------------------------------------------------- power and energy
	private powerFlow(dt: number, h: number, ha: HaView, out: Out) {
		const sendNum = (helper: string | undefined, v: number, dp: number, lo?: number | null, hi?: number | null) => {
			if (!helper || !Number.isFinite(v)) return;
			const c = Math.round(clamp(v, lo ?? -1e9, hi ?? 1e9) * 10 ** dp) / 10 ** dp, prev = this.sent.get(helper);
			if (prev !== undefined && Math.abs((prev as number) - c) < 10 ** -dp * 0.5) return;
			this.sent.set(helper, c); out.number(helper, c);
		};
		const sensor = (name: string, v: number, dp = 1) => { const d = byName(name); sendNum(d?.sim?.helper, v, dp, d?.sim?.lo, d?.sim?.hi); };
		const solar = this.weather.solar(h) * (1 + gauss(this.r) * 0.01);
		let lightsW = 0; for (const d of DEVICES) if (d.kind === "light" && ha(d.entity)?.state === "on") lightsW += 5 + 0.045 * Number(ha(d.entity)?.attrs.brightness ?? 160);
		let fansW = 0; for (const d of DEVICES) if (d.kind === "fan" && ha(d.entity)?.state === "on") fansW += 38;
		let plugsW = 0; for (const w of Object.values(this.watts)) plugsW += w;
		const home = 215 + lightsW + fansW + plugsW + this.hvac.elecW + gauss(this.r) * 6;
		this.power = { home, solar, grid: home - solar };
		for (const [n, v] of Object.entries(this.watts)) sensor(n, v, 0);
		sensor("Whole Home Power", home, 0); sensor("Solar Production Power", Math.max(0, solar), 0);
		sensor("Grid Voltage", 231 - Math.min(6, home / 2500) + gauss(this.r) * 0.4, 1);
		// energy counters add up what the power actually was
		const acc = (name: string, w: number) => { const d = byName(name); if (!d?.sim?.helper) return; const cur = (this.energy[name] ??= Number(ha(d.entity)?.state) || 0); this.energy[name] = cur + (Math.max(0, w) * dt) / 3.6e6; sendNum(d.sim.helper, this.energy[name], 2); };
		acc("Whole Home Energy", home); acc("Solar Energy Produced", solar); acc("EV Charger Energy", this.watts["EV Charger Power"] ?? 0);
		// room readings
		for (const [n, R] of Object.entries(this.rooms)) {
			sensor(`${n} Temperature`, R.T + gauss(this.r) * 0.02, 1);
			if (n !== "Hallway" && n !== "Garage" && n !== "Home Office") sensor(`${n} Humidity`, R.hum + gauss(this.r) * 0.3, 0);
		}
		sensor("Bedroom CO2", this.roomState("Master Bedroom").co2, 0); sensor("Living Room CO2", this.roomState("Living Room").co2, 0);
		sensor("Outdoor Temperature", this.weather.temp(h) + gauss(this.r) * 0.05, 1); sensor("Outdoor Humidity", this.weather.humidity(h), 0); sensor("Wind Speed", this.weather.wind, 0);
		const soil = Number(ha("sensor.garden_soil_moisture")?.state);
		const wet = ha("switch.front_lawn_sprinkler")?.state === "on";
		if (Number.isFinite(soil)) sensor("Garden Soil Moisture", clamp(soil + (wet ? 0.004 * dt : 0) - dt * (0.0002 + sunAt(h) * 0.0004), 12, 85), 1);
		// motion: movement in the last couple of minutes, plus a sustained "occupied" for the office
		const moving = (n: string) => this.people.some((p) => this.roomAt(p.x, p.z) === n && this.t - p.lastMove < 120e3);
		const occupied = (n: string, grace: number) => this.people.some((p) => this.roomAt(p.x, p.z) === n) || this.t - (this.flags[`occ-${n}`] ?? 0) < grace;
		for (const p of this.people) { const n = this.roomAt(p.x, p.z); if (n === "Home Office") this.flags["occ-Home Office"] = this.t; }
		const flipB = (entity: string, onNow: boolean) => { const hp = boolHelper(entity); if (!hp) return; const prev = this.sent.get(hp) ?? (ha(entity)?.state === "on"); if (prev !== onNow) { this.sent.set(hp, onNow); out.bool(hp, onNow); } };
		flipB("binary_sensor.living_room_motion", moving("Living Room")); flipB("binary_sensor.hallway_motion", moving("Hallway")); flipB("binary_sensor.office_occupancy", occupied("Home Office", 300e3));
		void h;
	}

	// -------------------------------------------------------------------------- things going wrong
	private faultTick(ha: HaView, out: Out) {
		// someone undoing it from the app (locking the door, closing the cover, switching the plug off) ends it right away
		for (const f of this.faults) if (this.t - f.start > 12e3 && this.undone(f, ha)) f.endsAt = this.t;
		for (const f of this.faults.filter((x) => x.endsAt <= this.t)) this.endFault(f, out);
		this.faults = this.faults.filter((x) => x.endsAt > this.t);
		if (this.t > this.nextFault && this.nextFault > 0) {
			const k = choose(FAULT_KINDS, this.r);
			this.startFault(k, out); this.nextFault = this.t + (8 + this.r() * 20) * 3600e3;
		}
	}
	private undone(f: ActiveFault, ha: HaView) {
		if (f.kind === "door_ajar") return ha("lock.front_door_lock")?.state === "locked";
		if (f.kind === "garage_open") return ha("cover.garage_door")?.state === "closed";
		if (f.kind === "window_open") return f.detail.startsWith("cover.") && ha(f.detail)?.state === "closed";
		if (f.kind === "power_spike") { const d = DEVICES.find((x) => x.name === f.detail); return !!d?.sim?.gate && ha(d.sim.gate as string)?.state === "off"; }
		return false;
	}
	private startFault(kind: FaultKind, out: Out, detail = "") {
		if (this.faults.some((f) => f.kind === kind)) return;
		const f: ActiveFault = { id: this.faultId++, kind, start: this.t, endsAt: this.t + FAULTS[kind].minutes * 60e3, detail };
		const set = (entity: string, on: boolean) => { const hp = boolHelper(entity); if (hp) { this.sent.set(hp, on); out.bool(hp, on); } };
		const open = (entity: string, on: boolean) => (entity.startsWith("cover.") ? out.call("cover", on ? "open_cover" : "close_cover", entity) : set(entity, on));
		if (kind === "door_ajar") { out.call("lock", "unlock", "lock.front_door_lock"); set("binary_sensor.front_door_contact", true); }
		if (kind === "window_open") { const w = detail || choose(WINDOW_FAULTS, this.r); f.detail = w; open(w, true); }
		if (kind === "leak") set("binary_sensor.bathroom_leak_sensor", true);
		if (kind === "smoke") set("binary_sensor.kitchen_smoke_detector", true);
		if (kind === "power_spike") f.detail = detail || ["Workstation Plug Power", "Monitor Plug Power", "TV Plug Power", "Humidifier Power", "Dishwasher Power"].find((n) => (this.watts[n] ?? 0) > 0) || "Fridge Freezer Plug Power";
		if (kind === "fridge_door") set("binary_sensor.fridge_door", true);
		if (kind === "garage_open") out.call("cover", "open_cover", "cover.garage_door");
		this.faults.push(f); this.events.push(FAULTS[kind].label);
	}
	private endFault(f: ActiveFault, out: Out) {
		const set = (entity: string) => { const hp = boolHelper(entity); if (hp) { this.sent.set(hp, false); out.bool(hp, false); } };
		if (f.kind === "door_ajar") { set("binary_sensor.front_door_contact"); out.call("lock", "lock", "lock.front_door_lock"); }
		if (f.kind === "window_open") { if (f.detail.startsWith("cover.")) out.call("cover", "close_cover", f.detail); else set(f.detail); }
		if (f.kind === "leak") set("binary_sensor.bathroom_leak_sensor");
		if (f.kind === "smoke") set("binary_sensor.kitchen_smoke_detector");
		if (f.kind === "fridge_door") set("binary_sensor.fridge_door");
		if (f.kind === "garage_open") out.call("cover", "close_cover", "cover.garage_door");
		this.events.push(`${FAULTS[f.kind].label}: sorted`);
	}

	// -------------------------------------------------------------------------- adopt what is already there
	/** Day one: shut the windows and the garage door, which Home Assistant's demo leaves half open. */
	init(out: Out) { for (const c of ["cover.kitchen_window", "cover.living_room_window", "cover.hall_window", "cover.garage_door"]) out.call("cover", "close_cover", c); }

	/** On the first look, start from what Home Assistant already shows so nothing jumps. */
	adopt(ha: HaView) {
		for (const [n, R] of Object.entries(this.rooms)) {
			const t = Number(ha(DEVICES.find((d) => d.name === `${n} Temperature`)?.entity ?? "")?.state);
			if (Number.isFinite(t)) R.T = t;
			const hum = Number(ha(DEVICES.find((d) => d.name === `${n} Humidity`)?.entity ?? "")?.state);
			if (Number.isFinite(hum)) R.hum = hum;
		}
		const lo = Number(ha("sensor.outdoor_temperature")?.state);
		if (Number.isFinite(lo)) this.weather.drift = clamp(lo - (14 + 6 * Math.sin(((hourOf(this.t) - 9) / 24) * 2 * Math.PI)), -5, 5);
	}
}

export type PersonSnap = { name: string; x: number; z: number; room: string; act: Act; walking: boolean };
