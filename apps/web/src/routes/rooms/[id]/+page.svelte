<script lang="ts">
	import { page } from '$app/state';
	import { home } from '#lib/home.svelte.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';

	const room = $derived(home.rooms.find((r) => r.id === page.params.id));
	const devices = $derived(home.inRoom(page.params.id ?? ''));
</script>

<main class="mx-auto max-w-3xl space-y-4 p-4">
	<a href="/rooms" class="text-sm text-muted-foreground underline">← Rooms</a>
	{#if room}
		<h1 class="text-2xl font-semibold">{room.name}</h1>
		{#if devices.length}
			<div class="grid gap-3 sm:grid-cols-2">{#each devices as d (d.id)}<DeviceCard device={d} />{/each}</div>
		{:else}<p class="text-muted-foreground">Nothing in this room yet.</p>{/if}
	{:else if home.loaded}<p>That room doesn’t exist.</p>{/if}
</main>
