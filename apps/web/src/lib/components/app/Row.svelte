<script lang="ts">
	import type { Snippet } from 'svelte';
	import { ChevronRight } from '@lucide/svelte';
	let { title, description, href, icon, tone = 'default', trailing, children, onclick }: {
		title?: string; description?: string; href?: string; icon?: Snippet; tone?: 'default' | 'on' | 'signal';
		trailing?: Snippet; children?: Snippet; onclick?: () => void;
	} = $props();
	const chip = { default: 'bg-secondary text-muted-foreground', on: 'bg-on-soft text-on-foreground', signal: 'bg-signal-soft text-signal-foreground' };
</script>

{#snippet inner()}
	{#if icon}<span class="flex size-9 shrink-0 items-center justify-center rounded-xl {chip[tone]}">{@render icon()}</span>{/if}
	<div class="min-w-0 flex-1">
		{#if title}<p class="truncate text-[0.9375rem] font-medium leading-tight">{title}</p>{/if}
		{#if description}<p class="mt-0.5 text-sm leading-snug text-muted-foreground">{description}</p>{/if}
		{@render children?.()}
	</div>
	{#if trailing}<div class="flex shrink-0 items-center gap-2">{@render trailing()}</div>{:else if href}<ChevronRight class="size-4 shrink-0 text-muted-foreground/70" />{/if}
{/snippet}

{#if href}
	<a {href} class="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60">{@render inner()}</a>
{:else if onclick}
	<button type="button" {onclick} class="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/60">{@render inner()}</button>
{:else}
	<div class="flex min-h-14 items-center gap-3 px-4 py-3">{@render inner()}</div>
{/if}
