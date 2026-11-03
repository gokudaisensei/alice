<script lang="ts">
	import type { Snippet } from 'svelte';
	import { onMount } from 'svelte';
	import { ChevronLeft, Search } from '@lucide/svelte';
	import { chrome } from '#lib/chrome.svelte.js';

	let { title, subtitle, back, width = 'lg', actions, children }: {
		title: string; subtitle?: string; back?: { href: string; label: string }; width?: 'sm' | 'md' | 'lg' | 'xl';
		actions?: Snippet; children: Snippet;
	} = $props();
	const max = { sm: 'max-w-xl', md: 'max-w-3xl', lg: 'max-w-4xl', xl: 'max-w-6xl' };
	let h1: HTMLElement | undefined = $state();

	// The large title collapses into the slim bar on phones once it scrolls out of view.
	onMount(() => {
		chrome.compact = false;
		const io = new IntersectionObserver(([e]) => { if (e) chrome.compact = !e.isIntersecting && e.boundingClientRect.top < 0; }, { rootMargin: '-8px 0px 0px 0px' });
		if (h1) io.observe(h1);
		return () => { io.disconnect(); chrome.compact = false; };
	});
	$effect(() => { chrome.title = title; });
</script>

<main class="mx-auto w-full max-w-6xl px-5 pb-10 pt-4 md:px-10 md:pb-16 md:pt-10">
	<div class="{max[width]}">
	{#if back}<a href={back.href} class="-ml-1 mb-2 inline-flex items-center gap-0.5 text-sm text-muted-foreground transition-colors hover:text-foreground"><ChevronLeft class="size-4" />{back.label}</a>{/if}
	<header class="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 md:mb-7">
		<div class="min-w-0 flex-1">
			<h1 class="title" bind:this={h1}>{title}</h1>
			{#if subtitle}<p class="mt-1.5 line-clamp-2 max-w-[60ch] text-[0.9375rem] leading-snug text-muted-foreground md:mt-2 md:line-clamp-none md:leading-relaxed">{subtitle}</p>{/if}
		</div>
		<div class="flex shrink-0 items-center gap-2">
			{#if actions}{@render actions()}{/if}
			<button type="button" class="flex size-9 items-center justify-center rounded-full bg-secondary text-muted-foreground md:hidden" aria-label="Search" onclick={() => (chrome.search = true)}><Search class="size-4" /></button>
		</div>
	</header>
	<div class="stagger space-y-7 md:space-y-9">{@render children()}</div>
	</div>
</main>
