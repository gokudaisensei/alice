<script lang="ts">
	import { api } from '#lib/api.js';
	import { plural } from '#lib/fmt.js';
	import Segmented from '#lib/components/app/Segmented.svelte';

	type Bucket = { date: string; import: number; export: number; solar: number; batteryIn: number; batteryOut: number; consumption: number };
	type Data =
		| { available: false; reason: 'ha_unavailable' | 'not_configured' | 'no_statistics' }
		| { available: true; range: string; bucket: 'day' | 'month'; buckets: Bucket[]; totals: Omit<Bucket, 'date'>; has: { grid: boolean; solar: boolean; battery: boolean }; devices: { id: string; name: string; kwh: number }[]; other: { kind: 'gas' | 'water'; total: number; unit: string }[] };

	let range = $state('week'), data = $state<Data | null>(null);
	$effect(() => { const r = range; data = null; api<Data>('GET', `/api/energy/ha?range=${r}`).then((x) => { if (x.ok && r === range) data = x.data; }); });

	const num = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toLocaleString());
	const label = (d: string, bucket: 'day' | 'month') => bucket === 'month' ? new Date(d + '-15T12:00').toLocaleDateString([], { month: 'short' }) : new Date(d + 'T12:00').toLocaleDateString([], range === 'week' ? { weekday: 'short' } : { day: 'numeric' });
	const why = { ha_unavailable: 'Home Assistant can’t be reached right now.', not_configured: 'Set up the Energy dashboard in Home Assistant and its figures will appear here.', no_statistics: 'Home Assistant hasn’t recorded energy yet. Check back in an hour or two.' };
</script>

<section class="space-y-3 rounded-tile border bg-card p-3.5" aria-label="Energy from Home Assistant">
	<div class="flex items-center justify-between gap-3"><h2 class="heading">Home energy</h2>
		<Segmented options={[{ id: 'week', label: '7 days' }, { id: 'month', label: '30 days' }, { id: 'year', label: 'Year' }]} bind:value={range} label="Range" /></div>
	{#if !data}<div class="h-28 animate-pulse rounded-xl bg-muted"></div>
	{:else if !data.available}<p class="text-sm text-muted-foreground">{why[data.reason]}</p>
	{:else}
		{@const bk = data.bucket}
		{@const bs = data.buckets}
		{@const max = Math.max(0.1, ...bs.map((b) => b.consumption))}
		<p class="figure text-[1.75rem] leading-none">{num(data.totals.consumption)}<span class="ml-1 text-base font-medium text-muted-foreground">kWh used</span></p>
		<p class="text-xs text-muted-foreground">
			{#if data.has.grid}From the grid {num(data.totals.import)} kWh{#if data.totals.export}, sent back {num(data.totals.export)} kWh{/if}.{/if}
			{#if data.has.solar} Solar made {num(data.totals.solar)} kWh.{/if}
		</p>
		<div class="flex h-24 items-end gap-1" role="img" aria-label="kWh used per {bk}: {bs.map((b) => `${label(b.date, bk)} ${b.consumption}`).join(', ')}">
			{#each bs as b, i (b.date)}<div class="flex-1 rounded-t-md {i === bs.length - 1 ? 'bg-primary' : 'bg-primary/30'}" style="height:{Math.max(4, (b.consumption / max) * 100)}%" title="{label(b.date, bk)}: {b.consumption} kWh"></div>{/each}
		</div>
		<div class="flex justify-between text-[11px] text-muted-foreground"><span>{label(bs[0]!.date, bk)}</span><span>{label(bs.at(-1)!.date, bk)}</span></div>
		{#if data.devices.length}
			<h3 class="pt-1 text-sm font-medium">Biggest users</h3>
			<ul class="divide-y overflow-hidden rounded-xl border">{#each data.devices as d (d.id)}<li class="flex items-baseline justify-between gap-3 px-3 py-2 text-sm"><span class="truncate">{d.name}</span><span class="figure shrink-0 tabular-nums">{num(d.kwh)}<span class="ml-0.5 text-xs text-muted-foreground">kWh</span></span></li>{/each}</ul>
		{/if}
		{#if data.other.length}<p class="text-xs text-muted-foreground">{data.other.map((o) => `${o.kind === 'gas' ? 'Gas' : 'Water'} ${num(o.total)} ${o.unit}`).join(' · ')}</p>{/if}
		<p class="text-xs text-muted-foreground">From Home Assistant’s own records ({plural(bs.length, bk)}), so it covers the time before this app was installed.</p>
	{/if}
</section>
