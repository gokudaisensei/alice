import { expect, test } from 'bun:test';
import { inverse } from './undo';

const light = (state: string, pct: number | null) => ({ state, attrs: { brightnessPct: pct } });

test('switching something on or off is undone by the opposite', () => {
	expect(inverse(light('off', null), 'turn_on')).toEqual({ action: 'turn_off' });
	expect(inverse(light('on', 80), 'turn_off')).toEqual({ action: 'turn_on' });
});
test('nothing to take back when the command changed nothing', () => {
	expect(inverse(light('on', 80), 'turn_on')).toBeNull();
	expect(inverse(light('off', null), 'turn_off')).toBeNull();
});
test('a dimmed light goes back to how bright it was, or off if it was off', () => {
	expect(inverse(light('on', 80), 'set_brightness', 30)).toEqual({ action: 'set_brightness', value: 80 });
	expect(inverse(light('off', null), 'set_brightness', 30)).toEqual({ action: 'turn_off' });
	expect(inverse(light('on', 30), 'set_brightness', 30)).toBeNull();
});
test('fan speed and thermostat targets go back to their old values', () => {
	expect(inverse({ state: 'on', attrs: { speedPct: 40 } }, 'set_speed', 90)).toEqual({ action: 'set_speed', value: 40 });
	expect(inverse({ state: 'heat', attrs: { target: 21 } }, 'set_temperature', 24)).toEqual({ action: 'set_temperature', value: 21 });
});
test('locking is never undone into unlocking', () => {
	expect(inverse({ state: 'unlocked', attrs: {} }, 'lock')).toBeNull();
	expect(inverse({ state: 'locked', attrs: {} }, 'unlock')).toBeNull();
});
