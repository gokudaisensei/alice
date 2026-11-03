// Shake the phone to take back the last thing you did. Two sharp jolts within a second; a short rest after.
import { undo } from './undo.svelte.js';
import { haptics } from './haptics.js';
import { home } from './home.svelte.js';

type MotionCtor = { requestPermission?: () => Promise<'granted' | 'denied'> };
export const shakeSupported = () => typeof window !== 'undefined' && 'DeviceMotionEvent' in window;
/** iPhone asks once, and only in answer to a tap. Elsewhere there is nothing to ask. */
export async function allowShake(): Promise<boolean> {
	const m = (window as unknown as { DeviceMotionEvent?: MotionCtor }).DeviceMotionEvent;
	if (!m) return false;
	if (typeof m.requestPermission !== 'function') return true;
	try { return (await m.requestPermission()) === 'granted'; } catch { return false; }
}

let last = 0, jolts: number[] = [], prev = 0, off: (() => void) | null = null;
function onMotion(e: DeviceMotionEvent) {
	const g = e.accelerationIncludingGravity; if (!g) return;
	const mag = Math.hypot(g.x ?? 0, g.y ?? 0, g.z ?? 0), delta = Math.abs(mag - prev); prev = mag;
	const now = Date.now();
	if (delta < 18 || now - last < 1500) return;
	jolts = [...jolts.filter((t) => now - t < 900), now];
	if (jolts.length >= 2) { jolts = []; last = now; void run(); }
}
async function run() {
	haptics.grab();
	const what = await undo.last();
	if (what) { haptics.success(); home.say('ok', `Undid: ${what}.`); } else home.say('info', 'Nothing to undo.');
}
export function startShake() { if (off || !shakeSupported()) return; window.addEventListener('devicemotion', onMotion); off = () => window.removeEventListener('devicemotion', onMotion); }
export function stopShake() { off?.(); off = null; jolts = []; }
