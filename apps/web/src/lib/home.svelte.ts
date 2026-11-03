import { api, explain, reauth, type ApiResult } from './api.js';
import { haptics } from './haptics.js';
import { inverse } from './undo.js';
import { undo, type Undoable } from './undo.svelte.js';
import { rememberUsual } from './usual.js';
import { session } from './session.svelte.js';
import type { Me } from './api.js';

export type Control =
	| { type: 'power' } | { type: 'brightness' } | { type: 'color_temp'; minK: number; maxK: number } | { type: 'color' }
	| { type: 'fan_speed'; step: number }
	| { type: 'thermostat'; min: number; max: number; step: number; modes: string[]; unit: string }
	| { type: 'lock' } | { type: 'media'; playback: boolean; volume: boolean; power: boolean } | { type: 'camera' };

/** The readings the server picks out for each kind of device. Which ones are present depends on the device. */
export type DeviceAttrs = {
	brightnessPct?: number | null; colorTempK?: number | null; hs?: number[] | null;
	speedPct?: number | null;
	target?: number | null; hvacAction?: string | null;
	volumePct?: number | null; title?: string | null;
};

export type Device = {
	id: string; name: string; category: string; roomId: string | null;
	available: boolean; reason: 'device_offline' | 'home_assistant_unavailable' | null;
	state: string; controls: Control[]; reading: { value: string; unit: string | null; cls?: string | null } | null;
	attrs: DeviceAttrs;
	/** when the state last changed (ms since 1970), as the hub reports it */
	changedAt?: number | null;
	/** the icon a person chose for it; null lets the app pick one */
	icon?: string | null;
	/** the hub's device class (outlet, speaker, …), when it gives one */
	deviceClass?: string | null;
	/** "Spaceship · Speaker": set only when a physical device shows as several cards */
	subtitle?: string | null;
};
export type Room = { id: string; name: string; color?: string | null; icon?: string | null; floor?: string | null };
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
export type RoutineStep = { type: string; text: string; [k: string]: unknown };
export type Routine = { id: string; name: string; template: string | null; steps: RoutineStep[]; summary: string; needsAttention: boolean };
export type Suggested = { key: string; name: string; blurb: string; defaultSteps: { type: string; [k: string]: unknown }[]; complete?: boolean; missing?: string[]; summary?: string };
type HaHealth = 'ok' | 'unreachable' | 'auth_failed';

/** Everything the first screen needs, in one response. A part is null when the server refused it for this person. */
type Bootstrap = {
	devices?: { devices: Device[]; haHealth: HaHealth } | null; rooms?: { rooms: Room[] } | null; groups?: { groups: Group[] } | null;
	prefs?: Prefs | null; mode?: ModeInfo | null; scenes?: { scenes: Scene[]; canManage: boolean } | null; routines?: { routines: Routine[]; suggested: Suggested[] } | null;
};
type BootstrapResponse = Bootstrap & { me: Me };
/** What changed since the revision a device last saw. */
type SyncResponse = { rev: number; resync: boolean; devices: Device[]; mode: boolean; ha: boolean; data: boolean };
type GroupResult = { id: string; name: string; ok: boolean; confirmed?: boolean; error?: string; message?: string };
type Notice = { kind: 'error' | 'info' | 'ok'; text: string; action?: { label: string; run: () => unknown } };

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
	haHealth = $state<HaHealth>('ok');
	loaded = $state(false);
	busy = $state<Record<string, boolean>>({});
	notice = $state<Notice | null>(null);
	/** A moment after a command: it settled, or it didn't. Tiles use it to pulse or shake. */
	flash = $state<Record<string, 'ok' | 'fail'>>({});
	/** Whether this phone has a connection at all, apart from whether the hub answers */
	online = $state(typeof navigator === 'undefined' ? true : navigator.onLine);
	private batching: Undoable[] | null = null;
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

	say(kind: Notice['kind'], text: string, action?: Notice['action']) {
		this.notice = { kind, text, action };
		clearTimeout(this.timer);
		this.timer = setTimeout(() => (this.notice = null), action ? 8000 : 6000);
	}

	private mark(id: string, v: 'ok' | 'fail') {
		this.flash[id] = v;
		setTimeout(() => { if (this.flash[id] === v) delete this.flash[id]; }, 800);
	}

	/** Do several things as one action: they are reported together, and one Undo takes them all back. */
	async batch(label: string, fn: () => Promise<unknown>) {
		const outer = this.batching; this.batching = [];
		try { await fn(); } finally {
			const done = this.batching ?? []; this.batching = outer;
			if (done.length) {
				const entry: Undoable = { label, run: async () => { for (const e of [...done].reverse()) await e.run(); } };
				undo.push(entry);
				this.say('ok', `${label}.`, { label: 'Undo', run: async () => { undo.stack = undo.stack.filter((x) => x !== entry); await entry.run(); this.say('ok', `Undid: ${label}.`); } });
			}
		}
	}

	private apply(b: Bootstrap, from: 'cache' | 'network' = 'network') {
		if (typeof performance !== 'undefined' && !performance.getEntriesByName('home-' + from).length) performance.mark('home-' + from); // timing: when the first real data painted
		if (b.mode) this.mode = b.mode;
		if (b.scenes) { this.scenes = b.scenes.scenes; this.canManageScenes = b.scenes.canManage; }
		if (b.routines) { this.routines = b.routines.routines; this.suggested = b.routines.suggested; }
		if (b.devices) { this.devices = b.devices.devices; this.haHealth = b.devices.haHealth; if (b.devices.haHealth === 'ok') this.lastOkAt = Date.now(); }
		if (b.rooms) this.rooms = b.rooms.rooms;
		if (b.groups) this.groups = b.groups.groups;
		if (b.prefs) this.prefs = b.prefs;
		this.loaded = true;
	}

	/** Paint last time's home straight away (kept only on this device), then let load() bring it up to date. */
	restore() {
		if (this.loaded) return;
		try { const v = localStorage.getItem('home:v1'); const c = v ? (JSON.parse(v) as { uid: string; data: Bootstrap }) : null; if (c && c.uid === session.me?.id) this.apply(c.data, 'cache'); } catch { /* start from the network */ }
	}

	private inflight: Promise<void> | null = null;
	/** One request for everything the first screen needs. Asking twice at once shares the one request. */
	load(): Promise<void> {
		return (this.inflight ??= this.fetchAll().finally(() => (this.inflight = null)));
	}
	private async fetchAll() {
		const w = window as unknown as { __boot?: Promise<ApiResult<BootstrapResponse> | null> };
		const early = w.__boot; w.__boot = undefined; // started by the page itself before the scripts arrived; used once
		const r = (early && (await early)) || (await api<BootstrapResponse>('GET', '/api/bootstrap'));
		if (r.status === 401) { await session.refresh(); return; }
		if (!r.ok) return;
		const { me, ...rest } = r.data;
		session.remember(me);
		this.apply(rest);
		try { localStorage.setItem('home:v1', JSON.stringify({ uid: me.id, data: rest })); } catch { /* storage full or blocked: carry on */ }
	}

	/** Stay in step with the household. Long-polling rather than a stream: it works through any proxy or tunnel. */
	connect() {
		if (this.polling) return;
		this.polling = true; this.rev = -1;
		const wake = () => { if (document.visibilityState === 'visible') { if (this.loaded) void this.load(); this.rev = -1; this.abort?.abort(); } };
		const up = () => { this.online = true; this.rev = -1; this.abort?.abort(); void this.load(); }, down = () => (this.online = false);
		this.online = navigator.onLine;
		document.addEventListener('visibilitychange', wake); window.addEventListener('online', up); window.addEventListener('offline', down);
		this.unhook = () => { document.removeEventListener('visibilitychange', wake); window.removeEventListener('online', up); window.removeEventListener('offline', down); };
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
				const d = (await res.json()) as SyncResponse;
				if (this.fails > 0) { this.fails = 0; if (this.loaded) this.reloadSoon(); }
				const first = this.rev < 0; this.rev = d.rev;
				if (d.resync) { if (!first) this.reloadSoon(); continue; }
				for (const dev of d.devices) { const i = this.devices.findIndex((x) => x.id === dev.id); if (i >= 0) this.devices[i] = dev; else this.devices.push(dev); }
				if (d.mode) { const m = await api<ModeInfo>('GET', '/api/mode'); if (m.ok) this.mode = m.data; }
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
	async command(id: string, action: string, value?: unknown, opts: { record?: boolean } = {}): Promise<boolean> {
		if (!this.online) { haptics.error(); this.mark(id, 'fail'); this.say('error', 'You’re offline. Controls are paused until your phone reconnects.'); return false; }
		const i0 = this.devices.findIndex((x) => x.id === id), before = i0 >= 0 ? this.devices[i0] : null;
		const guess = before ? this.expected(before, action, value) : null;
		if (guess && i0 >= 0) this.devices[i0] = guess;
		const undoGuess = () => { const i = this.devices.findIndex((x) => x.id === id); if (before && i >= 0) this.devices[i] = before; };
		this.busy[id] = true;
		try {
			const send = () => api<{ confirmed: boolean; device: Device | null }>('POST', `/api/devices/${encodeURIComponent(id)}/command`, { action, value });
			let r = await send();
			if (!r.ok && r.status === 401 && r.data.error === 'reauth_required') {
				if (!(await reauth())) { undoGuess(); haptics.warn(); this.say('error', 'Confirmation was cancelled, so the action was not sent.'); return false; }
				r = await send();
			}
			if (!r.ok) { undoGuess(); haptics.error(); this.mark(id, 'fail'); this.say('error', r.data.message ?? explain(r.data.error)); await this.load(); return false; }
			const i = this.devices.findIndex((x) => x.id === id);
			if (i >= 0 && r.data.device) this.devices[i] = r.data.device;
			if (action === 'lock' || action === 'unlock') haptics.click();
			this.mark(id, 'ok');
			if (typeof value === 'number' && ['set_brightness', 'set_speed', 'set_temperature'].includes(action)) rememberUsual(id, value);
			const inv = before && opts.record !== false ? inverse(before, action, value) : null;
			if (inv && before) {
				const entry: Undoable = { label: `${before.name}`, run: () => this.command(id, inv.action, inv.value, { record: false }) };
				if (this.batching) this.batching.push(entry); else undo.push(entry);
			}
			if (!r.data.confirmed) this.say('info', 'Sent. Waiting for the device to respond…');
			return true;
		} finally { this.busy[id] = false; }
	}

	async groupCommand(gid: string, action: string, value?: unknown) {
		const r = await api<{ summary: 'all' | 'none' | 'partial'; results: GroupResult[]; notPermitted: number }>('POST', `/api/groups/${gid}/command`, { action, value });
		if (!r.ok) { this.say('error', r.data.message ?? explain(r.data.error)); return; }
		const { summary, results, notPermitted } = r.data;
		const failed = results.filter((x) => !x.ok).map((x) => x.name);
		if (summary === 'all') this.say('ok', 'Done.');
		else if (summary === 'none') this.say('error', `Nothing responded: ${failed.join(', ')}.`);
		else this.say('error', `Only some responded.${failed.length ? ` Didn't respond: ${failed.join(', ')}.` : ''}${notPermitted ? ` ${notPermitted} not available to you.` : ''}`);
		await this.load();
	}

	async setMode(mode: string) {
		const r = await api<{ confirmed: boolean }>('POST', '/api/mode', { mode });
		if (!r.ok) { this.say('error', r.data.message ?? explain(r.data.error)); return; }
		if (!r.data.confirmed) this.say('info', 'Sent. Waiting for the home hub to confirm…');
		const m = await api<ModeInfo>('GET', '/api/mode'); if (m.ok) this.mode = m.data;
	}

	async activateScene(s: Scene) {
		this.busy[s.id] = true;
		try {
			const r = await api<{ confirmed: boolean }>('POST', `/api/scenes/${encodeURIComponent(s.id)}/activate`);
			if (!r.ok) { haptics.warn(); this.say('error', r.data.message ?? explain(r.data.error)); }
			else { haptics.success(); this.say(r.data.confirmed ? 'ok' : 'info', r.data.confirmed ? `Activated “${s.name}”.` : `Sent “${s.name}”. Waiting for the hub to confirm…`); }
		} finally { this.busy[s.id] = false; }
	}

	async runRoutine(rt: Routine) {
		this.busy[`routine:${rt.id}`] = true;
		try {
			const r = await api('POST', `/api/routines/${rt.id}/run`);
			// The hub runs the steps itself; "started" is all we can honestly say.
			if (!r.ok) this.say('error', r.data.message ?? explain(r.data.error));
			else this.say('ok', `Started “${rt.name}”.`);
		} finally { this.busy[`routine:${rt.id}`] = false; }
	}

	async savePrefs(patch: Partial<Pick<Prefs, 'template' | 'appearance' | 'sections' | 'roomOrder'>>) {
		const r = await api<Prefs>('PUT', '/api/me/prefs', patch);
		if (r.ok) this.prefs = r.data; else this.say('error', explain(r.data.error));
	}
	async saveFavorites(devices: string[], rooms: string[]) {
		const r = await api<Prefs>('PUT', '/api/me/favorites', { devices, rooms });
		if (r.ok) this.prefs = r.data; else this.say('error', explain(r.data.error));
	}
	async toggleFavorite(id: string) {
		const cur = this.prefs?.favorites.devices ?? [];
		await this.saveFavorites(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id], this.prefs?.favorites.rooms ?? []);
	}
}
export const home = new Home();
