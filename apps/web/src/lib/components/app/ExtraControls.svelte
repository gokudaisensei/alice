<script lang="ts">
	import { home, type Control, type Device } from '#lib/home.svelte.js';
	import { Slider } from '#lib/components/ui/slider';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import MediaBrowser from '#lib/components/app/MediaBrowser.svelte';
	import { ArrowDown, ArrowUp, Square, Play, Pause, Navigation, Home } from '@lucide/svelte';

	let { device, off, sliderTone }: { device: Device; off: boolean; sliderTone: string } = $props();
	const has = <const T extends Control['type']>(t: T) => device.controls.find((c): c is Extract<Control, { type: T }> => c.type === t);
	const cover = $derived(has('cover') ?? has('valve')), vacuum = $derived(has('vacuum')), humid = $derived(has('humidifier')), alarm = $derived(has('alarm')), num = $derived(has('number')), sel = $derived(has('select')), press = $derived(has('press')), media = $derived(has('media'));
	const cmd = (a: string, v?: unknown) => home.command(device.id, a, v);
	const word = (s: string) => s.replace(/_/g, ' ');
	let code = $state('');
	const armed = $derived(device.state.startsWith('armed') || device.state === 'triggered');
	async function send(a: string, v: Record<string, unknown>) { await cmd(a, code ? { ...v, code } : v); code = ''; }
</script>

{#if cover}
	<div class="flex flex-wrap gap-2">
		<Button variant="secondary" size="sm" disabled={off} onclick={() => cmd('open')}><ArrowUp />Open</Button>
		{#if cover.stop}<Button variant="secondary" size="sm" disabled={off} onclick={() => cmd('stop')}><Square />Stop</Button>{/if}
		<Button variant="secondary" size="sm" disabled={off} onclick={() => cmd('close')}><ArrowDown />Close</Button>
	</div>
	{#if cover.position}<label class="block space-y-1.5 text-sm">Position<Slider type="single" class={sliderTone} value={device.attrs.positionPct ?? 0} min={0} max={100} step={1} disabled={off} aria-label="{device.name} position" onValueCommit={(v) => cmd('set_position', v)} /></label>{/if}
	{#if has('cover')?.tilt}<label class="block space-y-1.5 text-sm">Tilt<Slider type="single" class={sliderTone} value={device.attrs.tiltPct ?? 0} min={0} max={100} step={1} disabled={off} aria-label="{device.name} tilt" onValueCommit={(v) => cmd('set_tilt', v)} /></label>{/if}
{/if}

{#if vacuum}
	<div class="flex flex-wrap gap-2">
		{#if vacuum.start}<Button variant="secondary" size="sm" disabled={off} onclick={() => cmd('vacuum_start')}><Play />Start</Button>{/if}
		{#if vacuum.pause}<Button variant="secondary" size="sm" disabled={off} onclick={() => cmd('vacuum_pause')}><Pause />Pause</Button>{/if}
		{#if vacuum.dock}<Button variant="secondary" size="sm" disabled={off} onclick={() => cmd('vacuum_dock')}><Home />Dock</Button>{/if}
		{#if vacuum.locate}<Button variant="secondary" size="sm" disabled={off} onclick={() => cmd('vacuum_locate')}><Navigation />Find it</Button>{/if}
	</div>
	{#if vacuum.speeds.length}
		<div class="flex flex-wrap gap-2" role="group" aria-label="Suction">{#each vacuum.speeds as s}<Button size="sm" variant={device.attrs.speed === s ? 'default' : 'secondary'} class="capitalize" disabled={off} onclick={() => cmd('set_vacuum_speed', s)}>{word(s)}</Button>{/each}</div>
	{/if}
	{#if device.attrs.batteryPct != null}<p class="text-sm text-muted-foreground">Battery {device.attrs.batteryPct}%</p>{/if}
{/if}

{#if humid}
	{#if device.state === 'on'}<label class="block space-y-1.5 text-sm">Target humidity {device.attrs.targetHumidityPct ?? ''}%<Slider type="single" class={sliderTone} value={device.attrs.targetHumidityPct ?? humid.min} min={humid.min} max={humid.max} step={1} disabled={off} aria-label="{device.name} target humidity" onValueCommit={(v) => cmd('set_humidity', v)} /></label>{/if}
	{#if humid.modes.length}<div class="flex flex-wrap gap-2" role="group" aria-label="Mode">{#each humid.modes as m}<Button size="sm" variant={device.attrs.mode === m ? 'default' : 'secondary'} class="capitalize" disabled={off} onclick={() => cmd('set_mode', m)}>{word(m)}</Button>{/each}</div>{/if}
{/if}

{#if alarm}
	<div class="space-y-2.5">
		{#if alarm.code}<Input type="password" inputmode="numeric" autocomplete="off" maxlength={12} placeholder="Alarm code" aria-label="Alarm code" bind:value={code} disabled={off} />{/if}
		<div class="flex flex-wrap gap-2">
			{#if armed}<Button size="sm" disabled={off} onclick={() => send('disarm', {})}>Disarm</Button>
			{:else}{#each alarm.modes as m}<Button variant="secondary" size="sm" disabled={off} onclick={() => send('arm', { mode: m })}>Arm {m === 'home' ? 'at home' : m}</Button>{/each}{/if}
		</div>
	</div>
{/if}

{#if num}
	<label class="block space-y-1.5 text-sm">{device.attrs.value ?? '—'}{num.unit ? ` ${num.unit}` : ''}<Slider type="single" class={sliderTone} value={device.attrs.value ?? num.min} min={num.min} max={num.max} step={num.step} disabled={off} aria-label={device.name} onValueCommit={(v) => cmd('set_number', v)} /></label>
{/if}
{#if sel}
	<div class="flex flex-wrap gap-2" role="group" aria-label={device.name}>{#each sel.options as o}<Button size="sm" variant={device.attrs.option === o ? 'default' : 'secondary'} disabled={off} onclick={() => cmd('set_option', o)}>{o}</Button>{/each}</div>
{/if}
{#if press}<Button variant="secondary" size="sm" disabled={off} onclick={() => cmd('press')}>Press</Button>{/if}
{#if media?.sources.length}
	<div class="flex flex-wrap gap-2" role="group" aria-label="Input">{#each media.sources as s}<Button size="sm" variant={device.attrs.source === s ? 'default' : 'secondary'} disabled={off} onclick={() => cmd('select_source', s)}>{s}</Button>{/each}</div>
{/if}
{#if media?.browse && !off}<MediaBrowser {device} />{/if}
