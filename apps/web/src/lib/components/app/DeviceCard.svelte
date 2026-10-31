<script lang="ts">
	import { home, type Device } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import * as Card from '#lib/components/ui/card';
	import { Switch } from '#lib/components/ui/switch';
	import { Slider } from '#lib/components/ui/slider';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import { Lightbulb, Plug, Fan, Thermometer, Lock, Camera, Tv, Gauge, Zap, Star, Workflow } from '@lucide/svelte';

	let { device, compact = false }: { device: Device; compact?: boolean } = $props();

	const icons: Record<string, any> = { light: Lightbulb, switch: Plug, fan: Fan, climate: Thermometer, lock: Lock, camera: Camera, media: Tv, sensor: Gauge, energy: Zap };
	const Icon = $derived(icons[device.category] ?? Gauge);
	const has = <T extends string>(t: T) => device.controls.find((c) => c.type === t) as any;
	const off = $derived(!device.available || !!home.busy[device.id]);
	const isOn = $derived(['on', 'heat', 'cool', 'playing', 'idle', 'auto', 'heat_cool', 'paused'].includes(device.state) && device.state !== 'off');
	let more = $state(false);

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

<Card.Root class="gap-0 py-0 {device.available ? '' : 'opacity-70'}" data-device={device.id}>
	<div class="flex items-center gap-3 p-4 {compact ? 'py-3' : ''}">
		<span class="flex size-10 shrink-0 items-center justify-center rounded-full {isOn && device.available ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground'}"><Icon class="size-5" aria-hidden="true" /></span>
		<div class="min-w-0 flex-1">
			<h3 class="truncate text-base font-semibold leading-none">{device.name}</h3>
			<p class="text-sm text-muted-foreground" aria-live="polite">
				{#if !device.available}<Badge variant="outline">{status}</Badge>{:else}{status}{/if}
			</p>
		</div>
		<Button variant="ghost" size="icon" aria-label={home.isFavorite(device.id) ? `Remove ${device.name} from favorites` : `Add ${device.name} to favorites`} aria-pressed={home.isFavorite(device.id)} onclick={() => home.toggleFavorite(device.id)}>
			<Star class="size-4 {home.isFavorite(device.id) ? 'fill-current' : ''}" />
		</Button>
		{#if session.can('automation.manage') && !compact}
			<Button variant="ghost" size="icon" href="/automations/new?device={encodeURIComponent(device.id)}" aria-label="Create an automation for {device.name}"><Workflow class="size-4" /></Button>
		{/if}
		{#if has('power')}
			<Switch checked={device.state === 'on'} disabled={off} aria-label="{device.name} power" onCheckedChange={(v) => home.command(device.id, v ? 'turn_on' : 'turn_off')} />
		{:else if has('lock')}
			<Button variant="secondary" size="sm" disabled={off} onclick={() => home.command(device.id, device.state === 'locked' ? 'unlock' : 'lock')}>{device.state === 'locked' ? 'Unlock' : 'Lock'}</Button>
		{/if}
	</div>

	{#if !compact && device.available}
		<div class="space-y-3 px-4 pb-4">
			{#if has('brightness') && device.state === 'on'}
				<Slider type="single" value={device.attrs.brightnessPct ?? 100} min={1} max={100} step={1} disabled={off} aria-label="{device.name} brightness" onValueCommit={(v) => home.command(device.id, 'set_brightness', v)} />
			{/if}
			{#if has('fan_speed') && device.state === 'on'}
				<Slider type="single" value={device.attrs.speedPct ?? 0} min={0} max={100} step={has('fan_speed').step || 1} disabled={off} aria-label="{device.name} speed" onValueCommit={(v) => home.command(device.id, 'set_speed', v)} />
			{/if}
			{#if has('thermostat')}
				{@const t = has('thermostat')}
				<div class="flex items-center justify-between gap-2">
					<Button variant="outline" size="icon" aria-label="Lower temperature" disabled={off} onclick={() => home.command(device.id, 'set_temperature', Math.max(t.min, (device.attrs.target ?? t.min) - t.step))}>−</Button>
					<span class="text-lg font-medium tabular-nums">{device.attrs.target ?? '—'}{t.unit}</span>
					<Button variant="outline" size="icon" aria-label="Raise temperature" disabled={off} onclick={() => home.command(device.id, 'set_temperature', Math.min(t.max, (device.attrs.target ?? t.min) + t.step))}>+</Button>
				</div>
			{/if}
			{#if has('media')?.volume}
				<Slider type="single" value={device.attrs.volumePct ?? 0} min={0} max={100} step={1} disabled={off} aria-label="{device.name} volume" onValueCommit={(v) => home.command(device.id, 'set_volume', v)} />
			{/if}
			{#if has('media')?.playback}
				<div class="flex gap-2">
					<Button variant="outline" size="sm" disabled={off} onclick={() => home.command(device.id, 'media_play')}>Play</Button>
					<Button variant="outline" size="sm" disabled={off} onclick={() => home.command(device.id, 'media_pause')}>Pause</Button>
				</div>
			{/if}
			{#if has('camera')}
				<img src="/api/devices/{encodeURIComponent(device.id)}/snapshot" alt="Latest picture from {device.name}" class="w-full rounded-md bg-muted" loading="lazy" />
			{/if}
			{#if hasSecondary && ((device.state === 'on' && (has('color_temp') || has('color'))) || has('thermostat'))}
				<Button variant="link" class="h-auto p-0 text-sm" onclick={() => (more = !more)} aria-expanded={more}>{more ? 'Fewer settings' : 'More settings'}</Button>
				{#if more}
					<div class="space-y-3">
						{#if has('color_temp') && device.state === 'on'}
							{@const c = has('color_temp')}
							<label class="block text-sm">Warmth
								<Slider type="single" value={device.attrs.colorTempK ?? c.minK} min={c.minK} max={c.maxK} step={100} disabled={off} aria-label="{device.name} color temperature" onValueCommit={(v) => home.command(device.id, 'set_color_temp', v)} />
							</label>
						{/if}
						{#if has('color') && device.state === 'on'}
							<label class="block text-sm">Color
								<Slider type="single" value={device.attrs.hs?.[0] ?? 0} min={0} max={360} step={1} disabled={off} aria-label="{device.name} hue" onValueCommit={(v) => home.command(device.id, 'set_color', { h: v, s: device.attrs.hs?.[1] ?? 100 })} />
							</label>
						{/if}
						{#if has('thermostat')?.modes.length}
							<div class="flex flex-wrap gap-2" role="group" aria-label="Mode">
								{#each has('thermostat').modes as m}
									<Button size="sm" variant={device.state === m ? 'default' : 'outline'} class="capitalize" disabled={off} onclick={() => home.command(device.id, 'set_hvac_mode', m)}>{m.replace('_', ' ')}</Button>
								{/each}
							</div>
						{/if}
					</div>
				{/if}
			{/if}
		</div>
	{/if}
</Card.Root>
