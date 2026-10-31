<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import * as Card from '#lib/components/ui/card';
</script>

<main class="mx-auto max-w-3xl space-y-4 p-4">
	<h1 class="text-2xl font-semibold">Rooms</h1>
	{#if home.orderedRooms.length}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each home.orderedRooms as r (r.id)}
				<a href="/rooms/{r.id}" class="block rounded-xl focus-visible:outline-2">
					<Card.Root class="transition-colors hover:bg-accent"><Card.Header class="p-4"><Card.Title>{r.name}</Card.Title><Card.Description>{home.inRoom(r.id).length} devices · {home.inRoom(r.id).filter((d) => d.state === 'on').length} on</Card.Description></Card.Header></Card.Root>
				</a>
			{/each}
		</div>
	{:else if home.loaded}
		<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No rooms yet.{#if session.can('rooms.manage')} <a class="underline" href="/admin/rooms">Set up your rooms</a>.{/if}</p>
	{/if}
	{#if home.devices.some((d) => !d.roomId)}<a class="text-sm underline" href="/devices">Devices not in a room</a>{/if}
</main>
