<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { dur } from '#lib/motion.js';
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-8" aria-live="assertive">
	{#if home.notice}
		<p in:fly={{ y: 18, duration: dur(260), easing: cubicOut }} out:fade={{ duration: dur(160) }} role={home.notice.kind === 'error' ? 'alert' : 'status'} class="pointer-events-auto max-w-md rounded-2xl px-4 py-3 text-sm font-medium shadow-xl backdrop-blur {home.notice.kind === 'error' ? 'bg-signal text-white' : 'bg-foreground/95 text-background'}">{home.notice.text}</p>
	{/if}
</div>
