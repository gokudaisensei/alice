<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { fly } from 'svelte/transition';
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { tileClass } from '#lib/tiles.js';
	import DeviceCard from '#lib/components/app/DeviceCard.svelte';
	import Page from '#lib/components/app/Page.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Settings2 } from '@lucide/svelte';

	const unplaced = $derived(home.devices.filter((d) => !d.roomId && !['sensor', 'energy'].includes(d.category)));
	const pages = $derived([...home.orderedRooms.map((r) => ({ id: r.id, name: r.name })), ...(unplaced.length ? [{ id: 'none', name: 'No room' }] : [])]);
	const devicesOf = (id: string) => (id === 'none' ? unplaced : home.inRoom(id));
	let cur = $state(-1), dir = $state(1);
	// Start on the room named in the link, otherwise the first one.
	$effect(() => { if (cur < 0 && pages.length) cur = Math.max(0, pages.findIndex((p) => p.id === page.url.searchParams.get('room'))); });
	const room = $derived(cur >= 0 ? pages[Math.min(cur, pages.length - 1)] : undefined);
	const list = $derived(room ? devicesOf(room.id) : []);
	const lightsOn = $derived(list.filter((d) => d.category === 'light' && d.state === 'on' && d.available));

	function go(i: number) {
		if (i < 0 || i >= pages.length || i === cur) return;
		dir = i > cur ? 1 : -1; cur = i; haptics.tap();
		const u = new URL(location.href); u.searchParams.set('room', pages[i].id); replaceState(u, {});
		document.querySelector(`[data-room-chip="${pages[i].id}"]`)?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
	}

	// Swipe the room sideways to go to the next one. Mostly-vertical movement is just scrolling and is left alone.
	let sx = 0, sy = 0, st = 0;
	const down = (e: PointerEvent) => { sx = e.clientX; sy = e.clientY; st = Date.now(); };
	function up(e: PointerEvent) {
		const dx = e.clientX - sx, dy = e.clientY - sy;
		if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6 && Date.now() - st < 700) go(cur + (dx < 0 ? 1 : -1));
	}
	async function lightsOff() { haptics.grab(); for (const d of lightsOn) await home.command(d.id, 'turn_off'); haptics.success(); }
</script>

<Page title="Rooms" width="xl">
	{#snippet actions()}{#if session.can('rooms.manage')}<Button variant="secondary" size="sm" href="/admin/rooms"><Settings2 />Manage</Button>{/if}{/snippet}
	{#if pages.length}
		<div class="-mx-5 flex snap-x snap-proximity scroll-px-5 gap-2 overflow-x-auto no-scrollbar px-5 pb-1 md:mx-0 md:flex-wrap md:overflow-visible md:px-0" role="tablist" aria-label="Rooms">
			{#each pages as p, i (p.id)}
				{@const on = devicesOf(p.id).filter((d) => d.state === 'on' && d.available).length}
				<button type="button" role="tab" aria-selected={cur === i} data-room-chip={p.id} onclick={() => go(i)} class="flex h-11 shrink-0 snap-start items-center gap-2 rounded-full px-4 text-[0.9375rem] font-medium transition-[background-color,color,transform] duration-150 active:scale-[0.97] {cur === i ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground'}">
					{p.name}{#if on}<span class="size-1.5 rounded-full bg-on" aria-label="{on} on"></span>{/if}
				</button>
			{/each}
		</div>
		<div class="flex justify-center gap-1.5 md:hidden" aria-hidden="true">{#each pages as p, i (p.id)}<span class="h-1.5 rounded-full transition-all duration-300 {cur === i ? 'w-5 bg-foreground/70' : 'w-1.5 bg-border'}"></span>{/each}</div>

		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div class="min-h-[40dvh] space-y-4" onpointerdown={down} onpointerup={up}>
			{#key room?.id}
				<div in:fly={{ x: dir * 40, duration: 240 }} class="space-y-4">
					<div class="flex items-end justify-between gap-3">
						<div><h2 class="title">{room?.name}</h2><p class="mt-1 text-sm text-muted-foreground">{list.length} device{list.length === 1 ? '' : 's'}{#if lightsOn.length}&nbsp;· {lightsOn.length} light{lightsOn.length === 1 ? '' : 's'} on{/if}</p></div>
						{#if lightsOn.length}<Button variant="secondary" size="sm" onclick={lightsOff}>Lights off</Button>{/if}
					</div>
					{#if list.length}<div class="tile-grid">{#each list as d (d.id)}<div class={tileClass(d)}><DeviceCard device={d} /></div>{/each}</div>
					{:else}<Empty title="Nothing in this room yet" description="Devices appear here once they're placed in it.">{#if session.can('rooms.manage') && room && room.id !== 'none'}<Button href="/admin/rooms/{room.id}?add=1">Add devices</Button>{/if}</Empty>{/if}
				</div>
			{/key}
		</div>
		<p class="text-center text-xs text-muted-foreground md:hidden">Swipe sideways to change room</p>
	{:else if home.loaded}
		<Empty title="No rooms yet" description="Rooms group your devices so they're easy to find.">{#if session.can('rooms.manage')}<Button href="/admin/rooms">Set up rooms</Button>{/if}</Empty>
	{/if}
</Page>
