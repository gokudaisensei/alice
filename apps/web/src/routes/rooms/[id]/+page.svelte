<script lang="ts">
	import { page } from '$app/state';
	import { home } from '#lib/home.svelte.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';
	import { tileClass } from '#lib/tiles.js';
	import Pg from '#lib/components/app/Page.svelte';
	import Empty from '#lib/components/app/Empty.svelte';

	const room = $derived(home.rooms.find((r) => r.id === page.params.id));
	const devices = $derived(home.inRoom(page.params.id ?? ''));
</script>

<Pg title={room?.name ?? (home.loaded ? 'Room not found' : '')} back={{ href: '/rooms', label: 'Rooms' }} width="xl">
	{#if room}
		{#if devices.length}<div class="grid grid-flow-dense grid-cols-2 gap-2.5 sm:gap-3 lg:grid-cols-3">{#each devices as d (d.id)}<div class={tileClass(d)}><DeviceCard device={d} /></div>{/each}</div>
		{:else}<Empty title="Nothing in this room yet" description="Devices appear here once they're placed in this room." />{/if}
	{:else if home.loaded}<Empty title="That room doesn't exist" description="It may have been removed." />{/if}
</Pg>
