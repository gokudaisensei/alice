<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';
	import Insights from '#lib/components/app/Insights.svelte';
	import ModeCard from '#lib/components/app/ModeCard.svelte';
	import { Button } from '#lib/components/ui/button';

	const t = $derived(home.prefs?.template ?? 'comfort');
	const sections = $derived(home.prefs?.sections ?? ['favorites', 'rooms']);
	const favRooms = $derived((home.prefs?.favorites.rooms ?? []).map((id) => home.rooms.find((r) => r.id === id)).filter((r) => !!r));
	const shownRooms = $derived(favRooms.length ? favRooms : home.orderedRooms);
	const sensors = $derived(home.devices.filter((d) => d.category === 'sensor' || d.category === 'energy').slice(0, 6));
	const hour = new Date().getHours();
	const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
</script>

<main class="mx-auto max-w-3xl space-y-6 p-4">
	<h1 class="text-2xl font-semibold">{greeting}{session.me ? `, ${session.me.displayName}` : ''}</h1>

	<ModeCard />
	<Insights />

	{#if !home.loaded}
		<p class="text-muted-foreground" role="status">Loading your home…</p>
	{:else}
		{#if sections.includes('favorites')}
			<section aria-labelledby="fav">
				<h2 id="fav" class="mb-2 text-sm font-medium uppercase text-muted-foreground">Favorites</h2>
				{#if home.favoriteDevices.length}
					<div class={t === 'minimal' ? 'space-y-2' : 'grid gap-3 sm:grid-cols-2'}>
						{#each home.favoriteDevices as d (d.id)}<DeviceCard device={d} compact={t === 'minimal'} />{/each}
					</div>
				{:else}
					<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
						{#if home.devices.length}Tap the star on any device to keep it here. <a class="underline" href="/devices">Browse devices</a>
						{:else}No devices have been shared with you yet. Ask the person who manages your home.{/if}</p>
				{/if}
			</section>
		{/if}

		{#if sections.includes('rooms')}
			<section aria-labelledby="rooms">
				<h2 id="rooms" class="mb-2 text-sm font-medium uppercase text-muted-foreground">Rooms</h2>
				{#if shownRooms.length}
					<div class="flex flex-wrap gap-2">
						{#each shownRooms as r}<Button variant="outline" href="/rooms/{r!.id}">{r!.name} <span class="ml-1 text-muted-foreground">{home.inRoom(r!.id).length}</span></Button>{/each}
					</div>
				{:else}
					<p class="text-sm text-muted-foreground">No rooms yet.{#if session.can('rooms.manage')} <a class="underline" href="/admin/rooms">Set up your rooms</a>.{/if}</p>
				{/if}
			</section>
		{/if}

		{#if sections.includes('sensors') && sensors.length}
			<section aria-labelledby="sens">
				<h2 id="sens" class="mb-2 text-sm font-medium uppercase text-muted-foreground">At a glance</h2>
				<div class="grid gap-3 sm:grid-cols-2">{#each sensors as d (d.id)}<DeviceCard device={d} compact />{/each}</div>
			</section>
		{/if}

		{#if home.groups.length}
			<section aria-labelledby="grp">
				<h2 id="grp" class="mb-2 text-sm font-medium uppercase text-muted-foreground">Groups</h2>
				<div class="space-y-2">
					{#each home.groups as g}
						<div class="flex items-center justify-between rounded-lg border p-3">
							<span>{g.name} <span class="text-sm text-muted-foreground">· {g.deviceIds.length} devices</span></span>
							<span class="flex gap-2">
								<Button size="sm" variant="outline" onclick={() => home.groupCommand(g.id, 'turn_on')}>All on</Button>
								<Button size="sm" variant="outline" onclick={() => home.groupCommand(g.id, 'turn_off')}>All off</Button>
							</span>
						</div>
					{/each}
				</div>
			</section>
		{/if}
	{/if}
</main>
