<script lang="ts">
	import Swipeable from '#lib/components/app/Swipeable.svelte';
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import type { AutomationView, Template } from '#lib/automations.js';
	import Section from '#lib/components/app/Section.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import { Switch } from '#lib/components/ui/switch';
	import { Plus, Copy, Pencil } from '@lucide/svelte';

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

<div class="space-y-7">
<div class="flex justify-end"><Button href="/automations/new"><Plus />New automation</Button></div>

	
	{#if home.haHealth !== 'ok' && home.loaded}<p role="status" class="rounded-2xl bg-secondary px-4 py-3 text-sm">The home hub isn't reachable, so automations can't be changed right now. Any that are switched on keep running on the hub.</p>{/if}
	{#if notice}<p role="status" class="rounded-2xl bg-accent px-4 py-3 text-sm">{notice}</p>{/if}
	{#if loadError}<p role="alert" class="text-sm text-signal">{loadError}</p>{/if}

	{#if list.length}
		<div class="space-y-3">
			{#each list as a (a.id)}
				<Swipeable class="rounded-tile border" actions={a.enabled === null ? [] : [{ label: a.enabled ? 'Turn off' : 'Turn on', tone: a.enabled ? 'default' : 'on', run: () => toggle(a, !a.enabled) }]}><article class="bg-card p-4 {a.enabled === false ? 'opacity-80' : ''}">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0">
							<h2 class="heading truncate">{a.name}</h2>
							<p class="mt-1 text-[0.9375rem] leading-snug text-muted-foreground">{a.summary}</p>
						</div>
						{#if a.enabled === null}<Badge variant="outline" class="shrink-0">Not on the hub</Badge>
						{:else}<Switch checked={a.enabled} disabled={!!busy[a.id] || home.haHealth !== 'ok'} aria-label="{a.name} is {a.enabled ? 'on' : 'off'}" onCheckedChange={(v) => toggle(a, v)} />{/if}
					</div>
					{#if a.needsAttention}<p role="alert" class="mt-2.5 rounded-xl bg-signal-soft px-3 py-2 text-sm text-signal-foreground">{a.enabled === null ? 'The home hub doesn’t list this automation.' : 'Some of the devices it uses are no longer available.'} Edit it to fix this.</p>{/if}
					<div class="mt-3 flex items-center justify-between gap-2">
						<p class="text-sm text-muted-foreground">{#if a.lastTriggered && when(a.lastTriggered)}Last ran {when(a.lastTriggered)}{:else}Hasn't run yet{/if}</p>
						<div class="flex gap-1"><Button size="sm" variant="ghost" href="/automations/{a.id}"><Pencil />Edit</Button><Button size="sm" variant="ghost" disabled={!!busy[a.id] || home.haHealth !== 'ok'} onclick={() => duplicate(a)}><Copy />Duplicate</Button></div>
					</div>
				</article></Swipeable>
			{/each}
		</div>
	{:else if loaded}
		<Empty title="No automations yet" description="Start from one of the ideas below, or build your own."><Button href="/automations/new">Build your own</Button></Empty>
	{/if}

	{#if suggested.length}
		<Section title="Ideas" hint="Not set up yet. Nothing runs until you finish and save one.">
			<div class="grid gap-3 sm:grid-cols-2">
				{#each suggested as t}
					<div class="flex flex-col gap-3 rounded-tile border border-dashed p-4">
						<div class="flex-1"><h3 class="font-semibold tracking-[-0.015em]">{t.name}</h3><p class="mt-1 text-sm text-muted-foreground">{t.blurb}</p></div>
						<div><Button size="sm" variant="secondary" href="/automations/new?template={t.key}">Set up</Button></div>
					</div>
				{/each}
			</div>
		</Section>
	{/if}

</div>
