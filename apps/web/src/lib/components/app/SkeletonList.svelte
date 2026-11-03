<script lang="ts">
	import Skeleton from '#lib/components/app/Skeleton.svelte';
	/** Placeholder shapes while real data loads: device tiles, list rows or cards. Announces "Loading" once to screen readers. */
	let { kind = 'rows', count = 4, class: cls = '' }: { kind?: 'tiles' | 'rows' | 'cards'; count?: number; class?: string } = $props();
	const items = $derived(Array.from({ length: count }, (_, i) => i));
</script>

<div role="status" class={cls}>
	<span class="sr-only">Loading</span>
	{#if kind === 'tiles'}
		<div class="tile-grid" aria-hidden="true">{#each items as i (i)}<Skeleton class="h-28 rounded-tile" />{/each}</div>
	{:else if kind === 'cards'}
		<div class="grid grid-cols-2 gap-2.5" aria-hidden="true">{#each items as i (i)}<Skeleton class="h-28 rounded-tile" />{/each}</div>
	{:else}
		<div class="divide-y overflow-hidden rounded-tile bg-secondary/40" aria-hidden="true">
			{#each items as i (i)}
				<div class="flex items-center gap-3 px-4 py-3.5"><Skeleton class="size-9 shrink-0 rounded-full" /><div class="min-w-0 flex-1 space-y-2"><Skeleton class="h-3.5 w-2/5" /><Skeleton class="h-3 w-3/4" /></div></div>
			{/each}
		</div>
	{/if}
</div>
