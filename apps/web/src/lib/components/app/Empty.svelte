<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import { Button } from '#lib/components/ui/button';
	let { title, description, icon: Icon, action, href, onclick, children }: {
		title: string; description?: string; icon?: Component<{ class?: string }>;
		/** Label for an optional primary action. Give it an href or an onclick. */
		action?: string; href?: string; onclick?: () => void; children?: Snippet;
	} = $props();
</script>

<div class="flex flex-col items-center rounded-2xl bg-secondary/60 px-6 py-10 text-center">
	{#if Icon}<span class="mb-3 flex size-12 items-center justify-center rounded-2xl bg-primary/12 text-primary"><Icon class="size-6" /></span>{/if}
	<p class="heading">{title}</p>
	{#if description}<p class="mt-1 max-w-[44ch] text-sm text-muted-foreground">{description}</p>{/if}
	{#if action && href}<Button class="mt-4" {href}>{action}</Button>{:else if action && onclick}<Button class="mt-4" {onclick}>{action}</Button>{/if}
	{#if children}<div class="mt-4 flex flex-wrap justify-center gap-2">{@render children()}</div>{/if}
</div>
