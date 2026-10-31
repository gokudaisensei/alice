<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import Empty from '#lib/components/app/Empty.svelte';

	type Meter = { id: string; name: string; available: boolean; unit: string; now: number | null; kind: 'energy' | 'power' | 'other'; todayKwh?: number | null; days?: { date: string; kwh: number }[]; peak24h?: number | null; low24h?: number | null };
	let meters = $state<Meter[]>([]), note = $state(''), since = $state<number | null>(null), loaded = $state(false);
	onMount(async () => { const r = await api('GET', '/api/energy'); if (r.ok) { meters = r.data.meters; note = r.data.note; since = r.data.sampledSince; } loaded = true; });
	const max = (m: Meter) => Math.max(0.1, ...(m.days ?? []).map((d) => d.kwh));
	const day = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'short' });
</script>

<div class="space-y-6">
	{#if loaded && !meters.length}<Empty title="No energy meters" description="Energy meters appear here once they're shared with you." />{/if}
	<div class="grid gap-3 sm:grid-cols-2">
		{#each meters as m (m.id)}
			<section class="rounded-tile border bg-card p-4 {m.available ? '' : 'opacity-65'}">
				<h2 class="text-sm text-muted-foreground">{m.name}</h2>
				<p class="figure mt-1 text-4xl">{m.available && m.now !== null ? m.now : '—'}<span class="ml-1 text-xl font-medium text-muted-foreground">{m.available ? m.unit : 'offline'}</span></p>
				{#if m.kind === 'power'}
					<p class="mt-1 text-sm text-muted-foreground">{m.peak24h != null ? `Past 24 hours: ${m.low24h} to ${m.peak24h} W` : 'Collecting readings…'}</p>
				{:else if m.kind === 'energy'}
					<p class="mt-1 text-sm text-muted-foreground">{m.todayKwh != null ? `${m.todayKwh} kWh so far today` : 'Today: not enough readings yet'}</p>
					{#if m.days?.length}
						<div class="mt-4 flex h-20 items-end gap-1.5" role="img" aria-label="Daily kWh: {m.days.map((d) => `${day(d.date)} ${d.kwh}`).join(', ')}">
							{#each m.days as d, i}<div class="flex-1 rounded-t-md {i === m.days.length - 1 ? 'bg-primary' : 'bg-primary/30'}" style="height:{Math.max(6, (d.kwh / max(m)) * 100)}%" title="{day(d.date)}: {d.kwh} kWh"></div>{/each}
						</div>
						<div class="mt-1.5 flex gap-1.5 text-center text-xs text-muted-foreground">{#each m.days as d}<span class="flex-1">{day(d.date)}</span>{/each}</div>
					{/if}
				{/if}
			</section>
		{/each}
	</div>
	{#if loaded && meters.length}<p class="max-w-[70ch] text-sm text-muted-foreground">{note}{#if since} Sampling began {new Date(since).toLocaleDateString()}.{/if} Meters are shown separately and never added together, since one may already include another.</p>{/if}
</div>
