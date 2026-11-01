<script lang="ts">
	import { home, type Device } from '#lib/home.svelte.js';
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
	import { dur } from '#lib/motion.js';
	import { viewport } from '#lib/viewport.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { Lightbulb, Plug, Fan, Thermometer, Lock, LockOpen, Camera, Tv, Gauge, Zap, Star, Workflow, Minus, Plus, Play, Pause } from '@lucide/svelte';

	let { device, compact = false }: { device: Device; compact?: boolean } = $props();

	const icons: Record<string, any> = { light: Lightbulb, switch: Plug, fan: Fan, climate: Thermometer, lock: Lock, camera: Camera, media: Tv, sensor: Gauge, energy: Zap };
	const Icon = $derived(device.category === 'lock' && device.state === 'unlocked' ? LockOpen : (icons[device.category] ?? Gauge));
	const has = <T extends string>(t: T) => device.controls.find((c) => c.type === t) as any;
	const off = $derived(!device.available || !!home.busy[device.id]);
	let more = $state(false), detail = $state(false);
	const phoneTile = $derived(viewport.phone && !compact);
	const wide = $derived(isWide(device));
	const dimmable = $derived(device.available && device.state === 'on' && !!has('brightness'));

	// Ember means on; signal means a door is open to the world. Everything else stays neutral.
	const tone = $derived<'on' | 'signal' | 'none'>(!device.available ? 'none' : device.category === 'lock' && device.state === 'unlocked' ? 'signal' : ['light', 'switch', 'fan'].includes(device.category) && device.state === 'on' ? 'on' : device.category === 'media' && device.state === 'playing' ? 'on' : 'none');
	const surface = { on: 'border-transparent bg-on-soft text-on-foreground', signal: 'border-transparent bg-signal-soft text-signal-foreground', none: 'bg-card' };
	const chip = { on: 'bg-on text-on-foreground shadow-[0_0_0_4px_color-mix(in_oklab,var(--on)_22%,transparent)]', signal: 'bg-signal text-white shadow-[0_0_0_4px_color-mix(in_oklab,var(--signal)_20%,transparent)]', none: 'bg-secondary text-muted-foreground' };
	const sub = { on: 'text-on-foreground/70', signal: 'text-signal-foreground/80', none: 'text-muted-foreground' };
	const sliderTone = $derived(tone === 'on' ? '[&_[data-slot=slider-track]]:bg-on/25 [&_[data-slot=slider-range]]:bg-on' : '[&_[data-slot=slider-range]]:bg-primary');

	/** Pressing the icon does the obvious thing: switch it, lock it, play it. Pressing anywhere else opens the details. */
	const toggleable = $derived(device.available && !!(has('power') || has('lock') || has('media')?.power || has('media')?.playback));
	function toggle() {
		haptics.tap();
		if (has('power')) home.command(device.id, device.state === 'on' ? 'turn_off' : 'turn_on');
		else if (has('lock')) home.command(device.id, device.state === 'locked' ? 'unlock' : 'lock');
		else if (has('media')?.power) home.command(device.id, device.state === 'off' ? 'turn_on' : 'turn_off');
		else if (has('media')?.playback) home.command(device.id, device.state === 'playing' ? 'media_pause' : 'media_play');
	}
	const toggleLabel = $derived(has('lock') ? (device.state === 'locked' ? `Unlock ${device.name}` : `Lock ${device.name}`) : has('power') ? `Turn ${device.name} ${device.state === 'on' ? 'off' : 'on'}` : `Play or pause ${device.name}`);

	// The one number worth seeing at a glance, shown large on the right.
	const numeric = (v: unknown) => v !== null && v !== '' && Number.isFinite(Number(v));
	const metric = $derived.by(() => {
		if (!device.available) return null;
		const a = device.attrs;
		if (device.category === 'light' && device.state === 'on' && numeric(a.brightnessPct)) return { v: String(a.brightnessPct), u: '%' };
		if (device.category === 'fan' && device.state === 'on' && numeric(a.speedPct)) return { v: String(a.speedPct), u: '%' };
		if ((device.category === 'sensor' || device.category === 'energy') && device.reading && numeric(device.reading.value)) return { v: device.reading.value, u: device.reading.unit ?? '' };
		if (device.category === 'climate' && device.reading && numeric(device.reading.value)) return { v: device.reading.value, u: '°' };
		return null;
	});
	const plain = (s: string) => (['unknown', 'unavailable'].includes(s) ? 'No reading' : s.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()));
	const short = $derived.by(() => {
		if (device.reason === 'device_offline') return 'Offline';
		if (device.reason === 'home_assistant_unavailable') return 'Hub unreachable';
		const a = device.attrs;
		switch (device.category) {
			case 'light': case 'fan': case 'switch': return device.state === 'on' ? 'On' : 'Off';
			case 'lock': return device.state === 'locked' ? 'Locked' : device.state === 'unlocked' ? 'Unlocked' : device.state;
			case 'media': return device.state === 'off' ? 'Off' : (a.title ?? device.state);
			case 'climate': return `${plain(device.state)}${numeric(a.target) ? ` · set ${a.target}°` : ''}`;
			case 'sensor': case 'energy': return !device.reading || ['unknown', 'unavailable', ''].includes(device.reading.value) ? 'No reading' : numeric(device.reading.value) ? '' : plain(device.reading.value);
			default: return '';
		}
	});
	const status = $derived.by(() => {
		if (device.reason === 'device_offline') return 'Offline';
		if (device.reason === 'home_assistant_unavailable') return 'Hub unreachable';
		const a = device.attrs;
		switch (device.category) {
			case 'light': return device.state === 'on' ? (a.brightnessPct != null ? `On · ${a.brightnessPct}%` : 'On') : 'Off';
			case 'fan': return device.state === 'on' ? (a.speedPct != null ? `On · ${a.speedPct}%` : 'On') : 'Off';
			case 'climate': return `${device.reading && numeric(device.reading.value) ? device.reading.value + '°' : '—'}${numeric(a.target) ? ` → ${a.target}°` : ''} · ${plain(device.state)}`;
			case 'lock': return device.state === 'locked' ? 'Locked' : device.state === 'unlocked' ? 'Unlocked' : device.state;
			case 'media': return device.state === 'off' ? 'Off' : (a.title ?? device.state);
			case 'sensor': case 'energy': return device.reading && numeric(device.reading.value) ? `${device.reading.value}${device.reading.unit ? ' ' + device.reading.unit : ''}` : plain(device.reading?.value ?? device.state);
			default: return device.state === 'on' ? 'On' : device.state === 'off' ? 'Off' : device.state;
		}
	});
	const hasSecondary = $derived(!!(has('color_temp') || has('color') || has('thermostat') || has('media')));

	// Dimming is a deliberate gesture: press and hold, then slide sideways. A quick tap opens details; scrolling never dims.
	let tileEl: HTMLElement | undefined = $state();
	let drag = $state(false), dragPct = $state(0);
	const shownPct = $derived(drag ? dragPct : (device.attrs.brightnessPct ?? 100));
	let timer: ReturnType<typeof setTimeout> | undefined, startX = 0, startY = 0, startPct = 0, moved = false, armed = false, lastTick = -1;
	function down(e: PointerEvent) {
		moved = false; armed = false; startX = e.clientX; startY = e.clientY; startPct = device.attrs.brightnessPct ?? 100;
		if (dimmable) timer = setTimeout(() => { armed = true; drag = true; dragPct = startPct; lastTick = startPct; (e.target as HTMLElement).setPointerCapture?.(e.pointerId); haptics.grab(); }, 360);
	}
	function move(e: PointerEvent) {
		const dx = e.clientX - startX, dy = e.clientY - startY;
		if (!armed) { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { moved = true; clearTimeout(timer); } return; }
		e.preventDefault();
		const w = tileEl?.getBoundingClientRect().width ?? 160;
		dragPct = Math.round(Math.min(100, Math.max(1, startPct + (dx / w) * 100)));
		if (Math.abs(dragPct - lastTick) >= 10) { lastTick = dragPct; haptics.tap(); } // a tick every ten percent, like a dial
	}
	function up() {
		clearTimeout(timer);
		if (armed) { const v = dragPct; armed = false; drag = false; if (v !== startPct) home.command(device.id, 'set_brightness', v); return; }
		if (!moved) detail = true;
	}
	function cancel() { clearTimeout(timer); armed = false; drag = false; }
</script>

{#snippet controls()}
			{#if has('brightness') && device.state === 'on'}
				<Slider type="single" class={sliderTone} value={device.attrs.brightnessPct ?? 100} min={1} max={100} step={1} disabled={off} aria-label="{device.name} brightness" onValueCommit={(v) => home.command(device.id, 'set_brightness', v)} />
			{/if}
			{#if has('fan_speed') && device.state === 'on'}
				<Slider type="single" class={sliderTone} value={device.attrs.speedPct ?? 0} min={0} max={100} step={has('fan_speed').step || 1} disabled={off} aria-label="{device.name} speed" onValueCommit={(v) => home.command(device.id, 'set_speed', v)} />
			{/if}
			{#if has('thermostat')}
				{@const t = has('thermostat')}
				<div class="flex items-center justify-between gap-2">
					<Button variant="secondary" size="icon" aria-label="Lower temperature" disabled={off} onclick={() => home.command(device.id, 'set_temperature', Math.max(t.min, (device.attrs.target ?? t.min) - t.step))}><Minus /></Button>
					<span class="figure text-3xl">{device.attrs.target ?? '—'}<span class="text-xl text-muted-foreground">{t.unit}</span></span>
					<Button variant="secondary" size="icon" aria-label="Raise temperature" disabled={off} onclick={() => home.command(device.id, 'set_temperature', Math.min(t.max, (device.attrs.target ?? t.min) + t.step))}><Plus /></Button>
				</div>
			{/if}
			{#if has('media')?.volume}
				<Slider type="single" class={sliderTone} value={device.attrs.volumePct ?? 0} min={0} max={100} step={1} disabled={off} aria-label="{device.name} volume" onValueCommit={(v) => home.command(device.id, 'set_volume', v)} />
			{/if}
			{#if has('media')?.playback}
				<div class="flex gap-2">
					<Button variant="secondary" size="sm" disabled={off} onclick={() => home.command(device.id, 'media_play')}><Play />Play</Button>
					<Button variant="secondary" size="sm" disabled={off} onclick={() => home.command(device.id, 'media_pause')}><Pause />Pause</Button>
				</div>
			{/if}
			{#if has('camera')}
				<img src="/api/devices/{encodeURIComponent(device.id)}/snapshot" alt="Latest picture from {device.name}" class="aspect-video max-h-56 w-full rounded-xl bg-muted object-cover" loading="lazy" />
			{/if}
			{#if hasSecondary && ((device.state === 'on' && (has('color_temp') || has('color'))) || has('thermostat'))}
				<button type="button" class="text-sm font-medium text-primary underline-offset-4 hover:underline {tone === 'on' ? 'text-on-foreground' : ''}" onclick={() => (more = !more)} aria-expanded={more}>{more ? 'Fewer settings' : 'More settings'}</button>
				{#if more}
					<div class="space-y-3.5">
						{#if has('color_temp') && device.state === 'on'}
							{@const c = has('color_temp')}
							<label class="block space-y-1.5 text-sm">Warmth
								<Slider type="single" class={sliderTone} value={device.attrs.colorTempK ?? c.minK} min={c.minK} max={c.maxK} step={100} disabled={off} aria-label="{device.name} color temperature" onValueCommit={(v) => home.command(device.id, 'set_color_temp', v)} />
							</label>
						{/if}
						{#if has('color') && device.state === 'on'}
							<label class="block space-y-1.5 text-sm">Color
								<Slider type="single" class={sliderTone} value={device.attrs.hs?.[0] ?? 0} min={0} max={360} step={1} disabled={off} aria-label="{device.name} hue" onValueCommit={(v) => home.command(device.id, 'set_color', { h: v, s: device.attrs.hs?.[1] ?? 100 })} />
							</label>
						{/if}
						{#if has('thermostat')?.modes.length}
							<div class="flex flex-wrap gap-2" role="group" aria-label="Mode">
								{#each has('thermostat').modes as m}
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
	<Button variant="ghost" size="icon-sm" class="text-current opacity-55 hover:opacity-100" aria-label={home.isFavorite(device.id) ? `Remove ${device.name} from favorites` : `Add ${device.name} to favorites`} aria-pressed={home.isFavorite(device.id)} onclick={() => { haptics.tap(); home.toggleFavorite(device.id); }}>
		<Star class="size-4 {home.isFavorite(device.id) ? 'fill-current' : ''}" />
	</Button>
{/snippet}
{#snippet control()}
	{#if has('power')}
		<Switch checked={device.state === 'on'} disabled={off} aria-label="{device.name} power" onCheckedChange={(v) => { haptics.tap(); home.command(device.id, v ? 'turn_on' : 'turn_off'); }} />
	{:else if has('lock')}
		<Button variant={device.state === 'locked' ? 'secondary' : 'default'} size="sm" disabled={off} onclick={toggle}>{device.state === 'locked' ? 'Unlock' : 'Lock'}</Button>
	{/if}
{/snippet}
{#snippet icn(size: string)}
	{#if toggleable}
		<button type="button" onclick={toggle} disabled={off} aria-label={toggleLabel} aria-pressed={tone !== 'none'} class="pointer-events-auto relative z-20 flex {size} shrink-0 items-center justify-center rounded-full transition-[background-color,box-shadow,transform] duration-200 active:scale-90 disabled:opacity-60 {chip[tone]}">{#key tone}<span class="flex size-full items-center justify-center" in:scale={{ start: 0.7, duration: dur(220), easing: backOut }}><Icon class="size-[46%]" aria-hidden="true" /></span>{/key}</button>
	{:else}
		<span class="flex {size} shrink-0 items-center justify-center rounded-full transition-colors duration-300 {chip[tone]}"><Icon class="size-[46%]" aria-hidden="true" /></span>
	{/if}
{/snippet}
{#snippet label()}
	<h3 class="line-clamp-2 break-words text-[0.9375rem] font-semibold leading-[1.15] tracking-[-0.015em]">{device.name}</h3>
	{#if short || !device.available}<p class="mt-0.5 truncate text-[0.8125rem] {sub[tone]}" aria-live="polite">{#if !device.available}<Badge variant="outline" class="-ml-0.5 h-5 px-2">{short}</Badge>{:else}{short}{/if}</p>{/if}
{/snippet}
{#snippet drawerBody()}
	<Drawer.Header class="px-0 pb-1"><Drawer.Title class="flex items-center gap-3 text-left"><span class="flex size-10 shrink-0 items-center justify-center rounded-full {chip[tone]}"><Icon class="size-5" aria-hidden="true" /></span><span class="min-w-0"><span class="block truncate text-lg font-semibold tracking-[-0.02em]">{device.name}</span><span class="block text-sm font-normal text-muted-foreground">{status}</span></span></Drawer.Title><Drawer.Description class="sr-only">Controls for {device.name}</Drawer.Description></Drawer.Header>
	<div class="space-y-5 pt-2">
		{#if device.available}<div class="space-y-3.5">{@render controls()}</div>{:else}<p class="text-sm text-muted-foreground">{device.reason === 'device_offline' ? 'This device is offline. Check its power and Wi-Fi.' : 'The home hub can’t be reached, so it can’t be controlled right now.'}</p>{/if}
		{#if detail}<DeviceHistory id={device.id} />{/if}
		{#if device.category === 'energy' && ['W', 'kW'].includes(device.reading?.unit ?? '') && session.can('automation.manage')}<PowerLimit {device} />{/if}
		<div class="flex flex-wrap gap-2 border-t pt-4">
			<Button variant="secondary" aria-pressed={home.isFavorite(device.id)} onclick={() => { haptics.tap(); home.toggleFavorite(device.id); }}><Star class={home.isFavorite(device.id) ? 'fill-current' : ''} />{home.isFavorite(device.id) ? 'Favorite' : 'Add to favorites'}</Button>
			{#if session.can('automation.manage')}<Button variant="secondary" href="/automations/new?device={encodeURIComponent(device.id)}"><Workflow />Automate</Button>{/if}
		</div>
	</div>
{/snippet}

{#if phoneTile}
	{@const th = has('thermostat')}
	{@const cam = has('camera') && device.available}
	<div data-device={device.id} bind:this={tileEl} class="relative isolate h-full select-none overflow-hidden rounded-tile border transition-[background-color,transform] duration-300 active:scale-[0.985] {cam ? 'border-transparent bg-card' : surface[tone]} {device.available ? '' : 'opacity-65'}" style="touch-action: pan-y; -webkit-touch-callout: none">
		{#if cam}
			<img src="/api/devices/{encodeURIComponent(device.id)}/snapshot" alt="" class="pointer-events-none absolute inset-0 -z-10 size-full object-cover" loading="lazy" />
			<div class="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-t from-black/70 via-black/10 to-black/20"></div>
		{/if}
		{#if drag}<div class="pointer-events-none absolute inset-y-0 left-0 z-0 bg-on/45" style="width:{shownPct}%" aria-hidden="true"></div>{/if}
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
		{:else if wide && has('media')}
			<div class="pointer-events-none relative z-10 flex h-full items-center gap-3 p-3.5">
				{@render icn('size-11')}
				<div class="min-w-0 flex-1">{@render label()}</div>
				{#if has('media').playback && device.available}<Button class="pointer-events-auto" variant="secondary" size="icon-lg" aria-label={device.state === 'playing' ? 'Pause' : 'Play'} disabled={off} onclick={toggle}>{#if device.state === 'playing'}<Pause />{:else}<Play />{/if}</Button>{/if}
			</div>
		{:else}
			<div class="pointer-events-none relative z-10 flex h-full flex-col justify-between p-3">
				<div class="flex items-start justify-between gap-2">
					{@render icn('size-10')}
					{#if metric}<span class="figure text-[1.375rem] leading-none {tone === 'none' ? '' : ''}">{metric.v}<span class="ml-0.5 text-sm font-medium opacity-60">{metric.u}</span></span>{/if}
				</div>
				<div class="min-w-0 pt-2">{@render label()}</div>
			</div>
			{#if dimmable && !drag}<div class="pointer-events-none absolute bottom-0 left-0 z-10 h-[3px] rounded-r-full bg-on transition-[width] duration-300" style="width:{shownPct}%" aria-hidden="true"></div>{/if}
		{/if}
		{#if drag}<div class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"><span class="figure rounded-full bg-foreground/90 px-3 py-1 text-lg text-background">{shownPct}%</span></div>{/if}
	</div>
	<Drawer.Root bind:open={detail}>
		<Drawer.Content class="max-h-[88dvh] rounded-t-3xl"><div class="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">{@render drawerBody()}</div></Drawer.Content>
	</Drawer.Root>
{:else}
<div data-device={device.id} class="h-full rounded-tile border transition-colors duration-300 {surface[tone]} {device.available ? '' : 'opacity-65'}">
	{#if compact}
		<div class="flex items-center gap-3 p-3">
			{@render icn('size-10')}
			<div class="min-w-0 flex-1">{@render label()}</div>
			<span class="flex items-center gap-0.5">{@render actions()}</span>
			{@render control()}
		</div>
	{:else}
		<div class="flex items-center gap-1 p-3.5 pb-1">
			{@render icn('size-10')}
			<span class="ml-auto flex items-center gap-0.5">{@render actions()}</span>
			<span class="ml-1.5">{@render control()}</span>
		</div>
		<div class="px-3.5 pb-3 pt-1.5"><h3 class="truncate text-[0.9375rem] font-semibold leading-tight tracking-[-0.015em]">{device.name}</h3><p class="mt-0.5 truncate text-sm {sub[tone]}" aria-live="polite">{#if !device.available}<Badge variant="outline" class="-ml-0.5 h-5 px-2">{status}</Badge>{:else}{status}{/if}</p></div>
	{/if}

	{#if !compact && device.available}
		<div class="space-y-3.5 px-3.5 pb-3.5">
			{@render controls()}
		</div>
	{/if}
</div>
{/if}
