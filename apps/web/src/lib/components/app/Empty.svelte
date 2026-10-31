<script lang="ts">
	import type { Snippet } from 'svelte';
	let { title, description, children }: { title: string; description?: string; children?: Snippet } = $props();
</script>

<div class="flex flex-col items-center rounded-2xl border border-dashed px-6 py-10 text-center">
	<p class="heading">{title}</p>
	{#if description}<p class="mt-1 max-w-[44ch] text-sm text-muted-foreground">{description}</p>{/if}
	{#if children}<div class="mt-4 flex flex-wrap justify-center gap-2">{@render children()}</div>{/if}
</div>
