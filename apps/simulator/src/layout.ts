// The house as one flat plan, in metres. x runs left to right, z runs top (back of the house) to bottom (front garden).
// Both the world model (where people are, what a motion sensor can see) and the 3D viewer read this, so they never disagree.
import devices from "./devices.json" with { type: "json" };

export type Rect = { x0: number; x1: number; z0: number; z1: number };
export type Room = Rect & { name: string; indoor: boolean; color: number; door: { x: number; z: number } };

// A door point is where a resident crosses from the hallway (or garden) into the room.
export const ROOMS: Room[] = [
	{ name: "Master Bedroom", x0: 0, x1: 5.5, z0: 0, z1: 5, indoor: true, color: 0xcfd8ee, door: { x: 2.5, z: 5 } },
	{ name: "Bathroom", x0: 5.5, x1: 8.5, z0: 0, z1: 5, indoor: true, color: 0xcbe6ee, door: { x: 7, z: 5 } },
	{ name: "Kids Room", x0: 8.5, x1: 13, z0: 0, z1: 5, indoor: true, color: 0xf0dcc4, door: { x: 10.5, z: 5 } },
	{ name: "Home Office", x0: 13, x1: 17, z0: 0, z1: 5, indoor: true, color: 0xd9d3ee, door: { x: 15, z: 5 } },
	{ name: "Hallway", x0: 0, x1: 17, z0: 5, z1: 6.5, indoor: true, color: 0xe4e1d8, door: { x: 8.5, z: 5.75 } },
	{ name: "Living Room", x0: 0, x1: 8, z0: 6.5, z1: 12, indoor: true, color: 0xe6d9c4, door: { x: 4, z: 6.5 } },
	{ name: "Kitchen", x0: 8, x1: 12.5, z0: 6.5, z1: 12, indoor: true, color: 0xe3e8d2, door: { x: 10.25, z: 6.5 } },
	{ name: "Garage", x0: 12.5, x1: 17, z0: 6.5, z1: 12, indoor: true, color: 0xcfcfd2, door: { x: 14.75, z: 6.5 } },
	{ name: "Garden", x0: -3, x1: 20, z0: 12, z1: 18, indoor: false, color: 0xbfe0b0, door: { x: 10.25, z: 12 } },
];
export const room = (name: string): Room => {
	const found = ROOMS.find((r) => r.name === name);
	if (!found) throw new Error(`No room called ${name}`);
	return found;
};
export const centre = (r: Rect) => ({ x: (r.x0 + r.x1) / 2, z: (r.z0 + r.z1) / 2 });
export const HALL_Z = 5.75;
export const FRONT_DOOR = { x: 0, z: HALL_Z }; // west end of the hallway
export const OUTSIDE = { x: -3.5, z: HALL_Z }; // "away" residents leave and arrive here

/** How a simulated device behaves, as written in devices.json. */
export type Sim = {
	/** The Home Assistant helper this device's reading is written to. */
	helper?: string; base?: number; jitter?: number; lo?: number | null; hi?: number | null;
	/** The switch that has to be on for this device to draw power. */
	gate?: string; flip_mins?: number | null; hold_s?: number; dc?: string; accumulate?: boolean; per_day?: number;
};
export type Dev = { entity: string; name: string; room: string; kind: string; sim?: Sim };
export const DEVICES: readonly Dev[] = devices satisfies readonly Dev[];

/** "light.floor_lamp" is in the "light" domain. */
export const domainOf = (entity: string) => entity.split(".")[0] ?? "";

export type Placed = Dev & { x: number; y: number; z: number };

// Fixed spots for things that live in a particular place; everything else is spread by kind along the room.
const FIXED: Record<string, [number, number, number]> = {
	"lock.front_door_lock": [0.16, 1.15, HALL_Z + 0.62], "binary_sensor.front_door_contact": [0.05, 2.15, HALL_Z], "binary_sensor.doorbell_button": [0.15, 1.35, HALL_Z + 0.6],
	"lock.back_door_lock": [10.62, 1.15, 11.9], "lock.garage_side_door_lock": [16.82, 1.15, 11.9], "binary_sensor.garage_door_contact": [16.2, 2.15, 11.95],
	"binary_sensor.kitchen_window": [11.3, 1.2, 11.95], "binary_sensor.bedroom_window": [2.5, 1.3, 0.05], "binary_sensor.kids_room_window": [10.5, 1.3, 0.05],
	"binary_sensor.bathroom_leak_sensor": [7.4, 0.05, 4.2], "binary_sensor.kitchen_smoke_detector": [10.25, 2.3, 9.2], "binary_sensor.fridge_door": [8.4, 1.0, 7.0],
	"switch.tv_plug": [3.5, 0.9, 11.5], "switch.ev_charger": [16.7, 1.2, 8.5], "switch.fridge_freezer_plug": [8.2, 0.3, 7.2], "switch.water_heater": [6.0, 0.3, 0.4],
	"switch.garden_path_lights": [6, 0.2, 14], "switch.front_lawn_sprinkler": [3, 0.2, 14.5], "light.porch_light": [1, 2.2, 11.9],
};
const HEIGHT: Record<string, number> = { light: 2.35, fan: 2.4, switch: 0.35, lock: 1.2, bsensor: 1.4, sensor: 1.5, energy: 0.3, meter: 0.3 };
const heightOf = (kind: string) => HEIGHT[kind] ?? 1.4;

/** Every device in a place: pinned ones where they belong, the rest spaced along the room so they never overlap. */
export function place(): Placed[] {
	const out: Placed[] = [], slots = new Map<string, number>();
	for (const d of DEVICES) {
		const f = FIXED[d.entity];
		if (f) { out.push({ ...d, x: f[0], y: f[1], z: f[2] }); continue; }
		const found = ROOMS.find((x) => x.name === d.room);
		if (!found) { const i = slots.get("meters") ?? 0; slots.set("meters", i + 1); out.push({ ...d, x: 13 + (i % 5) * 0.5, y: 1.6, z: 6.7 }); continue; } // whole-home meters sit on the garage's inner wall
		const r = found, key = `${d.room}:${d.kind}`, i = slots.get(key) ?? 0;
		slots.set(key, i + 1);
		const w = r.x1 - r.x0, h = r.z1 - r.z0;
		if (d.kind === "light" || d.kind === "fan") {
			const row = Math.floor(i / 3), col = i % 3;
			out.push({ ...d, x: r.x0 + w * (0.25 + 0.25 * col), y: heightOf(d.kind), z: r.z0 + h * (0.3 + 0.25 * row) });
		} else if (d.kind === "switch") out.push({ ...d, x: r.x0 + 0.35 + i * 0.7, y: heightOf(d.kind), z: r.z1 - 0.35 });
		else if (d.kind === "sensor") out.push({ ...d, x: r.x1 - 0.3 - (i % 5) * 0.28, y: 1.5, z: r.z0 + 0.3 + Math.floor(i / 5) * 0.3 });
		else out.push({ ...d, x: r.x0 + w * 0.5 + i * 0.4, y: heightOf(d.kind), z: r.z0 + h * 0.5 });
	}
	return out;
}

/** The walk from anywhere to a room: out to the hallway, along it, in through the door. Rooms off the hallway share its centre line. */
export function route(fromRoom: string, to: string): { x: number; z: number }[] {
	if (fromRoom === to) return [];
	const pts: { x: number; z: number }[] = [];
	const toHall = (name: string) => {
		const r = room(name);
		if (name === "Hallway") return;
		if (name === "Garden") return;
		pts.push({ x: r.door.x, z: r.z0 < 5 ? 4.6 : r.z0 + 0.4 });
		pts.push({ x: r.door.x, z: HALL_Z });
	};
	if (fromRoom === "Away") pts.push(OUTSIDE, { x: FRONT_DOOR.x - 0.2, z: HALL_Z }, { x: 1, z: HALL_Z });
	else if (fromRoom === "Garden") pts.push({ x: room("Kitchen").door.x, z: 12.2 }, { x: room("Kitchen").door.x, z: 11.2 }, { x: room("Kitchen").door.x, z: 6.9 }, { x: room("Kitchen").door.x, z: HALL_Z });
	else if (fromRoom !== "Hallway") toHall(fromRoom);
	if (to === "Away") pts.push({ x: 1, z: HALL_Z }, { x: FRONT_DOOR.x - 0.2, z: HALL_Z }, OUTSIDE);
	else if (to === "Garden") { const k = room("Kitchen").door.x; pts.push({ x: k, z: HALL_Z }, { x: k, z: 6.9 }, { x: k, z: 11.2 }, { x: k, z: 12.4 }, centre(room("Garden"))); }
	else if (to !== "Hallway") { const r = room(to); pts.push({ x: r.door.x, z: HALL_Z }, { x: r.door.x, z: r.z0 < 5 ? 4.6 : r.z0 + 0.5 }, centre(r)); }
	else pts.push({ x: 8.5, z: HALL_Z });
	return pts;
}

// ------------------------------------------------------------------ where people sit, lie and stand
export type Pose = "stand" | "sit" | "lie";
export type Spot = { x: number; z: number; pose: Pose };
const SOFA: Record<string, number> = { Maya: 2.2, Dev: 3.0, Kiran: 3.8 };
const STOOL: Record<string, number> = { Maya: 9.6, Dev: 10.4, Kiran: 11.2, Nani: 10.0 };
/** The exact place an activity happens, or null when the person simply moves about the room. */
export function spot(roomName: string, act: string, name: string): Spot | null {
	if (act === "sleep") {
		if (roomName === "Master Bedroom") return { x: name === "Maya" ? 1.7 : 2.8, z: 1.8, pose: "lie" };
		if (roomName === "Kids Room") return { x: 11.2, z: 1.5, pose: "lie" };
		if (roomName === "Home Office") return { x: 15.6, z: 3.7, pose: "lie" };
	}
	if (roomName === "Living Room" && ["tv", "dinner", "nap"].includes(act)) return name === "Nani" ? { x: 1.1, z: 10.2, pose: act === "nap" ? "lie" : "sit" } : { x: SOFA[name] ?? 3, z: 11.2, pose: "sit" };
	if (roomName === "Kitchen" && ["breakfast", "lunch"].includes(act)) return { x: STOOL[name] ?? 10, z: 8.75, pose: "sit" };
	if (roomName === "Kitchen" && act === "cook") return { x: name === "Dev" ? 11.0 : 9.6, z: 7.55, pose: "stand" };
	if (roomName === "Home Office" && act === "work") return { x: 15, z: 2.05, pose: "sit" };
	if (roomName === "Kids Room" && act === "homework") return { x: 9.4, z: 1.3, pose: "sit" };
	return null;
}
