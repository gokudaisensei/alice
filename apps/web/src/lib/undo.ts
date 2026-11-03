import type { Device } from './home.svelte.js';

/** What would put a device back after `action`, or null when nothing should be offered. Locks are never "undone" into unlocked: that needs a passkey and must be deliberate. */
export function inverse(before: Pick<Device, 'state' | 'attrs'>, action: string, value?: unknown): { action: string; value?: unknown } | null {
	const a = before.attrs;
	switch (action) {
		case 'turn_on': return before.state === 'off' ? { action: 'turn_off' } : null;
		case 'turn_off': return before.state === 'on' ? { action: 'turn_on' } : null;
		case 'set_brightness':
			if (before.state === 'off') return { action: 'turn_off' };
			return typeof a.brightnessPct === 'number' && a.brightnessPct !== value ? { action: 'set_brightness', value: a.brightnessPct } : null;
		case 'set_speed': return typeof a.speedPct === 'number' && a.speedPct !== value ? { action: 'set_speed', value: a.speedPct } : null;
		case 'set_temperature': return typeof a.target === 'number' && a.target !== value ? { action: 'set_temperature', value: a.target } : null;
		default: return null;
	}
}
