// The 3D house. It draws what the simulator says is happening and sends your clicks back to Home Assistant.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Room = { name: string; x0: number; x1: number; z0: number; z1: number; indoor: boolean; color: number; door: { x: number; z: number } };
type Dev = { entity: string; name: string; room: string; kind: string; x: number; y: number; z: number };
type Snap = {
	t: number; hour: number; speed: number; paused: boolean; sun: number; cloud: number; outdoor: number; wind: number; humidity: number;
	power: { home: number; solar: number; grid: number }; hvac: { mode: string; low: number; high: number; heatW: number; coolW: number };
	rooms: Record<string, { T: number; hum: number; co2: number }>;
	people: { name: string; x: number; z: number; room: string; act: string; walking: boolean; pose: "stand" | "sit" | "lie" }[];
	devices: Record<string, { s: string; b: number | null; pct: number | null }>; watts: Record<string, number>;
	covers: Record<string, { s: string; pos: number; tilt: number | null }>; media: Record<string, string>; climate: { mode: string; low: number; high: number; fan: string } | null;
	faults: { id: number; kind: string; label: string; left: number }[]; events: string[]; thermostat: string | null;
};

const $ = (id: string) => document.getElementById(id)!;
const layout = (await (await fetch("/api/layout")).json()) as { rooms: Room[]; devices: Dev[]; faults: { kind: string; label: string }[] };
const ROOMS = layout.rooms, DEVS = layout.devices;
let snap: Snap | null = null;
let showLabels = true, roofOn = false;

// ------------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$("app").appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
camera.position.set(23, 20, 27);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(8.5, 0, 8);
controls.maxPolarAngle = Math.PI / 2.05; controls.minDistance = 8; controls.maxDistance = 90; controls.enableDamping = true;
const hemi = new THREE.HemisphereLight(0xcfe3ff, 0x4a5a40, 0.6); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 120 }); scene.add(sun, sun.target); sun.target.position.set(8.5, 0, 8);
const sunBall = new THREE.Mesh(new THREE.SphereGeometry(1.6, 16, 16), new THREE.MeshBasicMaterial({ color: 0xfff1b0 })); scene.add(sunBall);
const moonBall = new THREE.Mesh(new THREE.SphereGeometry(1.1, 16, 16), new THREE.MeshBasicMaterial({ color: 0xdfe6ff })); scene.add(moonBall);

const std = (color: number, o: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.02, ...o });
function box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, parent: THREE.Object3D = scene, o: Partial<THREE.MeshStandardMaterialParameters> = {}) {
	const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), std(color, o)); m.position.set(x, y + h / 2, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}

// ------------------------------------------------------------------ ground, floors, walls
const ground = new THREE.Mesh(new THREE.PlaneGeometry(140, 140), std(0x7fb26a)); ground.rotation.x = -Math.PI / 2; ground.position.set(8.5, -0.02, 8); ground.receiveShadow = true; scene.add(ground);
const floors = new Map<string, THREE.Mesh>();
const GAPS: Record<string, { edge: "n" | "s" | "w" | "e"; at: number; w?: number }[]> = {
	"Master Bedroom": [{ edge: "s", at: 2.5 }], Bathroom: [{ edge: "s", at: 7 }], "Kids Room": [{ edge: "s", at: 10.5 }], "Home Office": [{ edge: "s", at: 15 }],
	Hallway: [{ edge: "w", at: 5.75 }], "Living Room": [{ edge: "n", at: 4 }], Kitchen: [{ edge: "n", at: 10.25 }, { edge: "s", at: 10 }], Garage: [{ edge: "n", at: 14.75 }, { edge: "s", at: 16.2 }, { edge: "s", at: 14, w: 1.25 }],
};
const WALL = 0.07, EXT = 2.4, INT = 1.15;
const wallMat = (ext: boolean) => new THREE.MeshStandardMaterial({ color: 0xf2f4fa, roughness: 0.9, transparent: true, opacity: ext ? 0.22 : 0.6, depthWrite: ext ? false : true });
function wall(parent: THREE.Object3D, x0: number, z0: number, x1: number, z1: number, h: number, ext: boolean) {
	const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.05) return;
	const m = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(x1 - x0) > Math.abs(z1 - z0) ? len : WALL, h, Math.abs(x1 - x0) > Math.abs(z1 - z0) ? WALL : len), wallMat(ext));
	m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2); m.castShadow = !ext; m.receiveShadow = true; parent.add(m);
}
const house = new THREE.Group(); scene.add(house);
for (const r of ROOMS) {
	if (!r.indoor) continue;
	const f = new THREE.Mesh(new THREE.BoxGeometry(r.x1 - r.x0 - 0.04, 0.12, r.z1 - r.z0 - 0.04), std(r.color)); f.position.set((r.x0 + r.x1) / 2, 0.06, (r.z0 + r.z1) / 2); f.receiveShadow = true; house.add(f); floors.set(r.name, f);
	const i = 0.035, gaps = GAPS[r.name] ?? [];
	const edges: { edge: "n" | "s" | "w" | "e"; a: [number, number]; b: [number, number]; ext: boolean }[] = [
		{ edge: "n", a: [r.x0 + i, r.z0 + i], b: [r.x1 - i, r.z0 + i], ext: r.z0 === 0 }, { edge: "s", a: [r.x0 + i, r.z1 - i], b: [r.x1 - i, r.z1 - i], ext: r.z1 === 12 },
		{ edge: "w", a: [r.x0 + i, r.z0 + i], b: [r.x0 + i, r.z1 - i], ext: r.x0 === 0 }, { edge: "e", a: [r.x1 - i, r.z0 + i], b: [r.x1 - i, r.z1 - i], ext: r.x1 === 17 },
	];
	for (const e of edges) {
		const horiz = e.edge === "n" || e.edge === "s", gs = gaps.filter((g) => g.edge === e.edge).sort((p, q) => p.at - q.at);
		let cur = horiz ? e.a[0] : e.a[1]; const end = horiz ? e.b[0] : e.b[1];
		const seg = (p: number, q: number) => (horiz ? wall(house, p, e.a[1], q, e.a[1], e.ext ? EXT : INT, e.ext) : wall(house, e.a[0], p, e.a[0], q, e.ext ? EXT : INT, e.ext));
		for (const g of gs) { const hw = g.w ?? 0.55; seg(cur, g.at - hw); cur = g.at + hw; }
		seg(cur, end);
	}
}
// the roof is one thin slab (off by default so you can see in); the solar array stands in the garden
const roof = new THREE.Group(); scene.add(roof); const array = new THREE.Group(); scene.add(array);
const slab = new THREE.Mesh(new THREE.BoxGeometry(17.4, 0.12, 12.4), new THREE.MeshStandardMaterial({ color: 0xcfd3e0, transparent: true, opacity: 0.14, roughness: 0.8, depthWrite: false })); slab.position.set(8.5, EXT + 0.1, 6); roof.add(slab);
const panelMat: THREE.MeshStandardMaterial[] = [];
for (let c = 0; c < 6; c++) for (let rw = 0; rw < 2; rw++) {
	const m = new THREE.MeshStandardMaterial({ color: 0x15244a, emissive: 0x3a6dff, emissiveIntensity: 0, roughness: 0.3, metalness: 0.4 });
	const p = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 1.0), m); p.position.set(5 + c * 1.65, 0.55 + rw * 0.0, 14.6 + rw * 1.15); p.rotation.x = -0.45; array.add(p); panelMat.push(m); if (c === 0) box(0.1, 0.5, 0.1, 0x888c99, 5 + c * 1.65, 0, 14.6 + rw * 1.15, array);
}

// ------------------------------------------------------------------ furniture and garden
const FURN = new THREE.Group(); scene.add(FURN);
const f = (w: number, h: number, d: number, c: number, x: number, z: number, y = 0.12) => box(w, h, d, c, x, y, z, FURN);
f(2.6, 0.5, 0.9, 0x7a8ca8, 3, 11.2); f(0.9, 0.5, 1.8, 0x7a8ca8, 1.1, 10.1); f(1.2, 0.35, 0.7, 0x8d6e50, 3, 9.6); f(2.2, 0.01, 1.6, 0xb6a58c, 3, 9.8, 0.13);
const tvScreen = box(1.7, 0.95, 0.06, 0x101018, 3.6, 0.55, 6.85, FURN, { emissive: 0x4a6aff, emissiveIntensity: 0 }); f(2.0, 0.4, 0.4, 0x6b5640, 3.6, 6.85);
f(3.4, 0.9, 0.7, 0xc9ccd4, 10.25, 7.0); f(1.8, 0.95, 1.0, 0xbfc4cc, 10.25, 9.6); f(0.8, 1.8, 0.7, 0xdfe3ea, 8.5, 7.1);
f(2.0, 0.5, 2.3, 0x9a7fb0, 2.2, 1.8); f(1.4, 1.9, 0.6, 0x8d6e50, 4.9, 0.5); f(1.2, 0.4, 1.8, 0x7fb09a, 11.2, 1.5); f(1.0, 0.8, 0.5, 0x8d6e50, 9.4, 0.6);
f(2.0, 0.75, 0.9, 0x8d6e50, 15, 1.2); f(0.6, 0.6, 0.6, 0x3a3f58, 15, 2.3); f(1.6, 0.6, 0.8, 0xe8ecf2, 6.4, 1.4); f(0.9, 0.9, 0.5, 0xdfe6ee, 7.8, 3.4); f(1.2, 0.3, 0.5, 0x8d6e50, 6, 5.5);
const car = new THREE.Group(); FURN.add(car); car.position.set(14.8, 0, 9.4);
box(2.0, 0.6, 4.0, 0x2d3a64, 0, 0.25, 0, car, { metalness: 0.5, roughness: 0.4 }); box(1.7, 0.5, 2.0, 0x1b2342, 0, 0.85, -0.2, car, { metalness: 0.4 });
const chargeGlow = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.8, 40), new THREE.MeshBasicMaterial({ color: 0x4dffb8, transparent: true, opacity: 0, side: THREE.DoubleSide })); chargeGlow.rotation.x = -Math.PI / 2; chargeGlow.position.set(14.8, 0.15, 9.4); scene.add(chargeGlow);
const treeAt = (x: number, z: number, s = 1) => { const t = new THREE.Group(); box(0.35, 1.6 * s, 0.35, 0x6b4a2f, 0, 0, 0, t); const c = new THREE.Mesh(new THREE.ConeGeometry(1.2 * s, 3 * s, 8), std(0x2f7a4a)); c.position.y = 3 * s; c.castShadow = true; t.add(c); t.position.set(x, 0, z); scene.add(t); };
const TREES: [x: number, z: number, scale: number][] = [[-2, 14.5, 1.1], [3.5, 16.5, 0.9], [14, 15.5, 1.2], [19, 13, 1], [-2, 2, 1.2], [19, 2, 1.3], [8, 17.5, 1]];
for (const [x, z, s] of TREES) treeAt(x, z, s);
for (let i = 0; i < 7; i++) box(0.9, 0.05, 0.5, 0xb8b2a3, 6 + i * 0.6, 0, 12.8 + i * 0.5, scene);
const spray = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.4, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0, side: THREE.DoubleSide })); spray.position.set(3, 0.8, 14.5); scene.add(spray);
const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.75 })); puddle.rotation.x = -Math.PI / 2; puddle.position.set(7.4, 0.14, 4.2); puddle.visible = false; scene.add(puddle);

// ------------------------------------------------------------------ doors that open and close
// every door has a leaf that swings; it opens when its contact sensor says so, or when someone walks through it
type DoorRig = { pivot: THREE.Group; open: number; contact?: number; lock: string; cx: number; cz: number; sign: number };
const doors: Record<string, DoorRig> = {};
function door(key: string, lock: string, hingeX: number, hingeZ: number, along: "x" | "z", width: number, cx: number, cz: number, color = 0x8d6e50, sign = 1) {
	const pivot = new THREE.Group(); pivot.position.set(hingeX, 0.12, hingeZ); scene.add(pivot);
	if (along === "z") { box(0.07, 2.0, width, color, 0, 0, width / 2, pivot); box(0.04, 0.05, 0.35, 0xcfd3e0, 0.06, 1.0, width - 0.2, pivot); }
	else { box(width, 2.0, 0.07, color, width / 2, 0, 0, pivot); box(0.35, 0.05, 0.04, 0xcfd3e0, width - 0.2, 1.0, 0.06, pivot); }
	doors[key] = { pivot, open: 0, lock, cx, cz, sign };
}
door("binary_sensor.front_door_contact", "lock.front_door_lock", 0.04, 5.25, "z", 1.0, 0, 5.75, 0x8d6e50, -1);
door("door.back", "lock.back_door_lock", 9.5, 11.97, "x", 1.0, 10, 12, 0x7a5c44, 1);
door("binary_sensor.garage_door_contact", "lock.garage_side_door_lock", 15.7, 11.97, "x", 0.95, 16.2, 12, 0x6a707f, 1);
// windows slide sideways by how far open they are; the same pane answers to a sensor or to a cover
type Win = { mesh: THREE.Mesh; base: THREE.Vector3; axis: "x" | "z"; open: number; ids: string[] };
const wins: Win[] = [];
const win = (ids: string[], x: number, z: number, axis: "x" | "z") => {
	const w = new THREE.Mesh(new THREE.BoxGeometry(axis === "x" ? 1.3 : 0.04, 0.9, axis === "x" ? 0.04 : 1.3), new THREE.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.5, roughness: 0.1 }));
	w.position.set(x, 1.4, z); scene.add(w); wins.push({ mesh: w, base: w.position.clone(), axis, open: 0, ids });
	box(axis === "x" ? 1.5 : 0.05, 1.1, axis === "x" ? 0.05 : 1.5, 0xe8ecf4, x, 0.85, z, scene, { transparent: true, opacity: 0.35 });
};
win(["binary_sensor.bedroom_window"], 2.5, 0.06, "x"); win(["binary_sensor.kids_room_window"], 10.5, 0.06, "x");
win(["binary_sensor.kitchen_window", "cover.kitchen_window"], 11.3, 11.94, "x"); win(["cover.living_room_window"], 5.6, 11.94, "x"); win(["cover.hall_window"], 16.94, 5.75, "z");
// the garage door rolls up; the pergola's slats turn
const garageDoor = box(2.4, 2.1, 0.06, 0xaab0c0, 14, 0.12, 11.97, scene, { metalness: 0.3, roughness: 0.5 }); let garageOpen = 0;
const pergola = new THREE.Group(); scene.add(pergola); pergola.position.set(10.25, 2.3, 15);
const POSTS: [x: number, z: number][] = [[-2, -1.4], [2, -1.4], [-2, 1.4], [2, 1.4]];
for (const [px, pz] of POSTS) box(0.12, 2.3, 0.12, 0x8d6e50, px, -2.3, pz, pergola);
const slats: THREE.Mesh[] = [];
for (let i = 0; i < 9; i++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.04, 0.26), std(0x9a7a58)); sl.position.set(0, 0, -1.4 + i * 0.35); sl.castShadow = true; pergola.add(sl); slats.push(sl); }
box(2.2, 0.08, 1.2, 0x8d6e50, 10.25, 0.12, 15.6, scene); box(0.5, 0.45, 0.5, 0x8d6e50, 9.2, 0.12, 15.6, scene); box(0.5, 0.45, 0.5, 0x8d6e50, 11.3, 0.12, 15.6, scene);

// the wall thermostat in the hallway, drawn on a small canvas so it shows real numbers
const tcv = document.createElement("canvas"); tcv.width = 256; tcv.height = 160; const tctx = tcv.getContext("2d")!; const ttex = new THREE.CanvasTexture(tcv);
const thermo = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.31), new THREE.MeshBasicMaterial({ map: ttex })); thermo.position.set(8.5, 1.5, 5.045); thermo.rotation.y = 0; scene.add(thermo);
box(0.56, 0.37, 0.03, 0x2a2f45, 8.5, 1.335, 5.02, scene);
let thermoKey = "";
function drawThermo(cur: number, mode: string, low: number | undefined, high: number | undefined, action: string) {
	const key = `${cur.toFixed(1)}|${mode}|${low}|${high}|${action}`; if (key === thermoKey) return; thermoKey = key;
	tctx.fillStyle = "#0d1226"; tctx.fillRect(0, 0, 256, 160);
	tctx.fillStyle = action === "heating" ? "#ff9a5c" : action === "cooling" ? "#6ab6ff" : "#eef0fa"; tctx.font = "bold 74px system-ui"; tctx.textAlign = "center"; tctx.fillText(`${cur.toFixed(1)}°`, 128, 84);
	tctx.fillStyle = "#97a1c0"; tctx.font = "22px system-ui"; tctx.fillText(mode === "off" ? "Off" : `${low ?? "–"}° to ${high ?? "–"}°`, 128, 118); tctx.fillText(action === "idle" ? mode.replace("_", " ") : action, 128, 146);
	ttex.needsUpdate = true;
}

// clouds drift with the wind; more of them as the sky clouds over
const cloudGroup = new THREE.Group(); scene.add(cloudGroup);
const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, transparent: true, opacity: 0.92 });
const clouds: THREE.Group[] = [];
for (let i = 0; i < 9; i++) { const g = new THREE.Group(); for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(2 + (k % 3) * 0.8, 10, 8), cloudMat); p.position.set(k * 2.2 - 4, (k % 2) * 0.6, (k % 3) * 1.2); p.scale.y = 0.55; g.add(p); } g.position.set(-60 + i * 18 + (i % 3) * 5, 30 + (i % 4) * 3, -20 + (i * 17) % 70); cloudGroup.add(g); clouds.push(g); }

// a soft glow around a lit bulb
const glowTex = (() => { const c = document.createElement("canvas"); c.width = c.height = 64; const x = c.getContext("2d")!; const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, "rgba(255,225,160,1)"); g.addColorStop(0.35, "rgba(255,200,110,.45)"); g.addColorStop(1, "rgba(255,190,90,0)"); x.fillStyle = g; x.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();

// ceiling vents glow when the heating or cooling is running
const vents = new Map<string, THREE.Mesh>();
for (const r of ROOMS) if (r.indoor && r.name !== "Garage" && r.name !== "Hallway") { const v = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.04, 0.7), new THREE.MeshStandardMaterial({ color: 0xcfd3e0, emissive: 0x000000 })); v.position.set((r.x0 + r.x1) / 2 + 0.9, 2.38, (r.z0 + r.z1) / 2 - 0.6); scene.add(v); vents.set(r.name, v); }

// ------------------------------------------------------------------ devices
type Handle = { dev: Dev; obj: THREE.Object3D; mat?: THREE.MeshStandardMaterial; spin?: THREE.Object3D; glow?: THREE.Sprite; speed: number };
const handles = new Map<string, Handle>(); const pick: THREE.Object3D[] = [];
const roomLight = new Map<string, THREE.PointLight>();
for (const r of ROOMS) if (r.indoor) { const l = new THREE.PointLight(0xffd9a0, 0, 9, 1.6); l.position.set((r.x0 + r.x1) / 2, 2.1, (r.z0 + r.z1) / 2); scene.add(l); roomLight.set(r.name, l); }
const gardenLight = new THREE.PointLight(0xffe0b0, 0, 12, 1.5); gardenLight.position.set(8, 2, 14); scene.add(gardenLight);
for (const d of DEVS) {
	let obj: THREE.Object3D | undefined, mat: THREE.MeshStandardMaterial | undefined, spin: THREE.Object3D | undefined, glow: THREE.Sprite | undefined;
	if (d.kind === "light") {
		mat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc866, emissiveIntensity: 0 }); obj = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat);
		glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 })); glow.position.set(d.x, d.y, d.z); scene.add(glow);
	}
	else if (d.kind === "switch") { mat = new THREE.MeshStandardMaterial({ color: 0x9aa3bd, emissive: 0x2cff9a, emissiveIntensity: 0 }); obj = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat); }
	else if (d.kind === "fan") { const g = new THREE.Group(); mat = new THREE.MeshStandardMaterial({ color: 0xd8def0, emissive: 0x7fd0ff, emissiveIntensity: 0, transparent: true }); for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.02, 0.16), mat); b.rotation.y = (k * Math.PI) / 2; b.position.set(Math.cos((k * Math.PI) / 2) * 0.42, 0, -Math.sin((k * Math.PI) / 2) * 0.42); g.add(b); } obj = g; spin = g; }
	else if (d.kind === "lock") {
		const g = new THREE.Group(); mat = new THREE.MeshStandardMaterial({ color: 0x50d890, emissive: 0x50d890, emissiveIntensity: 0.7 });
		const alongZ = d.entity === "lock.front_door_lock";
		const plate = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 0.08 : 0.2, 0.32, alongZ ? 0.2 : 0.08), std(0x2a2f45)); g.add(plate);
		const bolt = new THREE.Mesh(new THREE.BoxGeometry(alongZ ? 0.06 : 0.22, 0.06, alongZ ? 0.22 : 0.06), std(0xdfe3ea, { metalness: 0.7, roughness: 0.3 })); bolt.name = "bolt"; bolt.position.y = 0.04; g.add(bolt);
		const led = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), mat); led.position.set(alongZ ? 0.05 : 0, -0.1, alongZ ? 0 : 0.05); g.add(led);
		g.userData.alongZ = alongZ; obj = g;
	}
	else if (d.kind === "bsensor") { mat = new THREE.MeshStandardMaterial({ color: 0x6b7596, emissive: 0xff4f6d, emissiveIntensity: 0 }); obj = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), mat); }
	if (!obj) continue;
	obj.position.set(d.x, d.y, d.z); obj.userData.entity = d.entity; scene.add(obj);
	if (obj instanceof THREE.Group) obj.traverse((c) => (c.userData.entity = d.entity));
	if (["light", "switch", "fan", "lock"].includes(d.kind)) pick.push(obj);
	handles.set(d.entity, { dev: d, obj, mat, spin, glow, speed: 0 });
}
const rings = new Map<string, THREE.Mesh>();
for (const d of DEVS.filter((x) => x.kind === "bsensor" && /motion|occupancy/.test(x.entity))) { const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 32), new THREE.MeshBasicMaterial({ color: 0x4de1ff, transparent: true, opacity: 0, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set(d.x, 0.2, d.z); scene.add(m); rings.set(d.entity, m); }
// stools at the kitchen island
for (const x of [9.6, 10.0, 10.4, 11.2]) { const st = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.55, 14), std(0x6b5640)); st.position.set(x, 0.4, 8.75); st.castShadow = true; scene.add(st); }
// the big loads wear a small tag while they are running
const powerTags = new Map<string, HTMLElement>();

// ------------------------------------------------------------------ people
const COLORS: Record<string, number> = { Maya: 0xff7b8f, Dev: 0x7f9bff, Kiran: 0xffc247, Nani: 0x5fd0a0 };
type Pair = [left: THREE.Group, right: THREE.Group];
type Figure = { g: THREE.Group; body: THREE.Group; legs: Pair; arms: Pair; target: THREE.Vector3; label: HTMLElement; facing: number; k: { bodyY: number; legX: number; lie: number; armX: number }; pose: string; walking: boolean };
const folk = new Map<string, Figure>();
function person(name: string): Figure {
	const g = new THREE.Group(), body = new THREE.Group(); g.add(body);
	const c = COLORS[name] ?? 0xffffff, kid = name === "Kiran", sc = kid ? 0.72 : name === "Nani" ? 0.95 : 1;
	g.scale.setScalar(sc);
	const skin = std(0xf0cfae), cloth = std(c), trousers = std(0x2f3550);
	const torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.6, 0.24), cloth); torso.position.y = 1.2; torso.castShadow = true; body.add(torso);
	const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 14, 12), skin); head.position.y = 1.64; head.castShadow = true; body.add(head);
	const hair = new THREE.Mesh(new THREE.SphereGeometry(0.175, 14, 12, 0, Math.PI * 2, 0, Math.PI / 2), std(name === "Nani" ? 0xe6e6ee : 0x2a2018)); hair.position.y = 1.66; hair.rotation.x = -0.25; body.add(hair);
	const limbs = (sx: -1 | 1) => {
		const leg = new THREE.Group(); leg.position.set(sx * 0.11, 0.9, 0); const lm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.85, 0.16), trousers); lm.position.y = -0.425; lm.castShadow = true; leg.add(lm); body.add(leg);
		const arm = new THREE.Group(); arm.position.set(sx * 0.28, 1.46, 0); const am = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.58, 0.12), cloth); am.position.y = -0.29; am.castShadow = true; arm.add(am); body.add(arm);
		return { leg, arm };
	};
	const left = limbs(-1), right = limbs(1);
	const legs: Pair = [left.leg, right.leg], arms: Pair = [left.arm, right.arm];
	scene.add(g); const el = document.createElement("div"); el.className = "label who"; el.textContent = name; $("labels").appendChild(el);
	return { g, body, legs, arms, target: new THREE.Vector3(), label: el, facing: 0, k: { bodyY: 0, legX: 0, lie: 0, armX: 0 }, pose: "stand", walking: false };
}

// ------------------------------------------------------------------ room labels
const roomLabels = new Map<string, HTMLElement>();
for (const r of ROOMS) { const el = document.createElement("div"); el.className = "label"; $("labels").appendChild(el); roomLabels.set(r.name, el); }
const proj = new THREE.Vector3();
function placeLabel(el: HTMLElement, x: number, y: number, z: number, show = true) {
	proj.set(x, y, z).project(camera);
	if (!show || proj.z > 1) { el.style.display = "none"; return; }
	el.style.display = ""; el.style.left = `${((proj.x + 1) / 2) * innerWidth}px`; el.style.top = `${((1 - proj.y) / 2) * innerHeight}px`;
}

// ------------------------------------------------------------------ the heads-up display
const SPEEDS = [1, 10, 60, 300, 1200];
const ctl = $("ctl");
const post = (path: string, body: unknown) => fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const btn = (label: string, run: () => void, id?: string) => { const b = document.createElement("button"); b.textContent = label; b.onclick = run; if (id) b.id = id; ctl.appendChild(b); return b; };
for (const s of SPEEDS) btn(s === 1 ? "Real time" : `${s}×`, () => post("/api/speed", { speed: s }), `sp${s}`);
btn("Pause", () => post("/api/speed", { paused: !snap?.paused }), "pause");
btn("Roof", () => { roofOn = !roofOn; roof.visible = roofOn; $("roofb").classList.toggle("on", roofOn); }, "roofb");
btn("Labels", () => { showLabels = !showLabels; $("lab").classList.toggle("on", showLabels); }, "lab");
$("lab").classList.add("on"); roof.visible = roofOn;
for (const f of layout.faults) { const b = document.createElement("button"); b.textContent = f.label; b.onclick = () => post("/api/fault", { kind: f.kind }); $("faultBtns").appendChild(b); }

const fmtW = (w: number) => (Math.abs(w) >= 1000 ? `${(w / 1000).toFixed(2)} kW` : `${Math.round(w)} W`);
function hud(s: Snap) {
	const d = new Date(s.t);
	$("time").textContent = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
	$("date").textContent = d.toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" }) + (s.speed > 1 ? `  ·  ${s.speed}× speed` : "");
	$("wx").innerHTML = `<span>Outside</span><b>${s.outdoor.toFixed(1)}°C</b><span>Humidity</span><b>${Math.round(s.humidity)}%</b><span>Cloud</span><b>${Math.round(s.cloud * 100)}%</b><span>Wind</span><b>${Math.round(s.wind)} km/h</b><span>Thermostat</span><b>${s.thermostat ?? "—"} ${s.thermostat && s.thermostat !== "off" ? `${s.hvac.low}–${s.hvac.high}°` : ""}</b>`;
	for (const sp of SPEEDS) $(`sp${sp}`).classList.toggle("on", !s.paused && s.speed === sp);
	$("pause").classList.toggle("on", s.paused); $("pause").textContent = s.paused ? "Resume" : "Pause";
	$("peopleList").innerHTML = s.people.map((p) => `<div><span class="who"><i style="background:#${(COLORS[p.name] ?? 0xffffff).toString(16).padStart(6, "0")}"></i>${p.name}</span><span>${p.room === "Away" ? "Away" : p.walking ? `Walking to ${p.room}` : `${p.room}, ${p.act}`}</span></div>`).join("");
	const max = Math.max(4500, s.power.home, s.power.solar);
	const bar = (label: string, w: number, col: string) => `<div class="row"><span>${label}</span><b>${fmtW(w)}</b></div><div class="bar"><div style="width:${Math.min(100, (Math.abs(w) / max) * 100)}%;background:${col}"></div></div>`;
	$("powerRows").innerHTML = bar("Home is using", s.power.home, "#ffc247") + bar("Solar is making", s.power.solar, "#5fd0a0") + bar(s.power.grid >= 0 ? "Drawing from the grid" : "Sending to the grid", s.power.grid, s.power.grid >= 0 ? "#ff7b8f" : "#7f9bff") + (s.hvac.heatW + s.hvac.coolW > 0 ? `<div class="row"><span>${s.hvac.heatW > 0 ? "Heating" : "Cooling"}</span><b>${fmtW(s.hvac.heatW + s.hvac.coolW)}</b></div>` : "");
	$("active").innerHTML = s.faults.map((f) => `${f.label} <span style="color:var(--mut)">(${f.left} min left)</span>`).join("<br>");
	$("events").textContent = s.events.at(-1) ?? "Quiet at home.";
}

// ------------------------------------------------------------------ keeping the scene in step with the simulator
const skyDay = new THREE.Color(0x9cc8ff), skyDusk = new THREE.Color(0xf0a078), skyNight = new THREE.Color(0x0a1030);
const tmp = new THREE.Color(), cold = new THREE.Color(0x6aa8ff), hot = new THREE.Color(0xff8a5c), warmDim = new THREE.Color(0xff9a48), warmFull = new THREE.Color(0xffe2b8);
const open01 = (s: Snap, id: string) => { const c = s.covers[id]; if (c) return c.s === "closed" ? 0 : Math.min(1, c.pos / 100); return s.devices[id]?.s === "on" ? 1 : 0; };
let tvPlaying = false;
function apply(s: Snap) {
	const h = s.hour, a = ((h - 6) / 12) * Math.PI, day = s.sun;
	sun.position.set(8.5 + Math.cos(a) * 38, Math.max(2, Math.sin(a) * 42), 8 - Math.sin(a) * 6 + 12);
	sun.intensity = 0.15 + day * 1.7 * (1 - 0.55 * s.cloud); hemi.intensity = 0.28 + day * 0.7;
	sunBall.position.copy(sun.position).multiplyScalar(1.5); sunBall.visible = day > 0.01 && Math.sin(a) > 0;
	const na = a + Math.PI; moonBall.position.set(8.5 + Math.cos(na) * 55, Math.max(6, Math.sin(na) * 50), 8); moonBall.visible = day < 0.05;
	const twilight = h > 5.5 && h < 7.2 || h > 17.8 && h < 19.4;
	scene.background = tmp.clone().copy(skyNight).lerp(twilight ? skyDusk : skyDay, Math.min(1, day * 3 + (twilight ? 0.6 : 0)));
	scene.fog = new THREE.Fog((scene.background as THREE.Color).getHex(), 90, 260);
	ground.material.color.setHex(day > 0.05 ? 0x7fb26a : 0x35553a);
	cloudMat.color.setHex(day > 0.08 ? 0xffffff : 0x3a4262); cloudMat.opacity = 0.35 + 0.6 * s.cloud;
	clouds.forEach((c, i) => (c.visible = i < Math.round(s.cloud * 9) + 1));
	for (const [n, fl] of floors) { const R = s.rooms[n]; if (!R) continue; const k = Math.min(1, Math.max(0, (R.T - 17) / 10)); const base = new THREE.Color(ROOMS.find((r) => r.name === n)!.color); (fl.material as THREE.MeshStandardMaterial).color.copy(base).lerp(k < 0.5 ? cold : hot, Math.abs(k - 0.5) * 0.9); }
	const lightSum = new Map<string, number>(), lightWarm = new Map<string, number>();
	for (const [id, hd] of handles) {
		const st = s.devices[id]; if (!st) continue; const on = st.s === "on" || st.s === "unlocked"; const d = hd.dev;
		if (d.kind === "light" && hd.mat) {
			const br = on ? Math.max(0.08, (st.b ?? 200) / 255) : 0;
			hd.mat.emissiveIntensity = on ? 0.3 + br * 2.7 : 0; hd.mat.emissive.copy(warmDim).lerp(warmFull, br);
			if (hd.glow) { (hd.glow.material as THREE.SpriteMaterial).opacity = br * 0.95; hd.glow.scale.setScalar(on ? 0.5 + br * 1.0 : 0.1); }
			lightSum.set(d.room, (lightSum.get(d.room) ?? 0) + br); lightWarm.set(d.room, Math.max(lightWarm.get(d.room) ?? 0, br));
		}
		else if (d.kind === "switch" && hd.mat) {
			hd.mat.emissiveIntensity = on ? 0.9 : 0;
			if (d.entity === "switch.front_lawn_sprinkler") (spray.material as THREE.MeshBasicMaterial).opacity = on ? 0.35 : 0;
			if (d.entity === "switch.garden_path_lights") lightSum.set("Garden", (lightSum.get("Garden") ?? 0) + (on ? 0.6 : 0));
		}
		else if (d.kind === "fan" && hd.mat) { const pct = on ? (st.pct ?? 100) : 0; hd.mat.emissiveIntensity = on ? 0.4 : 0; hd.mat.opacity = pct > 80 ? 0.55 : 0.95; hd.speed = (pct / 100) * 16; }
		else if (d.kind === "lock" && hd.mat) { hd.mat.color.setHex(on ? 0xff7b8f : 0x50d890); hd.mat.emissive.setHex(on ? 0xff7b8f : 0x50d890); hd.speed = on ? 1 : 0; /* 1 = bolt drawn back (unlocked) */ }
		else if (d.kind === "bsensor" && hd.mat) {
			hd.mat.emissiveIntensity = on ? 1.6 : 0;
			if (doors[id]) doors[id].contact = on ? 1 : 0;
			if (id === "binary_sensor.bathroom_leak_sensor") puddle.visible = on;
		}
		if (d.entity === "light.porch_light") lightSum.set("Garden", (lightSum.get("Garden") ?? 0) + (st.s === "on" ? 0.8 * Math.max(0.3, (st.b ?? 200) / 255) : 0));
		if (d.kind === "switch") {
			const w = s.watts[`${d.name} Power`] ?? 0;
			let tag = powerTags.get(id);
			if (w > 300) { if (!tag) { tag = document.createElement("div"); tag.className = "label"; tag.style.color = "#ffc247"; $("labels").appendChild(tag); powerTags.set(id, tag); } tag.textContent = `${d.name}  ${fmtW(w)}`; }
			else if (tag) { tag.remove(); powerTags.delete(id); }
		}
	}
	for (const [n, l] of roomLight) { const sum = lightSum.get(n) ?? 0; l.intensity = Math.min(2.8, sum * 0.9); l.color.copy(warmDim).lerp(warmFull, Math.min(1, lightWarm.get(n) ?? 0)); }
	gardenLight.intensity = Math.min(2.2, (lightSum.get("Garden") ?? 0) * 1.2);
	for (const w of wins) w.open = Math.max(...w.ids.map((i) => open01(s, i)));
	garageOpen = open01(s, "cover.garage_door");
	const tilt = s.covers["cover.pergola_roof"]; const slatAngle = tilt ? (tilt.s === "closed" ? 0 : ((tilt.tilt ?? 60) / 100) * 1.4) : 0; slats.forEach((sl) => (sl.rotation.x = slatAngle));
	const sol = Math.min(1, s.power.solar / 4300); for (const m of panelMat) m.emissiveIntensity = 0.05 + sol * 0.45;
	(chargeGlow.material as THREE.MeshBasicMaterial).opacity = (s.watts["EV Charger Power"] ?? 0) > 1000 ? 0.7 : 0;
	car.visible = s.people.find((p) => p.name === "Dev")?.room !== "Away";
	tvPlaying = s.devices["switch.tv_plug"]?.s === "on" && s.media["media_player.living_room"] === "playing";
	(tvScreen.material as THREE.MeshStandardMaterial).emissiveIntensity = s.devices["switch.tv_plug"]?.s === "on" ? 1.4 : 0;
	for (const r of rings.keys()) rings.get(r)!.userData.on = s.devices[r]?.s === "on";
	puddle.scale.setScalar(puddle.visible ? 1 + 6 * Math.min(1, (s.faults.find((f) => f.kind === "leak")?.left ?? 0) > 0 ? 0.6 : 0.2) : 1);
	const heating = s.hvac.heatW > 0, cooling = s.hvac.coolW > 0, hvacW = s.hvac.heatW + s.hvac.coolW;
	vents.forEach((v, n) => { const m = v.material as THREE.MeshStandardMaterial; const run = (heating || cooling) && (s.rooms[n]?.T ?? 21) < (heating ? s.hvac.low + 0.6 : 99) ; m.emissive.setHex(heating ? 0xff7a30 : 0x4aa8ff); m.emissiveIntensity = run || cooling ? Math.min(1.6, 0.3 + hvacW / 1500) : 0; });
	drawThermo(s.rooms["Hallway"]?.T ?? 21, s.climate?.mode ?? "off", s.climate?.low, s.climate?.high, heating ? "heating" : cooling ? "cooling" : "idle");
	for (const p of s.people) {
		let o = folk.get(p.name); if (!o) { o = person(p.name); o.g.position.set(p.x, 0.12, p.z); folk.set(p.name, o); }
		const lieY = p.room === "Home Office" ? 0.55 : 0.78;
		o.target.set(p.x, p.pose === "lie" ? lieY : 0.12, p.z); o.g.visible = p.room !== "Away"; o.label.style.display = p.room === "Away" ? "none" : ""; o.walking = p.walking; o.pose = p.pose;
		if (p.pose === "sit") o.facing = p.room === "Kitchen" ? 0 : Math.PI;
	}
	for (const d of Object.values(doors)) { const near = s.people.some((p) => p.room !== "Away" && Math.hypot(p.x - d.cx, p.z - d.cz) < 1.15) || s.people.some((p) => p.room === "Away" && d.cx === 0 && p.walking); d.open = Math.max(d.contact ?? 0, near ? 1 : 0); }
	roomLabels.forEach((el, n) => { const R = s.rooms[n]; el.innerHTML = R ? `<b>${n}</b><span>${R.T.toFixed(1)}° · ${R.hum}%</span><span style="opacity:.7">${R.co2} ppm</span>` : `<b>${n}</b>`; });
	hud(s);
}

// ------------------------------------------------------------------ picking
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $("tip");
let down = { x: 0, y: 0 };
function hit(e: MouseEvent) { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); const first = ray.intersectObjects(pick, true)[0]; return first ? (first.object.userData.entity as string) : null; }
renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener("pointerup", async (e) => {
	if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;
	const id = hit(e); if (!id || !snap) return; const hd = handles.get(id)!, st = snap.devices[id];
	if (hd.dev.kind === "fan") { const steps = [0, 33, 67, 100], cur = st?.s === "on" ? st.pct ?? 100 : 0; const next = steps[(steps.findIndex((v) => v >= cur - 5) + 1) % 4]; await post("/api/act", { entity: id, level: next }); }
	else if (hd.dev.kind === "light" && e.shiftKey) { const cur = st?.s === "on" ? (st.b ?? 255) / 255 : 0; await post("/api/act", { entity: id, level: cur < 0.3 ? 60 : cur < 0.7 ? 100 : 25 }); }
	else await post("/api/act", { entity: id });
});
renderer.domElement.addEventListener("pointermove", (e) => {
	const id = hit(e); renderer.domElement.style.cursor = id ? "pointer" : "grab";
	if (!id || !snap) { tip.style.display = "none"; return; }
	const hd = handles.get(id)!, st = snap.devices[id], w = snap.watts[`${hd.dev.name} Power`];
	const detail = hd.dev.kind === "light" ? (st?.s === "on" ? `${Math.round(((st.b ?? 255) / 255) * 100)}%` : "off") : hd.dev.kind === "fan" ? (st?.s === "on" ? `speed ${st.pct ?? 100}%` : "off") : st?.s ?? "?";
	const how = hd.dev.kind === "fan" ? "click to change speed" : hd.dev.kind === "light" ? "click to switch, shift-click to dim" : "click to switch";
	tip.style.display = "block"; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 14}px`; tip.textContent = `${hd.dev.name}: ${detail}${w ? ` · ${Math.round(w)} W` : ""}  (${how})`;
});

// ------------------------------------------------------------------ run
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();
const clock = new THREE.Clock();
const ease = (cur: number, to: number, dt: number, rate = 5) => cur + (to - cur) * Math.min(1, dt * rate);
let lastDraw = 0;
function update(dt: number, t: number) {
	controls.update();
	for (const d of Object.values(doors)) d.pivot.rotation.y = ease(d.pivot.rotation.y, d.open ? d.sign * 1.45 : 0, dt, 3.5);
	for (const hd of handles.values()) if (hd.dev.kind === "lock") { const bolt = hd.obj.getObjectByName("bolt")!, back = hd.speed; const slide = (1 - back) * 0.14; if (hd.obj.userData.alongZ) bolt.position.z = ease(bolt.position.z, -slide, dt, 8); else bolt.position.x = ease(bolt.position.x, -slide, dt, 8); }
	for (const w of wins) { const slide = ease(w.axis === "x" ? w.mesh.position.x - w.base.x : w.mesh.position.z - w.base.z, w.open * 0.7, dt, 3); if (w.axis === "x") w.mesh.position.x = w.base.x + slide; else w.mesh.position.z = w.base.z + slide; w.mesh.position.y = 1.4; }
	garageDoor.position.y = ease(garageDoor.position.y, 0.12 + 1.05 + garageOpen * 1.9, dt, 2.5); garageDoor.scale.y = 1 - garageOpen * 0.0;
	for (const hd of handles.values()) if (hd.spin) hd.spin.rotation.y += hd.speed * dt;
	for (const r of rings.values()) { const on = r.userData.on; const m = r.material as THREE.MeshBasicMaterial; m.opacity = on ? 0.6 * (1 - ((t * 1.2) % 1)) : 0; r.scale.setScalar(on ? 0.4 + ((t * 1.2) % 1) * 2.4 : 1); }
	if (tvPlaying) (tvScreen.material as THREE.MeshStandardMaterial).emissive.setHSL((t * 0.12) % 1, 0.7, 0.5); else (tvScreen.material as THREE.MeshStandardMaterial).emissive.setHex(0x4a6aff);
	for (const c of clouds) { c.position.x += dt * (0.6 + (snap?.wind ?? 8) * 0.05); if (c.position.x > 80) c.position.x = -80; }
	for (const [n, o] of folk) {
		const dx = o.target.x - o.g.position.x, dz = o.target.z - o.g.position.z;
		if (o.walking && Math.hypot(dx, dz) > 0.05) o.facing = Math.atan2(dx, dz);
		o.g.position.x += dx * Math.min(1, dt * 3.2); o.g.position.z += dz * Math.min(1, dt * 3.2);
		const lying = o.pose === "lie", sitting = o.pose === "sit";
		o.g.position.y = ease(o.g.position.y, o.target.y, dt, 4);
		let da = o.facing - o.g.rotation.y; da = Math.atan2(Math.sin(da), Math.cos(da)); o.g.rotation.y += da * Math.min(1, dt * 6);
		o.k.bodyY = ease(o.k.bodyY, sitting ? -0.36 : 0, dt, 6); o.k.legX = ease(o.k.legX, sitting ? -1.45 : 0, dt, 6); o.k.lie = ease(o.k.lie, lying ? -Math.PI / 2 : 0, dt, 4); o.k.armX = ease(o.k.armX, sitting ? -0.5 : 0, dt, 6);
		const swing = o.walking ? Math.sin(t * 8) * 0.65 : 0;
		o.body.position.y = o.k.bodyY + (o.walking ? Math.abs(Math.sin(t * 8)) * 0.04 : 0); o.body.rotation.x = o.k.lie;
		o.legs[0].rotation.x = o.k.legX + swing; o.legs[1].rotation.x = o.k.legX - swing; o.arms[0].rotation.x = o.k.armX - swing; o.arms[1].rotation.x = o.k.armX + swing;
		placeLabel(o.label, o.g.position.x, o.g.position.y + (lying ? 1.1 : 2.1), o.g.position.z, showLabels && o.g.visible); void n;
	}
	for (const [id, tag] of powerTags) { const hd = handles.get(id)!; placeLabel(tag, hd.dev.x, hd.dev.y + 0.5, hd.dev.z, showLabels); }
	for (const r of ROOMS) placeLabel(roomLabels.get(r.name)!, (r.x0 + r.x1) / 2, 0.4, (r.z0 + r.z1) / 2 + (r.indoor ? 0 : -1), showLabels && r.name !== "Garden");
}
function frame() { lastDraw = performance.now(); update(clock.getDelta(), clock.elapsedTime); renderer.render(scene, camera); requestAnimationFrame(frame); }
// a page that is not on screen gets no animation frames; keep the world moving anyway so it is right the moment it is seen
setInterval(() => { if (performance.now() - lastDraw > 250) update(0.05, clock.elapsedTime + performance.now() / 1000); }, 50);
function connect() {
	const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
	ws.onmessage = (m) => { snap = JSON.parse(m.data); apply(snap!); };
	ws.onclose = () => setTimeout(connect, 1500);
}
connect(); frame();
(window as unknown as { __sim: unknown }).__sim = { doors, handles }; // handy for checking animations from the console
