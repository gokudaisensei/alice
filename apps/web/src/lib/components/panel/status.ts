import type { Device } from '#lib/home.svelte.js';
import { measure, sensorWord, plural } from '#lib/fmt.js';

/** One honest reading of the home, shared by the wall panel and the status picture so they never disagree. */
const live = (d: Device) => d.available;
const isOpening = (d: Device) => d.category !== 'lock' && ['Open', 'Closed'].includes(sensorWord(d) ?? '');

export function security(devices: Device[]) {
	const locks = devices.filter((d) => d.category === 'lock');
	const openings = devices.filter(isOpening);
	const unlocked = locks.filter((d) => live(d) && d.state === 'unlocked');
	const open = openings.filter((d) => live(d) && sensorWord(d) === 'Open');
	const unknown = [...locks, ...openings].filter((d) => !live(d));
	const total = locks.length + openings.length;
	const issues = [
		unlocked.length ? `${plural(unlocked.length, 'door')} unlocked` : '',
		open.length ? `${open.length} open` : '',
		unknown.length ? `${plural(unknown.length, 'device')} not reporting` : ''
	].filter(Boolean);
	const ok = total > 0 && !issues.length;
	return {
		locks, openings, unlocked, open, unknown, total, ok, issues,
		headline: total === 0 ? 'No locks or door sensors' : ok ? 'Secure' : issues.join(' · '),
		detail: ok ? [locks.length ? `${plural(locks.length, 'lock')} locked` : '', openings.length ? `${plural(openings.length, 'door or window sensor')} closed` : ''].filter(Boolean).join(' · ') : ''
	};
}

export function environment(devices: Device[]) {
	// Same source as the Home screen: the first available climate device.
	const climate = devices.find((d) => d.category === 'climate' && d.available);
	const humid = devices.find((d) => d.available && d.reading?.unit === '%' && (d.reading.cls === 'humidity' || /humid/i.test(d.name)));
	const watts = devices.filter((d) => d.category === 'energy' && d.available && d.reading?.unit === 'W');
	const meter = watts.find((d) => /whole|house|grid|total/i.test(d.name)) ?? watts[0];
	const temp = climate?.reading ? measure(climate.reading.value, climate.reading.unit ?? '°C', { short: true }) : null;
	return {
		climate, humid, meter,
		temp, tempSource: climate?.name ?? null,
		humidity: humid?.reading ? measure(humid.reading.value, '%') : null,
		power: meter?.reading ? measure(meter.reading.value, 'W') : null, powerSource: meter?.name ?? null
	};
}

/** What is running right now, for the "Currently on" strip. */
export const running = (devices: Device[]) =>
	devices.filter((d) => d.available && ['light', 'switch', 'fan'].includes(d.category) && d.state === 'on');
