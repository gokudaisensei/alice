/** Suggests rooms from what devices are called ("Bedroom Fan", "Kitchen Light"), so a new home can be organised in one tap. */
export type Suggestion = { name: string; roomId: string | null; deviceIds: string[] };

/** [what to look for, the room it points to] — checked in order, so "master bedroom" wins over "bedroom". */
const ROOMS: [RegExp, string][] = [
	[/living ?room|lounge|\bliving\b/i, 'Living room'], [/dining/i, 'Dining room'], [/kitchen/i, 'Kitchen'], [/(master|guest|kids?) ?bed ?room|bed ?room|\bbedroom\b/i, 'Bedroom'],
	[/bath ?room|toilet|\bwc\b|washroom/i, 'Bathroom'], [/office|study|workroom/i, 'Office'], [/hall(way)?|corridor|entry|foyer/i, 'Hallway'],
	[/garage/i, 'Garage'], [/garden|yard|patio|terrace|lawn/i, 'Garden'], [/balcony/i, 'Balcony'], [/laundry|utility/i, 'Laundry'], [/nursery/i, 'Nursery'], [/porch/i, 'Porch'], [/basement|cellar/i, 'Basement'], [/attic|loft/i, 'Attic']
];

type Dev = { id: string; name: string; roomId: string | null };
type Existing = { id: string; name: string };

/** Groups the devices that are in no room by the room their name points to. A room that already exists is reused rather than duplicated. */
export function suggestRooms(devices: Dev[], rooms: Existing[]): Suggestion[] {
	const by = new Map<string, string[]>();
	for (const d of devices) {
		if (d.roomId) continue;
		const hit = ROOMS.find(([re]) => re.test(d.name));
		if (hit) by.set(hit[1], [...(by.get(hit[1]) ?? []), d.id]);
	}
	return [...by.entries()].map(([name, deviceIds]) => ({ name, roomId: rooms.find((r) => r.name.toLowerCase() === name.toLowerCase())?.id ?? null, deviceIds }))
		.sort((a, b) => b.deviceIds.length - a.deviceIds.length || a.name.localeCompare(b.name));
}
