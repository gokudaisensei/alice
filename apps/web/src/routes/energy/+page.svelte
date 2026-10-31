<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import * as Card from '#lib/components/ui/card';

	type Meter = { id: string; name: string; available: boolean; unit: string; now: number | null; kind: 'energy' | 'power' | 'other'; todayKwh?: number | null; days?: { date: string; kwh: number }[]; peak24h?: number | null; low24h?: number | null };
	let meters = $state<Meter[]>([]), note = $state(''), since = $state<number | null>(null), loaded = $state(false);
	onMount(async () => { const r = await api('GET', '/api/energy'); if (r.ok) { meters = r.data.meters; note = r.data.note; since = r.data.sampledSince; } loaded = true; });
	const max = (m: Meter) => Math.max(0.1, ...(m.days ?? []).map((d) => d.kwh));
	const day = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'short' });
</script>

<main class="mx-auto max-w-3xl space-y-4 p-4">
	<h1 class="text-2xl font-semibold">Energy</h1>
	{#if loaded && !meters.length}
		<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No energy meters are shared with you.</p>
	{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		{#each meters as m (m.id)}
			<Card.Root class="gap-0 py-0 {m.available ? '' : 'opacity-70'}"><div class="space-y-2 p-4">
				<h2 class="font-semibold">{m.name}</h2>
				<p class="text-2xl">{m.available && m.now !== null ? `${m.now} ${m.unit}` : 'Unavailable'}</p>
				{#if m.kind === 'power'}
					<p class="text-sm text-muted-foreground">{m.peak24h != null ? `Last 24 hours: ${m.low24h}–${m.peak24h} W` : 'Collecting readings…'}</p>
				{:else if m.kind === 'energy'}
					<p class="text-sm text-muted-foreground">{m.todayKwh != null ? `${m.todayKwh} kWh so far today` : 'Today: not enough readings yet'}</p>
					{#if m.days?.length}
						<div class="flex h-16 items-end gap-1" role="img" aria-label="Daily kWh: {m.days.map((d) => `${day(d.date)} ${d.kwh}`).join(', ')}">
							{#each m.days as d}<div class="flex-1 rounded-t bg-primary/70" style="height:{Math.max(4, (d.kwh / max(m)) * 100)}%" title="{day(d.date)}: {d.kwh} kWh"></div>{/each}
						</div>
						<div class="flex gap-1 text-center text-xs text-muted-foreground">{#each m.days as d}<span class="flex-1">{day(d.date)}</span>{/each}</div>
					{/if}
				{/if}
			</div></Card.Root>
		{/each}
	</div>
	{#if loaded && meters.length}<p class="text-xs text-muted-foreground">{note}{#if since} Sampling began {new Date(since).toLocaleDateString()}.{/if} Meters are shown separately and never added together, since one may already include another.</p>{/if}
</main>
