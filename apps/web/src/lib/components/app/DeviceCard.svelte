<script lang="ts">
	import { home, type Control, type Device } from '#lib/home.svelte.js';
		import { session } from '#lib/session.svelte.js';
	import PowerLimit from '#lib/components/app/PowerLimit.svelte';
	import { Switch } from '#lib/components/ui/switch';
	import { Slider } from '#lib/components/ui/slider';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import * as Drawer from '#lib/components/ui/drawer';
	import DeviceHistory from '#lib/components/app/DeviceHistory.svelte';
	import { isWide } from '#lib/tiles.js';
	import { scale } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { dur, reduced } from '#lib/motion.js';
	import { tick } from 'svelte';
	import { viewport } from '#lib/viewport.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { selection } from '#lib/select.svelte.js';
	import { usual } from '#lib/usual.js';
	import { scrubbed, crossed } from '#lib/scrub.js';
	import HoldButton from '#lib/components/app/HoldButton.svelte';
	import TileMenu from '#lib/components/app/TileMenu.svelte';
	import { iconFor } from '#lib/icons.js';
	import { sheet } from '#lib/sheet.svelte.js';
	import { api } from '#lib/api.js';
	import { onMount } from 'svelte';
	import { ago, measure, parts, sensorWord } from '#lib/fmt.js';
	import DeviceEdit from '#lib/components/app/DeviceEdit.svelte';
	import { Star, Workflow, Minus, Plus, Play, Pause, Check, Pencil } from '@lucide/svelte';

	let { device, compact = false }: { device: Device; compact?: boolean } = $props();

	const Icon = $derived(iconFor(device));
	/** The device's control of type `t`, narrowed to that kind of control. */
	const has = <const T extends Control['type']>(t: T) => device.controls.find((c): c is Extract<Control, { type: T }> => c.type === t);
	const fanSpeed = $derived(has('fan_speed')), thermostat = $derived(has('thermostat')), colorTemp = $derived(has('color_temp')), media = $derived(has('media'));
	const off = $derived(!device.available || !home.online || !!home.busy[device.id]);
	let more = $state(false), editing = $state(false);
	/** Said once, the first time someone switches on a dimmable light: the slide gesture is otherwise easy to miss. */
	function slideHint() { try { if (localStorage.getItem('hint-slide') === '1') return; localStorage.setItem('hint-slide', '1'); } catch { return; } setTimeout(() => home.say('info', 'Tip: press and hold the tile, then slide sideways to dim it.'), 900); }
	// The details sheet is a history entry, so Back closes it instead of leaving the page.
	const sheetState = sheet(() => `device:${device.id}`);
	const detail = $derived(sheetState.open);
	// Who last changed it: a name when it was done from this app, otherwise a plain note that it happened elsewhere.
	let changedBy = $state<string | null | undefined>(undefined);
	$effect(() => { if (detail) { changedBy = undefined; api<{ by: string | null }>('GET', `/api/devices/${encodeURIComponent(device.id)}/last-change`).then((r) => { if (r.ok) changedBy = r.data.by; }); } });
	// Camera pictures are fetched again every minute, and never served from an old copy.
	let stamp = $state(Math.floor(Date.now() / 60_000));
	onMount(() => { if (device.category !== 'camera') return; const t = setInterval(() => (stamp = Math.floor(Date.now() / 60_000)), 60_000); return () => clearInterval(t); });
	const snap = $derived(`/api/devices/${encodeURIComponent(device.id)}/snapshot?t=${stamp}`);
	const phoneTile = $derived(viewport.phone && !compact);
	const wide = $derived(isWide(device));
	const dimmable = $derived(device.available && device.state === 'on' && !!has('brightness'));

	// Ember means on; signal means a door is open to the world. Everything else stays neutral.
	const tone = $derived<'on' | 'signal' | 'none'>(!device.available ? 'none' : device.category === 'lock' && device.state === 'unlocked' ? 'signal' : ['light', 'switch', 'fan'].includes(device.category) && device.state === 'on' ? 'on' : device.category === 'media' && device.state === 'playing' ? 'on' : 'none');
	// On is a faint warm wash with a small filled icon; an open door is the only thing allowed to shout.
	const surface = { on: 'border-on/25 bg-[color-mix(in_oklab,var(--on)_9%,var(--card))]', signal: 'border-transparent bg-signal-soft text-signal-foreground', none: 'bg-card' };
	const chip = { on: 'bg-on text-on-foreground', signal: 'bg-signal text-white', none: 'bg-secondary text-muted-foreground' };
	const sub = { on: 'text-muted-foreground', signal: 'text-signal-foreground/80', none: 'text-muted-foreground' };
	const sliderTone = $derived(tone === 'on' ? '[&_[data-slot=slider-track]]:bg-on/25 [&_[data-slot=slider-range]]:bg-on' : '[&_[data-slot=slider-range]]:bg-primary');

	/** Pressing the icon does the obvious thing: switch it, lock it, play it. Pressing anywhere else opens the details. */
	const toggleable = $derived(device.available && !!(has('power') || has('lock') || media?.power || media?.playback));
	function toggle() {
		haptics.tap();
		if (selection.active) { selection.toggle(device.id); return; } // while choosing several, the icon chooses too
		if (has('power')) home.command(device.id, device.state === 'on' ? 'turn_off' : 'turn_on');
		else if (has('lock')) home.command(device.id, device.state === 'locked' ? 'unlock' : 'lock');
		else if (media?.power) home.command(device.id, device.state === 'off' ? 'turn_on' : 'turn_off');
		else if (media?.playback) home.command(device.id, device.state === 'playing' ? 'media_pause' : 'media_play');
	}

	// The one number worth seeing at a glance, shown large on the right.
	const numeric = (v: unknown) => v !== null && v !== '' && Number.isFinite(Number(v));
	const metric = $derived.by(() => {
		if (!device.available) return null;
		if ((device.category === 'sensor' || device.category === 'energy') && device.reading && numeric(device.reading.value)) return parts(device.reading.value, device.reading.unit);
		if (device.category === 'climate' && device.reading && numeric(device.reading.value)) return parts(device.reading.value, device.reading.unit ?? '°C', { short: true });
		return null;
	});
	const plain = (s: string) => (['unknown', 'unavailable'].includes(s) ? 'No reading' : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
	const since = $derived(device.changedAt ? ago(device.changedAt) : '');
	/** What the tile or sheet says about the device: confirmed state first, a pending command in plain words, a failure never as a state. */
	const status = $derived.by(() => {
		if (!home.online) return 'Paused';
		if (device.reason === 'device_offline') return 'Offline';
		if (device.reason === 'home_assistant_unavailable') return 'Hub unreachable';
		const a = device.attrs, on = device.state === 'on';
		if (home.busy[device.id]) return has('lock') ? (device.state === 'locked' ? 'Unlocking…' : 'Locking…') : has('power') ? (on ? 'Turning off…' : 'Turning on…') : 'Working…';
		switch (device.category) {
			case 'light': return on ? (numeric(a.brightnessPct) ? `On · ${a.brightnessPct}%` : 'On') : 'Off';
			case 'fan': return on ? (numeric(a.speedPct) ? `On · ${a.speedPct}%` : 'On') : 'Off';
			case 'switch': return on ? 'On' : device.state === 'off' ? 'Off' : plain(device.state);
			case 'climate': return `${device.reading && numeric(device.reading.value) ? measure(device.reading.value, device.reading.unit ?? '°C', { short: true }) : '—'}${numeric(a.target) ? ` → ${a.target}°` : ''} · ${plain(device.state)}`;
			case 'lock': return `${device.state === 'locked' ? 'Locked' : device.state === 'unlocked' ? 'Unlocked' : plain(device.state)}${since ? ` · ${since}` : ''}`;
			case 'media': return device.state === 'off' ? 'Off' : (a.title ?? plain(device.state));
			case 'sensor': case 'energy': {
				if (!device.reading || ['unknown', 'unavailable', ''].includes(device.reading.value)) return 'No reading';
				if (numeric(device.reading.value)) return measure(device.reading.value, device.reading.unit);
				const w = sensorWord(device);
				return w ? `${w}${since ? ` · ${since}` : ''}` : plain(device.reading.value);
			}
			default: return plain(device.state);
		}
	});
	/** On a small tile the number sits top right, so the line below drops it. */
	const short = $derived(metric && ['sensor', 'energy', 'climate'].includes(device.category) && device.available && home.online && !device.reason ? (device.category === 'climate' ? (numeric(device.attrs.target) ? `Set to ${device.attrs.target}° · ${plain(device.state)}` : plain(device.state)) : since) : status);
	const hasSecondary = $derived(!!(has('color_temp') || has('color') || has('thermostat') || has('media')));

	// Press and hold lifts the tile. Slide sideways to set a level (brightness, fan speed, temperature, volume); let go without
	// sliding for the quick-actions menu. A quick tap opens details, and a double tap goes to the level you usually pick.
	type Scrub = { min: number; max: number; step: number; cur: number; cmd: string; unit: string; every: number };
	const scrub = $derived.by<Scrub | null>(() => {
		if (!device.available || !home.online) return null;
		if (dimmable) return { min: 1, max: 100, step: 1, cur: device.attrs.brightnessPct ?? 100, cmd: 'set_brightness', unit: '%', every: 10 };
		if (fanSpeed && device.state === 'on') return { min: 0, max: 100, step: fanSpeed.step || 1, cur: device.attrs.speedPct ?? 0, cmd: 'set_speed', unit: '%', every: 10 };
		if (thermostat && numeric(device.attrs.target)) return { min: thermostat.min, max: thermostat.max, step: thermostat.step, cur: Number(device.attrs.target), cmd: 'set_temperature', unit: '°', every: 1 };
		if (media?.volume && device.state !== 'off') return { min: 0, max: 100, step: 1, cur: device.attrs.volumePct ?? 0, cmd: 'set_volume', unit: '%', every: 10 };
		return null;
	});
	const usualCmd = $derived(has('brightness') ? 'set_brightness' : fanSpeed ? 'set_speed' : thermostat ? 'set_temperature' : null);

	let tileEl: HTMLElement | undefined = $state();
	let drag = $state(false), dragVal = $state(0), lift = $state(false), menu = $state(false);
	const fill = $derived(drag && scrub ? ((dragVal - scrub.min) / (scrub.max - scrub.min)) * 100 : (device.attrs.brightnessPct ?? 100));
	const shown = $derived(drag && scrub ? `${Number.isInteger(dragVal) ? dragVal : dragVal.toFixed(1)}${scrub.unit}` : '');
	let timer: ReturnType<typeof setTimeout> | undefined, tapTimer: ReturnType<typeof setTimeout> | undefined, startX = 0, startY = 0, startVal = 0, moved = false, armed = false, lastVal = 0, lastTap = 0;

	function down(e: PointerEvent) {
		moved = false; armed = false; startX = e.clientX; startY = e.clientY; startVal = scrub?.cur ?? 0;
		if (selection.active) return;
		timer = setTimeout(() => { armed = true; lift = true; lastVal = startVal; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); haptics.grab(); }, 360);
	}
	function move(e: PointerEvent) {
		const dx = e.clientX - startX, dy = e.clientY - startY;
		if (!armed) { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { moved = true; clearTimeout(timer); } return; }
		e.preventDefault();
		if (!scrub) return;
		if (!drag) { if (Math.abs(dx) < 8) return; drag = true; dragVal = startVal; }
		dragVal = scrubbed(startVal, dx, tileEl?.getBoundingClientRect().width ?? 160, scrub.min, scrub.max, scrub.step);
		if (crossed(lastVal, dragVal, scrub.every)) { lastVal = dragVal; haptics.detent(); } // a tick at every notch, like a dial
	}
	function up() {
		clearTimeout(timer);
		if (selection.active) { if (!moved) { selection.toggle(device.id); haptics.tap(); } return; }
		if (armed) {
			const v = dragVal, sc = scrub, was = drag;
			armed = false; lift = false; drag = false;
			if (was && sc) { if (v !== startVal) home.command(device.id, sc.cmd, v); } else menu = true;
			return;
		}
		if (moved) return;
		tap();
	}
	function cancel() { clearTimeout(timer); armed = false; lift = false; drag = false; }
	/** Opening details: the tile's icon glides up into the sheet's header (where the browser supports it). Everything else just opens. */
	function openDetail() {
		const doc = document as unknown as { startViewTransition?: (cb: () => Promise<void>) => { finished: Promise<unknown> } };
		const chipEl = tileEl?.querySelector<HTMLElement>('[data-chip]');
		if (!doc.startViewTransition || reduced() || !chipEl) { sheetState.open = true; return; }
		chipEl.style.viewTransitionName = 'dev-chip';
		const t = doc.startViewTransition(async () => { chipEl.style.viewTransitionName = ''; sheetState.open = true; await tick(); });
		void t.finished.catch(() => {}).finally(() => { chipEl.style.viewTransitionName = ''; });
	}
	function tap() {
		const u = usual(device.id);
		if (usualCmd && u !== null && device.available) {
			const now = Date.now();
			if (now - lastTap < 300) { clearTimeout(tapTimer); lastTap = 0; haptics.success(); home.command(device.id, usualCmd, u); return; }
			lastTap = now; tapTimer = setTimeout(() => { lastTap = 0; openDetail(); }, 260); // wait a moment in case it's a double tap
			return;
		}
		openDetail();
	}
</script>

{#snippet controls()}
			{#if has('brightness') && device.state === 'on'}
				<Slider type="single" class={sliderTone} value={device.attrs.brightnessPct ?? 100} min={1} max={100} step={1} disabled={off} aria-label="{device.name} brightness" onValueCommit={(v) => home.command(device.id, 'set_brightness', v)} />
			{/if}
			{#if fanSpeed && device.state === 'on'}
				<Slider type="single" class={sliderTone} value={device.attrs.speedPct ?? 0} min={0} max={100} step={fanSpeed.step || 1} disabled={off} aria-label="{device.name} speed" onValueCommit={(v) => home.command(device.id, 'set_speed', v)} />
			{/if}
			{#if thermostat}
				{@const t = thermostat}
				<div class="flex items-center justify-between gap-2">
					<Button variant="secondary" size="icon" aria-label="Lower temperature" disabled={off} onclick={() => home.command(device.id, 'set_temperature', Math.max(t.min, (device.attrs.target ?? t.min) - t.step))}><Minus /></Button>
					<span class="figure text-3xl">{device.attrs.target ?? '—'}<span class="text-xl text-muted-foreground">{t.unit}</span></span>
					<Button variant="secondary" size="icon" aria-label="Raise temperature" disabled={off} onclick={() => home.command(device.id, 'set_temperature', Math.min(t.max, (device.attrs.target ?? t.min) + t.step))}><Plus /></Button>
				</div>
			{/if}
			{#if media?.volume}
				<Slider type="single" class={sliderTone} value={device.attrs.volumePct ?? 0} min={0} max={100} step={1} disabled={off} aria-label="{device.name} volume" onValueCommit={(v) => home.command(device.id, 'set_volume', v)} />
			{/if}
			{#if media?.playback}
				<div class="flex gap-2">
					<Button variant="secondary" size="sm" disabled={off} onclick={() => home.command(device.id, 'media_play')}><Play />Play</Button>
					<Button variant="secondary" size="sm" disabled={off} onclick={() => home.command(device.id, 'media_pause')}><Pause />Pause</Button>
				</div>
			{/if}
			{#if has('camera')}
				<img src={snap} alt="Latest picture from {device.name}" class="aspect-video max-h-56 w-full rounded-xl bg-muted object-cover" loading="lazy" />
			{/if}
			{#if hasSecondary && ((device.state === 'on' && (has('color_temp') || has('color'))) || has('thermostat'))}
				<button type="button" class="text-sm font-medium text-primary underline-offset-4 hover:underline {tone === 'on' ? 'text-on-foreground' : ''}" onclick={() => (more = !more)} aria-expanded={more}>{more ? 'Fewer settings' : 'More settings'}</button>
				{#if more}
					<div class="space-y-3.5">
						{#if colorTemp && device.state === 'on'}
							{@const c = colorTemp}
							<label class="block space-y-1.5 text-sm">Warmth
								<Slider type="single" class={sliderTone} value={device.attrs.colorTempK ?? c.minK} min={c.minK} max={c.maxK} step={100} disabled={off} aria-label="{device.name} color temperature" onValueCommit={(v) => home.command(device.id, 'set_color_temp', v)} />
							</label>
						{/if}
						{#if has('color') && device.state === 'on'}
							<label class="block space-y-1.5 text-sm">Colour
								<Slider type="single" class={sliderTone} value={device.attrs.hs?.[0] ?? 0} min={0} max={360} step={1} disabled={off} aria-label="{device.name} hue" onValueCommit={(v) => home.command(device.id, 'set_color', { h: v, s: device.attrs.hs?.[1] ?? 100 })} />
							</label>
						{/if}
						{#if thermostat?.modes.length}
							<div class="flex flex-wrap gap-2" role="group" aria-label="Mode">
								{#each thermostat.modes as m}
									<Button size="sm" variant={device.state === m ? 'default' : 'secondary'} class="capitalize" disabled={off} onclick={() => home.command(device.id, 'set_hvac_mode', m)}>{m.replace('_', ' ')}</Button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/if}
{/snippet}
{#snippet actions()}
	{#if session.can('automation.manage') && !compact}
		<Button variant="ghost" size="icon-sm" class="text-current opacity-55 hover:opacity-100" href="/automations/new?device={encodeURIComponent(device.id)}" aria-label="Create an automation for {device.name}"><Workflow class="size-4" /></Button>
	{/if}
	<Button variant="ghost" size="icon-sm" class="text-current opacity-55 hover:opacity-100" aria-label={home.isFavorite(device.id) ? `Remove ${device.name} from favourites` : `Add ${device.name} to favourites`} aria-pressed={home.isFavorite(device.id)} onclick={() => { haptics.tap(); home.toggleFavorite(device.id); }}>
		<Star class="size-4 {home.isFavorite(device.id) ? 'fill-current' : ''}" />
	</Button>
{/snippet}
{#snippet control()}
	{#if has('power')}
		<Switch checked={device.state === 'on'} disabled={off} aria-label="{device.name} power" onCheckedChange={(v) => { haptics.tap(); home.command(device.id, v ? 'turn_on' : 'turn_off'); if (v && has('brightness')) slideHint(); }} />
	{:else if has('lock') && device.state === 'locked'}
		<HoldButton onhold={() => home.command(device.id, 'unlock')} hint="Hold to unlock {device.name}" disabled={off} class="inline-flex h-8 items-center rounded-lg bg-secondary px-3 text-sm font-medium text-secondary-foreground disabled:opacity-50">Hold to unlock</HoldButton>
	{:else if has('lock')}
		<Button variant="default" size="sm" disabled={off} onclick={toggle}>Lock</Button>
	{/if}
{/snippet}
{#snippet icn(size: string)}
	{#if toggleable && has('lock') && device.state === 'locked'}
		<HoldButton data-chip ring onhold={() => home.command(device.id, 'unlock')} hint="Hold to unlock {device.name}" disabled={off} aria-label="Hold to unlock {device.name}" class="pointer-events-auto z-20 flex {size} shrink-0 items-center justify-center rounded-full transition-colors duration-200 disabled:opacity-60 {chip[tone]}"><Icon class="size-[46%]" aria-hidden="true" /></HoldButton>
	{:else}
		<span data-chip class="flex {size} shrink-0 items-center justify-center rounded-full transition-colors duration-300 {chip[tone]}">{#key tone}<span class="flex size-full items-center justify-center" in:scale={{ start: 0.7, duration: dur(220), easing: backOut }}><Icon class="size-[46%]" aria-hidden="true" /></span>{/key}</span>
	{/if}
{/snippet}
{#snippet tileSwitch()}
	{#if selection.active || !device.available}
		<!-- nothing to switch while choosing several, or when the device can't be reached -->
	{:else if has('lock') && device.state !== 'locked'}
		<Button class="pointer-events-auto relative z-20" size="sm" variant="secondary" disabled={off} onclick={toggle}>Lock</Button>
	{/if}
{/snippet}
{#snippet label()}
	<h3 class="line-clamp-2 break-words text-[0.9375rem] font-semibold leading-[1.15] tracking-[-0.015em]">{device.name}</h3>
	{#if device.subtitle}<p class="mt-0.5 truncate text-xs {sub[tone]}">{device.subtitle}</p>{/if}
	{#if short || !device.available}<p class="mt-0.5 truncate text-[0.8125rem] {sub[tone]}" aria-live="polite">{#if !device.available}<Badge variant="outline" class="-ml-0.5 h-5 px-2">{short}</Badge>{:else}{short}{/if}</p>{/if}
{/snippet}
{#snippet drawerBody()}
	<Drawer.Header class="px-0 pb-1"><Drawer.Title class="flex items-center gap-3 text-left"><span class="flex size-10 shrink-0 items-center justify-center rounded-full {chip[tone]}" style="view-transition-name: dev-chip"><Icon class="size-5" aria-hidden="true" /></span><span class="min-w-0"><span class="block truncate text-lg font-semibold tracking-[-0.02em]">{device.name}</span>{#if device.subtitle}<span class="block truncate text-xs font-normal text-muted-foreground">{device.subtitle}</span>{/if}<span class="block text-sm font-normal text-muted-foreground">{status}</span></span></Drawer.Title><Drawer.Description class="sr-only">Controls for {device.name}</Drawer.Description></Drawer.Header>
	<div class="space-y-5 pt-2">
		{#if device.available && (has('power') || (has('lock') && device.state !== 'locked'))}
			<div class="flex items-center justify-between rounded-2xl bg-secondary/60 px-4 py-3">
				<span class="text-[0.9375rem] font-medium">{has('lock') ? 'Lock the door' : device.state === 'on' ? 'On' : 'Off'}</span>
				{@render control()}
			</div>
		{/if}
		{#if device.available}<div class="space-y-3.5">{@render controls()}</div>{:else}<p class="text-sm text-muted-foreground">{device.reason === 'device_offline' ? 'This device is offline. Check its power and Wi-Fi.' : 'The home hub can’t be reached, so it can’t be controlled right now.'}</p>{/if}
		{#if detail}<DeviceHistory id={device.id} />{/if}
		{#if since && device.available}<p class="text-sm text-muted-foreground">Last changed {since}{#if changedBy}, by {changedBy}{:else if changedBy === null}, in Home Assistant or at the device{/if}.</p>{/if}
		{#if device.category === 'energy' && ['W', 'kW'].includes(device.reading?.unit ?? '') && session.can('automation.manage')}<PowerLimit {device} />{/if}
		<div class="flex flex-wrap gap-2 border-t pt-4">
			<Button variant="secondary" aria-pressed={home.isFavorite(device.id)} onclick={() => { haptics.tap(); home.toggleFavorite(device.id); }}><Star class={home.isFavorite(device.id) ? 'fill-current' : ''} />{home.isFavorite(device.id) ? 'Favourite' : 'Add to favourites'}</Button>
			{#if session.can('automation.manage')}<Button variant="secondary" href="/automations/new?device={encodeURIComponent(device.id)}"><Workflow />Automate</Button>{/if}
			{#if session.can('rooms.manage')}<Button variant="secondary" aria-expanded={editing} onclick={() => (editing = !editing)}><Pencil />{editing ? 'Close editor' : 'Rename, room and icon'}</Button>{/if}
		</div>
		{#if editing && session.can('rooms.manage')}<DeviceEdit {device} onsaved={() => (editing = false)} />{/if}
	</div>
{/snippet}

{#if phoneTile}
	{@const th = has('thermostat')}
	{@const cam = has('camera') && device.available}
	<div data-device={device.id} bind:this={tileEl} class="relative isolate h-full select-none overflow-hidden rounded-tile border transition-[background-color,transform,box-shadow] duration-300 {lift ? 'lifted z-10' : 'active:scale-[0.985]'} {home.flash[device.id] === 'ok' ? 'flash-ok' : home.flash[device.id] === 'fail' ? 'flash-fail' : ''} {selection.has(device.id) ? 'ring-2 ring-primary' : ''} {cam ? 'border-transparent bg-card' : surface[tone]} {device.available && home.online ? '' : 'opacity-65'}" style="touch-action: pan-y; -webkit-touch-callout: none">
		{#if cam}
			<img src={snap} alt="" class="pointer-events-none absolute inset-0 -z-10 size-full object-cover" loading="lazy" />
			<div class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-black/70 via-black/10 to-black/20"></div>
		{/if}
		{#if drag}<div class="pointer-events-none absolute inset-y-0 left-0 z-0 bg-on/45" style="width:{fill}%" aria-hidden="true"></div>{/if}
		<button type="button" class="absolute inset-0 z-0" aria-label="{device.name}: details" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} oncontextmenu={(e) => e.preventDefault()}></button>

		{#if th && device.available}
			<div class="pointer-events-none relative z-10 flex h-full items-center gap-3 p-3.5">
				{@render icn('size-11')}
				<div class="min-w-0 flex-1">{@render label()}</div>
				<Button class="pointer-events-auto" variant="secondary" size="icon-lg" aria-label="Lower temperature" disabled={off} onclick={() => { haptics.tap(); home.command(device.id, 'set_temperature', Math.max(th.min, (device.attrs.target ?? th.min) - th.step)); }}><Minus /></Button>
				<span class="figure min-w-10 text-center text-2xl">{device.attrs.target ?? '—'}°</span>
				<Button class="pointer-events-auto" variant="secondary" size="icon-lg" aria-label="Raise temperature" disabled={off} onclick={() => { haptics.tap(); home.command(device.id, 'set_temperature', Math.min(th.max, (device.attrs.target ?? th.min) + th.step)); }}><Plus /></Button>
			</div>
		{:else if cam}
			<div class="pointer-events-none relative z-10 flex h-full flex-col justify-between p-3.5 text-white">
				<span class="flex size-9 items-center justify-center rounded-full bg-black/35 backdrop-blur"><Icon class="size-4" aria-hidden="true" /></span>
				<div class="min-w-0"><h3 class="truncate text-[0.9375rem] font-semibold">{device.name}</h3><p class="text-[0.8125rem] text-white/75">Tap to see live</p></div>
			</div>
		{:else if wide && media}
			<div class="pointer-events-none relative z-10 flex h-full items-center gap-3 p-3.5">
				{@render icn('size-11')}
				<div class="min-w-0 flex-1">{@render label()}</div>
				{#if media.playback && device.available}<Button class="pointer-events-auto" variant="secondary" size="icon-lg" aria-label={device.state === 'playing' ? 'Pause' : 'Play'} disabled={off} onclick={toggle}>{#if device.state === 'playing'}<Pause />{:else}<Play />{/if}</Button>{/if}
			</div>
		{:else}
			<div class="pointer-events-none relative z-10 flex h-full flex-col justify-between p-3">
				<div class="flex items-start justify-between gap-2">
					{@render icn('size-10')}
					{#if metric}<span class="figure text-[1.375rem] leading-none">{metric.v}<span class="ml-0.5 text-sm font-medium opacity-60">{metric.u}</span></span>{:else}{@render tileSwitch()}{/if}
				</div>
				<div class="min-w-0 pt-2">{@render label()}</div>
			</div>
			{#if dimmable && !drag}<div class="pointer-events-none absolute bottom-0 left-0 z-10 h-[3px] rounded-r-full bg-on transition-[width] duration-300" style="width:{fill}%" aria-hidden="true"></div>{/if}
		{/if}
		{#if drag}<div class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"><span class="figure rounded-full bg-foreground/90 px-3 py-1 text-lg text-background">{shown}</span></div>{/if}
		{#if selection.active}<span class="pointer-events-none absolute bottom-3 right-3 z-30 flex size-6 items-center justify-center rounded-full border-2 transition-colors {selection.has(device.id) ? 'border-primary bg-primary text-primary-foreground' : 'border-foreground/30 bg-background/70'}" aria-hidden="true">{#if selection.has(device.id)}<Check class="size-3.5" strokeWidth={3} />{/if}</span>{/if}
	</div>
	<Drawer.Root bind:open={sheetState.open}>
		<Drawer.Content class="max-h-[88dvh] rounded-t-3xl"><div class="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">{@render drawerBody()}</div></Drawer.Content>
	</Drawer.Root>
	<TileMenu {device} bind:open={menu} ondetails={() => (sheetState.open = true)} />
{:else}
<div data-device={device.id} class="relative h-full rounded-tile border transition-colors duration-300 {home.flash[device.id] === 'ok' ? 'flash-ok' : home.flash[device.id] === 'fail' ? 'flash-fail' : ''} {surface[tone]} {device.available ? '' : 'opacity-65'}">
	{#if compact}
		<div class="flex items-center gap-3 p-3">
			{@render icn('size-10')}
			<div class="min-w-0 flex-1">{@render label()}</div>
			<span class="flex items-center gap-0.5">{@render actions()}</span>
			{@render control()}
		</div>
	{:else}
		<div class="flex items-center gap-3 p-3.5 pb-2">
			{@render icn('size-10')}
			<div class="min-w-0 flex-1"><h3 class="truncate text-[0.9375rem] font-semibold leading-tight tracking-[-0.015em]">{device.name}</h3><p class="mt-0.5 truncate text-sm {sub[tone]}" aria-live="polite">{#if !device.available}<Badge variant="outline" class="-ml-0.5 h-5 px-2">{status}</Badge>{:else}{status}{/if}</p></div>
			<span class="flex items-center gap-0.5">{@render actions()}</span>
			<span class="ml-1">{@render control()}</span>
		</div>
	{/if}

	{#if !compact && device.available}
		<div class="space-y-3.5 px-3.5 pb-3.5">
			{@render controls()}
		</div>
	{/if}
</div>
{/if}
