import type { Device } from './home.svelte.js';
import type { Step } from './steps.js';

export type Trigger =
	| { type: 'device_state'; entityId: string; to: string; forSeconds?: number }
	| { type: 'sensor'; entityId: string; above?: number; below?: number; forSeconds?: number }
	| { type: 'time'; at: string }
	| { type: 'sun'; event: 'sunrise' | 'sunset'; offsetMinutes?: number }
	| { type: 'mode'; mode: string };
export type Condition =
	| { type: 'device_state'; entityId: string; is: string }
	| { type: 'sensor'; entityId: string; above?: number; below?: number }
	| { type: 'time'; after: string; before: string }
	| { type: 'mode'; mode: string }
	| { type: 'days'; days: string[] };

export type AutomationView = {
	id: string; name: string; summary: string; enabled: boolean | null; lastTriggered: string | null; needsAttention: boolean;
	triggers: (Trigger & { text: string })[]; conditions: (Condition & { text: string })[]; actions: (Step & { text: string })[];
};
export type Template = { key: string; name: string; blurb: string; triggers: Trigger[]; conditions: Condition[]; actions: Step[] };

export const DAYS = [['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun']] as const;

/** The states a person can pick for this device, based on what it can actually do. */
/** The states of a device that can be tested for, or none when there is no device. */
export const statesOf = (d: Device | undefined): string[] => (d ? statesFor(d) : []);
/** The first state worth offering for a device. */
export const firstState = (d: Device | undefined): string => statesOf(d)[0] ?? 'on';

export function statesFor(d: Device): string[] {
	const out: string[] = [];
	for (const c of d.controls) {
		if (c.type === 'power') out.push('on', 'off');
		if (c.type === 'lock') out.push('locked', 'unlocked');
		if (c.type === 'media') out.push('playing', 'paused', 'idle');
	}
	return [...new Set(out)];
}
export const isSensor = (d: Device) => d.id.startsWith('sensor.') && !!d.reading;
