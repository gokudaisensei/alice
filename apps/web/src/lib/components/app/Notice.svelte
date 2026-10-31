<script lang="ts">
	import { home } from '#lib/home.svelte.js';
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 md:bottom-6" aria-live="assertive">
	{#if home.notice}
		<p role={home.notice.kind === 'error' ? 'alert' : 'status'} class="pointer-events-auto max-w-md rounded-lg border px-4 py-3 text-sm shadow-lg {home.notice.kind === 'error' ? 'border-destructive bg-background text-destructive' : 'bg-card text-card-foreground'}">{home.notice.text}</p>
	{/if}
</div>
