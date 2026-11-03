<script lang="ts">
	import { onDestroy } from 'svelte';
	import { Button } from '#lib/components/ui/button';
	import { Radio, Square } from '@lucide/svelte';

	let { id, name }: { id: string; name: string } = $props();
	let video = $state<HTMLVideoElement | undefined>(), on = $state(false), phase = $state<'idle' | 'loading' | 'playing' | 'failed'>('idle'), why = $state('');
	let hls: { destroy: () => void } | null = null;
	type HlsCtor = typeof import('hls.js').default;
	/** The player is a separate file, fetched only when someone watches a camera, so it is not part of everyone's first download. */
	let loading: Promise<HlsCtor | null> | null = null;
	const loadHls = () => (loading ??= new Promise<HlsCtor | null>((resolve) => {
		const w = window as unknown as { Hls?: HlsCtor };
		if (w.Hls) return resolve(w.Hls);
		const s = document.createElement('script');
		s.src = '/vendor/hls.js'; s.onload = () => resolve(w.Hls ?? null); s.onerror = () => { loading = null; resolve(null); };
		document.head.append(s);
	}));
	const src = $derived(`/api/devices/${encodeURIComponent(id)}/live/master_playlist.m3u8`);

	/** The bundled player where the browser can run it; the browser's own HLS only where it cannot (older iPhones). Browsers that claim native HLS do not all play it. */
	async function start() {
		on = true; phase = 'loading'; why = '';
		await new Promise((r) => setTimeout(r)); // the <video> exists on the next tick
		const v = video; if (!v) return;
		v.muted = true; v.playsInline = true;
		const Hls = await loadHls();
		if (Hls?.isSupported()) {
			const h = new Hls({ enableWorker: false, lowLatencyMode: true, maxBufferLength: 8 });
			hls = h;
			h.on(Hls.Events.ERROR, (_e, d) => { if (d.fatal) fail(d.response?.code === 429 ? 'Too many cameras are open right now. Close one and try again.' : 'The live video isn’t available right now.'); });
			h.loadSource(src); h.attachMedia(v);
			v.play().catch(() => { /* autoplay may need a tap; the controls are shown */ });
		} else if (v.canPlayType('application/vnd.apple.mpegurl')) {
			v.src = src; v.play().catch(() => { /* the controls are shown */ });
		} else fail('This browser can’t play live video.');
	}
	function fail(m: string) { phase = 'failed'; why = m; teardown(); }
	function teardown() { hls?.destroy(); hls = null; if (video) { video.removeAttribute('src'); video.load(); } }
	function stop() { teardown(); on = false; phase = 'idle'; }
	onDestroy(teardown);
</script>

{#if !on}
	<Button variant="secondary" size="sm" onclick={start}><Radio />Watch live</Button>
{:else}
	<div class="space-y-2">
		<div class="relative overflow-hidden rounded-xl bg-muted">
			<!-- svelte-ignore a11y_media_has_caption -->
			<video bind:this={video} class="aspect-video max-h-64 w-full bg-black object-contain" muted playsinline controls aria-label="Live video from {name}" onplaying={() => (phase = 'playing')} onwaiting={() => { if (phase === 'playing') phase = 'loading'; }}></video>
			{#if phase === 'loading'}<span class="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30 text-sm text-white">Connecting…</span>{/if}
		</div>
		{#if phase === 'failed'}<p role="alert" class="text-sm text-signal">{why}</p>{/if}
		<Button variant="secondary" size="sm" onclick={stop}><Square />Stop</Button>
	</div>
{/if}
