import { capitalize } from './utils.js';
import { plural } from './fmt.js';
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

/** "Kitchen, Desk and Hall", or "Kitchen, Desk, Hall and 2 more" when the list gets long. */
export function joinNames(xs: string[], show = 3): string {
	const n = xs.length;
	if (n <= 1) return xs.join('');
	if (n <= show + 1) return `${xs.slice(0, -1).join(', ')} and ${xs[n - 1]}`;
	return `${xs.slice(0, show).join(', ')} and ${n - show} more`;
}

/** How an action reads in the middle of a sentence ("turn off", "set the brightness to 40% on"). */
function verb(action: string, value: unknown, actions?: ActionOption[]): string {
	const v = value;
	switch (action) {
		case 'turn_on': return 'turn on';
		case 'turn_off': return 'turn off';
		case 'lock': return 'lock';
		case 'media_play': return 'play';
		case 'media_pause': return 'pause';
		case 'set_brightness': return `set the brightness to ${v}% on`;
		case 'set_color_temp': return `set the warmth to ${v}K on`;
		case 'set_speed': return `set the speed to ${v}% on`;
		case 'set_temperature': return `set the temperature to ${v}° on`;
		case 'set_hvac_mode': return `set the mode to ${v} on`;
		case 'set_volume': return `set the volume to ${v}% on`;
		default: return (actions?.find((a) => a.action === action)?.label ?? action.replace(/_/g, ' ')).toLowerCase();
	}
}

/**
 * Steps as one flowing sentence: "turn off Kitchen, Desk and Hall, set the house to Night, then wait 5 seconds".
 * Neighbouring devices that get the same action are grouped so a long routine stays readable.
 * Returns '' when there are no steps.
 */
export function stepsSentence(steps: Step[], nameOf: (id: string) => string, optsOf?: (id: string) => ActionOption[]): string {
	const parts: string[] = [];
	for (let i = 0; i < steps.length; i++) {
		const s = steps[i]!;
		if (s.type === 'device') {
			const group = [s];
			while (steps[i + 1]?.type === 'device') {
				const n = steps[i + 1] as typeof s;
				if (n.action !== s.action || n.value !== s.value) break;
				group.push(n); i++;
			}
			parts.push(`${verb(s.action, s.value, optsOf?.(s.entityId))} ${joinNames(group.map((g) => nameOf(g.entityId)))}`);
		} else if (s.type === 'scene') parts.push(`activate the scene “${nameOf(s.entityId)}”`);
		else if (s.type === 'mode') parts.push(`set the house to ${capitalize(s.mode)}`);
		else parts.push(`wait ${plural(s.seconds, 'second')}`);
	}
	return parts.length < 3 ? parts.join(', then ') : `${parts.slice(0, -1).join(', ')}, then ${parts[parts.length - 1]}`;
}
