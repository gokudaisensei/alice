import { expect, test } from 'bun:test';
import { suggestRooms } from './roomSuggest';

const d = (id: string, name: string, roomId: string | null = null) => ({ id, name, roomId });
test('groups unplaced devices by the room their name points to', () => {
	const s = suggestRooms([d('a', 'Bedroom Fan'), d('b', 'Bedroom Light'), d('c', 'Kitchen Light'), d('e', 'Garage Heater'), d('f', 'Coffee machine')], []);
	expect(s.map((x) => [x.name, x.deviceIds.length])).toEqual([['Bedroom', 2], ['Garage', 1], ['Kitchen', 1]]);
});
test('reuses an existing room and skips devices that already have one', () => {
	const s = suggestRooms([d('a', 'Kitchen Light'), d('b', 'Kitchen Plug', 'r1')], [{ id: 'r1', name: 'kitchen' }]);
	expect(s).toEqual([{ name: 'Kitchen', roomId: 'r1', deviceIds: ['a'] }]);
});
