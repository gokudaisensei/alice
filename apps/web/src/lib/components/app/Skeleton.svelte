<script lang="ts">
	/** One rounded block that shimmers softly. Give it the size and shape of the thing it stands in for. */
	let { class: cls = '' }: { class?: string } = $props();
</script>

<div class="skeleton rounded-xl bg-muted {cls}" aria-hidden="true"></div>

<style>
	.skeleton {
		background-image: linear-gradient(100deg, transparent 30%, color-mix(in oklab, var(--color-foreground, currentColor) 7%, transparent) 50%, transparent 70%);
		background-size: 200% 100%;
		animation: skeleton-shimmer 1.6s ease-in-out infinite;
	}
	@keyframes skeleton-shimmer { from { background-position: 150% 0; } to { background-position: -50% 0; } }
	@media (prefers-reduced-motion: reduce) { .skeleton { animation: none; background-image: none; } }
</style>
