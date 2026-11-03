// Understands a short typed request like "turn off the kitchen lights" using plain rules. No AI: it either matches
// something specific in this home or it says nothing. It never unlocks doors and never guesses between near matches.

export type Target = { id: string; name: string; category: string; roomId: string | null };
export type Ctx = { devices: Target[]; rooms: { id: string; name: string }[]; scenes: { id: string; name: string }[]; routines: { id: string; name: string }[] };
export type Intent =
	| { kind: 'devices'; action: 'turn_on' | 'turn_off' | 'lock' | 'set_brightness'; value?: number; ids: string[]; label: string }
	| { kind: 'scene'; id: string; label: string }
	| { kind: 'routine'; id: string; label: string }
	| { kind: 'refused'; label: string };

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9% ]+/g, ' ').replace(/\s+/g, ' ').trim();
const STOP = new Set(['the', 'a', 'an', 'my', 'please', 'all', 'every', 'in', 'of', 'to', 'at', 'light', 'lights', 'lamp', 'lamps']);
const words = (s: string) => norm(s).split(' ').filter((w) => w && !STOP.has(w));
/** Capture group `i` of a match, or '' when that group didn't take part. */
const at = (m: RegExpMatchArray, i: number) => m[i] ?? '';
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

const CATEGORY_WORDS: Record<string, string> = { light: 'light', lights: 'light', lamp: 'light', lamps: 'light', fan: 'fan', fans: 'fan', plug: 'switch', plugs: 'switch', switch: 'switch', switches: 'switch', lock: 'lock', locks: 'lock', door: 'lock', doors: 'lock' };

export function parseIntent(raw: string, c: Ctx): Intent | null {
	const t = norm(raw);
	if (t.length < 3) return null;

	// What to do
	let action: 'turn_on' | 'turn_off' | 'lock' | 'unlock' | 'set_brightness' | 'run' | null = null, value: number | undefined, rest = t;
	let m: RegExpMatchArray | null;
	if ((m = t.match(/^(?:set|dim|brighten)\s+(.+?)\s+(?:to\s+)?(\d{1,3})\s*%?$/))) { action = 'set_brightness'; rest = at(m, 1); value = Math.min(100, Math.max(1, Number(at(m, 2)))); }
	else if ((m = t.match(/^(?:turn|switch)\s+(on|off)\s+(.+)$/))) { action = at(m, 1) === 'on' ? 'turn_on' : 'turn_off'; rest = at(m, 2); }
	else if ((m = t.match(/^(?:turn|switch)\s+(.+?)\s+(on|off)$/))) { action = at(m, 2) === 'on' ? 'turn_on' : 'turn_off'; rest = at(m, 1); }
	else if ((m = t.match(/^(on|off)\s+(.+)$/))) { action = at(m, 1) === 'on' ? 'turn_on' : 'turn_off'; rest = at(m, 2); }
	else if ((m = t.match(/^(.+?)\s+(on|off)$/))) { action = at(m, 2) === 'on' ? 'turn_on' : 'turn_off'; rest = at(m, 1); }
	else if ((m = t.match(/^lock\s+(.+)$/))) { action = 'lock'; rest = at(m, 1); }
	else if ((m = t.match(/^unlock\s+(.+)$/))) { action = 'unlock'; rest = at(m, 1); }
	else if ((m = t.match(/^(?:activate|run|start|play|good|set the scene)\s*(.+)$/))) { action = 'run'; rest = /^good\b/.test(t) ? t : at(m, 1); }
	if (!action) return null;

	if (action === 'unlock') return { kind: 'refused', label: 'Doors can only be unlocked from the door’s own tile, after a passkey check.' };

	if (action === 'run') {
		const q = words(rest);
		const hits = [...c.scenes.map((s) => ({ ...s, kind: 'scene' as const })), ...c.routines.map((s) => ({ ...s, kind: 'routine' as const }))].filter((x) => q.length && q.every((w) => norm(x.name).includes(w)));
		const [hit] = hits;
		if (!hit || hits.length !== 1) return null; // zero or ambiguous: say nothing rather than guess
		return { kind: hit.kind, id: hit.id, label: `${hit.kind === 'scene' ? 'Activate' : 'Run'} ${hit.name}` };
	}

	// Which devices
	const wantsAll = /\b(all|every)\b/.test(rest) || /\blights\b|\bfans\b|\bdoors\b|\blocks\b|\bplugs\b/.test(rest);
	const toks = norm(rest).split(' ');
	const cat = toks.map((w) => CATEGORY_WORDS[w]).find(Boolean) ?? null;
	const room = c.rooms.find((r) => norm(rest).includes(norm(r.name)));
	const nameWords = words(rest.replace(room ? norm(room.name) : '', '')).filter((w) => !CATEGORY_WORDS[w]);
	const wanted = action === 'lock' ? 'lock' : null;
	let pool = c.devices.filter((d) => (wanted ? d.category === wanted : true));
	if (room) pool = pool.filter((d) => d.roomId === room.id);
	if (cat && !nameWords.length) pool = pool.filter((d) => d.category === cat);
	else if (nameWords.length) pool = pool.filter((d) => nameWords.every((w) => norm(d.name).split(' ').includes(w)));
	else if (!room) return null;
	if (action === 'turn_on' || action === 'turn_off') pool = pool.filter((d) => ['light', 'switch', 'fan', 'climate', 'media', 'humidifier'].includes(d.category)); // never a door, gate, valve or alarm
	if (action === 'set_brightness') pool = pool.filter((d) => d.category === 'light');
	if (!pool.length) return null;
	if (!wantsAll && !room && pool.length > 1 && nameWords.length && !cat) return null; // "kitchen" matched several different things: don't guess
	const verb = action === 'turn_on' ? 'Turn on' : action === 'turn_off' ? 'Turn off' : action === 'lock' ? 'Lock' : `Set to ${value}%:`;
	const [only] = pool;
	const what = only && pool.length === 1 ? only.name : room && cat ? `${room.name} ${cat === 'light' ? 'lights' : cat + 's'} (${pool.length})` : `${plural(pool.length, cat === 'light' ? 'light' : 'device')}`;
	return { kind: 'devices', action: action as 'turn_on' | 'turn_off' | 'lock' | 'set_brightness', value, ids: pool.map((d) => d.id), label: `${verb} ${what}` };
}
