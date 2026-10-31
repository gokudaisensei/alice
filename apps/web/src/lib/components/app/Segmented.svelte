<script lang="ts">
	/** iOS-style segmented control. */
	let { options, value = $bindable(), label = 'View' }: { options: { id: string; label: string; badge?: number }[]; value: string; label?: string } = $props();
</script>

<div class="grid gap-1 rounded-2xl bg-secondary p-1" style="grid-template-columns: repeat({options.length}, minmax(0, 1fr))" role="tablist" aria-label={label}>
	{#each options as o (o.id)}
		<button type="button" role="tab" aria-selected={value === o.id} onclick={() => (value = o.id)}
			class="flex h-9 items-center justify-center gap-1.5 rounded-xl text-sm font-medium transition-all duration-200 {value === o.id ? 'bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-muted-foreground hover:text-foreground'}">
			{o.label}{#if o.badge}<span class="min-w-4 rounded-full bg-primary px-1 text-center text-[11px] font-semibold text-primary-foreground">{o.badge}</span>{/if}
		</button>
	{/each}
</div>
