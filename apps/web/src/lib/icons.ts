import { Activity, Blinds, Bed, Camera, Coffee, CookingPot, DoorClosed, DoorOpen, Droplets, Fan, Gauge, Heater, Lamp, LampDesk, Lightbulb, Lock, LockOpen, Microwave, Plug, Refrigerator, ToggleRight, Siren, Sofa, Speaker, Thermometer, Tv, Warehouse, WashingMachine, Zap, type House } from '@lucide/svelte';
import type { Device } from './home.svelte.js';
import { sensorWord } from './fmt.js';

/** Every Lucide icon is the same kind of component, so any one of them stands in for the type. */
export type IconComponent = typeof House;

/** The icons a person can choose for a device (the same keys the server accepts). */
export const ICON_CHOICES: { key: string; label: string; icon: IconComponent }[] = [
	{ key: 'bulb', label: 'Light', icon: Lightbulb }, { key: 'lamp', label: 'Lamp', icon: LampDesk }, { key: 'plug', label: 'Plug', icon: Plug },
	{ key: 'coffee', label: 'Coffee', icon: Coffee }, { key: 'kettle', label: 'Kettle', icon: CookingPot }, { key: 'heater', label: 'Heater', icon: Heater },
	{ key: 'fan', label: 'Fan', icon: Fan }, { key: 'tv', label: 'TV', icon: Tv }, { key: 'speaker', label: 'Speaker', icon: Speaker },
	{ key: 'lock', label: 'Lock', icon: Lock }, { key: 'door', label: 'Door', icon: DoorClosed }, { key: 'window', label: 'Window', icon: Blinds },
	{ key: 'garage', label: 'Garage', icon: Warehouse }, { key: 'camera', label: 'Camera', icon: Camera }, { key: 'thermometer', label: 'Temperature', icon: Thermometer },
	{ key: 'water', label: 'Water', icon: Droplets }, { key: 'bolt', label: 'Power', icon: Zap }, { key: 'motion', label: 'Motion', icon: Activity },
	{ key: 'smoke', label: 'Smoke', icon: Siren }, { key: 'washer', label: 'Washer', icon: WashingMachine }, { key: 'fridge', label: 'Fridge', icon: Refrigerator },
	{ key: 'oven', label: 'Oven', icon: Microwave }, { key: 'bed', label: 'Bed', icon: Bed }, { key: 'sofa', label: 'Sofa', icon: Sofa }
];
const BY_KEY = new Map(ICON_CHOICES.map((c) => [c.key, c.icon]));

/** Names that say what a plug or switch really is, checked in order. */
const NAMED: [RegExp, string][] = [
	[/coffee|espresso/i, 'coffee'], [/kettle/i, 'kettle'], [/heater|radiator|geyser|boiler/i, 'heater'], [/\bfan\b|cooler/i, 'fan'], [/\btv\b|television/i, 'tv'],
	[/speaker|sound|music/i, 'speaker'], [/wash|laundry|dryer/i, 'washer'], [/fridge|refrigerator|freezer/i, 'fridge'], [/oven|microwave|stove|cooker/i, 'oven'], [/lamp/i, 'lamp']
];

/** The icon for a device: the person's own choice, else one picked from its kind, its reading and its name. */
export function iconFor(d: Pick<Device, 'category' | 'state' | 'name' | 'reading'> & { icon?: string | null; deviceClass?: string | null }): IconComponent {
	if (d.icon && BY_KEY.has(d.icon)) {
		if (d.icon === 'lock' && d.category === 'lock' && d.state === 'unlocked') return LockOpen;
		if (d.icon === 'door' && d.state === 'on') return DoorOpen;
		return BY_KEY.get(d.icon)!;
	}
	switch (d.category) {
		case 'lock': return d.state === 'unlocked' ? LockOpen : Lock;
		case 'light': return /lamp/i.test(d.name) ? LampDesk : Lightbulb;
		case 'fan': return Fan;
		case 'climate': return Thermometer;
		case 'camera': return Camera;
		case 'media': return /speaker|sound|music/i.test(d.name) ? Speaker : Tv;
		case 'energy': return Zap;
		case 'switch': { const k = NAMED.find(([re]) => re.test(d.name))?.[1]; return (k && BY_KEY.get(k)) || (d.deviceClass === 'outlet' ? Plug : ToggleRight); }
		case 'sensor': {
			const cls = d.reading?.cls ?? '';
			const word = sensorWord(d as Parameters<typeof sensorWord>[0]);
			if (cls === 'door' || /\bdoor\b|gate/i.test(d.name)) return word === 'Open' ? DoorOpen : DoorClosed;
			if (cls === 'window' || /window/i.test(d.name)) return Blinds;
			if (cls === 'garage_door' || /garage/i.test(d.name)) return Warehouse;
			if (cls === 'motion' || cls === 'occupancy' || /motion/i.test(d.name)) return Activity;
			if (cls === 'moisture' || cls === 'humidity' || /leak|flood|humid|water/i.test(d.name)) return Droplets;
			if (cls === 'smoke' || cls === 'gas' || /smoke/i.test(d.name)) return Siren;
			if (cls === 'temperature' || /temperature/i.test(d.name)) return Thermometer;
			return Gauge;
		}
		default: return Lamp;
	}
}
