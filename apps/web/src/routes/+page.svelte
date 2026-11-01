<script lang="ts">
	import { onMount } from 'svelte';
	import { fade } from 'svelte/transition';
	import { dur } from '#lib/motion.js';
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { api } from '#lib/api.js';
	import { chrome } from '#lib/chrome.svelte.js';
	import { home, type Device } from '#lib/home.svelte.js';
	import { notifications } from '#lib/notifications.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { viewport } from '#lib/viewport.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { tileClass, isWide } from '#lib/tiles.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';
	import Insights from '#lib/components/app/Insights.svelte';
	import ModeCard from '#lib/components/app/ModeCard.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Collapse from '#lib/components/app/Collapse.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Check, ChevronDown, Gauge, GripVertical, Lightbulb, Loader2, Lock, LockOpen, Plug, Search, ShieldAlert, Sparkles, Thermometer, Tv, Video, WifiOff, X, Zap } from '@lucide/svelte';

	const t = $derived(home.prefs?.template ?? 'comfort');
	const sections = $derived(home.prefs?.sections ?? ['favorites', 'rooms']);

	// ---- the sentence ----
	const hour = new Date().getHours();
	const greeting = hour < 5 ? 'Still up' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
	const NUM = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
	const n = (k: number) => (k <= 10 ? NUM[k] : String(k));
	const by = (c: string) => home.devices.filter((d) => d.category === c);
	const lights = $derived(by('light')), lightsOn = $derived(lights.filter((d) => d.available && d.state === 'on'));
	const locks = $derived(by('lock')), unlocked = $derived(locks.filter((d) => d.available && d.state === 'unlocked'));
	const offline = $derived(home.devices.filter((d) => d.reason === 'device_offline'));
	const headline = $derived.by(() => {
		if (!home.loaded) return 'One moment…';
		if (home.haHealth !== 'ok') return 'The hub can’t be reached.';
		if (!home.devices.length) return 'Your home is ready.';
		const p: string[] = [];
		if (unlocked.length) p.push(unlocked.length === 1 ? `${unlocked[0].name} is unlocked.` : `${n(unlocked.length)} doors unlocked.`);
		else if (locks.length) p.push('Everything is locked.');
		if (lights.length) p.push(lightsOn.length === 0 ? 'Lights are off.' : lightsOn.length === 1 ? `${lightsOn[0].name} is on.` : `${n(lightsOn.length)} lights on.`);
		return p.join(' ') || 'Everything looks calm.';
	});

	// ---- status chips: each one is a summary, a filter, and a way in ----
	const climate = $derived(home.devices.find((d) => d.category === 'climate' && d.available));
	const meter = $derived(home.devices.find((d) => d.category === 'energy' && d.available && d.reading?.unit === 'W'));
	const playing = $derived(by('media').filter((d) => d.state === 'playing').length);
	const cams = $derived(by('camera'));
	const sensors = $derived(home.devices.filter((d) => (d.category === 'sensor' || d.category === 'energy') && d.reading && d.available && Number.isFinite(Number(d.reading.value))).slice(0, 8));
	const plugs = $derived(home.devices.filter((d) => ['switch', 'fan'].includes(d.category)));
	type Chip = { key: string; label: string; value: string; icon: any; tone: 'on' | 'signal' | 'none'; cats: string[] };
	const chips = $derived.by<Chip[]>(() => {
		const c: Chip[] = [];
		if (lights.length) c.push({ key: 'lights', label: 'Lights', value: lightsOn.length ? `${lightsOn.length} on` : 'Off', icon: Lightbulb, tone: lightsOn.length ? 'on' : 'none', cats: ['light'] });
		if (locks.length) c.push({ key: 'security', label: 'Doors', value: unlocked.length ? `${unlocked.length} open` : 'Locked', icon: unlocked.length ? LockOpen : Lock, tone: unlocked.length ? 'signal' : 'none', cats: ['lock'] });
		if (climate) c.push({ key: 'climate', label: 'Climate', value: climate.reading ? `${climate.reading.value}°` : climate.state, icon: Thermometer, tone: 'none', cats: ['climate'] });
		if (plugs.length) c.push({ key: 'plugs', label: 'Plugs & fans', value: `${plugs.filter((d) => d.state === 'on').length} on`, icon: Plug, tone: plugs.some((d) => d.state === 'on') ? 'on' : 'none', cats: ['switch', 'fan'] });
		if (by('media').length) c.push({ key: 'media', label: 'Media', value: playing ? `${playing} playing` : 'Idle', icon: Tv, tone: 'none', cats: ['media'] });
		if (cams.length) c.push({ key: 'cameras', label: 'Cameras', value: String(cams.length), icon: Video, tone: 'none', cats: ['camera'] });
		if (meter) c.push({ key: 'energy', label: 'Power', value: `${meter.reading?.value} W`, icon: Zap, tone: 'none', cats: [] });
		return c;
	});
	let filter = $state<string | null>(null);
	const active = $derived(chips.find((c) => c.key === filter));
	const filtered = $derived(active ? home.devices.filter((d) => active.cats.includes(d.category)) : []);
	const filteredByRoom = $derived.by(() => {
		const rooms = [...home.orderedRooms.map((r) => ({ id: r.id as string | null, name: r.name })), { id: null as string | null, name: 'No room' }];
		return rooms.map((r) => ({ ...r, devices: filtered.filter((d) => (d.roomId ?? null) === r.id) })).filter((r) => r.devices.length);
	});
	const toggleChip = (c: Chip) => { if (c.key === 'energy') location.href = '/activity?tab=energy'; else filter = filter === c.key ? null : c.key; };
	async function allOff(ds: Device[]) { for (const d of ds.filter((x) => x.state === 'on')) await home.command(d.id, 'turn_off'); }
	async function lockAll() { for (const d of unlocked) await home.command(d.id, 'lock'); }
	const toneIcon = { on: 'bg-on text-on-foreground', signal: 'bg-signal text-white', none: 'bg-secondary text-muted-foreground' };
	const toneChip = { on: 'bg-on-soft text-on-foreground border-transparent', signal: 'bg-signal-soft text-signal-foreground border-transparent', none: 'bg-card' };

	// ---- quick actions: a suggestion that fits the time of day comes first. It only suggests; it never acts. ----
	const WHEN: [RegExp, (h: number) => boolean][] = [[/night|bed|sleep/i, (h) => h >= 21 || h < 4], [/morning|wake/i, (h) => h >= 5 && h < 10], [/evening|movie|dinner|relax/i, (h) => h >= 17 && h < 21]];
	type Quick = { id: string; label: string; run: () => unknown; suggested?: boolean; busy?: boolean };
	const quick = $derived.by<Quick[]>(() => {
		const all: Quick[] = [
			...home.scenes.map((s) => ({ id: s.id, label: s.name, run: () => home.activateScene(s), busy: !!home.busy[s.id] })),
			...home.routines.map((r) => ({ id: `routine:${r.id}`, label: r.name, run: () => home.runRoutine(r), busy: !!home.busy[`routine:${r.id}`] }))
		];
		for (const q of all) q.suggested = WHEN.some(([re, ok]) => re.test(q.label) && ok(hour));
		all.sort((a, b) => Number(!!b.suggested) - Number(!!a.suggested));
		return all.slice(0, 8);
	});

	// ---- favourites, things you reach for, and rooms you can fold away ----
	const often = $derived((home.prefs?.frequent ?? []).map((id) => home.byId(id)).filter((d): d is Device => !!d && d.available && d.controls.some((c) => c.type === 'power')));
	let openRooms = $state<Record<string, boolean>>({});
	onMount(() => { try { openRooms = JSON.parse(localStorage.getItem('rooms-open') ?? '{}'); } catch {} });
	const isRoomOpen = (id: string, i: number) => openRooms[id] ?? (!viewport.phone && i === 0);
	const flip = (id: string, i: number) => { openRooms[id] = !isRoomOpen(id, i); try { localStorage.setItem('rooms-open', JSON.stringify(openRooms)); } catch {} };
	const roomsWithDevices = $derived(home.orderedRooms.map((r) => ({ ...r, devices: home.inRoom(r.id) })).filter((r) => r.devices.length));
	const unplaced = $derived(home.devices.filter((d) => !d.roomId && !['sensor', 'energy'].includes(d.category)));

	// ---- hold a chip to do it for everything of that kind ----
	let holdTimer: ReturnType<typeof setTimeout> | undefined, held = false;
	const bulk = (c: Chip) => (c.key === 'lights' && lightsOn.length ? () => allOff(lightsOn) : c.key === 'security' && unlocked.length ? lockAll : c.key === 'plugs' && plugs.some((d) => d.state === 'on') ? () => allOff(plugs) : null);
	function chipDown(c: Chip) { held = false; const act = bulk(c); if (!act) return; holdTimer = setTimeout(() => { held = true; haptics.grab(); Promise.resolve(act()).then(() => haptics.success()); }, 480); }
	const chipUp = () => clearTimeout(holdTimer);

	// ---- quick actions show that they are working, and that they worked ----
	let qState = $state<Record<string, 'run' | 'ok'>>({});
	async function runQuick(q: Quick) {
		haptics.tap(); qState[q.id] = 'run';
		try { await q.run(); qState[q.id] = 'ok'; } catch { delete qState[q.id]; }
		setTimeout(() => delete qState[q.id], 1400);
	}

	// ---- reorder favorites: hold and drag, like arranging apps ----
	let editing = $state(false), dragId = $state<string | null>(null), dragDx = $state(0), dragDy = $state(0), overId = $state<string | null>(null), sx = 0, sy = 0;
	function favDown(e: PointerEvent, id: string) { dragId = id; sx = e.clientX; sy = e.clientY; dragDx = 0; dragDy = 0; (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); haptics.grab(); }
	function favMove(e: PointerEvent) {
		if (!dragId) return;
		dragDx = e.clientX - sx; dragDy = e.clientY - sy;
		const hit = document.elementsFromPoint(e.clientX, e.clientY).map((n) => (n as HTMLElement).closest?.('[data-fav]') as HTMLElement | null).find((n) => n && n.dataset.fav !== dragId);
		const id = hit?.dataset.fav ?? null;
		if (id !== overId) { overId = id; if (id) haptics.tap(); }
	}
	async function favUp() {
		if (!dragId) return;
		const ids = home.favoriteDevices.map((d) => d.id), from = ids.indexOf(dragId);
		if (overId) { ids.splice(ids.indexOf(overId), 0, ids.splice(from, 1)[0]); await home.saveFavorites(ids, home.prefs?.favorites.rooms ?? []); haptics.success(); }
		dragId = null; overId = null; dragDx = 0; dragDy = 0;
	}

	// ---- shortcuts from the app icon (?do=lock-all, ?do=lights-off, ?do=good-night) ----
	let handled = false;
	$effect(() => {
		if (handled || !home.loaded) return;
		const what = page.url.searchParams.get('do'); if (!what) { handled = true; return; }
		handled = true;
		if (what === 'lock-all') { if (unlocked.length) lockAll(); else home.say('ok', 'Everything is already locked.'); }
		else if (what === 'lights-off') { if (lightsOn.length) allOff(lightsOn); else home.say('ok', 'The lights are already off.'); }
		else if (what === 'good-night') { const q = quick.find((x) => /good ?night/i.test(x.label)) ?? quick.find((x) => /night|bed|sleep/i.test(x.label)); if (q) runQuick(q); else home.say('error', 'There isn’t a “Good night” routine yet. You can make one under Routines.'); }
		const u = new URL(location.href); u.searchParams.delete('do'); replaceState(u, {});
	});

	// ---- tips, once ----
	let tipsDone = $state(true);
	onMount(() => { try { tipsDone = localStorage.getItem('tips-done') === '1'; } catch { tipsDone = false; } });
	const dismissTips = () => { tipsDone = true; try { localStorage.setItem('tips-done', '1'); } catch {} };

	// ---- getting started ----
	let pushHere = $state(false), others = $state(false), hidden = $state(false), setupOpen = $state<boolean | null>(null);
	onMount(async () => {
		try { hidden = localStorage.getItem('setup-hidden') === '1'; } catch {}
		pushHere = await notifications.thisDevice();
		if (session.can('users.manage')) { const r = await api('GET', '/api/admin/users'); if (r.ok) others = (r.data.users ?? r.data).length > 1; }
	});
	const steps = $derived([
		{ label: 'Star your favorite devices', done: home.favoriteDevices.length > 0, href: '/devices', cta: 'Browse' },
		{ label: 'Turn on alerts for this device', done: pushHere, href: '/settings/notifications', cta: 'Set up' },
		...(session.can('users.manage') ? [{ label: 'Invite someone in your home', done: others, href: '/admin/users', cta: 'Invite' }] : []),
		...(session.can('automation.manage') ? [{ label: 'Create your first routine', done: home.routines.length > 0, href: '/routines/new', cta: 'Create' }] : [])
	]);
	const doneCount = $derived(steps.filter((s) => s.done).length);
	const showSetup = $derived(home.loaded && !hidden && doneCount < steps.length);
	const setupIsOpen = $derived(setupOpen ?? !viewport.phone);
	const hide = () => { hidden = true; try { localStorage.setItem('setup-hidden', '1'); } catch {} };
	const cameras = $derived(cams.filter((d) => d.available).slice(0, 2));
</script>

{#snippet setup()}
	<section class="rounded-2xl border bg-card p-4">
		<div class="flex items-center justify-between gap-3"><button type="button" class="flex min-w-0 flex-1 items-baseline gap-2 text-left" aria-expanded={setupIsOpen} onclick={() => (setupOpen = !setupIsOpen)}><h2 class="heading">Get set up</h2><span class="text-sm text-muted-foreground">{doneCount} of {steps.length}</span></button><button class="text-sm text-muted-foreground hover:text-foreground" onclick={hide}>Hide</button></div>
		<div class="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}><div class="h-full rounded-full bg-primary transition-all duration-500" style="width:{(doneCount / steps.length) * 100}%"></div></div>
		<Collapse open={setupIsOpen}>
			<ul class="mt-3 space-y-0.5">
				{#each steps as s}
					<li class="flex items-center gap-2.5 py-1.5">
						<span class="flex size-5 shrink-0 items-center justify-center rounded-full border {s.done ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}">{#if s.done}<Check class="size-3" strokeWidth={3} />{/if}</span>
						<span class="flex-1 text-sm {s.done ? 'text-muted-foreground line-through' : 'font-medium'}">{s.label}</span>
						{#if !s.done}<Button size="sm" variant="secondary" href={s.href}>{s.cta}</Button>{/if}
					</li>
				{/each}
			</ul>
		</Collapse>
	</section>
{/snippet}

<main class="mx-auto w-full max-w-6xl px-5 pb-10 pt-4 md:px-10 md:pb-16 md:pt-10 xl:grid xl:grid-cols-[minmax(0,1fr)_19.5rem] xl:gap-x-12">
	<div class="stagger min-w-0 space-y-6 md:space-y-9">
		<header class="flex items-start justify-between gap-4">
			<div class="min-w-0">
				<p class="text-[0.9375rem] text-muted-foreground">{greeting}{session.me ? `, ${session.me.displayName.split(' ')[0]}` : ''}</p>
				{#key headline}<h1 class="display mt-1.5 max-w-[22ch]" aria-live="polite" in:fade={{ duration: dur(260) }}>{headline}</h1>{/key}
			</div>
			<button type="button" class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground md:hidden" aria-label="Search" onclick={() => (chrome.search = true)}><Search class="size-4" /></button>
		</header>

		{#if home.loaded && (unlocked.length || offline.length)}
			<ul class="space-y-2" aria-label="Needs attention">
				{#if unlocked.length}
					<li class="flex items-center gap-3 rounded-2xl bg-signal-soft px-4 py-3 text-signal-foreground">
						<ShieldAlert class="size-5 shrink-0" />
						<span class="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">{unlocked.length === 1 ? `${unlocked[0].name} is unlocked.` : `${unlocked.length} doors are unlocked.`}{#if unlocked.length > 1}<span class="block truncate text-sm font-normal opacity-80">{unlocked.map((d) => d.name).join(', ')}</span>{/if}</span>
						<Button size="sm" class="bg-signal text-white hover:bg-signal/85" onclick={lockAll}>{unlocked.length > 1 ? 'Lock all' : 'Lock'}</Button>
					</li>
				{/if}
				{#if offline.length}
					<li><a href="/devices" class="flex items-center gap-3 rounded-2xl bg-secondary px-4 py-3"><WifiOff class="size-5 shrink-0 text-muted-foreground" /><span class="flex-1 text-[0.9375rem]"><span class="font-medium">{offline.length === 1 ? offline[0].name : `${offline.length} devices`}</span> {offline.length === 1 ? 'is' : 'are'} offline</span><span class="text-sm text-muted-foreground">Check</span></a></li>
				{/if}
			</ul>
		{/if}

		{#if home.loaded && chips.length}
			<div class="-mx-5 flex snap-x snap-proximity scroll-px-5 gap-2 overflow-x-auto no-scrollbar px-5 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0" role="group" aria-label="Status">
				{#each chips as c (c.key)}
					<button type="button" aria-pressed={filter === c.key} onpointerdown={() => chipDown(c)} onpointerup={chipUp} onpointerleave={chipUp} onpointercancel={chipUp} oncontextmenu={(e) => e.preventDefault()} onclick={() => { if (held) { held = false; return; } haptics.tap(); toggleChip(c); }} class="flex h-14 min-w-[8rem] shrink-0 snap-start items-center gap-2.5 rounded-2xl border pl-2.5 pr-4 text-left transition-[background-color,transform] duration-150 active:scale-[0.97] {toneChip[c.tone]} {filter === c.key ? 'shadow-[inset_0_0_0_999px_color-mix(in_oklab,var(--foreground)_8%,transparent)]' : ''}">
						<span class="flex size-9 shrink-0 items-center justify-center rounded-full {toneIcon[c.tone]}"><c.icon class="size-[18px]" aria-hidden="true" /></span>
						<span class="min-w-0"><span class="block text-xs leading-none opacity-70">{c.label}</span><span class="figure mt-1.5 block whitespace-nowrap text-[1.0625rem] leading-none">{c.value}</span></span>
					</button>
				{/each}
			</div>
		{/if}

		{#if home.loaded && !tipsDone && home.devices.length && !active}
			<section class="rounded-2xl bg-accent px-4 py-3.5" aria-label="Tips">
				<div class="flex items-start gap-3"><Lightbulb class="mt-0.5 size-5 shrink-0 text-primary" />
					<div class="min-w-0 flex-1 space-y-1 text-sm leading-snug"><p class="font-semibold">Quick tips</p>
						<p>Tap a device's <span class="font-medium">icon</span> to switch it. Tap <span class="font-medium">anywhere else</span> for details.</p>
						<p>Press and hold a light, then slide sideways to dim it.</p>
						<p>Press and hold a status chip to switch them all off, or lock every door.</p></div>
					<Button size="sm" variant="secondary" onclick={dismissTips}>Got it</Button></div>
			</section>
		{/if}

		{#if active}
			<Section title={active.label}>
				{#snippet actions()}
					{#if active.cats.some((k) => ['light', 'switch', 'fan'].includes(k)) && filtered.some((d) => d.state === 'on')}<Button size="sm" variant="secondary" onclick={() => allOff(filtered)}>All off</Button>{/if}
					<Button size="sm" variant="ghost" onclick={() => (filter = null)}><X />Clear</Button>
				{/snippet}
				<div class="space-y-5">
					{#each filteredByRoom as r (r.id ?? 'none')}
						<div class="space-y-2"><h3 class="text-sm font-medium text-muted-foreground">{r.name}</h3><div class="tile-grid">{#each r.devices as d (d.id)}<div class={tileClass(d)}><DeviceCard device={d} /></div>{/each}</div></div>
					{/each}
				</div>
			</Section>
		{:else}
			<ModeCard />

			{#if home.loaded && quick.length}
				<Section>
					<div class="-mx-5 flex snap-x snap-proximity scroll-px-5 gap-2 overflow-x-auto no-scrollbar px-5 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
						{#each quick as q (q.id)}
							<button type="button" disabled={q.busy || home.haHealth !== 'ok'} onclick={() => runQuick(q)} class="flex h-11 shrink-0 snap-start items-center gap-1.5 rounded-full border px-4 text-[0.9375rem] font-medium transition-[background-color,transform] duration-150 active:scale-[0.97] disabled:opacity-50 {q.suggested ? 'border-primary/40 bg-primary/10 text-primary' : 'bg-card hover:bg-muted'}">{#if qState[q.id] === 'run'}<Loader2 class="size-4 animate-spin" />{:else if qState[q.id] === 'ok'}<Check class="size-4 animate-in text-ok duration-200 zoom-in-50" strokeWidth={3} />{:else if q.suggested}<Sparkles class="size-3.5" />{/if}{q.label}</button>
						{/each}
					</div>
				</Section>
			{/if}

			{#if home.loaded}
				{#if sections.includes('favorites')}
					<Section title="Favorites">
						{#snippet actions()}{#if home.favoriteDevices.length > 1 && t !== 'minimal'}<Button size="sm" variant={editing ? 'default' : 'ghost'} onclick={() => { haptics.tap(); editing = !editing; }}>{editing ? 'Done' : 'Edit'}</Button>{/if}{/snippet}
						{#if home.favoriteDevices.length}
							{#if editing}
								<p class="text-sm text-muted-foreground">Hold a tile and drag it onto another to move it.</p>
								<div class="tile-grid" role="list">
									{#each home.favoriteDevices as d (d.id)}
										<div role="listitem" data-fav={d.id} class="relative h-full {isWide(d) ? 'col-span-2' : ''} {dragId === d.id ? 'z-30 shadow-2xl' : 'jiggle'} {overId === d.id ? 'rounded-tile shadow-[inset_0_0_0_999px_color-mix(in_oklab,var(--primary)_12%,transparent)]' : ''}" style={dragId === d.id ? `transform: translate(${dragDx}px, ${dragDy}px) scale(1.04)` : ''}>
											<div class="pointer-events-none h-full"><DeviceCard device={d} /></div>
											<div role="presentation" class="absolute inset-0 z-20 flex cursor-grab items-start justify-end p-2" style="touch-action: none" onpointerdown={(e) => favDown(e, d.id)} onpointermove={favMove} onpointerup={favUp} onpointercancel={favUp}><GripVertical class="size-4 text-muted-foreground/70" /></div>
										</div>
									{/each}
								</div>
							{:else}
								<div class={t === 'minimal' ? 'space-y-2' : 'tile-grid'}>
									{#each home.favoriteDevices as d (d.id)}<div class={t === 'minimal' ? '' : tileClass(d)}><DeviceCard device={d} compact={t === 'minimal'} /></div>{/each}
								</div>
							{/if}
						{:else}
							<p class="rounded-2xl border border-dashed px-5 py-8 text-center text-sm text-muted-foreground">
								{#if home.devices.length}Star a device to keep it here. <a class="font-medium text-primary underline-offset-2 hover:underline" href="/devices">Browse devices</a>
								{:else}Nothing has been shared with you yet. Ask the person who manages your home.{/if}</p>
						{/if}
						{#if often.length && !editing}
							<div class="-mx-5 flex snap-x snap-proximity scroll-px-5 items-center gap-2 overflow-x-auto no-scrollbar px-5 pb-1 pt-1 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Often used">
								<span class="shrink-0 text-sm text-muted-foreground">Often used</span>
								{#each often as d (d.id)}
									<button type="button" onclick={() => { haptics.tap(); home.command(d.id, d.state === 'on' ? 'turn_off' : 'turn_on'); }} aria-pressed={d.state === 'on'} class="flex h-10 shrink-0 snap-start items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-[background-color,transform] duration-150 active:scale-[0.97] {d.state === 'on' ? 'border-transparent bg-on-soft text-on-foreground' : 'bg-card hover:bg-muted'}"><span class="size-1.5 rounded-full {d.state === 'on' ? 'bg-on' : 'bg-border'}"></span>{d.name}</button>
								{/each}
							</div>
						{/if}
					</Section>
				{/if}

				{#if sections.includes('sensors') && sensors.length}
					<Section title="At a glance">
						<div class="-mx-5 flex snap-x snap-proximity scroll-px-5 gap-2 overflow-x-auto no-scrollbar px-5 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0">
							{#each sensors as d (d.id)}
								<div class="flex h-14 min-w-[8rem] shrink-0 snap-start items-center gap-2.5 rounded-2xl border bg-card pl-2.5 pr-4">
									<span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground">{#if d.category === 'energy'}<Zap class="size-[18px]" />{:else}<Gauge class="size-[18px]" />{/if}</span>
									<span class="min-w-0"><span class="block max-w-[7rem] truncate text-xs leading-none text-muted-foreground">{d.name}</span><span class="figure mt-1.5 block whitespace-nowrap text-[1.0625rem] leading-none">{d.reading?.value}<span class="ml-0.5 text-sm font-medium text-muted-foreground">{d.reading?.unit ?? ''}</span></span></span>
								</div>
							{/each}
						</div>
					</Section>
				{/if}

				{#if sections.includes('rooms')}
					<Section title="Rooms">
						{#if roomsWithDevices.length || unplaced.length}
							<div class="space-y-2">
								{#each roomsWithDevices as r, i (r.id)}
									{@const open = isRoomOpen(r.id, i)}
									{@const on = r.devices.filter((d) => d.state === 'on' && d.available).length}
									<div class="overflow-hidden rounded-2xl border bg-card">
										<button type="button" class="flex w-full items-center gap-3 px-4 py-3.5 text-left" aria-expanded={open} onclick={() => flip(r.id, i)}>
											<span class="size-2.5 shrink-0 rounded-full {on ? 'bg-on' : 'bg-border'}" aria-hidden="true"></span>
											<span class="min-w-0 flex-1"><span class="block truncate text-base font-semibold tracking-[-0.015em]">{r.name}</span><span class="text-sm text-muted-foreground">{on ? `${on} on · ` : ''}{r.devices.length} device{r.devices.length === 1 ? '' : 's'}</span></span>
											<ChevronDown class="size-4 text-muted-foreground transition-transform duration-300 {open ? 'rotate-180' : ''}" />
										</button>
										<Collapse {open}><div class="tile-grid px-3 pb-3">{#each r.devices as d (d.id)}<div class={tileClass(d)}><DeviceCard device={d} /></div>{/each}</div></Collapse>
									</div>
								{/each}
							</div>
							{#if unplaced.length}<p class="text-sm text-muted-foreground">{unplaced.length} device{unplaced.length === 1 ? '' : 's'} not in a room. <a class="font-medium text-primary hover:underline" href="/devices">See all devices</a></p>{/if}
						{:else}
							<p class="text-sm text-muted-foreground">No rooms yet.{#if session.can('rooms.manage')} <a class="font-medium text-primary hover:underline" href="/admin/rooms">Set up your rooms</a>.{/if}</p>
						{/if}
					</Section>
				{/if}

				{#if home.groups.length}
					<Section title="Groups">
						<Group>{#each home.groups as g (g.id)}
							<Row title={g.name} description="{g.deviceIds.length} devices">{#snippet trailing()}<Button size="sm" variant="secondary" onclick={() => home.groupCommand(g.id, 'turn_on')}>All on</Button><Button size="sm" variant="secondary" onclick={() => home.groupCommand(g.id, 'turn_off')}>All off</Button>{/snippet}</Row>
						{/each}</Group>
					</Section>
				{/if}

				{#if !viewport.wide}
					{#if session.me?.role !== 'guest'}<Insights />{/if}
					{#if showSetup}{@render setup()}{/if}
				{/if}
			{/if}
		{/if}
	</div>

	{#if home.loaded && viewport.wide}
		<aside class="space-y-6 pt-1" aria-label="More">
			{#if showSetup}{@render setup()}{/if}
			{#if climate || meter || cameras.length}
				<Group>
					{#if climate}
						<Row title={climate.name} description={climate.attrs.target != null ? `Set to ${climate.attrs.target}°` : climate.state}>
							{#snippet icon()}<Thermometer class="size-[18px]" />{/snippet}
							{#snippet trailing()}<span class="figure text-2xl">{climate!.reading ? climate!.reading.value : '—'}°</span>{/snippet}
						</Row>
					{/if}
					{#if meter}
						<Row title="Power right now" description={meter.name} tone="on" href="/activity?tab=energy">
							{#snippet icon()}<Zap class="size-[18px]" />{/snippet}
							{#snippet trailing()}<span class="figure text-2xl">{meter!.reading?.value} W</span>{/snippet}
						</Row>
					{/if}
					{#if cameras.length}
						<div class="grid grid-cols-2 gap-2 p-3">{#each cameras as c (c.id)}<button type="button" class="block overflow-hidden rounded-xl bg-muted" onclick={() => (filter = 'cameras')}><img src="/api/devices/{encodeURIComponent(c.id)}/snapshot" alt="Latest picture from {c.name}" class="aspect-video w-full object-cover" loading="lazy" /></button>{/each}</div>
					{/if}
				</Group>
			{/if}
			{#if session.me?.role !== 'guest'}<Insights />{/if}
		</aside>
	{/if}
</main>
