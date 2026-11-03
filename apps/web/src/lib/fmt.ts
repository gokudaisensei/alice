/** One place that decides how numbers, units, dates and sensor states are written, so the same reading looks the same on every screen. */

/** "1 device", "3 devices". Pass `many` for irregular plurals. */
/** The space is a non-breaking one, so a number never ends a line while its noun starts the next. */
export const plural = (n: number, one: string, many = `${one}s`) => `${n}\u00a0${n === 1 ? one : many}`;

/** 21 stays 21, 21.50 becomes 21.5, 55.0 becomes 55. Returns the input when it is not a number. */
export function trim(v: number | string, max = 1): string {
	const n = typeof v === 'number' ? v : Number(v);
	if (!Number.isFinite(n)) return String(v);
	const r = Number(n.toFixed(max));
	return r.toLocaleString(undefined, { maximumFractionDigits: max });
}

/** How many decimals a unit deserves: whole watts and percentages, a tenth of a degree, two for kilowatts. */
const DECIMALS: Record<string, number> = { W: 0, kW: 2, Wh: 0, kWh: 1, '%': 0, '°C': 1, '°F': 0, V: 0, A: 1, ppm: 0, lx: 0, hPa: 0 };

/** A reading split for display where the number is large and the unit small: {v: "21.5", u: "°C"}. `short` drops the scale letter of a temperature. */
export function parts(value: string | number, unit?: string | null, opts: { short?: boolean } = {}): { v: string; u: string } {
	const n = Number(value);
	if (!Number.isFinite(n)) return { v: String(value), u: '' };
	const u = unit ?? '';
	const v = trim(n, DECIMALS[u] ?? 1);
	return { v, u: (u === '°C' || u === '°F') && opts.short ? '°' : u };
}

/** A reading with its unit: "450 W", "21.5 °C", "55%". */
export function measure(value: string | number, unit?: string | null, opts: { short?: boolean } = {}): string {
	const { v, u } = parts(value, unit, opts);
	return !u ? v : u === '%' || u === '°' ? `${v}${u}` : `${v} ${u}`;
}

/** The reading of a device in words ("Open", "Closed", "Motion"), or null when it is a plain number. */
const WORDS: Record<string, [string, string]> = {
	door: ['Open', 'Closed'], window: ['Open', 'Closed'], garage_door: ['Open', 'Closed'], opening: ['Open', 'Closed'],
	motion: ['Motion', 'Clear'], occupancy: ['Occupied', 'Clear'], presence: ['Home', 'Away'],
	moisture: ['Wet', 'Dry'], smoke: ['Smoke', 'Clear'], gas: ['Gas', 'Clear'], carbon_monoxide: ['Gas', 'Clear'],
	tamper: ['Tampered', 'Clear'], vibration: ['Vibration', 'Still'], battery: ['Low', 'OK'], connectivity: ['Connected', 'Offline'],
	problem: ['Problem', 'OK'], safety: ['Unsafe', 'Safe'], lock: ['Unlocked', 'Locked'], plug: ['Plugged in', 'Unplugged'], power: ['On', 'Off']
};
/** Names are only a fallback for sensors that report no class. */
const BY_NAME: [RegExp, string][] = [[/\b(door|gate)\b/i, 'door'], [/window/i, 'window'], [/garage/i, 'garage_door'], [/motion/i, 'motion'], [/leak|flood|water/i, 'moisture'], [/smoke/i, 'smoke']];

export type Sensorish = { name: string; state: string; reading: { value: string; unit: string | null; cls?: string | null } | null };

export function sensorWord(d: Sensorish): string | null {
	const raw = (d.reading?.value ?? d.state).toLowerCase();
	if (raw !== 'on' && raw !== 'off') return null;
	const cls = d.reading?.cls ?? BY_NAME.find(([re]) => re.test(d.name))?.[1] ?? null;
	const pair = cls ? WORDS[cls] : undefined;
	return pair ? pair[raw === 'on' ? 0 : 1] : raw === 'on' ? 'On' : 'Off';
}

const DAY = 86_400_000;

/** "3 November 2026": spelled out, so no one has to guess day from month. */
export const longDate = (ts: number | Date) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
export const clock = (ts: number | Date) => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "just now", "5 min ago", "2 h ago", "yesterday", or the date. */
export function ago(ts: number, now = Date.now()): string {
	const d = now - ts;
	if (d < 45_000) return 'just now';
	if (d < 3_600_000) return `${Math.max(1, Math.round(d / 60_000))} min ago`;
	if (d < DAY) return `${Math.round(d / 3_600_000)} h ago`;
	if (d < 2 * DAY) return 'yesterday';
	return longDate(ts);
}

/** Joins sentences with one space and no doubled full stops, for copy assembled from parts. */
export const sentences = (...parts: (string | false | null | undefined)[]) =>
	parts.filter((p): p is string => !!p).map((p) => p.trim()).map((p) => (/[.!?…]$/.test(p) ? p : `${p}.`)).join(' ');
