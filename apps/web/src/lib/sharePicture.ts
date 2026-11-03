import { parts } from '#lib/fmt.js';

/** The app's own typeface, so a picture looks like the app. */
export const FONT = `'Bricolage Grotesque Variable', ui-sans-serif, system-ui, sans-serif`;
/** Waits until the app's font is ready to draw with; canvas text silently falls back if it is not. */
export async function ensureFont(): Promise<void> {
	try { await Promise.all([400, 500, 600, 700].map((w) => document.fonts.load(`${w} 40px 'Bricolage Grotesque Variable'`))); await document.fonts.ready; } catch { /* fall back to the system face */ }
}

// Turn something drawn on a canvas into a picture the person can send or keep. The share sheet where the phone has one, a download elsewhere.
export async function sharePicture(draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, name: string, title: string, size = { w: 1080, h: 1350 }): Promise<void> {
	await ensureFont();
	const c = document.createElement('canvas'); c.width = size.w; c.height = size.h;
	const g = c.getContext('2d'); if (!g) return;
	draw(g, size.w, size.h);
	const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
	if (!blob) return;
	const file = new File([blob], `${name}.png`, { type: 'image/png' });
	if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title }); } catch { /* cancelled */ } return; }
	const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${name}.png`; a.click();
	setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

/** The week's energy as a poster: the meter, today's figure, the average, and seven bars with their values. */
export function drawEnergy(g: CanvasRenderingContext2D, w: number, h: number, o: { name: string; today: number | null; avg: number; days: { label: string; kwh: number }[]; unit?: string }) {
	const unit = o.unit ?? 'kWh', f = (n: number) => parts(n, unit).v;
	const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#0c1226'); bg.addColorStop(1, '#080b16');
	g.fillStyle = bg; g.fillRect(0, 0, w, h);
	g.textBaseline = 'alphabetic';
	g.fillStyle = '#ffc247'; g.beginPath(); g.arc(120, 140, 30, 0, Math.PI * 2); g.fill();
	g.fillStyle = '#9aa3bd'; g.font = `500 40px ${FONT}`; g.fillText('Energy this week', 176, 154);
	g.fillStyle = '#ffffff'; g.font = `700 54px ${FONT}`; g.fillText(o.name, 90, 290);
	g.font = `700 168px ${FONT}`; g.fillText(o.today != null ? f(o.today) : '—', 90, 470);
	const tw = g.measureText(o.today != null ? f(o.today) : '—').width;
	g.fillStyle = '#9aa3bd'; g.font = `500 50px ${FONT}`; g.fillText(`${unit} today`, 90 + tw + 24, 470);
	g.font = `500 42px ${FONT}`; g.fillText(`Average ${f(o.avg)} ${unit} a day`, 90, 540);

	const top = 640, bottom = 1130, left = 90, right = w - 90, max = Math.max(0.1, ...o.days.map((d) => d.kwh));
	const slot = (right - left) / Math.max(1, o.days.length), bar = Math.min(96, slot * 0.62);
	const avgY = bottom - (o.avg / max) * (bottom - top - 50);
	g.strokeStyle = '#ffffff55'; g.lineWidth = 3; g.setLineDash([14, 12]); g.beginPath(); g.moveTo(left, avgY); g.lineTo(right, avgY); g.stroke(); g.setLineDash([]);
	o.days.forEach((d, i) => {
		const x = left + slot * i + (slot - bar) / 2, hgt = Math.max(10, (d.kwh / max) * (bottom - top - 50)), y = bottom - hgt, last = i === o.days.length - 1;
		g.fillStyle = last ? '#ffc247' : '#7f9bff'; g.globalAlpha = last ? 1 : 0.55;
		g.beginPath(); g.roundRect(x, y, bar, hgt, [16, 16, 4, 4]); g.fill(); g.globalAlpha = 1;
		g.textAlign = 'center'; g.fillStyle = '#ffffff'; g.font = `600 34px ${FONT}`; g.fillText(f(d.kwh), x + bar / 2, y - 16);
		g.fillStyle = '#9aa3bd'; g.font = `500 34px ${FONT}`; g.fillText(d.label, x + bar / 2, bottom + 54);
	});
	g.textAlign = 'left'; g.fillStyle = '#9aa3bd88'; g.font = `500 34px ${FONT}`; g.fillText('Dashed line is the weekly average', 90, 1240);
}
