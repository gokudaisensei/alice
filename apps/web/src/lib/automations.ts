import type { Device } from './home.svelte.js';
import { stepsSentence, type ActionOption, type Step } from './steps.js';
import { clock } from './fmt.js';
import { capitalize } from './utils.js';

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
export type Template = { key: string; name: string; blurb: string; triggers: Trigger[]; conditions: Condition[]; actions: Step[]; complete?: boolean; missing?: string | null; summary?: string };

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

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const WEEKEND = ['sat', 'sun'];
export type DayMode = 'every' | 'weekdays' | 'weekends' | 'pick';
const FULL: Record<string, string> = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const same = (a: string[], b: string[]) => a.length === b.length && a.every((d) => b.includes(d));
export const dayModeOf = (days: string[] | undefined): DayMode => (!days || days.length === 0 || days.length === 7 ? 'every' : same(days, WEEKDAYS) ? 'weekdays' : same(days, WEEKEND) ? 'weekends' : 'pick');

/** "every day", "every weekday", "every weekend", "every Monday", "on Monday, Wednesday and Friday". */
export function daysPhrase(days: string[] | undefined): string {
	const m = dayModeOf(days);
	if (m === 'every') return 'every day';
	if (m === 'weekdays') return 'every weekday';
	if (m === 'weekends') return 'every weekend';
	const names = DAYS.map(([d]) => d).filter((d) => days!.includes(d)).map((d) => FULL[d]!);
	return names.length === 1 ? `every ${names[0]}` : `on ${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

type Words = { nameOf: (id: string) => string; unitOf?: (id: string) => string; optsOf?: (id: string) => ActionOption[] };
const span = (s: number) => (s % 3600 === 0 ? `${s / 3600} ${s === 3600 ? 'hour' : 'hours'}` : s % 60 === 0 ? `${s / 60} ${s === 60 ? 'minute' : 'minutes'}` : `${s} seconds`);
const at = (t: string) => clock(new Date(`2000-01-01T${t}:00`));

/** The "when" part: "Every weekday at 23:00", "When Front door turns on". `plain` is true when it needs no "When". */
function whenWords(t: Trigger[], days: string[] | undefined, w: Words): string {
	const dayText = daysPhrase(days);
	const every = days && dayModeOf(days) !== 'every';
	const parts = t.map((x) => {
		if (x.type === 'time') return `${every ? capitalize(dayText) : 'Every day'} at ${at(x.at)}`;
		if (x.type === 'sun') {
			const o = x.offsetMinutes ?? 0, ev = x.event;
			return `${every ? capitalize(dayText) + ', ' : 'Every day, '}${o ? `${span(Math.abs(o) * 60)} ${o < 0 ? 'before' : 'after'} ${ev}` : `at ${ev}`}`;
		}
		const u = (id: string) => w.unitOf?.(id) ?? '';
		const core = x.type === 'device_state' ? `${w.nameOf(x.entityId)} ${x.forSeconds ? `stays ${x.to} for ${span(x.forSeconds)}` : `turns ${x.to}`}`
			: x.type === 'sensor' ? `${w.nameOf(x.entityId)} ${x.above !== undefined && x.below === undefined ? `goes above ${x.above}${u(x.entityId)}` : x.below !== undefined && x.above === undefined ? `goes below ${x.below}${u(x.entityId)}` : `is between ${x.above}${u(x.entityId)} and ${x.below}${u(x.entityId)}`}${x.forSeconds ? ` for ${span(x.forSeconds)}` : ''}`
			: `the house is set to ${capitalize(x.mode)}`;
		return `When ${core}${every ? `, ${dayText}` : ''}`;
	});
	return parts.join(', or ');
}
const condWords = (c: Condition, w: Words): string =>
	c.type === 'device_state' ? `${w.nameOf(c.entityId)} is ${c.is}`
	: c.type === 'sensor' ? `${w.nameOf(c.entityId)} ${c.above !== undefined && c.below !== undefined ? `is between ${c.above} and ${c.below}` : c.above !== undefined ? `is above ${c.above}` : `is below ${c.below}`}${w.unitOf?.(c.entityId) ?? ''}`
	: c.type === 'time' ? `it is between ${at(c.after)} and ${at(c.before)}`
	: c.type === 'mode' ? `the house is in ${capitalize(c.mode)} mode`
	: '';

/**
 * The one sentence at the top of the builder: "Every weekday at 23:00, turn off Kitchen and Desk, then set the house to Night."
 * Built from the same triggers, conditions and steps that get saved, so it is never out of date.
 */
export function plainWords(t: Trigger[], c: Condition[], steps: Step[], w: Words): string {
	const days = c.find((x) => x.type === 'days')?.days;
	const others = c.map((x) => condWords(x, w)).filter(Boolean);
	const what = stepsSentence(steps, w.nameOf, w.optsOf);
	if (!t.length && !what) return 'Choose when this should happen and what it should do, and it will be written out here.';
	const when = t.length ? whenWords(t, days, w) : 'Choose when it should run';
	const only = others.length ? `, but only if ${others.join(' and ')}` : '';
	return `${when}${only}, ${what || 'choose what it should do'}.`;
}

/** A routine idea as the server offers it: the steps are chosen from this home's own devices. */
export type RoutineIdea = { key: string; name: string; blurb: string; defaultSteps: Step[]; complete?: boolean; missing?: string | null; summary?: string };
