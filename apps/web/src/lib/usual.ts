// The level you usually pick for a device (brightness, fan speed, target temperature), so a double tap can go straight there.
// Kept on this phone only. Written whenever you set a level yourself.
const KEY = 'usual:v1';
const read = (): Record<string, number> => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}'); } catch { return {}; } };
export const usual = (id: string): number | null => { const v = read()[id]; return typeof v === 'number' ? v : null; };
export function rememberUsual(id: string, v: number) {
	if (!Number.isFinite(v)) return;
	try { localStorage.setItem(KEY, JSON.stringify({ ...read(), [id]: v })); } catch { /* not kept */ }
}
