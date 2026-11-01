import { expect, test } from "bun:test";
import { DEVICES, ROOMS, place, route, room } from "./layout";
import { World, hourOf, sunAt, type HaState, type Out } from "./world";

/** A pretend Home Assistant that obeys the calls the world makes, so a whole day can run in a blink. */
function fakeHa() {
	const s = new Map<string, HaState>();
	for (const d of DEVICES) s.set(d.entity, { state: d.kind === "bsensor" ? "off" : d.kind === "lock" ? "locked" : d.kind === "sensor" || d.kind === "meter" || d.kind === "energy" ? String(d.sim?.base ?? 0) : "off", attrs: {} });
	s.set("climate.ecobee", { state: "heat_cool", attrs: { target_temp_low: 21, target_temp_high: 24 } });
	const helperToEntity = new Map(DEVICES.filter((d) => d.sim?.helper).map((d) => [d.sim!.helper as string, d.entity]));
	const out: Out = {
		number: (h, v) => { const e = helperToEntity.get(h); if (e) s.set(e, { state: String(v), attrs: {} }); },
		bool: (h, on) => { const e = helperToEntity.get(h); if (e) s.set(e, { state: on ? "on" : "off", attrs: {} }); },
		call: (d, svc, e) => { const cur = s.get(e); if (!cur) return; s.set(e, { state: d === "lock" ? (svc === "lock" ? "locked" : "unlocked") : svc === "turn_on" ? "on" : "off", attrs: cur.attrs }); },
	};
	return { s, out, view: (id: string) => s.get(id) };
}
const at = (h: number, day = 3 /* a Wednesday in Nov 2026 */) => new Date(2026, 10, day, Math.floor(h), (h % 1) * 60).getTime();

test("the sun rises and sets, and a day has a shape", () => {
	expect(sunAt(3)).toBe(0); expect(sunAt(12.5)).toBeGreaterThan(0.95); expect(sunAt(20)).toBe(0);
	expect(hourOf(at(7.5))).toBeCloseTo(7.5, 1);
});

test("every device has a place inside the house or garden", () => {
	for (const d of place().filter((x) => x.room)) { const r = room(d.room); expect(d.x).toBeGreaterThanOrEqual(r.x0 - 0.6); expect(d.x).toBeLessThanOrEqual(r.x1 + 0.6); }
	expect(route({ x: 4, z: 9 }, "Living Room", "Master Bedroom").length).toBeGreaterThan(2);
});

test("a weekday runs: people get up, leave and come back, and nothing goes out of range", () => {
	const ha = fakeHa(), w = new World(at(5.9), 11);
	w.adopt(ha.view);
	const seenAway = new Set<string>(), seenKitchen = new Set<string>(); let maxHome = 0, minT = 99, maxT = -99;
	for (let i = 0; i < 24 * 3600 / 20; i++) {
		w.step(20, ha.view, ha.out);
		for (const p of w.people) { if (p.room === "Away") seenAway.add(p.name); if (w.roomAt(p.x, p.z) === "Kitchen") seenKitchen.add(p.name); expect(Number.isFinite(p.x) && Number.isFinite(p.z)).toBe(true); }
		maxHome = Math.max(maxHome, w.power.home);
		for (const R of Object.values(w.rooms)) { expect(Number.isFinite(R.T)).toBe(true); minT = Math.min(minT, R.T); maxT = Math.max(maxT, R.T); expect(R.co2).toBeGreaterThanOrEqual(400); expect(R.hum).toBeGreaterThan(0); expect(R.hum).toBeLessThan(110); }
	}
	expect(seenAway.has("Dev")).toBe(true); expect(seenAway.has("Kiran")).toBe(true); expect(seenAway.has("Nani")).toBe(false);
	expect(seenKitchen.size).toBeGreaterThanOrEqual(3);
	expect(maxHome).toBeGreaterThan(700); expect(maxHome).toBeLessThan(15000);
	expect(minT).toBeGreaterThan(5); expect(maxT).toBeLessThan(35);
});

test("the heating answers the thermostat", () => {
	const cold = fakeHa(), w = new World(at(3), 5);
	w.adopt(cold.view); w.hvac.mode = "heat_cool";
	cold.s.set("climate.ecobee", { state: "heat_cool", attrs: { target_temp_low: 23, target_temp_high: 26 } });
	for (const R of Object.values(w.rooms)) R.T = 17;
	for (let i = 0; i < 360; i++) w.step(30, cold.view, cold.out);
	expect(w.hvac.heatW).toBeGreaterThan(0);
	const warmed = w.rooms["Living Room"].T;
	expect(warmed).toBeGreaterThan(17.5);
	const off = fakeHa(), v = new World(at(3), 5);
	off.s.set("climate.ecobee", { state: "off", attrs: {} });
	for (const R of Object.values(v.rooms)) R.T = 17;
	for (let i = 0; i < 360; i++) v.step(30, off.view, off.out);
	expect(v.hvac.heatW).toBe(0);
});

test("an open window cools the room, and a fault clears itself", () => {
	const ha = fakeHa(), w = new World(at(2), 9);
	w.adopt(ha.view); ha.s.set("climate.ecobee", { state: "off", attrs: {} });
	w.trigger("window_open", ha.out, "binary_sensor.bedroom_window");
	expect(ha.s.get("binary_sensor.bedroom_window")!.state).toBe("on");
	for (const R of Object.values(w.rooms)) R.T = 22;
	for (let i = 0; i < 240; i++) w.step(30, ha.view, ha.out);
	expect(w.rooms["Master Bedroom"].T).toBeLessThan(w.rooms["Living Room"].T);
	for (let i = 0; i < 400; i++) w.step(30, ha.view, ha.out);
	expect(w.faults.length).toBe(0);
	expect(ha.s.get("binary_sensor.bedroom_window")!.state).toBe("off");
});

test("energy counters only ever go up, and the whole-home figure includes what's on", () => {
	const ha = fakeHa(), w = new World(at(10), 3);
	w.adopt(ha.view); ha.s.set("switch.kettle", { state: "on", attrs: {} });
	let last = Number(ha.s.get("sensor.whole_home_energy")!.state);
	for (let i = 0; i < 200; i++) { w.step(30, ha.view, ha.out); const e = Number(ha.s.get("sensor.whole_home_energy")!.state); expect(e).toBeGreaterThanOrEqual(last); last = e; }
	expect(last).toBeGreaterThan(0);
});
