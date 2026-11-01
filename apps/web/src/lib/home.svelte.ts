import { api, explain, reauth } from './api.js';
import { haptics } from './haptics.js';

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
	/** when the hub last answered, so an outage can say how stale the screen is */
	lastOkAt = $state<number | null>(null);
	mode = $state<ModeInfo | null>(null);
	scenes = $state<Scene[]>([]);
	routines = $state<Routine[]>([]);
	suggested = $state<Suggested[]>([]);
	canManageScenes = $state(false);
	haHealth = $state<'ok' | 'unreachable' | 'auth_failed'>('ok');
	loaded = $state(false);
	busy = $state<Record<string, boolean>>({});
	notice = $state<Notice | null>(null);
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
		if (d.ok) { this.devices = d.data.devices; this.haHealth = d.data.haHealth; if (d.data.haHealth === 'ok') this.lastOkAt = Date.now(); }
		if (r.ok) this.rooms = r.data.rooms;
		if (g.ok) this.groups = g.data.groups;
		if (p.ok) this.prefs = p.data;
		this.loaded = true;
	}

	/** Stay in step with the household. Long-polling rather than a stream: it works through any proxy or tunnel. */
	connect() {
		if (this.polling) return;
		this.polling = true; this.rev = -1;
		const wake = () => { if (document.visibilityState === 'visible') { if (this.loaded) void this.load(); this.rev = -1; this.abort?.abort(); } };
		document.addEventListener('visibilitychange', wake); this.unhook = () => document.removeEventListener('visibilitychange', wake);
		void this.poll();
	}
	disconnect() { this.polling = false; this.abort?.abort(); this.unhook?.(); this.unhook = null; }

	private polling = false; private rev = -1; private abort: AbortController | null = null; private unhook: (() => void) | null = null; private fails = 0; private reloadTimer: ReturnType<typeof setTimeout> | undefined;
	private reloadSoon() { clearTimeout(this.reloadTimer); this.reloadTimer = setTimeout(() => void this.load(), 250); }
	private async poll() {
		while (this.polling) {
			const ctl = (this.abort = new AbortController());
			try {
				const res = await fetch(`/api/sync?rev=${this.rev}`, { headers: { 'x-requested-with': 'alice' }, signal: ctl.signal });
				if (!res.ok) throw new Error(String(res.status));
				const d = await res.json();
				if (this.fails > 0) { this.fails = 0; if (this.loaded) this.reloadSoon(); }
				const first = this.rev < 0; this.rev = d.rev;
				if (d.resync) { if (!first) this.reloadSoon(); continue; }
				for (const dev of d.devices as Device[]) { const i = this.devices.findIndex((x) => x.id === dev.id); if (i >= 0) this.devices[i] = dev; else this.devices.push(dev); }
				if (d.mode) { const m = await api('GET', '/api/mode'); if (m.ok) this.mode = m.data; }
				if (d.ha || d.data) this.reloadSoon();
			} catch {
				if (!this.polling) return;
				if (ctl.signal.aborted) continue;
				if (++this.fails >= 2) this.haHealth = 'unreachable';
				await new Promise((r) => setTimeout(r, Math.min(15000, 1000 * this.fails)));
			}
		}
	}

	/** What we expect a device to look like after a command, so the screen can answer at once. The hub's real answer replaces it. */
	private expected(d: Device, action: string, value?: unknown): Device | null {
		const a = { ...d.attrs };
		switch (action) {
			case 'turn_on': return { ...d, state: 'on' };
			case 'turn_off': return { ...d, state: 'off' };
			case 'lock': return { ...d, state: 'locked' };
			case 'set_brightness': return typeof value === 'number' ? { ...d, state: 'on', attrs: { ...a, brightnessPct: value } } : null;
			case 'set_speed': return typeof value === 'number' ? { ...d, attrs: { ...a, speedPct: value } } : null;
			case 'set_temperature': return typeof value === 'number' ? { ...d, attrs: { ...a, target: value } } : null;
			default: return null; // unlocking waits for the passkey check, so nothing is shown early
		}
	}

	/** Send a command and report exactly what happened. Shows the expected result immediately, undoes it if the hub says no, and never claims success the hub didn't confirm. */
	async command(id: string, action: string, value?: unknown): Promise<boolean> {
		const i0 = this.devices.findIndex((x) => x.id === id), before = i0 >= 0 ? this.devices[i0] : null;
		const guess = before ? this.expected(before, action, value) : null;
		if (guess && i0 >= 0) this.devices[i0] = guess;
		const undo = () => { const i = this.devices.findIndex((x) => x.id === id); if (before && i >= 0) this.devices[i] = before; };
		this.busy[id] = true;
		try {
			let r = await api('POST', `/api/devices/${encodeURIComponent(id)}/command`, { action, value });
			if (r.status === 401 && r.data?.error === 'reauth_required') {
				if (!(await reauth())) { undo(); haptics.warn(); this.say('error', 'Confirmation was cancelled, so the action was not sent.'); return false; }
				r = await api('POST', `/api/devices/${encodeURIComponent(id)}/command`, { action, value });
			}
			if (!r.ok) { undo(); haptics.warn(); this.say('error', r.data?.message ?? explain(r.data?.error)); await this.load(); return false; }
			const i = this.devices.findIndex((x) => x.id === id);
			if (i >= 0 && r.data.device) this.devices[i] = r.data.device;
			if (action === 'lock' || action === 'unlock') haptics.success();
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
			if (!r.ok) { haptics.warn(); this.say('error', r.data?.message ?? explain(r.data?.error)); }
			else { haptics.success(); this.say(r.data.confirmed ? 'ok' : 'info', r.data.confirmed ? `Activated “${s.name}”.` : `Sent “${s.name}”. Waiting for the hub to confirm…`); }
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
