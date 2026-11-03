// Small physical confirmations for taps. Android browsers expose navigator.vibrate; iPhone Safari (17.4+) gives a light tick
// when a hidden "switch" checkbox is toggled inside a tap, so we use that there. Anywhere neither works, this does nothing.
// People can turn it off in Settings.
const KEY = 'haptics';
let ios: HTMLElement | null = null;
const supportsVibrate = () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
const isIos = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);

export const hapticsEnabled = () => { try { return localStorage.getItem(KEY) !== 'off'; } catch { return true; } };
export const setHaptics = (on: boolean) => { try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch {} };
export const hapticsAvailable = () => supportsVibrate() || isIos();

function iosTick() {
	if (typeof document === 'undefined') return;
	if (!ios) {
		const label = document.createElement('label');
		label.setAttribute('aria-hidden', 'true');
		label.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
		const input = document.createElement('input');
		input.type = 'checkbox'; input.setAttribute('switch', ''); input.tabIndex = -1;
		label.appendChild(input); document.body.appendChild(label); ios = label;
	}
	ios.click();
}

function fire(pattern: number | number[]) {
	if (!hapticsEnabled()) return;
	try {
		if (supportsVibrate()) navigator.vibrate(pattern);
		else if (isIos()) { iosTick(); if (Array.isArray(pattern) && pattern.length > 2) setTimeout(iosTick, 90); }
	} catch {}
}

/** One vocabulary, used everywhere, so the feel is learnable. */
export const haptics = {
	/** a normal tap: toggle, select */
	tap: () => fire(8),
	/** something engaged (press-and-hold armed, a slider grabbed) */
	grab: () => fire(14),
	/** something finished well: a door locked, a scene ran */
	success: () => fire([10, 50, 16]),
	/** something did not happen */
	warn: () => fire([28, 60, 28]),
	/** one notch of a dial: every ten percent while scrubbing */
	detent: () => fire(4),
	/** a firm click: a bolt thrown or drawn */
	click: () => fire(22),
	/** it did not go through: two sharp taps */
	error: () => fire([18, 40, 18])
};
