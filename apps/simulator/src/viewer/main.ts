// The 3D house. It draws what the simulator says is happening and sends your clicks back to Home Assistant.
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

type Room = { name: string; x0: number; x1: number; z0: number; z1: number; indoor: boolean; color: number; door: { x: number; z: number } };
type Dev = { entity: string; name: string; room: string; kind: string; x: number; y: number; z: number };
type Snap = {
	t: number; hour: number; speed: number; paused: boolean; sun: number; cloud: number; outdoor: number; wind: number; humidity: number;
	power: { home: number; solar: number; grid: number }; hvac: { mode: string; low: number; high: number; heatW: number; coolW: number };
	rooms: Record<string, { T: number; hum: number; co2: number }>;
	people: { name: string; x: number; z: number; room: string; act: string; walking: boolean }[];
	devices: Record<string, { s: string; b: number | null }>; watts: Record<string, number>;
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
camera.position.set(30, 26, 32);
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
const GAPS: Record<string, { edge: "n" | "s" | "w" | "e"; at: number }[]> = {
	"Master Bedroom": [{ edge: "s", at: 2.5 }], Bathroom: [{ edge: "s", at: 7 }], "Kids Room": [{ edge: "s", at: 10.5 }], "Home Office": [{ edge: "s", at: 15 }],
	Hallway: [{ edge: "w", at: 5.75 }], "Living Room": [{ edge: "n", at: 4 }], Kitchen: [{ edge: "n", at: 10.25 }, { edge: "s", at: 10 }], Garage: [{ edge: "n", at: 14.75 }, { edge: "s", at: 16 }],
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
		const horiz = e.edge === "n" || e.edge === "s", gs = gaps.filter((g) => g.edge === e.edge).map((g) => g.at).sort((p, q) => p - q);
		let cur = horiz ? e.a[0] : e.a[1]; const end = horiz ? e.b[0] : e.b[1];
		const seg = (p: number, q: number) => (horiz ? wall(house, p, e.a[1], q, e.a[1], e.ext ? EXT : INT, e.ext) : wall(house, e.a[0], p, e.a[0], q, e.ext ? EXT : INT, e.ext));
		for (const g of gs) { seg(cur, g - 0.55); cur = g + 0.55; }
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
[[-2, 14.5, 1.1], [3.5, 16.5, 0.9], [14, 15.5, 1.2], [19, 13, 1], [-2, 2, 1.2], [19, 2, 1.3], [8, 17.5, 1]].forEach(([x, z, s]) => treeAt(x, z, s));
for (let i = 0; i < 7; i++) box(0.9, 0.05, 0.5, 0xb8b2a3, 6 + i * 0.6, 0, 12.8 + i * 0.5, scene);
const spray = new THREE.Mesh(new THREE.ConeGeometry(1.6, 1.4, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x7fd0ff, transparent: true, opacity: 0, side: THREE.DoubleSide })); spray.position.set(3, 0.8, 14.5); scene.add(spray);
const puddle = new THREE.Mesh(new THREE.CircleGeometry(0.1, 24), new THREE.MeshBasicMaterial({ color: 0x4aa3ff, transparent: true, opacity: 0.75 })); puddle.rotation.x = -Math.PI / 2; puddle.position.set(7.4, 0.14, 4.2); puddle.visible = false; scene.add(puddle);

// ------------------------------------------------------------------ doors that open and close
const doors: Record<string, { pivot: THREE.Group; open: number }> = {};
function door(key: string, x: number, z: number, along: "x" | "z", color = 0x8d6e50) {
	const pivot = new THREE.Group(); pivot.position.set(x, 0.12, z); scene.add(pivot);
	const leaf = along === "z" ? box(0.07, 2.0, 0.95, color, 0, 0, 0.475, pivot) : box(0.95, 2.0, 0.07, color, 0.475, 0, 0, pivot);
	void leaf; doors[key] = { pivot, open: 0 };
}
door("binary_sensor.front_door_contact", 0.04, 5.75 - 0.5, "z"); door("binary_sensor.garage_door_contact", 15.45, 11.97, "x", 0x6a707f);
const windows: Record<string, THREE.Mesh> = {};
for (const [k, x, z] of [["binary_sensor.bedroom_window", 2.5, 0.06], ["binary_sensor.kids_room_window", 10.5, 0.06], ["binary_sensor.kitchen_window", 11.3, 11.94]] as [string, number, number][]) {
	const w = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 0.04), new THREE.MeshStandardMaterial({ color: 0x9fd0ff, transparent: true, opacity: 0.55 })); w.position.set(x, 1.4, z); scene.add(w); windows[k] = w;
}

// ------------------------------------------------------------------ devices
type Handle = { dev: Dev; obj: THREE.Object3D; mat?: THREE.MeshStandardMaterial; spin?: THREE.Object3D };
const handles = new Map<string, Handle>(); const pick: THREE.Object3D[] = [];
const roomLight = new Map<string, THREE.PointLight>();
for (const r of ROOMS) if (r.indoor) { const l = new THREE.PointLight(0xffd9a0, 0, 9, 1.6); l.position.set((r.x0 + r.x1) / 2, 2.1, (r.z0 + r.z1) / 2); scene.add(l); roomLight.set(r.name, l); }
const gardenLight = new THREE.PointLight(0xffe0b0, 0, 12, 1.5); gardenLight.position.set(8, 2, 14); scene.add(gardenLight);
for (const d of DEVS) {
	let obj: THREE.Object3D | undefined, mat: THREE.MeshStandardMaterial | undefined, spin: THREE.Object3D | undefined;
	if (d.kind === "light") { mat = new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc866, emissiveIntensity: 0 }); obj = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), mat); }
	else if (d.kind === "switch") { mat = new THREE.MeshStandardMaterial({ color: 0x9aa3bd, emissive: 0x2cff9a, emissiveIntensity: 0 }); obj = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), mat); }
	else if (d.kind === "fan") { const g = new THREE.Group(); mat = new THREE.MeshStandardMaterial({ color: 0xd8def0, emissive: 0x7fd0ff, emissiveIntensity: 0 }); for (let k = 0; k < 4; k++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.02, 0.16), mat); b.rotation.y = (k * Math.PI) / 2; b.position.set(Math.cos((k * Math.PI) / 2) * 0.42, 0, -Math.sin((k * Math.PI) / 2) * 0.42); g.add(b); } obj = g; spin = g; }
	else if (d.kind === "lock") { mat = new THREE.MeshStandardMaterial({ color: 0x50d890, emissive: 0x50d890, emissiveIntensity: 0.6 }); obj = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, 0.1), mat); }
	else if (d.kind === "bsensor") { mat = new THREE.MeshStandardMaterial({ color: 0x6b7596, emissive: 0xff4f6d, emissiveIntensity: 0 }); obj = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), mat); }
	if (!obj) continue;
	obj.position.set(d.x, d.y, d.z); obj.userData.entity = d.entity; scene.add(obj);
	if (obj instanceof THREE.Group) obj.traverse((c) => (c.userData.entity = d.entity));
	if (["light", "switch", "fan", "lock"].includes(d.kind)) pick.push(obj);
	handles.set(d.entity, { dev: d, obj, mat, spin });
}
const rings = new Map<string, THREE.Mesh>();
for (const d of DEVS.filter((x) => x.kind === "bsensor" && /motion|occupancy/.test(x.entity))) { const m = new THREE.Mesh(new THREE.RingGeometry(0.5, 0.6, 32), new THREE.MeshBasicMaterial({ color: 0x4de1ff, transparent: true, opacity: 0, side: THREE.DoubleSide })); m.rotation.x = -Math.PI / 2; m.position.set(d.x, 0.2, d.z); scene.add(m); rings.set(d.entity, m); }

// ------------------------------------------------------------------ people
const COLORS: Record<string, number> = { Maya: 0xff7b8f, Dev: 0x7f9bff, Kiran: 0xffc247, Nani: 0x5fd0a0 };
const folk = new Map<string, { g: THREE.Group; target: THREE.Vector3; label: HTMLElement }>();
function person(name: string) {
	const g = new THREE.Group(); const c = COLORS[name] ?? 0xffffff, kid = name === "Kiran", s = kid ? 0.72 : 1;
	const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.22 * s, 0.85 * s, 6, 12), std(c)); body.position.y = 0.12 + 0.65 * s; body.castShadow = true; g.add(body);
	const head = new THREE.Mesh(new THREE.SphereGeometry(0.18 * s, 14, 12), std(0xf2d3b5)); head.position.y = 0.12 + 1.5 * s; head.castShadow = true; g.add(head);
	scene.add(g); const el = document.createElement("div"); el.className = "label who"; el.textContent = name; $("labels").appendChild(el);
	return { g, target: new THREE.Vector3(), label: el };
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
	$("events").textContent = s.events.length ? s.events[s.events.length - 1] : "Quiet at home.";
}

// ------------------------------------------------------------------ keeping the scene in step with the simulator
const skyDay = new THREE.Color(0x9cc8ff), skyDusk = new THREE.Color(0xf0a078), skyNight = new THREE.Color(0x0a1030);
const tmp = new THREE.Color(), cold = new THREE.Color(0x6aa8ff), hot = new THREE.Color(0xff8a5c);
function apply(s: Snap) {
	const h = s.hour, a = ((h - 6) / 12) * Math.PI, day = s.sun;
	sun.position.set(8.5 + Math.cos(a) * 38, Math.max(2, Math.sin(a) * 42), 8 - Math.sin(a) * 6 + 12);
	sun.intensity = 0.15 + day * 1.7 * (1 - 0.55 * s.cloud); hemi.intensity = 0.28 + day * 0.7;
	sunBall.position.copy(sun.position).multiplyScalar(1.5).add(new THREE.Vector3(0, 0, 0)); sunBall.visible = day > 0.01 && Math.sin(a) > 0;
	const na = a + Math.PI; moonBall.position.set(8.5 + Math.cos(na) * 55, Math.max(6, Math.sin(na) * 50), 8); moonBall.visible = day < 0.05;
	const twilight = h > 5.5 && h < 7.2 || h > 17.8 && h < 19.4;
	scene.background = tmp.clone().copy(skyNight).lerp(twilight ? skyDusk : skyDay, Math.min(1, day * 3 + (twilight ? 0.6 : 0)));
	scene.fog = new THREE.Fog((scene.background as THREE.Color).getHex(), 90, 260);
	ground.material.color.setHex(day > 0.05 ? 0x7fb26a : 0x35553a);
	for (const [n, fl] of floors) { const R = s.rooms[n]; if (!R) continue; const k = Math.min(1, Math.max(0, (R.T - 17) / 10)); const base = new THREE.Color(ROOMS.find((r) => r.name === n)!.color); (fl.material as THREE.MeshStandardMaterial).color.copy(base).lerp(k < 0.5 ? cold : hot, Math.abs(k - 0.5) * 0.9); }
	const lightSum = new Map<string, number>();
	for (const [id, hd] of handles) {
		const st = s.devices[id]; if (!st) continue; const on = st.s === "on" || st.s === "unlocked"; const d = hd.dev;
		if (d.kind === "light" && hd.mat) { const br = on ? (st.b ?? 200) / 255 : 0; hd.mat.emissiveIntensity = on ? 0.4 + br * 2.6 : 0; lightSum.set(d.room, (lightSum.get(d.room) ?? 0) + br); }
		else if (d.kind === "switch" && hd.mat) { hd.mat.emissiveIntensity = on ? 0.9 : 0; if (d.entity === "switch.tv_plug") (tvScreen.material as THREE.MeshStandardMaterial).emissiveIntensity = on ? 1.6 : 0; if (d.entity === "switch.front_lawn_sprinkler") (spray.material as THREE.MeshBasicMaterial).opacity = on ? 0.35 : 0; if (d.entity === "switch.garden_path_lights" || d.entity === "light.porch_light") lightSum.set("Garden", (lightSum.get("Garden") ?? 0) + (on ? 0.6 : 0)); }
		else if (d.kind === "fan" && hd.mat) hd.mat.emissiveIntensity = on ? 0.5 : 0;
		else if (d.kind === "lock" && hd.mat) { hd.mat.color.setHex(on ? 0xff7b8f : 0x50d890); hd.mat.emissive.setHex(on ? 0xff7b8f : 0x50d890); }
		else if (d.kind === "bsensor" && hd.mat) {
			hd.mat.emissiveIntensity = on ? 1.6 : 0;
			if (doors[id]) doors[id].open = on ? 1 : 0;
			if (windows[id]) windows[id].rotation.x = on ? -0.9 : 0;
			if (id === "binary_sensor.bathroom_leak_sensor") puddle.visible = on;
		}
		if (d.entity === "light.porch_light" && hd.mat) lightSum.set("Garden", (lightSum.get("Garden") ?? 0) + (on ? 0.8 : 0));
	}
	for (const [n, l] of roomLight) l.intensity = Math.min(2.8, (lightSum.get(n) ?? 0) * 0.9);
	gardenLight.intensity = Math.min(2.2, (lightSum.get("Garden") ?? 0) * 1.2);
	const sol = Math.min(1, s.power.solar / 4300); for (const m of panelMat) m.emissiveIntensity = 0.05 + sol * 0.45;
	(chargeGlow.material as THREE.MeshBasicMaterial).opacity = (s.watts["EV Charger Power"] ?? 0) > 1000 ? 0.7 : 0;
	car.visible = s.people.find((p) => p.name === "Dev")?.room !== "Away";
	for (const r of rings.keys()) rings.get(r)!.userData.on = s.devices[r]?.s === "on";
	puddle.scale.setScalar(puddle.visible ? 1 + 6 * Math.min(1, (s.faults.find((f) => f.kind === "leak")?.left ?? 0) > 0 ? 0.6 : 0.2) : 1);
	for (const p of s.people) {
		let o = folk.get(p.name); if (!o) { o = person(p.name); o.g.position.set(p.x, 0.12, p.z); folk.set(p.name, o); }
		o.target.set(p.x, 0.12, p.z); o.g.visible = p.room !== "Away"; o.label.style.display = p.room === "Away" ? "none" : ""; o.g.userData.walking = p.walking;
		const sleeping = p.act === "sleep"; o.g.rotation.z = sleeping ? Math.PI / 2 : 0; if (sleeping) o.target.y = 0.5;
	}
	roomLabels.forEach((el, n) => { const R = s.rooms[n]; el.innerHTML = R ? `<b>${n}</b><span>${R.T.toFixed(1)}° · ${R.hum}%</span>` : `<b>${n}</b>`; });
	hud(s);
}

// ------------------------------------------------------------------ picking
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2(), tip = $("tip");
let down = { x: 0, y: 0 };
function hit(e: MouseEvent) { mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera); const hs = ray.intersectObjects(pick, true); return hs.length ? (hs[0].object.userData.entity as string) : null; }
renderer.domElement.addEventListener("pointerdown", (e) => (down = { x: e.clientX, y: e.clientY }));
renderer.domElement.addEventListener("pointerup", async (e) => { if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; const id = hit(e); if (id) await post("/api/act", { entity: id }); });
renderer.domElement.addEventListener("pointermove", (e) => {
	const id = hit(e); renderer.domElement.style.cursor = id ? "pointer" : "grab";
	if (!id || !snap) { tip.style.display = "none"; return; }
	const hd = handles.get(id)!, st = snap.devices[id], w = snap.watts[`${hd.dev.name} Power`];
	tip.style.display = "block"; tip.style.left = `${e.clientX + 14}px`; tip.style.top = `${e.clientY + 14}px`; tip.textContent = `${hd.dev.name}: ${st?.s ?? "?"}${w ? ` · ${Math.round(w)} W` : ""}  (click to switch)`;
});

// ------------------------------------------------------------------ run
function resize() { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();
const clock = new THREE.Clock();
function frame() {
	const dt = clock.getDelta(), t = clock.elapsedTime;
	controls.update();
	for (const [id, d] of Object.entries(doors)) d.pivot.rotation.y += (((d.open ? (id.includes("garage") ? 1.4 : -1.35) : 0)) - d.pivot.rotation.y) * Math.min(1, dt * 4);
	for (const hd of handles.values()) if (hd.spin) hd.spin.rotation.y += (snap?.devices[hd.dev.entity]?.s === "on" ? 9 : 0) * dt;
	for (const r of rings.values()) { const on = r.userData.on; const m = r.material as THREE.MeshBasicMaterial; m.opacity = on ? 0.6 * (1 - ((t * 1.2) % 1)) : 0; r.scale.setScalar(on ? 0.4 + ((t * 1.2) % 1) * 2.4 : 1); }
	for (const [n, o] of folk) {
		o.g.position.x += (o.target.x - o.g.position.x) * Math.min(1, dt * 3.2); o.g.position.z += (o.target.z - o.g.position.z) * Math.min(1, dt * 3.2); o.g.position.y += (o.target.y - o.g.position.y) * Math.min(1, dt * 4);
		if (o.g.userData.walking) o.g.position.y = o.target.y + Math.abs(Math.sin(t * 9)) * 0.06;
		placeLabel(o.label, o.g.position.x, o.g.position.y + 2, o.g.position.z, showLabels && o.g.visible); void n;
	}
	for (const r of ROOMS) placeLabel(roomLabels.get(r.name)!, (r.x0 + r.x1) / 2, 0.4, (r.z0 + r.z1) / 2 + (r.indoor ? 0 : -1), showLabels && r.name !== "Garden");
	renderer.render(scene, camera); requestAnimationFrame(frame);
}
function connect() {
	const ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`);
	ws.onmessage = (m) => { snap = JSON.parse(m.data); apply(snap!); };
	ws.onclose = () => setTimeout(connect, 1500);
}
connect(); frame();
