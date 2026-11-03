import { expect, test } from 'bun:test';
import { stepsSentence } from './steps.js';
import { dayModeOf, daysPhrase, plainWords } from './automations.js';

const nameOf = (id: string) => ({ a: 'Kitchen', b: 'Desk', c: 'Hall', d: 'Porch', e: 'Lamp' })[id] ?? id;
const off = (id: string) => ({ type: 'device' as const, entityId: id, action: 'turn_off' });

test('neighbouring devices with the same action are grouped', () => {
	expect(stepsSentence([off('a'), off('b'), { type: 'mode', mode: 'night' }], nameOf)).toBe('turn off Kitchen and Desk, then set the house to Night');
	expect(stepsSentence(['a', 'b', 'c', 'd', 'e'].map(off), nameOf)).toBe('turn off Kitchen, Desk, Hall and 2 more');
	expect(stepsSentence([], nameOf)).toBe('');
});
test('days read as household phrases', () => {
	expect(dayModeOf(['mon', 'tue', 'wed', 'thu', 'fri'])).toBe('weekdays');
	expect(daysPhrase(['sat', 'sun'])).toBe('every weekend');
	expect(daysPhrase(['mon', 'wed', 'fri'])).toBe('on Monday, Wednesday and Friday');
	expect(daysPhrase([])).toBe('every day');
});
test('the plain-words sentence follows the trigger, days and steps', () => {
	const s = plainWords([{ type: 'time', at: '23:00' }], [{ type: 'days', days: ['mon', 'tue', 'wed', 'thu', 'fri'] }], [off('a'), { type: 'mode', mode: 'night' }], { nameOf });
	expect(s).toMatch(/^Every weekday at .*, turn off Kitchen, then set the house to Night\.$/);
	expect(plainWords([], [], [], { nameOf })).toContain('Choose when');
});
