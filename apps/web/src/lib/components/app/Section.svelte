<script lang="ts">
	import type { Snippet } from 'svelte';
	let { title, hint, actions, children }: { title?: string; hint?: string; actions?: Snippet; children: Snippet } = $props();
</script>

<section class="space-y-3">
	{#if title || actions}
		<div class="flex items-baseline justify-between gap-3">
			<div class="min-w-0"><h2 class="heading">{title}</h2>{#if hint}<p class="mt-0.5 text-sm text-muted-foreground">{hint}</p>{/if}</div>
			{#if actions}<div class="flex shrink-0 items-center gap-1">{@render actions()}</div>{/if}
		</div>
	{/if}
	{@render children()}
</section>
