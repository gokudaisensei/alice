<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { Kind } from '#lib/behaviours.svelte.js';
	import { Sparkles, ListOrdered, Zap } from '@lucide/svelte';

	/** One line in the list of everything the home can do: what it is, what it does and when it runs. */
	let { kind, name, does, alert, extra, trailing, dim = false }: { kind: Kind; name: string; does: string; alert?: string | null; extra?: string | null; trailing?: Snippet; dim?: boolean } = $props();
	const LABEL: Record<Kind, string> = { scene: 'Scene', routine: 'Routine', automation: 'Automatic' };
</script>

<div class="flex items-start gap-3 px-4 py-3.5 {dim ? 'opacity-80' : ''}">
	<span class="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-muted-foreground" aria-hidden="true">{#if kind === 'scene'}<Sparkles class="size-[18px]" />{:else if kind === 'routine'}<ListOrdered class="size-[18px]" />{:else}<Zap class="size-[18px]" />{/if}</span>
	<div class="min-w-0 flex-1">
		<p class="flex flex-wrap items-center gap-x-2 gap-y-1"><span class="text-[0.9375rem] font-semibold leading-tight">{name}</span><span class="shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">{LABEL[kind]}</span></p>
		<p class="mt-1 line-clamp-3 text-sm leading-snug text-muted-foreground">{does}</p>
		{#if extra}<p class="mt-0.5 text-xs text-muted-foreground">{extra}</p>{/if}
		{#if alert}<p role="alert" class="mt-1.5 text-sm text-signal">{alert}</p>{/if}
		{#if trailing}<div class="mt-3 flex items-center gap-2 sm:hidden">{@render trailing()}</div>{/if}
	</div>
	{#if trailing}<div class="hidden shrink-0 items-center gap-2 self-center sm:flex">{@render trailing()}</div>{/if}
</div>