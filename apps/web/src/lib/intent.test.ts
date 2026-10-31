import { expect, test } from 'bun:test';
import { parseIntent, type Ctx } from './intent';

const c: Ctx = {
	rooms: [{ id: 'k', name: 'Kitchen' }, { id: 'b', name: 'Bedroom' }],
	devices: [
		{ id: 'light.k1', name: 'Kitchen Lights', category: 'light', roomId: 'k' }, { id: 'light.k2', name: 'Counter Lamp', category: 'light', roomId: 'k' },
		{ id: 'light.b1', name: 'Bed Light', category: 'light', roomId: 'b' }, { id: 'fan.b', name: 'Bedroom Fan', category: 'fan', roomId: 'b' },
		{ id: 'lock.f', name: 'Front Door', category: 'lock', roomId: null }, { id: 'lock.k', name: 'Kitchen Door', category: 'lock', roomId: 'k' }, { id: 'sensor.t', name: 'Temp', category: 'sensor', roomId: null }
	],
	scenes: [{ id: 'scene.movie', name: 'Movie Time' }], routines: [{ id: 'r1', name: 'Good Night' }]
};

test('turns things on and off by room, type or name', () => {
	expect(parseIntent('turn off the kitchen lights', c)).toMatchObject({ kind: 'devices', action: 'turn_off', ids: ['light.k1', 'light.k2'] });
	expect(parseIntent('turn on bed light', c)).toMatchObject({ action: 'turn_on', ids: ['light.b1'] });
	expect(parseIntent('switch off all lights', c)).toMatchObject({ action: 'turn_off', ids: ['light.k1', 'light.k2', 'light.b1'] });
	expect(parseIntent('bedroom fan off', c)).toMatchObject({ action: 'turn_off', ids: ['fan.b'] });
});

test('sets brightness, locks, and runs scenes and routines', () => {
	expect(parseIntent('set bed light to 40%', c)).toMatchObject({ action: 'set_brightness', value: 40, ids: ['light.b1'] });
	expect(parseIntent('lock front door', c)).toMatchObject({ action: 'lock', ids: ['lock.f'] });
	expect(parseIntent('lock all doors', c)).toMatchObject({ action: 'lock', ids: ['lock.f', 'lock.k'] });
	expect(parseIntent('activate movie', c)).toEqual({ kind: 'scene', id: 'scene.movie', label: 'Activate Movie Time' });
	expect(parseIntent('run good night', c)).toMatchObject({ kind: 'routine', id: 'r1' });
});

test('refuses to unlock and never guesses', () => {
	expect(parseIntent('unlock the front door', c)).toMatchObject({ kind: 'refused' });
	expect(parseIntent('turn off the garage', c)).toBeNull();
	expect(parseIntent('turn on lock', c)).toBeNull();
	expect(parseIntent('hello', c)).toBeNull();
	expect(parseIntent('turn off the sensor', c)).toBeNull(); // not something that switches
});
