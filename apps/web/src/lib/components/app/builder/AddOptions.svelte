<script lang="ts">
	import type { Component } from 'svelte';
	export type Option = { title: string; desc: string; icon: Component<{ class?: string }>; onclick: () => void; disabled?: boolean; why?: string };
	/** What can be added next, as small cards with an icon and one line on what each does. */
	let { label, options }: { label: string; options: Option[] } = $props();
</script>

<div role="group" aria-label={label} class="grid gap-2 sm:grid-cols-2">
	{#each options as o}
		<button type="button" disabled={o.disabled} onclick={o.onclick} class="flex min-h-14 items-center gap-3 rounded-2xl bg-secondary px-3.5 py-2.5 text-left transition-colors hover:bg-secondary/70 active:scale-[0.99] disabled:opacity-50 motion-reduce:active:scale-100">
			<span class="flex size-9 shrink-0 items-center justify-center rounded-xl bg-card text-primary"><o.icon class="size-[18px]" /></span>
			<span class="min-w-0"><span class="block text-[0.9375rem] font-medium leading-tight">{o.title}</span><span class="block text-sm leading-snug text-muted-foreground">{o.disabled && o.why ? o.why : o.desc}</span></span>
		</button>
	{/each}
</div>
