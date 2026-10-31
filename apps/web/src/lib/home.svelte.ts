import { api, explain, reauth } from './api.js';

export type Control =
	| { type: 'power' } | { type: 'brightness' } | { type: 'color_temp'; minK: number; maxK: number } | { type: 'color' }
	| { type: 'fan_speed'; step: number }
	| { type: 'thermostat'; min: number; max: number; step: number; modes: string[]; unit: string }
	| { type: 'lock' } | { type: 'media'; playback: boolean; volume: boolean; power: boolean } | { type: 'camera' };

export type Device = {
	id: string; name: string; category: string; roomId: string | null;
	available: boolean; reason: 'device_offline' | 'home_assistant_unavailable' | null;
	state: string; controls: Control[]; reading: { value: string; unit: string | null } | null;
	attrs: Record<string, any>;
};
export type Room = { id: string; name: string };
export type Group = { id: string; name: string; deviceIds: string[] };
export type Prefs = {
	template: 'comfort' | 'minimal'; appearance: 'light' | 'dark' | 'system'; sections: string[]; roomOrder: string[];
	favorites: { devices: string[]; rooms: string[] };
	/** what this person reaches for most, from their own taps */
	frequent?: string[];
};
export type ModeInfo = {
	available: boolean; current: string | null; modes: string[]; canSet: boolean; note: string;
	linkedRoutines: Record<string, string[]>; suggestion: { mode: string; reason: string } | null;
};
export type Scene = { id: string; name: string; managed: boolean; deviceIds: string[] };
export type RoutineStep = { type: string; text: string; [k: string]: any };
export type Routine = { id: string; name: string; template: string | null; steps: RoutineStep[]; summary: string; needsAttention: boolean };
export type Suggested = { key: string; name: string; blurb: string; defaultSteps: any[] };
type Notice = { kind: 'error' | 'info' | 'ok'; text: string };

class Home {
	devices = $state<Device[]>([]);
	rooms = $state<Room[]>([]);
	groups = $state<Group[]>([]);
	prefs = $state<Prefs | null>(null);
	mode = $state<ModeInfo | null>(null);
	scenes = $state<Scene[]>([]);
	routines = $state<Routine[]>([]);
	suggested = $state<Suggested[]>([]);
	canManageScenes = $state(false);
	haHealth = $state<'ok' | 'unreachable' | 'auth_failed'>('ok');
	loaded = $state(false);
	busy = $state<Record<string, boolean>>({});
	notice = $state<Notice | null>(null);
	private es: EventSource | null = null;
	private timer: ReturnType<typeof setTimeout> | undefined;

	byId = (id: string) => this.devices.find((d) => d.id === id);
	inRoom = (roomId: string) => this.devices.filter((d) => d.roomId === roomId);
	orderedRooms = $derived.by(() => {
		const order = this.prefs?.roomOrder ?? [];
		const rank = (r: Room) => { const i = order.indexOf(r.id); return i < 0 ? 1e6 : i; };
		return [...this.rooms].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
	});
	favoriteDevices = $derived((this.prefs?.favorites.devices ?? []).map((id) => this.byId(id)).filter((d): d is Device => !!d));
	isFavorite = (id: string) => !!this.prefs?.favorites.devices.includes(id);

	say(kind: Notice['kind'], text: string) {
		this.notice = { kind, text };
		clearTimeout(this.timer);
		this.timer = setTimeout(() => (this.notice = null), 6000);
	}

	async load() {
		const [d, r, g, p, m, sc, ro] = await Promise.all([api('GET', '/api/devices'), api('GET', '/api/rooms'), api('GET', '/api/groups'), api('GET', '/api/me/prefs'), api('GET', '/api/mode'), api('GET', '/api/scenes'), api('GET', '/api/routines')]);
		if (m.ok) this.mode = m.data;
		if (sc.ok) { this.scenes = sc.data.scenes; this.canManageScenes = sc.data.canManage; }
		if (ro.ok) { this.routines = ro.data.routines; this.suggested = ro.data.suggested; }
		if (d.ok) { this.devices = d.data.devices; this.haHealth = d.data.haHealth; }
		if (r.ok) this.rooms = r.data.rooms;
		if (g.ok) this.groups = g.data.groups;
		if (p.ok) this.prefs = p.data;
		this.loaded = true;
	}

	connect() {
		if (this.es) return;
		const es = new EventSource('/api/stream');
		this.es = es;
		es.addEventListener('device', (e) => {
			const dev: Device = JSON.parse((e as MessageEvent).data);
			const i = this.devices.findIndex((x) => x.id === dev.id);
			if (i >= 0) this.devices[i] = dev; else this.devices.push(dev);
		});
		es.addEventListener('mode', async () => { const m = await api('GET', '/api/mode'); if (m.ok) this.mode = m.data; });
		es.addEventListener('ha', async () => { await this.load(); }); // hub state changed: refresh availability of everything
		es.onerror = () => { this.haHealth = 'unreachable'; }; // EventSource reconnects by itself
		es.onopen = () => { if (this.loaded) this.load(); };
	}
	disconnect() { this.es?.close(); this.es = null; }

	/** Send a command and report exactly what happened. Never claims success the hub didn't confirm. */
	async command(id: string, action: string, value?: unknown): Promise<boolean> {
		this.busy[id] = true;
		try {
			let r = await api('POST', `/api/devices/${encodeURIComponent(id)}/command`, { action, value });
			if (r.status === 401 && r.data?.error === 'reauth_required') {
				if (!(await reauth())) { this.say('error', 'Confirmation was cancelled, so the action was not sent.'); return false; }
				r = await api('POST', `/api/devices/${encodeURIComponent(id)}/command`, { action, value });
			}
			if (!r.ok) { this.say('error', r.data?.message ?? explain(r.data?.error)); await this.load(); return false; }
			const i = this.devices.findIndex((x) => x.id === id);
			if (i >= 0 && r.data.device) this.devices[i] = r.data.device;
			if (!r.data.confirmed) this.say('info', 'Sent. Waiting for the device to respond…');
			return true;
		} finally { this.busy[id] = false; }
	}

	async groupCommand(gid: string, action: string, value?: unknown) {
		const r = await api('POST', `/api/groups/${gid}/command`, { action, value });
		if (!r.ok) { this.say('error', r.data?.message ?? explain(r.data?.error)); return; }
		const { summary, results, notPermitted } = r.data;
		const failed = results.filter((x: any) => !x.ok).map((x: any) => x.name);
		if (summary === 'all') this.say('ok', 'Done.');
		else if (summary === 'none') this.say('error', `Nothing responded: ${failed.join(', ')}.`);
		else this.say('error', `Only some responded.${failed.length ? ` Didn't respond: ${failed.join(', ')}.` : ''}${notPermitted ? ` ${notPermitted} not available to you.` : ''}`);
		await this.load();
	}

	async setMode(mode: string) {
		const r = await api('POST', '/api/mode', { mode });
		if (!r.ok) { this.say('error', r.data?.message ?? explain(r.data?.error)); return; }
		if (!r.data.confirmed) this.say('info', 'Sent. Waiting for the home hub to confirm…');
		const m = await api('GET', '/api/mode'); if (m.ok) this.mode = m.data;
	}

	async activateScene(s: Scene) {
		this.busy[s.id] = true;
		try {
			const r = await api('POST', `/api/scenes/${encodeURIComponent(s.id)}/activate`);
			if (!r.ok) this.say('error', r.data?.message ?? explain(r.data?.error));
			else this.say(r.data.confirmed ? 'ok' : 'info', r.data.confirmed ? `Activated “${s.name}”.` : `Sent “${s.name}”. Waiting for the hub to confirm…`);
		} finally { this.busy[s.id] = false; }
	}

	async runRoutine(rt: Routine) {
		this.busy[`routine:${rt.id}`] = true;
		try {
			const r = await api('POST', `/api/routines/${rt.id}/run`);
			// The hub runs the steps itself; "started" is all we can honestly say.
			if (!r.ok) this.say('error', r.data?.message ?? explain(r.data?.error));
			else this.say('ok', `Started “${rt.name}”.`);
		} finally { this.busy[`routine:${rt.id}`] = false; }
	}

	async savePrefs(patch: Partial<Pick<Prefs, 'template' | 'appearance' | 'sections' | 'roomOrder'>>) {
		const r = await api('PUT', '/api/me/prefs', patch);
		if (r.ok) this.prefs = r.data; else this.say('error', explain(r.data?.error));
	}
	async saveFavorites(devices: string[], rooms: string[]) {
		const r = await api('PUT', '/api/me/favorites', { devices, rooms });
		if (r.ok) this.prefs = r.data; else this.say('error', explain(r.data?.error));
	}
	async toggleFavorite(id: string) {
		const cur = this.prefs?.favorites.devices ?? [];
		await this.saveFavorites(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], this.prefs?.favorites.rooms ?? []);
	}
}
export const home = new Home();
