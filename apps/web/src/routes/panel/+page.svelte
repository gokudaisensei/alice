<script lang="ts">
	import { onMount } from 'svelte';
	import { home } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { tileClass } from '#lib/tiles.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';
	import { X, MonitorSmartphone } from '@lucide/svelte';

	// A control panel for a spare phone or tablet on the wall: big clock, one tap to anything, the screen stays awake,
	// and after a couple of idle minutes it dims to just the time. Touch anywhere to wake it.
	let now = $state(new Date()), idle = $state(false), room = $state<string>('all'), awake = $state<boolean | null>(null);
	let idleTimer: ReturnType<typeof setTimeout> | undefined, lock: { release: () => Promise<void> } | null = null;
	const IDLE_MS = 120_000;
	const poke = () => { idle = false; clearTimeout(idleTimer); idleTimer = setTimeout(() => (idle = true), IDLE_MS); };

	async function keepAwake() {
		try {
			const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
			if (!wl) { awake = false; return; }
			lock = await wl.request('screen'); awake = true;
		} catch { awake = false; }
	}
	onMount(() => {
		const tick = setInterval(() => (now = new Date()), 1000);
		const back = () => { if (document.visibilityState === 'visible') void keepAwake(); };
		document.addEventListener('visibilitychange', back);
		void keepAwake(); poke();
		return () => { clearInterval(tick); clearTimeout(idleTimer); document.removeEventListener('visibilitychange', back); void lock?.release(); };
	});

	const usable = $derived(home.devices.filter((d) => d.controls.length > 0 && d.category !== 'camera'));
	const rooms = $derived(home.orderedRooms.filter((r) => usable.some((d) => d.roomId === r.id)));
	const shown = $derived(room === 'all' ? (home.favoriteDevices.length ? home.favoriteDevices : usable) : usable.filter((d) => d.roomId === room));
	const time = $derived(now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
	const date = $derived(now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' }));
	const unlocked = $derived(home.devices.filter((d) => d.category === 'lock' && d.available && d.state === 'unlocked').length);
	const lightsOn = $derived(home.devices.filter((d) => d.category === 'light' && d.available && d.state === 'on').length);
</script>

<svelte:head><title>Wall panel</title></svelte:head>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="min-h-dvh bg-background px-5 pb-8 pt-5 md:px-10" onpointerdown={poke} onkeydown={poke}>
	<header class="flex items-start justify-between gap-4">
		<div>
			<p class="figure text-[3.25rem] leading-none tracking-[-0.04em] md:text-[4.5rem]">{time}</p>
			<p class="mt-1.5 text-base text-muted-foreground">{date}</p>
		</div>
		<div class="flex items-center gap-2 pt-1">
			{#if awake === false}<span class="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"><MonitorSmartphone class="size-4" />Can’t keep the screen on</span>{/if}
			<a href="/" class="flex size-11 items-center justify-center rounded-full bg-secondary text-muted-foreground" aria-label="Leave the wall panel" onclick={() => haptics.tap()}><X class="size-5" /></a>
		</div>
	</header>

	<p class="mt-4 text-[0.9375rem] text-muted-foreground" aria-live="polite">{unlocked ? `${unlocked} door${unlocked === 1 ? '' : 's'} unlocked` : 'Everything is locked'} · {lightsOn ? `${lightsOn} light${lightsOn === 1 ? '' : 's'} on` : 'lights are off'}</p>

	{#if rooms.length}
		<div class="-mx-5 mt-5 flex gap-2 overflow-x-auto no-scrollbar px-5 md:mx-0 md:px-0" role="tablist" aria-label="Rooms">
			{#each [{ id: 'all', name: home.favoriteDevices.length ? 'Favorites' : 'All' }, ...rooms] as r (r.id)}
				<button type="button" role="tab" aria-selected={room === r.id} onclick={() => { haptics.tap(); room = r.id; }} class="h-12 shrink-0 rounded-full px-5 text-base font-medium transition-colors {room === r.id ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground'}">{r.name}</button>
			{/each}
		</div>
	{/if}

	<div class="tile-grid mt-5">{#each shown as d (d.id)}<div class={tileClass(d)}><DeviceCard device={d} /></div>{/each}</div>
	{#if home.loaded && !shown.length}<p class="mt-10 text-center text-muted-foreground">Nothing to show here yet.</p>{/if}

	{#if idle}
		<button type="button" class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black text-white" onclick={poke} aria-label="Wake the panel">
			<span class="figure text-[5rem] leading-none tracking-[-0.04em] opacity-60 md:text-[9rem]">{time}</span>
			<span class="mt-3 text-lg opacity-40">{date}</span>
		</button>
	{/if}
</div>
