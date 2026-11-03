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
	import { only } from '#lib/utils.js';
	import { ago, measure, plural as pl, sensorWord } from '#lib/fmt.js';
	import { iconFor } from '#lib/icons.js';
	import { roomLook } from '#lib/roomLook.js';
	import Empty from '#lib/components/app/Empty.svelte';
	import { install } from '#lib/install.svelte.js';
	import type { IconComponent } from '#lib/icons.js';
	import { haptics } from '#lib/haptics.js';
	import { tileClass, isWide } from '#lib/tiles.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';
	import Insights from '#lib/components/app/Insights.svelte';
	import AdaptiveCard from '#lib/components/app/AdaptiveCard.svelte';
	import ModeCard from '#lib/components/app/ModeCard.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Collapse from '#lib/components/app/Collapse.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Check, ChevronDown, GripVertical, Home as HomeIcon, Lightbulb, Loader2, Lock, LockOpen, Plug, PowerOff, Search, ShieldAlert, Sparkles, Star, Thermometer, Tv, Video, WifiOff, X, Zap } from '@lucide/svelte';

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
	// Everything that is running counts, not only the lights: a bulb the hub exposes as a switch is still a light on.
	const runningNow = $derived(home.devices.filter((d) => d.available && d.state === 'on' && ['light', 'switch', 'fan'].includes(d.category)));
	const openings = $derived(home.devices.filter((d) => d.category === 'sensor' && d.available && sensorWord(d) === 'Open'));
	const kinds = (ds: Device[]) => {
		const c = (k: string) => ds.filter((d) => d.category === k).length, out: string[] = [];
		if (c('light')) out.push(pl(c('light'), 'light'));
		if (c('switch')) out.push(pl(c('switch'), 'plug'));
		if (c('fan')) out.push(pl(c('fan'), 'fan'));
		return out.length > 1 ? `${out.slice(0, -1).join(', ')} and ${out.at(-1)}` : (out[0] ?? '');
	};
	// Two short clauses at most: how secure the home is, then what is running. Anything else is listed below the headline.
	const headline = $derived.by(() => {
		if (!home.loaded) return 'One moment…';
		if (home.haHealth !== 'ok') return 'The hub can’t be reached.';
		if (!home.devices.length) return 'Your home is ready.';
		const door = only(unlocked), open = only(openings), run = only(runningNow), p: string[] = [];
		if (unlocked.length) p.push(door ? `${door.name} is unlocked.` : `${n(unlocked.length)} doors unlocked.`);
		else if (openings.length) p.push(open ? `${open.name} is open.` : `${n(openings.length)} doors and windows are open.`);
		else if (locks.length) p.push('Everything is locked.');
		p.push(runningNow.length === 0 ? 'Nothing is on.' : run ? `${run.name} is on.` : `${kinds(runningNow)} on.`);
		return p.join(' ');
	});
	// The home's mood, shown as a soft glow behind the headline: red when something needs attention, amber while things are on, blue when calm.
	const mood = $derived<'signal' | 'on' | 'calm'>(!home.loaded ? 'calm' : unlocked.length || openings.length ? 'signal' : runningNow.length ? 'on' : 'calm');
	// How old the screen is. It says so when the hub has gone quiet, so an old reading is never passed off as current.
	let nowTick = $state(Date.now());
	onMount(() => { const t = setInterval(() => (nowTick = Date.now()), 15_000); return () => clearInterval(t); });
	const stale = $derived(!home.online || home.haHealth !== 'ok' || (home.lastOkAt !== null && nowTick - home.lastOkAt > 90_000));
	const updated = $derived(home.lastOkAt ? `Updated ${ago(home.lastOkAt, nowTick)}` : '');

	// ---- status chips: each one is a summary, a filter, and a way in ----
	const climate = $derived(home.devices.find((d) => d.category === 'climate' && d.available));
	const meter = $derived(home.devices.find((d) => d.category === 'energy' && d.available && d.reading?.unit === 'W'));
	const playing = $derived(by('media').filter((d) => d.state === 'playing').length);
	const cams = $derived(by('camera'));
	const sensors = $derived(home.devices.filter((d) => (d.category === 'sensor' || d.category === 'energy') && d.reading && d.available && Number.isFinite(Number(d.reading.value))).slice(0, 8));
	const plugs = $derived(home.devices.filter((d) => ['switch', 'fan'].includes(d.category)));
	type Chip = { key: string; label: string; value: string; icon: IconComponent; tone: 'on' | 'signal' | 'none'; cats: string[] };
	const chips = $derived.by<Chip[]>(() => {
		const c: Chip[] = [];
		if (lights.length) c.push({ key: 'lights', label: 'Lights', value: lightsOn.length ? `${lightsOn.length} on` : 'Off', icon: Lightbulb, tone: lightsOn.length ? 'on' : 'none', cats: ['light'] });
		if (locks.length) c.push({ key: 'security', label: 'Doors', value: unlocked.length ? `${unlocked.length} open` : 'Locked', icon: unlocked.length ? LockOpen : Lock, tone: unlocked.length ? 'signal' : 'none', cats: ['lock'] });
		if (climate) c.push({ key: 'climate', label: 'Climate', value: climate.reading ? measure(climate.reading.value, climate.reading.unit ?? '°C', { short: true }) : climate.state, icon: Thermometer, tone: 'none', cats: ['climate'] });
		if (plugs.length) c.push({ key: 'plugs', label: 'Plugs & fans', value: plugs.some((d) => d.state === 'on') ? `${plugs.filter((d) => d.state === 'on').length} on` : 'Off', icon: Plug, tone: plugs.some((d) => d.state === 'on') ? 'on' : 'none', cats: ['switch', 'fan'] });
		if (by('media').length) c.push({ key: 'media', label: 'Media', value: playing ? `${playing} playing` : 'Idle', icon: Tv, tone: 'none', cats: ['media'] });
		if (cams.length) c.push({ key: 'cameras', label: 'Cameras', value: String(cams.length), icon: Video, tone: 'none', cats: ['camera'] });
		if (meter) c.push({ key: 'energy', label: 'Power', value: measure(meter.reading?.value ?? '', meter.reading?.unit ?? 'W'), icon: Zap, tone: 'none', cats: [] });
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
	const count = (n: number, w: string) => pl(n, w);
	async function allOff(ds: Device[]) { const on = ds.filter((x) => x.state === 'on' && x.available); if (on.length) await home.batch(`Turned off ${count(on.length, 'device')}`, async () => { for (const d of on) await home.command(d.id, 'turn_off'); }); }
	async function lockAll() { const open = [...unlocked]; if (open.length) await home.batch(`Locked ${count(open.length, 'door')}`, async () => { for (const d of open) await home.command(d.id, 'lock'); }); }
	/** Hold a room's name to switch off everything that is on in it. */
	async function roomOff(r: { name: string; devices: Device[] }) {
		const on = r.devices.filter((d) => d.available && d.state === 'on' && d.controls.some((c) => c.type === 'power'));
		if (!on.length) { home.say('info', `Everything in ${r.name} is already off.`); return; }
		await home.batch(`Turned off ${r.name}: ${count(on.length, 'device')}`, async () => { await Promise.all(on.map((d) => home.command(d.id, 'turn_off'))); });
		haptics.success();
	}
	// Things that are risky to leave running, and doors left open to the world.
	const RISKY = /heater|oven|stove|cooker|hob\b|iron|kettle|toaster|fryer|geyser|radiator/i;
	const risky = $derived(home.devices.filter((d) => d.category === 'switch' && d.available && d.state === 'on' && RISKY.test(d.name)));
	const openNow = $derived(openings);
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
		if (overId) { ids.splice(ids.indexOf(overId), 0, ...ids.splice(from, 1)); await home.saveFavorites(ids, home.prefs?.favorites.rooms ?? []); haptics.success(); }
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
		if (session.can('users.manage')) { const r = await api<{ users: unknown[] }>('GET', '/api/admin/users'); if (r.ok) others = r.data.users.length > 1; }
	});
	const steps = $derived([
		...(session.can('rooms.manage') ? [{ label: 'Organise your devices into rooms', done: home.orderedRooms.length > 0 && unplaced.length === 0, href: '/admin/rooms', cta: 'Organise' }] : []),
		{ label: 'Star your favourite devices', done: home.favoriteDevices.length > 0, href: '/devices', cta: 'Browse' },
		{ label: 'Turn on alerts for this device', done: pushHere, href: '/settings/notifications', cta: 'Set up' },
		...(session.can('users.manage') ? [{ label: 'Invite someone in your home', done: others, href: '/admin/users', cta: 'Invite' }] : []),
		...(session.can('automation.manage') ? [{ label: 'Create your first routine', done: home.routines.length > 0 || home.scenes.length > 0, href: '/routines/new', cta: 'Create' }] : [])
	]);
	// What is left comes first; what is finished sinks to the bottom.
	const ordered = $derived([...steps.filter((x) => !x.done), ...steps.filter((x) => x.done)]);
	const nextStep = $derived(steps.find((x) => !x.done));
	const doneCount = $derived(steps.filter((s) => s.done).length);
	const showSetup = $derived(home.loaded && !hidden && doneCount < steps.length);
	const setupIsOpen = $derived(setupOpen ?? false);
	const hide = () => { hidden = true; try { localStorage.setItem('setup-hidden', '1'); } catch {} };
	const cameras = $derived(cams.filter((d) => d.available).slice(0, 2));
</script>

{#snippet setup()}
	<section class="space-y-3 rounded-2xl border bg-card p-4" aria-label="Get set up">
		<div class="flex items-center justify-between gap-3"><div class="flex min-w-0 items-baseline gap-2"><h2 class="heading">Get set up</h2><span class="text-sm text-muted-foreground">{doneCount} of {steps.length} done</span></div><button class="text-sm text-muted-foreground hover:text-foreground" onclick={hide}>Hide</button></div>
		<div class="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount}><div class="h-full rounded-full bg-primary transition-all duration-500" style="width:{(doneCount / steps.length) * 100}%"></div></div>
		{#if nextStep}
			<a href={nextStep.href} class="flex items-center gap-3 rounded-xl bg-primary/10 px-3.5 py-3 transition-colors active:bg-primary/15">
				<span class="min-w-0 flex-1"><span class="block text-xs font-medium text-primary">Next</span><span class="block text-[0.9375rem] font-semibold leading-snug">{nextStep.label}</span></span>
				<span class="inline-flex h-8 shrink-0 items-center rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground">{nextStep.cta}</span>
			</a>
		{/if}
		{#if steps.length > 1}
			<button type="button" class="text-sm font-medium text-primary" aria-expanded={setupIsOpen} onclick={() => (setupOpen = !setupIsOpen)}>{setupIsOpen ? 'Hide the list' : 'See all steps'}</button>
			<Collapse open={setupIsOpen}>
				<ul class="space-y-0.5">
					{#each ordered as s (s.label)}
						<li class="flex items-center gap-2.5 py-1.5">
							<span class="flex size-5 shrink-0 items-center justify-center rounded-full border {s.done ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}">{#if s.done}<Check class="size-3" strokeWidth={3} />{/if}</span>
							<span class="flex-1 text-sm {s.done ? 'text-muted-foreground' : 'font-medium'}">{s.label}</span>
							{#if !s.done && s !== nextStep}<Button size="sm" variant="secondary" href={s.href}>{s.cta}</Button>{/if}
						</li>
					{/each}
				</ul>
			</Collapse>
		{/if}
	</section>
{/snippet}

<div class="pointer-events-none fixed inset-x-0 top-0 -z-10 h-80 overflow-hidden" aria-hidden="true">
{#each [['signal', 'var(--signal)'], ['on', 'var(--on)'], ['calm', 'var(--primary)']] as [k, c] (k)}
<div class="glow absolute inset-0 transition-opacity duration-1000 {mood === k ? 'opacity-100' : 'opacity-0'}" style="--glow: {c}"></div>
{/each}
</div>
<main class="mx-auto w-full max-w-6xl px-5 pb-10 pt-4 md:px-10 md:pb-16 md:pt-10 xl:grid xl:grid-cols-[minmax(0,1fr)_19.5rem] xl:gap-x-12">
	<div class="stagger min-w-0 space-y-6 md:space-y-9">
		<header class="flex items-start justify-between gap-4">
			<div class="min-w-0">
				<p class="text-[0.9375rem] text-muted-foreground">{greeting}{session.me ? `, ${session.me.displayName.split(' ')[0]}` : ''}</p>
				{#key headline}<h1 class="display mt-1.5 max-w-[22ch]" aria-live="polite" in:fade={{ duration: dur(260) }}>{headline}</h1>{/key}
{#if home.loaded && updated}<p class="mt-2 text-xs {stale ? 'font-medium text-signal-foreground' : 'text-muted-foreground'}" aria-live="polite">{stale ? `Out of date. ${updated.replace('Updated', 'Last updated')}.` : `${updated}.`}</p>{/if}
			</div>
			<button type="button" class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground md:hidden" aria-label="Search" onclick={() => (chrome.search = true)}><Search class="size-4" /></button>
		</header>

		{#if home.loaded && (unlocked.length || offline.length || risky.length || openNow.length)}
			<ul class="space-y-2" aria-label="Needs attention">
				{#if unlocked.length}
					{@const lone = only(unlocked)}
					<li class="flex items-center gap-3 rounded-2xl bg-signal-soft px-4 py-3 text-signal-foreground">
						<ShieldAlert class="size-5 shrink-0" />
						<span class="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">{lone ? `${lone.name} is unlocked.` : `${unlocked.length} doors are unlocked.`}{#if unlocked.length > 1}<span class="block truncate text-sm font-normal opacity-80">{unlocked.map((d) => d.name).join(', ')}</span>{/if}</span>
						<Button size="sm" class="bg-signal text-white hover:bg-signal/85" onclick={lockAll}>{unlocked.length > 1 ? 'Lock all' : 'Lock'}</Button>
					</li>
				{/if}
				{#each risky as d (d.id)}
					<li class="flex items-center gap-3 rounded-2xl bg-signal-soft px-4 py-3 text-signal-foreground">
						<ShieldAlert class="size-5 shrink-0" /><span class="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug">{d.name} is on.</span>
						<Button size="sm" class="bg-signal text-white hover:bg-signal/85" onclick={() => home.batch(`Turned off ${d.name}`, async () => { await home.command(d.id, 'turn_off'); })}>Turn off</Button>
					</li>
				{/each}
				{#each openNow as d (d.id)}
					<li><a href="/devices?q={encodeURIComponent(d.name)}" class="flex items-center gap-3 rounded-2xl bg-signal-soft px-4 py-3 text-signal-foreground"><ShieldAlert class="size-5 shrink-0" /><span class="flex-1 text-[0.9375rem] font-medium">{d.name} is open.</span><span class="text-sm opacity-80">Check</span></a></li>
				{/each}
				{#if offline.length}
					<li><a href="/devices" class="flex items-center gap-3 rounded-2xl bg-secondary px-4 py-3"><WifiOff class="size-5 shrink-0 text-muted-foreground" /><span class="flex-1 text-[0.9375rem]"><span class="font-medium">{only(offline)?.name ?? `${offline.length} devices`}</span> {offline.length === 1 ? 'is' : 'are'} offline</span><span class="text-sm text-muted-foreground">Check</span></a></li>
				{/if}
			</ul>
		{/if}

		{#if home.loaded && !active}<ModeCard />{/if}

{#if home.loaded && chips.length}
			<div class="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="group" aria-label="Status">
				{#each chips as c (c.key)}
					<button type="button" aria-pressed={filter === c.key} onpointerdown={() => chipDown(c)} onpointerup={chipUp} onpointerleave={chipUp} onpointercancel={chipUp} oncontextmenu={(e) => e.preventDefault()} onclick={() => { if (held) { held = false; return; } haptics.tap(); toggleChip(c); }} class="flex h-14 min-w-0 items-center gap-2.5 rounded-2xl border pl-2.5 pr-3 text-left transition-[background-color,transform] duration-150 active:scale-[0.97] sm:min-w-[9rem] {toneChip[c.tone]} {filter === c.key ? 'shadow-[inset_0_0_0_999px_color-mix(in_oklab,var(--foreground)_8%,transparent)]' : ''}">
						<span class="flex size-9 shrink-0 items-center justify-center rounded-full {toneIcon[c.tone]}"><c.icon class="size-[18px]" aria-hidden="true" /></span>
						<span class="min-w-0"><span class="block text-xs leading-none opacity-70">{c.label}</span><span class="figure mt-1.5 block whitespace-nowrap text-[1.0625rem] leading-none">{c.value}</span></span>
					</button>
				{/each}
			</div>
		{/if}

		{#if home.loaded && install.offer && !active}
<section class="flex items-center gap-3 rounded-2xl bg-accent px-4 py-3.5" aria-label="Add to home screen">
<div class="min-w-0 flex-1 text-sm leading-snug"><p class="font-semibold">Keep Home one tap away</p><p class="text-muted-foreground">{install.offer === 'ios' ? 'Tap Share, then “Add to Home Screen”. It opens full screen, like an app.' : 'Add it to your home screen. It opens full screen, like an app.'}</p></div>
{#if install.offer === 'prompt'}<Button size="sm" onclick={() => install.install()}>Add</Button>{/if}
<Button size="sm" variant="ghost" onclick={() => install.dismiss()}>Not now</Button>
</section>
{/if}

{#if home.loaded && !tipsDone && home.devices.length && !active}
			<section class="rounded-2xl bg-accent px-4 py-3.5" aria-label="Tips">
				<div class="flex items-start gap-3"><Lightbulb class="mt-0.5 size-5 shrink-0 text-primary" />
					<div class="min-w-0 flex-1 space-y-1 text-sm leading-snug"><p class="font-semibold">Quick tips</p>
						<p>Use the <span class="font-medium">switch</span> on a tile to turn it on or off. Tap <span class="font-medium">anywhere else</span> on the tile for details.</p>
							<p>Press and hold a tile and slide sideways to set a level. Let go without sliding for more actions.</p>
							<p>Double-tap a tile to go to the level you usually pick. Every room has an <span class="font-medium">All off</span> button.</p>
							<p>Pull down to refresh. After most actions there is an <span class="font-medium">Undo</span> button.</p></div>
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
			<AdaptiveCard />

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
					<Section title="Favourites">
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
							{#if home.devices.length}<Empty icon={Star} title="Keep your favourites here" description="Star the devices you use every day and they will wait for you on this screen." action="Browse devices" href="/devices" />
							{:else}<Empty icon={HomeIcon} title="Nothing shared with you yet" description="Ask the person who manages your home to share some devices." />{/if}
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
								{@const SIcon = iconFor(d)}
								<div class="flex h-14 min-w-[8rem] shrink-0 snap-start items-center gap-2.5 rounded-2xl border bg-card pl-2.5 pr-4">
									<span class="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground"><SIcon class="size-[18px]" aria-hidden="true" /></span>
									<span class="min-w-0"><span class="block max-w-[7rem] truncate text-xs leading-none text-muted-foreground">{d.name}</span><span class="figure mt-1.5 block whitespace-nowrap text-[1.0625rem] leading-none">{measure(d.reading?.value ?? '', d.reading?.unit)}</span></span>
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
{@const look = roomLook(r)}
									<div class="overflow-hidden rounded-2xl border bg-card">
										<div class="flex items-center pr-2">
										<button type="button" class="flex min-w-0 flex-1 items-center gap-3 px-4 py-3.5 text-left" aria-expanded={open} onclick={() => flip(r.id, i)}>
										<span class="relative flex size-9 shrink-0 items-center justify-center rounded-full" style="background: color-mix(in oklab, {look.color} 16%, transparent); color: {look.color}" aria-hidden="true"><look.icon class="size-[18px]" />{#if on}<span class="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-on ring-2 ring-card"></span>{/if}</span>
										<span class="min-w-0 flex-1"><span class="block truncate text-base font-semibold tracking-[-0.015em]">{r.name}</span><span class="text-sm text-muted-foreground">{on ? `${on} on · ` : ''}{pl(r.devices.length, 'device')}</span></span>
										<ChevronDown class="size-4 text-muted-foreground transition-transform duration-300 {open ? 'rotate-180' : ''}" />
										</button>
										{#if on}<Button size="sm" variant="ghost" class="shrink-0 text-muted-foreground" aria-label="Turn off everything in {r.name}" onclick={() => roomOff(r)}><PowerOff />All off</Button>{/if}
										</div>
										<Collapse {open}><div class="tile-grid px-3 pb-3">{#each r.devices as d (d.id)}<div class={tileClass(d)}><DeviceCard device={d} /></div>{/each}</div></Collapse>
									</div>
								{/each}
							</div>
							{#if unplaced.length}<p class="text-sm text-muted-foreground">{pl(unplaced.length, 'device')} not in a room. <a class="font-medium text-primary hover:underline" href="/admin/rooms">Put them in rooms</a></p>{/if}
						{:else}
							<Empty icon={HomeIcon} title="No rooms yet" description="Rooms group your devices so you can find and control them by place." action={session.can('rooms.manage') ? 'Organise your home' : undefined} href="/admin/rooms" />
						{/if}
					</Section>
				{/if}

				{#if home.groups.length}
					<Section title="Groups">
						<Group>{#each home.groups as g (g.id)}
							<Row title={g.name} description={pl(g.deviceIds.length, 'device')}>{#snippet trailing()}<Button size="sm" variant="secondary" onclick={() => home.groupCommand(g.id, 'turn_on')}>All on</Button><Button size="sm" variant="secondary" onclick={() => home.groupCommand(g.id, 'turn_off')}>All off</Button>{/snippet}</Row>
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
							{#snippet trailing()}<span class="figure text-2xl">{climate!.reading ? measure(climate!.reading.value, climate!.reading.unit ?? '°C', { short: true }) : '—'}</span>{/snippet}
						</Row>
					{/if}
					{#if meter}
						<Row title="Power right now" description={meter.name} tone="on" href="/activity?tab=energy">
							{#snippet icon()}<Zap class="size-[18px]" />{/snippet}
							{#snippet trailing()}<span class="figure text-2xl">{measure(meter!.reading?.value ?? '', meter!.reading?.unit ?? 'W')}</span>{/snippet}
						</Row>
					{/if}
					{#if cameras.length}
						<div class="grid grid-cols-2 gap-2 p-3">{#each cameras as c (c.id)}<button type="button" class="block overflow-hidden rounded-xl bg-muted" onclick={() => (filter = 'cameras')}><img src="/api/devices/{encodeURIComponent(c.id)}/snapshot?t={Math.floor(nowTick / 60000)}" alt="Latest picture from {c.name}" class="aspect-video w-full object-cover" loading="lazy" /></button>{/each}</div>
					{/if}
				</Group>
			{/if}
			{#if session.me?.role !== 'guest'}<Insights />{/if}
		</aside>
	{/if}
</main>
