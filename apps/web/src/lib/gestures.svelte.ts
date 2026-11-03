// Whole-screen gestures: pull down to refresh, swipe in from the left edge to go back, and a press-and-hold that
// swallows the tap that follows it. Each is plain pointer or touch handling with no library behind it.
import { haptics } from './haptics.js';

/** Where the pull-to-refresh indicator is: `y` is how far it has been dragged, `busy` while the refresh runs. */
export const pull = $state({ y: 0, armed: false, busy: false });
/** How far an edge swipe has gone, 0 to 1, for the little back arrow. */
export const edge = $state({ p: 0 });

const THRESHOLD = 64;
const sheetOpen = () => !!document.querySelector('[role="dialog"][data-state="open"], [data-vaul-drawer][data-state="open"]');

/** Pull the page down from the very top to refresh. Anything else (scrolling, open sheets, sideways swipes) is left alone. */
export function pullToRefresh(refresh: () => Promise<unknown>) {
	let y0 = 0, x0 = 0, on = false, dead = false;
	const start = (e: TouchEvent) => { on = false; dead = pull.busy || sheetOpen() || window.scrollY > 0 || e.touches.length !== 1; y0 = e.touches[0]?.clientY ?? 0; x0 = e.touches[0]?.clientX ?? 0; };
	const move = (e: TouchEvent) => {
		if (dead) return;
		const t = e.touches[0]; if (!t) return;
		const dy = t.clientY - y0, dx = t.clientX - x0;
		if (!on) { if (Math.abs(dx) > Math.abs(dy) || dy < 0) { if (dy < -6) dead = true; return; } if (dy < 10) return; on = true; }
		if (window.scrollY > 0) { on = false; pull.y = 0; return; }
		e.preventDefault();
		pull.y = Math.min(96, dy * 0.5);
		const armed = pull.y >= THRESHOLD;
		if (armed !== pull.armed) { pull.armed = armed; if (armed) haptics.grab(); }
	};
	const end = async () => {
		if (!on) return;
		on = false;
		if (pull.armed) { pull.busy = true; pull.armed = false; pull.y = 52; try { await refresh(); haptics.success(); } finally { pull.busy = false; pull.y = 0; } }
		else pull.y = 0;
	};
	addEventListener('touchstart', start, { passive: true }); addEventListener('touchmove', move, { passive: false });
	addEventListener('touchend', end, { passive: true }); addEventListener('touchcancel', end, { passive: true });
	return () => { removeEventListener('touchstart', start); removeEventListener('touchmove', move); removeEventListener('touchend', end); removeEventListener('touchcancel', end); };
}

const installed = () => matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;

/** An installed app has no browser back button, so a swipe in from the left edge does it. In a browser tab the system already does this. */
export function edgeBack(canGoBack: () => boolean) {
	if (!installed()) return () => {};
	let x0 = 0, y0 = 0, on = false, dead = true;
	const start = (e: TouchEvent) => { const t = e.touches[0]; x0 = t?.clientX ?? 999; y0 = t?.clientY ?? 0; on = false; dead = x0 > 22 || e.touches.length !== 1 || sheetOpen() || !canGoBack(); };
	const move = (e: TouchEvent) => {
		if (dead) return;
		const t = e.touches[0]; if (!t) return;
		const dx = t.clientX - x0, dy = t.clientY - y0;
		if (!on) { if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 12) { dead = true; edge.p = 0; return; } if (dx < 10) return; on = true; }
		edge.p = Math.min(1, dx / 90);
	};
	const end = () => { if (on && edge.p >= 1) { haptics.tap(); history.back(); } on = false; edge.p = 0; };
	addEventListener('touchstart', start, { passive: true }); addEventListener('touchmove', move, { passive: true });
	addEventListener('touchend', end, { passive: true }); addEventListener('touchcancel', end, { passive: true });
	return () => { removeEventListener('touchstart', start); removeEventListener('touchmove', move); removeEventListener('touchend', end); removeEventListener('touchcancel', end); };
}

/** Press and hold an element. A short press behaves as normal; a long one runs `onlong` and cancels the click that would follow. */
export function longpress(node: HTMLElement, opts: { ms?: number; onlong: () => unknown }) {
	let timer: ReturnType<typeof setTimeout> | undefined, fired = false, sx = 0, sy = 0, o = opts;
	const down = (e: PointerEvent) => { fired = false; sx = e.clientX; sy = e.clientY; clearTimeout(timer); timer = setTimeout(() => { fired = true; haptics.grab(); void o.onlong(); }, o.ms ?? 520); };
	const move = (e: PointerEvent) => { if (Math.abs(e.clientX - sx) > 10 || Math.abs(e.clientY - sy) > 10) clearTimeout(timer); };
	const stop = () => clearTimeout(timer);
	const click = (e: MouseEvent) => { if (fired) { e.stopImmediatePropagation(); e.preventDefault(); fired = false; } };
	const menu = (e: Event) => e.preventDefault();
	node.addEventListener('pointerdown', down); node.addEventListener('pointermove', move); node.addEventListener('pointerup', stop);
	node.addEventListener('pointercancel', stop); node.addEventListener('pointerleave', stop); node.addEventListener('click', click, true); node.addEventListener('contextmenu', menu);
	return {
		update(n: typeof opts) { o = n; },
		destroy() { stop(); node.removeEventListener('pointerdown', down); node.removeEventListener('pointermove', move); node.removeEventListener('pointerup', stop); node.removeEventListener('pointercancel', stop); node.removeEventListener('pointerleave', stop); node.removeEventListener('click', click, true); node.removeEventListener('contextmenu', menu); }
	};
}
