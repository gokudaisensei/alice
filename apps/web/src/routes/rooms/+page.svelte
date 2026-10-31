<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import Page from '#lib/components/app/Page.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { Button } from '#lib/components/ui/button';
	import { ChevronRight } from '@lucide/svelte';
	const on = (id: string) => home.inRoom(id).filter((d) => d.state === 'on' && d.available).length;
</script>

<Page title="Rooms" subtitle="Jump to a room to see everything in it." width="lg">
	{#if home.orderedRooms.length}
		<div class="grid gap-3 sm:grid-cols-2">
			{#each home.orderedRooms as r (r.id)}
				<a href="/rooms/{r.id}" class="group flex items-center gap-3 rounded-tile border bg-card p-4 transition-colors hover:bg-muted/60">
					<span class="size-2.5 shrink-0 rounded-full {on(r.id) ? 'bg-on' : 'bg-border'}" aria-hidden="true"></span>
					<span class="min-w-0 flex-1"><span class="block truncate text-base font-semibold tracking-[-0.015em]">{r.name}</span><span class="text-sm text-muted-foreground">{home.inRoom(r.id).length} device{home.inRoom(r.id).length === 1 ? '' : 's'}{#if on(r.id)} · {on(r.id)} on{/if}</span></span>
					<ChevronRight class="size-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5" />
				</a>
			{/each}
		</div>
	{:else if home.loaded}
		<Empty title="No rooms yet" description="Rooms group your devices so they're easy to find.">{#if session.can('rooms.manage')}<Button href="/admin/rooms">Set up rooms</Button>{/if}</Empty>
	{/if}
	{#if home.devices.some((d) => !d.roomId)}<p class="text-sm text-muted-foreground">Some devices aren't in a room. <a class="font-medium text-primary hover:underline" href="/devices">See all devices</a></p>{/if}
</Page>
