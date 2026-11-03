import { capitalize } from './utils.js';
import type { Device } from './home.svelte.js';

export type Step =
	| { type: 'device'; entityId: string; action: string; value?: unknown }
	| { type: 'scene'; entityId: string }
	| { type: 'mode'; mode: string }
	| { type: 'delay'; seconds: number };

export type ActionOption = { action: string; label: string; input?: { kind: 'number'; min: number; max: number; step: number; unit: string; start: number } | { kind: 'select'; options: string[] } };

/** What a person can ask this particular device to do, derived from its real capabilities. */
export function actionsFor(d: Device): ActionOption[] {
	const out: ActionOption[] = [];
	for (const c of d.controls) {
		if (c.type === 'power') out.push({ action: 'turn_on', label: 'Turn on' }, { action: 'turn_off', label: 'Turn off' });
		if (c.type === 'brightness') out.push({ action: 'set_brightness', label: 'Set brightness', input: { kind: 'number', min: 1, max: 100, step: 1, unit: '%', start: 50 } });
		if (c.type === 'color_temp') out.push({ action: 'set_color_temp', label: 'Set warmth', input: { kind: 'number', min: c.minK, max: c.maxK, step: 100, unit: 'K', start: Math.round((c.minK + c.maxK) / 2 / 100) * 100 } });
		if (c.type === 'fan_speed') out.push({ action: 'set_speed', label: 'Set speed', input: { kind: 'number', min: 0, max: 100, step: c.step || 1, unit: '%', start: 50 } });
		if (c.type === 'thermostat') {
			out.push({ action: 'set_temperature', label: 'Set temperature', input: { kind: 'number', min: c.min, max: c.max, step: c.step, unit: '°', start: Math.round((c.min + c.max) / 2) } });
			if (c.modes.length) out.push({ action: 'set_hvac_mode', label: 'Set mode', input: { kind: 'select', options: c.modes } });
		}
		if (c.type === 'lock') out.push({ action: 'lock', label: 'Lock' }); // unlocking is never allowed in a stored routine
		if (c.type === 'media') {
			if (c.playback) out.push({ action: 'media_play', label: 'Play' }, { action: 'media_pause', label: 'Pause' });
			if (c.volume) out.push({ action: 'set_volume', label: 'Set volume', input: { kind: 'number', min: 0, max: 100, step: 1, unit: '%', start: 30 } });
		}
	}
	return out;
}


/** A plain sentence for a step, e.g. "Turn off Living room". */
export function stepText(s: Step, nameOf: (id: string) => string, actions?: ActionOption[]): string {
	if (s.type === 'scene') return `Activate the scene “${nameOf(s.entityId)}”`;
	if (s.type === 'mode') return `Set the household mode to ${capitalize(s.mode)}`;
	if (s.type === 'delay') return `Wait ${s.seconds} second${s.seconds === 1 ? '' : 's'}`;
	const label = actions?.find((a) => a.action === s.action)?.label ?? capitalize(s.action.replace(/_/g, ' '));
	const unit = actions?.find((a) => a.action === s.action)?.input;
	const v = s.value !== undefined && unit?.kind === 'number' ? ` to ${s.value}${unit.unit}` : s.value !== undefined ? ` to ${s.value}` : '';
	return `${label}${v} — ${nameOf(s.entityId)}`;
}
