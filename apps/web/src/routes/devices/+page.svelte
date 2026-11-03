<script lang="ts">
	import { api } from '#lib/api.js';
	import { home, type Device } from '#lib/home.svelte.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';
	import { tileClass } from '#lib/tiles.js';
	import { Input } from '#lib/components/ui/input';
	import Page from '#lib/components/app/Page.svelte';
	import SkeletonList from '#lib/components/app/SkeletonList.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Search } from '@lucide/svelte';

	import { page } from '$app/state';
	let q = $state(page.url.searchParams.get('q') ?? '');
	let hits = $state<string[] | null>(null);
	let filter = $state('all');
	let timer: ReturnType<typeof setTimeout>;
	const labels: Record<string, string> = { light: 'Lights', switch: 'Switches', fan: 'Fans', climate: 'Climate', lock: 'Locks', camera: 'Cameras', media: 'Media', sensor: 'Sensors', energy: 'Energy' };

	// Server-side search: the server decides what this user may find.
	$effect(() => {
		clearTimeout(timer);
		const term = q.trim();
		if (!term) { hits = null; return; }
		timer = setTimeout(async () => {
			const r = await api<{ devices: { id: string }[] }>('GET', `/api/search?q=${encodeURIComponent(term)}`);
			hits = r.ok ? r.data.devices.map((d) => d.id) : [];
		}, 200);
	});

	const cats = $derived([...new Set(home.devices.map((d) => d.category))]);
	const filters = $derived([{ key: 'all', text: 'All' }, ...cats.map((c) => ({ key: c, text: labels[c] ?? c }))]);
	let shown = $state(36);
	$effect(() => { q; filter; shown = 36; });
	const all = $derived<Device[]>(home.devices.filter((d) => (hits ? hits.includes(d.id) : true) && (filter === 'all' || d.category === filter)));
</script>

<Page title="Devices" subtitle="Everything you can control, in one place." width="xl">
	<div class="space-y-3">
		<div class="relative"><Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" class="pl-9" placeholder="Search by name, room or type" bind:value={q} aria-label="Search devices" /></div>
		<div class="-mx-5 flex gap-1.5 overflow-x-auto no-scrollbar px-5 pb-1 md:mx-0 md:flex-wrap md:px-0" role="group" aria-label="Filter by type">
			{#each filters as { key, text }}
				<button type="button" aria-pressed={filter === key} onclick={() => (filter = key)} class="h-8 shrink-0 rounded-full px-3.5 text-sm font-medium transition-colors {filter === key ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'}">{text}</button>
			{/each}
		</div>
	</div>
	{#if all.length}
		<div class="tile-grid">{#each all.slice(0, shown) as d (d.id)}<div class={tileClass(d)}><DeviceCard device={d} /></div>{/each}</div>
		{#if all.length > shown}<div class="flex justify-center"><Button variant="secondary" onclick={() => (shown += 36)}>Show {Math.min(36, all.length - shown)} more <span class="text-muted-foreground">({all.length - shown} left)</span></Button></div>{/if}
	{:else if !home.loaded}
		<SkeletonList kind="tiles" count={8} />
	{:else}
		<Empty title={q ? 'No devices match' : 'No devices yet'} description={q ? 'Try a different name, room or type.' : 'Nothing has been shared with you yet. Ask the person who manages your home.'} />
	{/if}
</Page>
