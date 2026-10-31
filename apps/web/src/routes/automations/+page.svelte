<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import type { AutomationView, Template } from '#lib/automations.js';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import { Switch } from '#lib/components/ui/switch';
	import * as Card from '#lib/components/ui/card';

	let list = $state<AutomationView[]>([]);
	let suggested = $state<Template[]>([]);
	let loaded = $state(false), loadError = $state(''), notice = $state('');
	let busy = $state<Record<string, boolean>>({});

	async function load() {
		const r = await api('GET', '/api/automations');
		if (r.ok) { list = r.data.automations; suggested = r.data.suggested; loadError = ''; } else loadError = r.data?.message ?? explain(r.data?.error);
		loaded = true;
	}
	onMount(load);

	async function toggle(a: AutomationView, enabled: boolean) {
		busy[a.id] = true; notice = '';
		const r = await api('POST', `/api/automations/${a.id}/enabled`, { enabled });
		busy[a.id] = false;
		if (!r.ok) notice = r.data?.message ?? explain(r.data?.error);
		await load();
	}
	async function duplicate(a: AutomationView) {
		busy[a.id] = true; notice = '';
		const r = await api('POST', `/api/automations/${a.id}/duplicate`);
		busy[a.id] = false;
		notice = r.ok ? `Copied “${a.name}”. The copy is switched off until you turn it on.` : (r.data?.message ?? explain(r.data?.error));
		await load();
	}
	const when = (iso: string) => { const d = new Date(/^\d+$/.test(iso) ? Number(iso) : iso); return isNaN(+d) ? null : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }); };
</script>

<main class="mx-auto max-w-3xl space-y-6 p-4">
	<div class="flex items-center justify-between gap-2">
		<h1 class="text-2xl font-semibold">Automations</h1>
		<Button size="sm" href="/automations/new">New automation</Button>
	</div>
	<p class="text-sm text-muted-foreground">An automation watches for something to happen, then does things for you. It runs on your home hub, so it keeps working even when this app is closed.</p>

	{#if home.haHealth !== 'ok' && home.loaded}<p role="status" class="rounded-lg border p-3 text-sm">The home hub isn't reachable, so automations can't be changed right now. Any that are already switched on keep running on the hub.</p>{/if}
	{#if notice}<p role="status" class="rounded-lg border p-3 text-sm">{notice}</p>{/if}
	{#if loadError}<p role="alert" class="text-sm text-destructive">{loadError}</p>{/if}

	<div class="space-y-2">
		{#each list as a (a.id)}
			<Card.Root class="gap-0 py-0"><div class="space-y-2 p-4">
				<div class="flex items-center justify-between gap-2">
					<h2 class="min-w-0 truncate font-semibold">{a.name}</h2>
					{#if a.enabled === null}<Badge variant="outline">Not on the hub</Badge>
					{:else}<span class="flex items-center gap-2 text-sm text-muted-foreground">{a.enabled ? 'On' : 'Off'}
						<Switch checked={a.enabled} disabled={!!busy[a.id] || home.haHealth !== 'ok'} aria-label="{a.name} is {a.enabled ? 'on' : 'off'}" onCheckedChange={(v) => toggle(a, v)} /></span>{/if}
				</div>
				<p class="text-sm text-muted-foreground">{a.summary}</p>
				<p class="text-xs text-muted-foreground">{#if a.lastTriggered && when(a.lastTriggered)}Last ran {when(a.lastTriggered)}{:else}Hasn't run yet{/if}</p>
				{#if a.needsAttention}<p role="alert" class="text-sm text-destructive">{a.enabled === null ? 'The home hub doesn’t list this automation.' : 'Some of the devices it uses are no longer available.'} Edit it to fix this.</p>{/if}
				<div class="flex gap-1"><Button size="sm" variant="ghost" href="/automations/{a.id}">Edit</Button><Button size="sm" variant="ghost" disabled={!!busy[a.id] || home.haHealth !== 'ok'} onclick={() => duplicate(a)}>Duplicate</Button></div>
			</div></Card.Root>
		{:else}
			{#if loaded}<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No automations yet. Start from one of the ideas below, or <a class="underline" href="/automations/new">build your own</a>.</p>{/if}
		{/each}
	</div>

	{#if suggested.length}
		<section aria-labelledby="ideas">
			<h2 id="ideas" class="mb-2 text-sm font-medium uppercase text-muted-foreground">Ideas · not set up yet</h2>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each suggested as t}
					<div class="space-y-2 rounded-lg border border-dashed p-3">
						<div><h3 class="font-medium">{t.name}</h3><p class="text-sm text-muted-foreground">{t.blurb}</p></div>
						<Button size="sm" variant="outline" href="/automations/new?template={t.key}">Set up</Button>
					</div>
				{/each}
			</div>
			<p class="mt-2 text-xs text-muted-foreground">Nothing here runs until you finish setting it up and save it.</p>
		</section>
	{/if}
</main>
