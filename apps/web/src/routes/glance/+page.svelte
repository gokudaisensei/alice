<script lang="ts">
	import { onMount } from 'svelte';
	import { home } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import Page from '#lib/components/app/Page.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Share2, Download } from '@lucide/svelte';

	// A single picture of the home right now, sized for a phone screen, that can be shared or saved.
	let canvas: HTMLCanvasElement | undefined = $state();
	const by = (c: string) => home.devices.filter((d) => d.category === c && d.available);
	const rows = $derived.by(() => {
		const unlocked = by('lock').filter((d) => d.state === 'unlocked'), lights = by('light').filter((d) => d.state === 'on');
		const climate = home.devices.find((d) => d.category === 'climate' && d.available && d.reading);
		const watts = home.devices.filter((d) => d.category === 'energy' && d.available && d.reading?.unit === 'W');
		const meter = watts.find((d) => /whole|house|grid|total/i.test(d.name)) ?? watts[0];
		const out: [string, string][] = [];
		if (by('lock').length) out.push(['Doors', unlocked.length ? `${unlocked.length} unlocked` : 'All locked']);
		if (by('light').length) out.push(['Lights', lights.length ? `${lights.length} on` : 'All off']);
		if (climate?.reading) out.push(['Inside', `${climate.reading.value}°`]);
		if (meter?.reading) out.push(['Power now', `${meter.reading.value} W`]);
		return out;
	});
	const title = $derived(by('lock').some((d) => d.state === 'unlocked') ? 'A door is unlocked' : 'All quiet at home');

	function draw() {
		const c = canvas; if (!c) return;
		const W = 1080, H = 1350; c.width = W; c.height = H;
		const g = c.getContext('2d'); if (!g) return;
		const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#0c1226'); grad.addColorStop(1, '#080b16');
		g.fillStyle = grad; g.fillRect(0, 0, W, H);
		g.fillStyle = '#ffc247'; g.beginPath(); g.arc(120, 150, 34, 0, Math.PI * 2); g.fill();
		g.fillStyle = '#9aa3bd'; g.font = '500 40px system-ui, sans-serif'; g.fillText(new Date().toLocaleString([], { weekday: 'long', hour: 'numeric', minute: '2-digit' }), 180, 164);
		g.fillStyle = '#ffffff'; g.font = '700 108px system-ui, sans-serif';
		title.split(' ').reduce<string[]>((lines, w) => { const l = lines[lines.length - 1] ?? ''; if ((l + ' ' + w).length > 14 && l) lines.push(w); else lines[lines.length - 1] = (l + ' ' + w).trim(); return lines; }, ['']).forEach((l, i) => g.fillText(l, 90, 380 + i * 126));
		rows.forEach(([k, v], i) => {
			const y = 640 + i * 150;
			g.fillStyle = '#9aa3bd'; g.font = '500 44px system-ui, sans-serif'; g.fillText(k, 90, y);
			g.fillStyle = '#ffffff'; g.font = '700 64px system-ui, sans-serif'; g.textAlign = 'right'; g.fillText(v, W - 90, y); g.textAlign = 'left';
			g.fillStyle = '#ffffff1f'; g.fillRect(90, y + 38, W - 180, 2);
		});
	}
	onMount(draw);
	$effect(() => { rows; title; draw(); });

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
