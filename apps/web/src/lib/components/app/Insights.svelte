<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';

	type Insight = { key: string; title: string; body: string; suggestion: { label: string; href: string } };
	let items = $state<Insight[]>([]);
	onMount(async () => { const r = await api('GET', '/api/insights'); if (r.ok) items = r.data.insights.slice(0, 3); });
	async function dismiss(i: Insight) { items = items.filter((x) => x !== i); await api('POST', '/api/insights/dismiss', { key: i.key }); }
</script>

{#if items.length}
	<section aria-labelledby="ins" class="space-y-2">
		<h2 id="ins" class="text-sm font-medium uppercase text-muted-foreground">Worth a look</h2>
		{#each items as i (i.key)}
			<Card.Root class="gap-0 py-0"><div class="space-y-1 p-4">
				<h3 class="font-semibold">{i.title}</h3>
				<p class="text-sm text-muted-foreground">{i.body}</p>
				<p class="text-xs text-muted-foreground">Just a suggestion. Nothing has been changed.</p>
				<div class="flex gap-1">
					{#if i.suggestion.href.startsWith('/energy') || session.can('automation.manage')}<Button size="sm" variant="outline" href={i.suggestion.href}>{i.suggestion.label}</Button>{/if}
					<Button size="sm" variant="ghost" onclick={() => dismiss(i)}>Not useful</Button>
				</div>
			</div></Card.Root>
		{/each}
	</section>
{/if}
