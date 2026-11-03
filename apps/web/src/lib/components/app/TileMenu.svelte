<script lang="ts">
	import { goto } from '$app/navigation';
	import { home, type Device } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { selection } from '#lib/select.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import * as Drawer from '#lib/components/ui/drawer';
	import DeviceEdit from '#lib/components/app/DeviceEdit.svelte';
	import { CheckCheck, History, Pencil, Star, Workflow, DoorOpen, ChevronLeft } from '@lucide/svelte';

	/** What a press-and-hold on a tile offers: the things you'd otherwise dig through settings for. */
	let { device, open = $bindable(false), ondetails }: { device: Device; open: boolean; ondetails: () => void } = $props();
	let editing = $state(false);
	$effect(() => { if (open) editing = false; });
	const fav = $derived(home.isFavorite(device.id));

	const close = (then?: () => unknown) => { open = false; haptics.tap(); setTimeout(() => then?.(), 180); };
	const item = 'flex h-14 w-full items-center gap-3.5 rounded-2xl px-4 text-left text-base font-medium transition-colors active:bg-muted';
</script>

<Drawer.Root bind:open>
	<Drawer.Content class="max-h-[88dvh] rounded-t-3xl">
		<div class="overflow-y-auto px-3 pb-[max(1rem,env(safe-area-inset-bottom))] pt-2">
			<Drawer.Header class="px-3 pb-2"><Drawer.Title class="truncate text-left text-lg font-semibold tracking-[-0.02em]">{device.name}</Drawer.Title><Drawer.Description class="sr-only">Actions for {device.name}</Drawer.Description></Drawer.Header>
			{#if editing}
				<div class="space-y-3 px-3 pb-2">
					<button type="button" class="flex items-center gap-1 text-sm text-muted-foreground" onclick={() => (editing = false)}><ChevronLeft class="size-4" />Back</button>
					<DeviceEdit {device} onsaved={() => (open = false)} />
				</div>
			{:else}
				<ul class="space-y-0.5">
					<li><button type="button" class={item} onclick={() => close(() => selection.start(device.id))}><CheckCheck class="size-5 text-muted-foreground" />Select several</button></li>
					<li><button type="button" class={item} aria-pressed={fav} onclick={() => { home.toggleFavorite(device.id); close(); }}><Star class="size-5 {fav ? 'fill-current text-on' : 'text-muted-foreground'}" />{fav ? 'Remove from favourites' : 'Add to favourites'}</button></li>
					<li><button type="button" class={item} onclick={() => close(ondetails)}><History class="size-5 text-muted-foreground" />Details and history</button></li>
					{#if session.can('automation.manage')}<li><button type="button" class={item} onclick={() => close(() => goto(`/automations/new?device=${encodeURIComponent(device.id)}`))}><Workflow class="size-5 text-muted-foreground" />Create an automation</button></li>{/if}
					{#if session.can('rooms.manage')}
						<li><button type="button" class={item} onclick={() => (editing = true)}><Pencil class="size-5 text-muted-foreground" />Rename</button></li>
						<li><button type="button" class={item} onclick={() => (editing = true)}><DoorOpen class="size-5 text-muted-foreground" />Move to another room</button></li>
					{/if}
				</ul>
			{/if}
		</div>
	</Drawer.Content>
</Drawer.Root>
