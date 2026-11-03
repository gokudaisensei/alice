<script lang="ts">
	import { onMount } from 'svelte';
	import { home } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { tileClass } from '#lib/tiles.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';
	import { security, environment, running } from '#lib/components/panel/status.js';
	import { clock, longDate, ago, plural } from '#lib/fmt.js';
	import { capitalize } from '#lib/utils.js';
	import { X, MonitorSmartphone, ShieldCheck, ShieldAlert, Thermometer, Droplets, Zap, WifiOff, Play } from '@lucide/svelte';

	// A control panel for a spare phone or tablet on the wall: big clock, one tap to anything, the screen stays awake,
	// and after a couple of idle minutes it dims to just the time. Touch anywhere to wake it.
	let now = $state(new Date()), idle = $state(false), openRoom = $state<string | null>(null), pending = $state<string | null>(null), shot = $state(0), awake = $state<boolean | null>(null);
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
		const tick = setInterval(() => { now = new Date(); if (now.getSeconds() === 0 && now.getMinutes() % 2 === 0) shot++; }, 1000);
		const back = () => { if (document.visibilityState === 'visible') void keepAwake(); };
		document.addEventListener('visibilitychange', back);
		void keepAwake(); poke();
		return () => { clearInterval(tick); clearTimeout(idleTimer); document.removeEventListener('visibilitychange', back); void lock?.release(); };
	});

	const usable = $derived(home.devices.filter((d) => d.controls.length > 0 && d.category !== 'camera'));
	const sec = $derived(security(home.devices)), env = $derived(environment(home.devices)), on = $derived(running(home.devices));
	const cameras = $derived(home.devices.filter((d) => d.category === 'camera' && d.available).slice(0, 2));
	const rooms = $derived(home.orderedRooms.map((r) => ({ ...r, count: running(home.inRoom(r.id)).length, devices: usable.filter((d) => d.roomId === r.id) })).filter((r) => r.devices.length));
	const open = $derived(rooms.find((r) => r.id === openRoom));
	const actions = $derived([
		...home.scenes.map((s) => ({ key: s.id, name: s.name, busy: home.busy[s.id], run: () => home.activateScene(s) })),
		...home.routines.filter((r) => !r.needsAttention).map((r) => ({ key: `r:${r.id}`, name: r.name, busy: home.busy[`routine:${r.id}`], run: () => home.runRoutine(r) }))
	].slice(0, 8));
	const time = $derived(clock(now));
	const date = $derived(`${now.toLocaleDateString([], { weekday: 'long' })}, ${longDate(now)}`);
	// The panel never looks fresher than it is: if the hub has not answered for a while, say so.
	const stale = $derived(!home.online || home.haHealth !== 'ok' || (home.lastOkAt != null && now.getTime() - home.lastOkAt > 90_000));
	const updated = $derived(home.lastOkAt == null ? 'Waiting for the hub' : `${stale ? 'Out of date, last updated' : 'Updated'} ${clock(home.lastOkAt)}${stale ? ` (${ago(home.lastOkAt, now.getTime())})` : ''}`);
	const modes = $derived(home.mode?.available ? home.mode.modes : []);
	const risky = (m: string) => m === 'away' || m === 'vacation';
	function pick(m: string) {
		haptics.tap();
		if (!home.mode?.canSet || m === home.mode.current) return;
		if (risky(m)) pending = m; else void home.setMode(m);
	}
	async function confirm() { const m = pending; pending = null; if (m) await home.setMode(m); }
</script>

<svelte:head><title>Wall panel</title></svelte:head>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="min-h-dvh bg-background px-5 pb-8 pt-5 md:px-8" onpointerdown={poke} onkeydown={poke}>
	<div class="grid gap-6 landscape:lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:grid-cols-1">
		<!-- Left: when it is, which mode, and the conditions indoors -->
		<div class="space-y-6">
			<header class="flex items-start justify-between gap-4">
				<div>
					<p class="figure text-[4.5rem] leading-none tracking-[-0.04em] md:text-[7rem]">{time}</p>
					<p class="mt-2 text-xl text-muted-foreground md:text-2xl">{date}</p>
				</div>
				<div class="flex items-center gap-2 pt-1">
					{#if awake === false}<span class="hidden items-center gap-1.5 text-sm text-muted-foreground sm:flex"><MonitorSmartphone class="size-5" />Can’t keep the screen on</span>{/if}
					<a href="/" class="flex size-14 items-center justify-center rounded-full bg-secondary text-muted-foreground" aria-label="Leave the wall panel" onclick={() => haptics.tap()}><X class="size-6" /></a>
				</div>
			</header>

			{#if modes.length}
				<section aria-labelledby="pm" class="space-y-3">
					<h2 id="pm" class="text-lg font-semibold text-muted-foreground">Household mode</h2>
					<div class="grid grid-cols-2 gap-3 sm:grid-cols-4 landscape:lg:grid-cols-2" role="group" aria-label="Household mode">
						{#each modes as m (m)}
							<button type="button" disabled={!home.mode?.canSet} aria-pressed={home.mode?.current === m} onclick={() => pick(m)} class="h-16 rounded-2xl text-xl font-semibold transition-colors disabled:opacity-60 {home.mode?.current === m ? 'bg-foreground text-background' : 'bg-secondary text-foreground'}">{capitalize(m)}</button>
						{/each}
					</div>
					{#if !home.mode?.canSet}<p class="text-base text-muted-foreground">You don’t have permission to change the mode.</p>{/if}
					{#if pending}
						<div class="space-y-3 rounded-2xl bg-accent p-4" role="alertdialog" aria-label="Confirm mode change">
							<p class="text-lg font-medium">Switch to {capitalize(pending)}?{#if !sec.ok && sec.total} <span class="font-normal text-signal-foreground">Right now: {sec.issues.join(', ')}.</span>{/if}</p>
							<div class="flex gap-3">
								<button type="button" class="h-14 flex-1 rounded-2xl bg-primary text-lg font-semibold text-primary-foreground" onclick={confirm}>Switch to {capitalize(pending)}</button>
								<button type="button" class="h-14 rounded-2xl bg-secondary px-6 text-lg font-medium" onclick={() => (pending = null)}>Cancel</button>
							</div>
						</div>
					{/if}
				</section>
			{/if}

			<section aria-labelledby="pe" class="space-y-3">
				<h2 id="pe" class="text-lg font-semibold text-muted-foreground">Inside</h2>
				<div class="grid grid-cols-3 gap-3">
					{#each [[Thermometer, 'Temperature', env.temp, env.tempSource], [Droplets, 'Humidity', env.humidity, env.humid?.name], [Zap, 'Power now', env.power, env.powerSource]] as const as [Icon, label, value, src] (label)}
						<div class="rounded-2xl bg-card p-4">
							<Icon class="size-6 text-muted-foreground" aria-hidden="true" />
							<p class="figure mt-2 text-3xl md:text-4xl">{value ?? '—'}</p>
							<p class="mt-1 text-base text-muted-foreground">{label}</p>
							{#if value && src}<p class="truncate text-sm text-muted-foreground/80">{src}</p>{/if}
						</div>
					{/each}
				</div>
				<p class="flex items-center gap-2 text-base {stale ? 'font-semibold text-signal' : 'text-muted-foreground'}" aria-live="polite">{#if stale}<WifiOff class="size-5" />{/if}{updated}</p>
			</section>
		</div>

		<!-- Right: security first, then what to press, then where things are -->
		<div class="space-y-6">
			<section aria-label="Security" class="rounded-3xl p-5 md:p-6 {sec.total === 0 ? 'bg-card' : sec.ok && !stale ? 'bg-card' : 'bg-signal-soft text-signal-foreground'}" aria-live="polite">
				<div class="flex items-center gap-4">
					{#if sec.ok}<ShieldCheck class="size-12 shrink-0 text-ok" aria-hidden="true" />{:else}<ShieldAlert class="size-12 shrink-0" aria-hidden="true" />{/if}
					<div class="min-w-0">
						<p class="text-3xl font-semibold tracking-[-0.02em] md:text-4xl">{sec.headline}</p>
						{#if sec.detail}<p class="mt-1 text-lg text-muted-foreground">{sec.detail}</p>{/if}
					</div>
				</div>
				{#if sec.unlocked.length || sec.open.length || sec.unknown.length}
					<ul class="mt-4 flex flex-wrap gap-2 text-lg font-medium">
						{#each sec.unlocked as d (d.id)}<li class="rounded-full bg-background/60 px-4 py-2">{d.name}: Unlocked</li>{/each}
						{#each sec.open as d (d.id)}<li class="rounded-full bg-background/60 px-4 py-2">{d.name}: Open</li>{/each}
						{#each sec.unknown as d (d.id)}<li class="rounded-full bg-background/60 px-4 py-2">{d.name}: Not reporting</li>{/each}
					</ul>
				{/if}
			</section>

			{#if actions.length}
				<section aria-labelledby="pq" class="space-y-3">
					<h2 id="pq" class="text-lg font-semibold text-muted-foreground">Scenes and routines</h2>
					<div class="grid grid-cols-2 gap-3 md:grid-cols-4">
						{#each actions as a (a.key)}
							<button type="button" disabled={a.busy} onclick={() => { haptics.tap(); void a.run(); }} class="flex min-h-20 items-center gap-3 rounded-2xl bg-secondary px-4 py-3 text-left text-xl font-semibold transition-colors active:bg-accent disabled:opacity-60"><Play class="size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><span class="line-clamp-2">{a.name}</span></button>
						{/each}
					</div>
				</section>
			{/if}

			<section aria-labelledby="pn" class="space-y-3">
				<h2 id="pn" class="text-lg font-semibold text-muted-foreground">Currently on</h2>
				{#if on.length}
					<ul class="flex flex-wrap gap-2">{#each on as d (d.id)}<li class="rounded-full bg-on-soft px-4 py-2 text-lg font-medium text-on-foreground">{d.name}</li>{/each}</ul>
					<p class="text-base text-muted-foreground">{plural(on.length, 'device')} running</p>
				{:else}<p class="text-lg text-muted-foreground">Nothing is running.</p>{/if}
			</section>

			{#if rooms.length}
				<section aria-labelledby="pr" class="space-y-3">
					<h2 id="pr" class="text-lg font-semibold text-muted-foreground">Rooms</h2>
					<div class="grid grid-cols-2 gap-3 md:grid-cols-3">
						{#each rooms as r (r.id)}
							<button type="button" aria-expanded={openRoom === r.id} onclick={() => { haptics.tap(); openRoom = openRoom === r.id ? null : r.id; }} class="min-h-20 rounded-2xl px-4 py-3 text-left transition-colors {openRoom === r.id ? 'bg-foreground text-background' : 'bg-secondary'}">
								<span class="block text-xl font-semibold">{r.name}</span>
								<span class="text-base {openRoom === r.id ? 'opacity-80' : 'text-muted-foreground'}">{r.count ? `${r.count} on` : 'All off'}</span>
							</button>
						{/each}
					</div>
					{#if open}<div class="tile-grid">{#each open.devices as d (d.id)}<div class={tileClass(d)}><DeviceCard device={d} /></div>{/each}</div>{/if}
				</section>
			{/if}

			{#if cameras.length}
				<section aria-labelledby="pc" class="space-y-3">
					<h2 id="pc" class="text-lg font-semibold text-muted-foreground">Cameras</h2>
					<div class="grid gap-3 sm:grid-cols-2">
						{#each cameras as c (c.id)}
							<figure class="overflow-hidden rounded-2xl bg-card">
								{#key shot}<img src="/api/devices/{encodeURIComponent(c.id)}/snapshot" alt="Latest picture from {c.name}" class="aspect-video w-full bg-muted object-cover" loading="lazy" />{/key}
								<figcaption class="px-4 py-2 text-lg font-medium">{c.name}</figcaption>
							</figure>
						{/each}
					</div>
				</section>
			{/if}

			{#if home.loaded && !rooms.length && !actions.length && !on.length && !cameras.length}<p class="text-center text-lg text-muted-foreground">Nothing to show here yet.</p>{/if}
		</div>
	</div>

	{#if idle}
		<button type="button" class="fixed inset-0 z-50 flex flex-col items-center justify-center bg-black text-white" onclick={poke} aria-label="Wake the panel">
			<span class="figure text-[5rem] leading-none tracking-[-0.04em] opacity-60 md:text-[9rem]">{time}</span>
			<span class="mt-3 text-lg opacity-40">{date}</span>
			{#if sec.total}<span class="mt-6 text-xl opacity-50">{sec.ok ? 'Secure' : sec.headline}</span>{/if}
			{#if stale}<span class="mt-2 text-lg opacity-50">{updated}</span>{/if}
		</button>
	{/if}
</div>
