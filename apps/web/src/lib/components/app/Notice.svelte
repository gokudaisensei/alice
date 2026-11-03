<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { fly, fade } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { dur } from '#lib/motion.js';
</script>

<div class="pointer-events-none fixed inset-x-0 bottom-24 z-50 flex justify-center px-4 md:bottom-8" aria-live="assertive">
	{#if home.notice}
		{@const n = home.notice}
		<div in:fly={{ y: 18, duration: dur(260), easing: cubicOut }} out:fade={{ duration: dur(160) }} role={n.kind === 'error' ? 'alert' : 'status'} class="pointer-events-auto flex max-w-md items-center gap-3 rounded-2xl py-3 pl-4 text-sm font-medium shadow-xl backdrop-blur {n.action ? 'pr-2' : 'pr-4'} {n.kind === 'error' ? 'bg-signal text-white' : 'bg-foreground/95 text-background'}">
			<span class="min-w-0">{n.text}</span>
			{#if n.action}<button type="button" class="h-8 shrink-0 rounded-full bg-background/20 px-3.5 text-sm font-semibold transition-colors active:bg-background/30" onclick={() => { const act = n.action; home.notice = null; void act?.run(); }}>{n.action.label}</button>{/if}
		</div>
	{/if}
</div>
