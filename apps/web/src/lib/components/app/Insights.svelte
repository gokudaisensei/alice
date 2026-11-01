<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Lightbulb, ChevronDown } from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import { dur } from '#lib/motion.js';

	import Empty from '#lib/components/app/Empty.svelte';
	let { full = false }: { full?: boolean } = $props();
	let loaded = $state(false);
	type Insight = { key: string; title: string; body: string; suggestion: { label: string; href: string } };
	let items = $state<Insight[]>([]);
	onMount(async () => { const r = await api('GET', '/api/insights'); if (r.ok) items = full ? r.data.insights : r.data.insights.slice(0, 3); loaded = true; });
	// The full page groups what's alike and keeps each one to a line until you open it, so a long list reads at a glance.
	const labels: Record<string, string> = { standby: 'Always on', energy_up: 'Higher than usual' };
	const groups = $derived.by(() => {
		const m = new Map<string, Insight[]>();
		for (const i of items) { const k = i.key.split(':')[0]; m.set(k, [...(m.get(k) ?? []), i]); }
		return [...m].map(([k, list]) => ({ k, label: labels[k] ?? 'Other', list }));
	});
	let open = $state<string | null>(null);
	async function dismiss(i: Insight) { items = items.filter((x) => x !== i); await api('POST', '/api/insights/dismiss', { key: i.key }); }
</script>

{#if items.length && full}
	<div class="space-y-5">
		{#each groups as g (g.k)}
			<section aria-label={g.label}>
				<div class="mb-2 flex items-baseline justify-between"><h2 class="heading">{g.label}</h2><span class="text-xs text-muted-foreground">{g.list.length}</span></div>
				<ul class="divide-y overflow-hidden rounded-tile border bg-card">
					{#each g.list as i (i.key)}
						{@const on = open === i.key}
						<li>
							<button type="button" class="flex w-full items-center gap-3 px-3.5 py-3 text-left transition-colors active:bg-muted" aria-expanded={on} onclick={() => (open = on ? null : i.key)}>
								<Lightbulb class="size-4 shrink-0 text-primary" />
								<span class="min-w-0 flex-1 text-[0.9375rem] font-medium leading-snug {on ? '' : 'line-clamp-2'}">{i.title}</span>
								<ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 {on ? 'rotate-180' : ''}" />
							</button>
							{#if on}
								<div class="space-y-2.5 px-3.5 pb-3.5 pl-[42px]" transition:slide={{ duration: dur(200) }}>
									<p class="text-sm text-muted-foreground">{i.body}</p>
									<div class="flex gap-1 -ml-2.5">
										{#if i.suggestion.href.startsWith('/energy') || session.can('automation.manage')}<Button size="sm" variant="secondary" href={i.suggestion.href.startsWith('/energy') ? '/activity?tab=energy' : i.suggestion.href}>{i.suggestion.label}</Button>{/if}
										<Button size="sm" variant="ghost" onclick={() => dismiss(i)}>Dismiss</Button>
									</div>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			</section>
		{/each}
	</div>
{:else if items.length}
	<section class="space-y-3">{#if !full}<h2 class="heading">Worth a look</h2>{/if}
	<div class="divide-y divide-border overflow-hidden rounded-2xl border bg-card">
		{#each items as i (i.key)}
			<div class="space-y-1.5 px-4 py-3.5">
				<div class="flex gap-2.5"><Lightbulb class="mt-0.5 size-4 shrink-0 text-primary" /><div><p class="text-[0.9375rem] font-medium leading-snug">{i.title}</p><p class="mt-0.5 text-sm text-muted-foreground">{i.body}</p></div></div>
				<div class="flex gap-1 pl-[26px]">
					{#if i.suggestion.href.startsWith('/energy') || session.can('automation.manage')}<Button size="sm" variant="secondary" href={i.suggestion.href.startsWith('/energy') ? '/activity?tab=energy' : i.suggestion.href}>{i.suggestion.label}</Button>{/if}
					<Button size="sm" variant="ghost" onclick={() => dismiss(i)}>Dismiss</Button>
				</div>
			</div>
		{/each}
	</div>
	</section>
{/if}
{#if full && loaded && !items.length}<Empty title="Nothing to point out" description="Insights appear once there is enough history to say something useful." />{/if}
