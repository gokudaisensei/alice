<script lang="ts">
	import { api } from '#lib/api.js';
	import { ago } from '#lib/fmt.js';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import SkeletonList from '#lib/components/app/SkeletonList.svelte';
	import Empty from '#lib/components/app/Empty.svelte';

	type Ev = { at: number; id: string; name: string; message: string; origin: { kind: 'automation' | 'script' | 'app' | 'device'; name: string | null } };
	let events = $state<Ev[]>([]), loaded = $state(false), failed = $state(false), hours = $state('24');
	$effect(() => {
		const h = hours; loaded = false;
		api<{ events: Ev[] }>('GET', `/api/logbook?hours=${h}`).then((r) => { if (h !== hours) return; if (r.ok) { events = r.data.events; failed = false; } else failed = true; loaded = true; });
	});
	/** What caused it, never who: a person using an app is just "from an app". */
	const cause = (o: Ev['origin']) => o.kind === 'automation' ? `by the automation “${o.name ?? 'unnamed'}”` : o.kind === 'script' ? `by “${o.name ?? 'a routine'}”` : o.kind === 'app' ? 'from an app' : 'at the device';
</script>

<div class="space-y-4">
	<Segmented options={[{ id: '6', label: '6 hours' }, { id: '24', label: 'Day' }, { id: '72', label: '3 days' }]} bind:value={hours} label="Range" />
	{#if !loaded}<SkeletonList kind="rows" count={5} />
	{:else if failed}<Empty title="Log isn’t available" description="The home hub can’t be reached right now." />
	{:else if !events.length}<Empty title="Nothing changed" description="No changes to your devices in this time." />
	{:else}
		<ul class="divide-y overflow-hidden rounded-tile border bg-card">
			{#each events as e, i (e.at + e.id + i)}
				<li class="flex items-baseline justify-between gap-3 px-3.5 py-2.5"><span class="min-w-0 text-[0.9375rem]"><span class="font-medium">{e.name}</span> {e.message}<span class="block text-xs text-muted-foreground">{cause(e.origin)}</span></span><span class="shrink-0 text-xs text-muted-foreground">{ago(e.at)}</span></li>
			{/each}
		</ul>
	{/if}
</div>
