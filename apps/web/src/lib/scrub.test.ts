import { expect, test } from 'bun:test';
import { crossed, scrubbed } from './scrub';

test('sliding a full tile width covers the whole range, and never leaves it', () => {
	expect(scrubbed(0, 160, 160, 0, 100)).toBe(100);
	expect(scrubbed(50, 80, 160, 0, 100)).toBe(100);
	expect(scrubbed(50, -999, 160, 1, 100)).toBe(1);
	expect(scrubbed(50, 0, 160, 0, 100)).toBe(50);
});
test('temperatures snap to the thermostat step', () => {
	expect(scrubbed(21, 30, 300, 16, 30, 0.5)).toBe(22.5);
	expect(scrubbed(21, 3, 300, 16, 30, 0.5)).toBe(21);
});
test('a tick fires once per notch, in either direction', () => {
	expect(crossed(48, 52, 10)).toBe(true);
	expect(crossed(41, 44, 5)).toBe(false);
	expect(crossed(52, 48, 5)).toBe(true);
	expect(crossed(51, 52, 10)).toBe(false);
});
