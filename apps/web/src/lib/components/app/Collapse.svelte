<script lang="ts">
	import type { Snippet } from 'svelte';
	/** Smooth open/close without measuring heights: animates a grid row between 0fr and 1fr. */
	let { open, children }: { open: boolean; children: Snippet } = $props();
</script>

<div class="grid transition-[grid-template-rows] duration-300 ease-[cubic-bezier(.3,.7,.2,1)] {open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}" inert={!open}>
	<div class="min-h-0 overflow-hidden">{@render children()}</div>
</div>
