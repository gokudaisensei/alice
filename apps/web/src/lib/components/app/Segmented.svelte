<script lang="ts" generics="T extends string">
	import type { Component } from 'svelte';
	import { haptics } from '#lib/haptics.js';

	type Opt = { id: T; label: string; badge?: number; icon?: Component<{ class?: string }> };
	/** A segmented control whose highlight glides to the chosen option. `stack` puts the icon above the label. */
	let { options, value = $bindable(), onselect, label = 'View', stack = false, disabled = false }: { options: Opt[]; value: T | null | undefined; onselect?: (id: T) => void; label?: string; stack?: boolean; disabled?: boolean } = $props();
	const n = $derived(options.length);
	const idx = $derived(Math.max(0, options.findIndex((o) => o.id === value)));
	const has = $derived(options.some((o) => o.id === value));
	function pick(id: T) { if (id === value) return; haptics.tap(); if (onselect) onselect(id); else value = id; }
</script>

<div class="relative grid gap-0 rounded-2xl bg-secondary p-1" style="grid-template-columns: repeat({n}, minmax(0, 1fr))" role="tablist" aria-label={label}>
	{#if has}<span class="pointer-events-none absolute inset-y-1 left-1 rounded-xl bg-card shadow-[0_1px_3px_rgba(0,0,0,0.12)] transition-transform duration-300 ease-[cubic-bezier(0.3,0.7,0.2,1)]" style="width: calc((100% - 0.5rem) / {n}); transform: translateX({idx * 100}%)"></span>{/if}
	{#each options as o (o.id)}
		<button type="button" role="tab" aria-selected={value === o.id} {disabled} onclick={() => pick(o.id)}
			class="relative z-10 flex items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition-colors duration-200 active:scale-[0.97] disabled:opacity-50 {stack ? 'h-12 flex-col gap-0.5 text-[0.8125rem] sm:h-14' : 'h-9'} {value === o.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}">
			{#if o.icon}<o.icon class="size-[18px] transition-colors duration-200 {value === o.id ? 'text-primary' : ''}" />{/if}
			{o.label}{#if o.badge}<span class="min-w-4 rounded-full bg-primary px-1 text-center text-[11px] font-semibold text-primary-foreground">{o.badge}</span>{/if}
		</button>
	{/each}
</div>
