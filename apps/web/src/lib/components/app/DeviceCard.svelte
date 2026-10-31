<script lang="ts">
	import { home, type Device } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { Switch } from '#lib/components/ui/switch';
	import { Slider } from '#lib/components/ui/slider';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import * as Drawer from '#lib/components/ui/drawer';
	import DeviceHistory from '#lib/components/app/DeviceHistory.svelte';
	import { isWide } from '#lib/tiles.js';
	import { viewport } from '#lib/viewport.svelte.js';
	import { Lightbulb, Plug, Fan, Thermometer, Lock, LockOpen, Camera, Tv, Gauge, Zap, Star, Workflow, Minus, Plus, Play, Pause } from '@lucide/svelte';

	let { device, compact = false }: { device: Device; compact?: boolean } = $props();

	const icons: Record<string, any> = { light: Lightbulb, switch: Plug, fan: Fan, climate: Thermometer, lock: Lock, camera: Camera, media: Tv, sensor: Gauge, energy: Zap };
	const Icon = $derived(device.category === 'lock' && device.state === 'unlocked' ? LockOpen : (icons[device.category] ?? Gauge));
	const has = <T extends string>(t: T) => device.controls.find((c) => c.type === t) as any;
	const off = $derived(!device.available || !!home.busy[device.id]);
	const isOn = $derived(['on', 'heat', 'cool', 'playing', 'idle', 'auto', 'heat_cool', 'paused'].includes(device.state) && device.state !== 'off');
	let more = $state(false), detail = $state(false);
	const phoneTile = $derived(viewport.phone && !compact);
	const wide = $derived(isWide(device));
	const dimmable = $derived(device.available && device.state === 'on' && !!has('brightness'));
	let tileEl: HTMLElement | undefined = $state();
	let drag = $state(false), dragPct = $state(0);
	const shownPct = $derived(drag ? dragPct : (device.attrs.brightnessPct ?? 100));
	// Dimming is a deliberate gesture: press and hold, then slide sideways. A quick tap opens details; scrolling never dims.
	let timer: ReturnType<typeof setTimeout> | undefined, startX = 0, startY = 0, startPct = 0, moved = false, armed = false, pid = -1;
	function down(e: PointerEvent) {
		moved = false; armed = false; startX = e.clientX; startY = e.clientY; startPct = device.attrs.brightnessPct ?? 100; pid = e.pointerId;
		if (dimmable) timer = setTimeout(() => { armed = true; drag = true; dragPct = startPct; (e.target as HTMLElement).setPointerCapture?.(pid); navigator.vibrate?.(8); }, 380);
	}
	function move(e: PointerEvent) {
		const dx = e.clientX - startX, dy = e.clientY - startY;
		if (!armed) { if (Math.abs(dx) > 8 || Math.abs(dy) > 8) { moved = true; clearTimeout(timer); } return; }
		e.preventDefault();
		const w = tileEl?.getBoundingClientRect().width ?? 160;
		dragPct = Math.round(Math.min(100, Math.max(1, startPct + (dx / w) * 100)));
	}
	function up() {
		clearTimeout(timer);
		if (armed) { const v = dragPct; armed = false; drag = false; if (v !== startPct) home.command(device.id, 'set_brightness', v); return; }
		if (!moved) detail = true;
	}
	function cancel() { clearTimeout(timer); armed = false; drag = false; }
	// Ember means on; signal means a door is open to the world. Everything else stays neutral.
	const tone = $derived<'on' | 'signal' | 'none'>(!device.available ? 'none' : device.category === 'lock' && device.state === 'unlocked' ? 'signal' : ['light', 'switch', 'fan'].includes(device.category) && device.state === 'on' ? 'on' : 'none');
	const surface = { on: 'border-transparent bg-on-soft text-on-foreground', signal: 'border-transparent bg-signal-soft text-signal-foreground', none: 'bg-card' };
	const chip = { on: 'bg-on text-on-foreground', signal: 'bg-signal text-white', none: 'bg-secondary text-muted-foreground' };
	const sub = { on: 'text-on-foreground/75', signal: 'text-signal-foreground/80', none: 'text-muted-foreground' };
	const sliderTone = $derived(tone === 'on' ? '[&_[data-slot=slider-track]]:bg-on/25 [&_[data-slot=slider-range]]:bg-on' : '[&_[data-slot=slider-range]]:bg-primary');

	const status = $derived.by(() => {
		if (device.reason === 'device_offline') return 'Offline';
		if (device.reason === 'home_assistant_unavailable') return 'Hub unreachable';
		const a = device.attrs;
		switch (device.category) {
			case 'light': return device.state === 'on' ? (a.brightnessPct != null ? `On · ${a.brightnessPct}%` : 'On') : 'Off';
			case 'fan': return device.state === 'on' ? (a.speedPct != null ? `On · ${a.speedPct}%` : 'On') : 'Off';
			case 'climate': return `${device.reading ? device.reading.value + '°' : '—'}${a.target != null ? ` → ${a.target}°` : ''} · ${device.state}`;
			case 'lock': return device.state === 'locked' ? 'Locked' : device.state === 'unlocked' ? 'Unlocked' : device.state;
			case 'media': return device.state === 'off' ? 'Off' : (a.title ?? device.state);
			case 'sensor': case 'energy': return device.reading ? `${device.reading.value}${device.reading.unit ? ' ' + device.reading.unit : ''}` : device.state;
			default: return device.state === 'on' ? 'On' : device.state === 'off' ? 'Off' : device.state;
		}
	});
	const hasSecondary = $derived(!!(has('color_temp') || has('color') || has('thermostat') || has('media')));
</script>

{#snippet actions()}
	{#if session.can('automation.manage') && !compact}
		<Button variant="ghost" size="icon-sm" class="text-current opacity-55 hover:opacity-100" href="/automations/new?device={encodeURIComponent(device.id)}" aria-label="Create an automation for {device.name}"><Workflow class="size-4" /></Button>
	{/if}
	<Button variant="ghost" size="icon-sm" class="text-current opacity-55 hover:opacity-100" aria-label={home.isFavorite(device.id) ? `Remove ${device.name} from favorites` : `Add ${device.name} to favorites`} aria-pressed={home.isFavorite(device.id)} onclick={() => home.toggleFavorite(device.id)}>
		<Star class="size-4 {home.isFavorite(device.id) ? 'fill-current' : ''}" />
	</Button>
{/snippet}
{#snippet control()}
	{#if has('power')}
		<Switch checked={device.state === 'on'} disabled={off} aria-label="{device.name} power" onCheckedChange={(v) => home.command(device.id, v ? 'turn_on' : 'turn_off')} />
	{:else if has('lock')}
		<Button variant={device.state === 'locked' ? 'secondary' : 'default'} size="sm" disabled={off} onclick={() => home.command(device.id, device.state === 'locked' ? 'unlock' : 'lock')}>{device.state === 'locked' ? 'Unlock' : 'Lock'}</Button>
	{/if}
{/snippet}
{#snippet label()}
	<h3 class="truncate text-[0.9375rem] font-semibold leading-tight tracking-[-0.015em]">{device.name}</h3>
	<p class="mt-0.5 truncate text-sm {sub[tone]}" aria-live="polite">{#if !device.available}<Badge variant="outline" class="-ml-0.5 h-5 px-2">{status}</Badge>{:else}{status}{/if}</p>
{/snippet}

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
				<img src="/api/devices/{encodeURIComponent(device.id)}/snapshot" alt="Latest picture from {device.name}" class="aspect-video w-full rounded-xl bg-muted object-cover" loading="lazy" />
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
{#if phoneTile}
	<div data-device={device.id} bind:this={tileEl} class="relative select-none overflow-hidden rounded-tile border transition-colors duration-300 {surface[tone]} {device.available ? '' : 'opacity-65'}" style="touch-action: pan-y">
		{#if dimmable}<div class="pointer-events-none absolute inset-y-0 left-0 bg-on/35 {drag ? '' : 'transition-[width] duration-300'}" style="width:{shownPct}%" aria-hidden="true"></div>{/if}
		<button type="button" class="absolute inset-0 z-0 rounded-tile" aria-label="{device.name}: details" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={cancel} oncontextmenu={(e) => e.preventDefault()}></button>
		{#if has('thermostat') && device.available}
			{@const th = has('thermostat')}
			<div class="relative z-10 flex items-center gap-3 p-3">
				<span class="pointer-events-none flex size-9 shrink-0 items-center justify-center rounded-xl {chip[tone]}"><Icon class="size-[18px]" aria-hidden="true" /></span>
				<div class="pointer-events-none min-w-0 flex-1">{@render label()}</div>
				<Button variant="secondary" size="icon-sm" aria-label="Lower temperature" disabled={off} onclick={() => home.command(device.id, 'set_temperature', Math.max(th.min, (device.attrs.target ?? th.min) - th.step))}><Minus /></Button>
				<span class="figure pointer-events-none min-w-9 text-center text-xl">{device.attrs.target ?? '—'}°</span>
				<Button variant="secondary" size="icon-sm" aria-label="Raise temperature" disabled={off} onclick={() => home.command(device.id, 'set_temperature', Math.min(th.max, (device.attrs.target ?? th.min) + th.step))}><Plus /></Button>
			</div>
		{:else}
		<div class="pointer-events-none relative z-10 flex items-start justify-between p-3">
			<span class="flex size-9 items-center justify-center rounded-xl transition-colors duration-300 {chip[tone]}"><Icon class="size-[18px]" aria-hidden="true" /></span>
			<span class="pointer-events-auto">{@render control()}</span>
		</div>
		<div class="pointer-events-none relative z-10 px-3 pb-3 pt-1">{@render label()}</div>
		{/if}
		{#if wide && device.available && !has('thermostat')}
			<div class="relative z-10 px-3 pb-3">
				{#if has('camera')}
					<img src="/api/devices/{encodeURIComponent(device.id)}/snapshot" alt="Latest picture from {device.name}" class="pointer-events-none aspect-video w-full rounded-xl bg-muted object-cover" loading="lazy" />
				{:else if has('media')?.playback}
					<div class="flex gap-2"><Button variant="secondary" size="sm" disabled={off} onclick={() => home.command(device.id, 'media_play')}><Play />Play</Button><Button variant="secondary" size="sm" disabled={off} onclick={() => home.command(device.id, 'media_pause')}><Pause />Pause</Button></div>
				{/if}
			</div>
		{/if}
		{#if drag}<div class="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"><span class="figure rounded-full bg-foreground/90 px-3 py-1 text-lg text-background">{shownPct}%</span></div>{/if}
	</div>
	<Drawer.Root bind:open={detail}>
		<Drawer.Content class="max-h-[88dvh] rounded-t-3xl">
			<div class="overflow-y-auto px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
				<Drawer.Header class="px-0 pb-1"><Drawer.Title class="flex items-center gap-3 text-left"><span class="flex size-10 shrink-0 items-center justify-center rounded-2xl {chip[tone]}"><Icon class="size-5" aria-hidden="true" /></span><span class="min-w-0"><span class="block truncate text-lg font-semibold tracking-[-0.02em]">{device.name}</span><span class="block text-sm font-normal text-muted-foreground">{status}</span></span></Drawer.Title><Drawer.Description class="sr-only">Controls for {device.name}</Drawer.Description></Drawer.Header>
				<div class="space-y-5 pt-2">
					{#if device.available}<div class="space-y-3.5">{@render controls()}</div>{:else}<p class="text-sm text-muted-foreground">{device.reason === 'device_offline' ? 'This device is offline. Check its power and Wi-Fi.' : 'The home hub can’t be reached, so it can’t be controlled right now.'}</p>{/if}
					{#if detail}<DeviceHistory id={device.id} />{/if}
					<div class="flex flex-wrap gap-2 border-t pt-4">
						<Button variant="secondary" size="sm" aria-pressed={home.isFavorite(device.id)} onclick={() => home.toggleFavorite(device.id)}><Star class={home.isFavorite(device.id) ? 'fill-current' : ''} />{home.isFavorite(device.id) ? 'Favorite' : 'Add to favorites'}</Button>
						{#if session.can('automation.manage')}<Button variant="secondary" size="sm" href="/automations/new?device={encodeURIComponent(device.id)}"><Workflow />Automate</Button>{/if}
					</div>
				</div>
			</div>
		</Drawer.Content>
	</Drawer.Root>
{:else}
<div data-device={device.id} class="rounded-tile border transition-colors duration-300 {surface[tone]} {device.available ? '' : 'opacity-65'}">
	{#if compact}
		<div class="flex items-center gap-3 p-3">
			<span class="flex size-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-300 {chip[tone]}"><Icon class="size-5" aria-hidden="true" /></span>
			<div class="min-w-0 flex-1">{@render label()}</div>
			<span class="flex items-center gap-0.5">{@render actions()}</span>
			{@render control()}
		</div>
	{:else}
		<div class="flex items-center gap-1 p-3.5 pb-1">
			<span class="flex size-10 shrink-0 items-center justify-center rounded-2xl transition-colors duration-300 {chip[tone]}"><Icon class="size-5" aria-hidden="true" /></span>
			<span class="ml-auto flex items-center gap-0.5">{@render actions()}</span>
			<span class="ml-1.5">{@render control()}</span>
		</div>
		<div class="px-3.5 pb-3 pt-1.5">{@render label()}</div>
	{/if}

	{#if !compact && device.available}
		<div class="space-y-3.5 px-3.5 pb-3.5">
			{@render controls()}
		</div>
	{/if}
</div>
{/if}
