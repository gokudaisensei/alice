<script lang="ts">
	import type { Snippet } from 'svelte';
	/** A grouped list: one surface, hairline dividers between rows. Used instead of a card per item. */
	let { children, class: cls = '' }: { children: Snippet; class?: string } = $props();
</script>

<div class="stagger divide-y divide-border overflow-hidden rounded-2xl border bg-card {cls}">{@render children()}</div>
