<script lang="ts">
	import { goto } from '$app/navigation';
	import { home } from '#lib/home.svelte.js';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import { Play, Workflow, Plus } from '@lucide/svelte';
</script>

	<Section>
		{#snippet actions()}{#if home.canManageScenes}<Button size="sm" variant="secondary" href="/routines/new"><Plus />New routine</Button>{/if}{/snippet}
		{#if home.routines.length}
			<Group>{#each home.routines as r (r.id)}
				<Row title={r.name}>
					{#snippet icon()}<Workflow class="size-[18px]" />{/snippet}
					<ol class="mt-1 space-y-0.5 text-sm text-muted-foreground">{#each r.steps as s}<li class="truncate">{s.text}</li>{/each}</ol>
					{#if r.needsAttention}<p role="alert" class="mt-1.5 text-sm text-signal">Some steps use devices that are no longer available. Edit this routine to fix them.</p>{/if}
					{#snippet trailing()}
						{#if home.canManageScenes}<Button size="sm" variant="ghost" href="/routines/{r.id}">Edit</Button>{/if}
						<Button size="sm" disabled={!!home.busy[`routine:${r.id}`] || home.haHealth !== 'ok'} onclick={() => home.runRoutine(r)} aria-label="Run {r.name}"><Play />Run</Button>
					{/snippet}
				</Row>
			{/each}</Group>
		{:else if home.loaded}
			<Empty title="No routines yet" description="Start from one of the ideas below, or build your own." />
		{/if}
	</Section>

	
{#if home.suggested.length}
		<Section title="Ideas" hint="Not set up yet. Nothing happens until you choose what they do and save them.">
			<div class="grid gap-3 sm:grid-cols-2">
				{#each home.suggested as t (t.key)}
					<div class="flex flex-col gap-3 rounded-tile border border-dashed p-4">
						<div class="flex items-start justify-between gap-2"><h3 class="font-semibold tracking-[-0.015em]">{t.name}</h3><Badge variant="outline">Not set up</Badge></div>
						<p class="flex-1 text-sm text-muted-foreground">{t.blurb}</p>
						<div><Button size="sm" variant="secondary" onclick={() => goto(`/routines/new?template=${t.key}`)}>Set up</Button></div>
					</div>
				{/each}
			</div>
		</Section>
	{/if}
