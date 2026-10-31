<script lang="ts">
	import { api } from '#lib/api.js';
	import { home, type Device } from '#lib/home.svelte.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';
	import { Input } from '#lib/components/ui/input';
	import { Button } from '#lib/components/ui/button';

	let q = $state('');
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
			const r = await api('GET', `/api/search?q=${encodeURIComponent(term)}`);
			hits = r.ok ? r.data.devices.map((d: any) => d.id) : [];
		}, 200);
	});

	const cats = $derived([...new Set(home.devices.map((d) => d.category))]);
	const list = $derived<Device[]>(home.devices.filter((d) => (hits ? hits.includes(d.id) : true) && (filter === 'all' || d.category === filter)));
</script>

<main class="mx-auto max-w-3xl space-y-4 p-4">
	<h1 class="text-2xl font-semibold">Devices</h1>
	<Input type="search" placeholder="Search by name, room or type" bind:value={q} aria-label="Search devices" />
	<div class="flex flex-wrap gap-2" role="group" aria-label="Filter by type">
		<Button size="sm" variant={filter === 'all' ? 'default' : 'outline'} onclick={() => (filter = 'all')}>All</Button>
		{#each cats as c}<Button size="sm" variant={filter === c ? 'default' : 'outline'} onclick={() => (filter = c)}>{labels[c] ?? c}</Button>{/each}
	</div>
	{#if list.length}
		<div class="grid gap-3 sm:grid-cols-2">{#each list as d (d.id)}<DeviceCard device={d} />{/each}</div>
	{:else if home.loaded}
		<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{q ? 'No devices match your search.' : 'No devices are available to you yet. Ask the person who manages your home to share some.'}</p>
	{/if}
</main>
