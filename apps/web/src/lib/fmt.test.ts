import { expect, test } from 'bun:test';
import { ago, measure, plural, sensorWord, sentences, trim } from './fmt';

test('plural', () => { expect(plural(1, 'meter')).toBe('1\u00a0meter'); expect(plural(2, 'meter')).toBe('2\u00a0meters'); expect(plural(0, 'box', 'boxes')).toBe('0\u00a0boxes'); });
test('trim drops trailing zeros', () => { expect(trim('55.0')).toBe('55'); expect(trim(21.5)).toBe('21.5'); expect(trim('abc')).toBe('abc'); });
test('measure uses sensible precision and one unit style', () => {
	expect(measure('450.0', 'W')).toBe('450 W');
	expect(measure('55.0', '%')).toBe('55%');
	expect(measure('21.0', '°C')).toBe('21 °C');
	expect(measure('21.04', '°C', { short: true })).toBe('21°');
	expect(measure('unknown', 'W')).toBe('unknown');
});
test('contact sensors read as words', () => {
	expect(sensorWord({ name: 'Front Door', state: 'off', reading: { value: 'off', unit: null, cls: 'door' } })).toBe('Closed');
	expect(sensorWord({ name: 'Garage Window', state: 'on', reading: { value: 'on', unit: null } })).toBe('Open');
	expect(sensorWord({ name: 'Hall', state: 'on', reading: { value: 'on', unit: null, cls: 'motion' } })).toBe('Motion');
	expect(sensorWord({ name: 'Humidity', state: '55', reading: { value: '55', unit: '%' } })).toBeNull();
});
test('ago', () => { const n = 1_000_000_000_000; expect(ago(n - 10_000, n)).toBe('just now'); expect(ago(n - 5 * 60_000, n)).toBe('5 min ago'); expect(ago(n - 3 * 3_600_000, n)).toBe('3 h ago'); });
test('sentences does not double full stops', () => { expect(sentences('Sampling began.', 'Estimates')).toBe('Sampling began. Estimates.'); });
