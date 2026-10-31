<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Lightbulb } from '@lucide/svelte';

	import Empty from '#lib/components/app/Empty.svelte';
	let { full = false }: { full?: boolean } = $props();
	let loaded = $state(false);
	type Insight = { key: string; title: string; body: string; suggestion: { label: string; href: string } };
	let items = $state<Insight[]>([]);
	onMount(async () => { const r = await api('GET', '/api/insights'); if (r.ok) items = full ? r.data.insights : r.data.insights.slice(0, 3); loaded = true; });
	async function dismiss(i: Insight) { items = items.filter((x) => x !== i); await api('POST', '/api/insights/dismiss', { key: i.key }); }
</script>

{#if items.length}
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
