<script lang="ts">
	import { goto } from '$app/navigation';
	import { home } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import * as Card from '#lib/components/ui/card';
	import { Play } from '@lucide/svelte';
</script>

<main class="mx-auto max-w-3xl space-y-8 p-4">
	<h1 class="text-2xl font-semibold">Scenes & routines</h1>

	<section aria-labelledby="scenes">
		<div class="mb-2 flex items-center justify-between">
			<h2 id="scenes" class="text-sm font-medium uppercase text-muted-foreground">Scenes</h2>
			{#if home.canManageScenes}<Button size="sm" variant="outline" href="/scenes/new">New scene</Button>{/if}
		</div>
		<p class="mb-3 text-sm text-muted-foreground">A scene sets several devices to how you like them, all at once.</p>
		{#if home.scenes.length}
			<div class="grid gap-2 sm:grid-cols-2">
				{#each home.scenes as s (s.id)}
					<div class="flex items-center justify-between gap-2 rounded-lg border p-3">
						<span class="min-w-0 truncate">{s.name}</span>
						<span class="flex shrink-0 gap-1">
							{#if s.managed && home.canManageScenes}<Button size="sm" variant="ghost" href="/scenes/{encodeURIComponent(s.id)}">Edit</Button>{/if}
							<Button size="sm" disabled={!!home.busy[s.id] || home.haHealth !== 'ok'} onclick={() => home.activateScene(s)} aria-label="Activate {s.name}"><Play class="size-4" /> Activate</Button>
						</span>
					</div>
				{/each}
			</div>
		{:else if home.loaded}
			<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No scenes yet.{#if home.canManageScenes} <a class="underline" href="/scenes/new">Create one</a> from how your devices are set right now.{/if}</p>
		{/if}
	</section>

	<section aria-labelledby="routines">
		<div class="mb-2 flex items-center justify-between">
			<h2 id="routines" class="text-sm font-medium uppercase text-muted-foreground">Routines</h2>
			{#if home.canManageScenes}<Button size="sm" variant="outline" href="/routines/new">New routine</Button>{/if}
		</div>
		<p class="mb-3 text-sm text-muted-foreground">A routine does a list of things in order when you start it. It never starts by itself.</p>
		{#if home.routines.length}
			<div class="space-y-2">
				{#each home.routines as r (r.id)}
					<Card.Root class="gap-0 py-0">
						<div class="space-y-2 p-4">
							<div class="flex items-center justify-between gap-2">
								<h3 class="font-semibold">{r.name}</h3>
								<span class="flex gap-1">
									{#if home.canManageScenes}<Button size="sm" variant="ghost" href="/routines/{r.id}">Edit</Button>{/if}
									<Button size="sm" disabled={!!home.busy[`routine:${r.id}`] || home.haHealth !== 'ok'} onclick={() => home.runRoutine(r)} aria-label="Run {r.name}"><Play class="size-4" /> Run</Button>
								</span>
							</div>
							<ol class="list-inside list-decimal space-y-0.5 text-sm text-muted-foreground">{#each r.steps as s}<li>{s.text}</li>{/each}</ol>
							{#if r.needsAttention}<p role="alert" class="text-sm text-destructive">Some steps use devices that are no longer available. Edit this routine to fix them.</p>{/if}
						</div>
					</Card.Root>
				{/each}
			</div>
		{:else if home.loaded}
			<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No routines set up yet.</p>
		{/if}
	</section>

	{#if home.suggested.length}
		<section aria-labelledby="sugg">
			<h2 id="sugg" class="mb-2 text-sm font-medium uppercase text-muted-foreground">Suggested · not set up yet</h2>
			<p class="mb-3 text-sm text-muted-foreground">These are ideas to start from. Nothing happens until you choose what they do and save them.</p>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each home.suggested as t (t.key)}
					<div class="space-y-2 rounded-lg border border-dashed p-4">
						<div class="flex items-center justify-between"><h3 class="font-medium">{t.name}</h3><Badge variant="outline">Not set up</Badge></div>
						<p class="text-sm text-muted-foreground">{t.blurb}</p>
						<Button size="sm" variant="secondary" onclick={() => goto(`/routines/new?template=${t.key}`)}>Set up</Button>
					</div>
				{/each}
			</div>
		</section>
	{/if}
</main>
