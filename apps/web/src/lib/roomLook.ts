import { Baby, Bath, Bed, Car, DoorOpen, Footprints, LampDesk, Sofa, Tv, TreePine, Utensils, CookingPot } from '@lucide/svelte';
import type { IconComponent } from './icons.js';

/** The colours and icons a room can have (the same keys the server accepts). */
export const ROOM_COLORS: Record<string, string> = { blue: '#4357d9', teal: '#12929a', green: '#2f9e68', amber: '#d79a00', orange: '#e8702a', red: '#d92d4a', pink: '#d6468f', purple: '#8a4fd8', grey: '#78809a' };
export const ROOM_ICONS: { key: string; label: string; icon: IconComponent }[] = [
	{ key: 'sofa', label: 'Living room', icon: Sofa }, { key: 'bed', label: 'Bedroom', icon: Bed }, { key: 'kitchen', label: 'Kitchen', icon: CookingPot }, { key: 'dining', label: 'Dining room', icon: Utensils },
	{ key: 'bath', label: 'Bathroom', icon: Bath }, { key: 'desk', label: 'Office', icon: LampDesk }, { key: 'car', label: 'Garage', icon: Car }, { key: 'tree', label: 'Garden', icon: TreePine },
	{ key: 'door', label: 'Entrance', icon: DoorOpen }, { key: 'stairs', label: 'Hallway', icon: Footprints }, { key: 'tv', label: 'TV room', icon: Tv }, { key: 'baby', label: 'Nursery', icon: Baby }
];
const BY_NAME: [RegExp, string][] = [[/living|lounge/i, 'sofa'], [/bed/i, 'bed'], [/kitchen/i, 'kitchen'], [/dining/i, 'dining'], [/bath|toilet|wash/i, 'bath'], [/office|study/i, 'desk'], [/garage/i, 'car'], [/garden|yard|patio|balcony/i, 'tree'], [/porch|entry|front/i, 'door'], [/hall|corridor|stair/i, 'stairs'], [/nursery|kids?/i, 'baby'], [/tv|media|cinema/i, 'tv']];

/** A room's own choices, falling back to an icon that fits its name and the app's blue. */
export function roomLook(r: { name: string; color?: string | null; icon?: string | null }): { color: string; icon: IconComponent } {
	const key = r.icon ?? BY_NAME.find(([re]) => re.test(r.name))?.[1];
	return { color: ROOM_COLORS[r.color ?? ''] ?? ROOM_COLORS.blue!, icon: ROOM_ICONS.find((i) => i.key === key)?.icon ?? DoorOpen };
}
