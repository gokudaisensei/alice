<script lang="ts">
	import { onMount } from 'svelte';
	import { home } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import Page from '#lib/components/app/Page.svelte';
	import { Button } from '#lib/components/ui/button';
	import { security, environment } from '#lib/components/panel/status.js';
	import { longDate, clock } from '#lib/fmt.js';
	import { FONT, ensureFont } from '#lib/sharePicture.js';
	import { Share2, Download } from '@lucide/svelte';

	// A single picture of the home right now, sized for a phone screen, that can be shared or saved.
	let canvas: HTMLCanvasElement | undefined = $state();
	let stamp = $state(Date.now());
	const sec = $derived(security(home.devices)), env = $derived(environment(home.devices));
	const lights = $derived(home.devices.filter((d) => d.category === 'light' && d.available));
	const lightsOn = $derived(lights.filter((d) => d.state === 'on'));
	// Rows: label, value and, where it helps, which device the figure came from.
	const rows = $derived.by(() => {
		const out: { k: string; v: string; src?: string; warn?: boolean }[] = [];
		if (sec.total) out.push({ k: 'Security', v: sec.ok ? 'All secure' : (sec.issues[0] ?? ''), src: sec.issues.slice(1).join(' · ') || undefined, warn: !sec.ok });
		if (lights.length) out.push({ k: 'Lights', v: lightsOn.length ? `${lightsOn.length} on` : 'All off' });
		if (env.temp) out.push({ k: 'Inside', v: env.temp, src: env.tempSource ?? undefined });
		if (env.humidity) out.push({ k: 'Humidity', v: env.humidity, src: env.humid?.name });
		if (env.power) out.push({ k: 'Power now', v: env.power, src: env.powerSource ?? undefined });
		return out;
	});
	const title = $derived(sec.total === 0 ? 'Home at a glance' : sec.ok ? 'All quiet at home' : (sec.issues[0] ?? ''));
	const at = $derived(home.lastOkAt ?? stamp), asOf = $derived(`As of ${longDate(at)}, ${clock(at)}`);

	function draw() {
		const c = canvas; if (!c) return;
		const W = 1080, H = 1350; c.width = W; c.height = H;
		const g = c.getContext('2d'); if (!g) return;
		const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#0c1226'); grad.addColorStop(1, '#080b16');
		g.fillStyle = grad; g.fillRect(0, 0, W, H);
		g.textBaseline = 'alphabetic';
		g.fillStyle = '#ffc247'; g.beginPath(); g.arc(120, 150, 34, 0, Math.PI * 2); g.fill();
		g.fillStyle = '#9aa3bd'; g.font = `500 40px ${FONT}`; g.fillText('Home status', 180, 164);
		g.fillStyle = sec.total && !sec.ok ? '#ff7b8f' : '#ffffff'; g.font = `700 108px ${FONT}`;
		title.split(' ').reduce<string[]>((lines, w) => { const l = lines[lines.length - 1] ?? ''; if ((l + ' ' + w).length > 14 && l) lines.push(w); else lines[lines.length - 1] = (l + ' ' + w).trim(); return lines; }, ['']).forEach((l, i) => g.fillText(l, 90, 380 + i * 126));
		const gap = Math.min(150, 540 / Math.max(1, rows.length));
		rows.forEach((r, i) => {
			const y = 660 + i * gap;
			g.fillStyle = '#9aa3bd'; g.font = `500 44px ${FONT}`; g.fillText(r.k, 90, y);
			if (r.src) { g.font = `500 30px ${FONT}`; g.fillStyle = '#9aa3bd99'; g.fillText(r.src.length > 34 ? r.src.slice(0, 33) + '…' : r.src, 90, y + 38); }
			g.fillStyle = r.warn ? '#ff7b8f' : '#ffffff'; g.font = `700 60px ${FONT}`; g.textAlign = 'right'; g.fillText(r.v, W - 90, y); g.textAlign = 'left';
			g.fillStyle = '#ffffff1f'; g.fillRect(90, y + 56, W - 180, 2);
		});
		g.fillStyle = '#9aa3bd'; g.font = `500 34px ${FONT}`; g.fillText(asOf, 90, H - 70);
	}
	onMount(() => { void ensureFont().then(() => { stamp = Date.now(); draw(); }); });
	$effect(() => { rows; title; asOf; draw(); });

	async function blob(): Promise<Blob | null> { return new Promise((res) => canvas?.toBlob(res, 'image/png')); }
	async function share() {
		haptics.tap();
		const b = await blob(); if (!b) return;
		const file = new File([b], 'home-status.png', { type: 'image/png' });
		if (navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: 'Home status' }); return; } catch { return; } }
		save(b);
	}
	function save(b: Blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = 'home-status.png'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
</script>

<Page title="Status picture" subtitle="How the home looks right now, ready to share." back={{ href: '/settings', label: 'Settings' }} width="md">
	<canvas bind:this={canvas} class="mx-auto w-full max-w-sm rounded-3xl border shadow-lg" aria-label="Preview of the status picture"></canvas>
	<div class="mx-auto flex max-w-sm gap-2">
		<Button class="h-12 flex-1" onclick={share}><Share2 />Share</Button>
		<Button class="h-12" variant="secondary" onclick={async () => { const b = await blob(); if (b) save(b); }}><Download />Save</Button>
	</div>
</Page>
