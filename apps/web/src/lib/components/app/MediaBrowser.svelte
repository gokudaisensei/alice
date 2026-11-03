<script lang="ts">
	import { api, explain } from '#lib/api.js';
	import { home, type Device } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { ArrowLeft, ChevronRight, Library, Play } from '@lucide/svelte';

	let { device }: { device: Device } = $props();
	type Item = { title: string; id: string; type: string; canPlay: boolean; canExpand: boolean };
	type Level = Item & { children: Item[] };
	let stack = $state<Level[]>([]), open = $state(false), busy = $state(false), error = $state('');
	const here = $derived(stack.at(-1));

	async function load(item?: Item) {
		busy = true; error = '';
		const q = item ? `?id=${encodeURIComponent(item.id)}&type=${encodeURIComponent(item.type)}` : '';
		const r = await api<Level>('GET', `/api/devices/${encodeURIComponent(device.id)}/browse${q}`);
		busy = false;
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		stack = [...stack, r.data];
	}
	async function toggle() { open = !open; if (open && !stack.length) await load(); }
	const back = () => { stack = stack.slice(0, -1); };
	const canPlay = $derived(device.controls.some((c) => c.type === 'media' && c.playMedia));
	async function play(i: Item) { if (await home.command(device.id, 'play_media', { id: i.id, type: i.type })) open = false; }
</script>

<div class="space-y-2">
	<Button variant="secondary" size="sm" onclick={toggle} aria-expanded={open}><Library />{canPlay ? 'Choose something to play' : 'Browse the library'}</Button>
	{#if open}
		<div class="overflow-hidden rounded-xl border bg-card">
			<div class="flex items-center gap-2 border-b px-3 py-2">
				{#if stack.length > 1}<Button size="icon-sm" variant="ghost" aria-label="Back" onclick={back}><ArrowLeft /></Button>{/if}
				<span class="min-w-0 flex-1 truncate text-sm font-medium">{here?.title || 'Library'}</span>
				{#if canPlay && here?.canPlay}<Button size="sm" variant="secondary" onclick={() => play(here!)}><Play />Play this</Button>{/if}
			</div>
			{#if busy}<p class="px-3 py-3 text-sm text-muted-foreground">Loading…</p>
			{:else if error}<p role="alert" class="px-3 py-3 text-sm text-signal">{error}</p>
			{:else if here}
				<ul class="max-h-64 divide-y overflow-auto">
					{#each here.children as c (c.id + c.type)}
						<li><button type="button" class="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm" onclick={() => (c.canExpand ? load(c) : canPlay && c.canPlay ? play(c) : null)}>
							<span class="min-w-0 flex-1 truncate">{c.title}</span>
							{#if c.canExpand}<ChevronRight class="size-4 text-muted-foreground" />{:else if canPlay && c.canPlay}<Play class="size-4 text-muted-foreground" />{/if}
						</button></li>
					{:else}<li class="px-3 py-3 text-sm text-muted-foreground">Nothing here.</li>{/each}
				</ul>
			{/if}
		</div>
	{/if}
</div>
