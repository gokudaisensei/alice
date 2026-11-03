<script lang="ts">
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { automationDoes, behaviours, words } from '#lib/behaviours.svelte.js';
	import { plural } from '#lib/fmt.js';
	import { capitalize } from '#lib/utils.js';
	import { stepsSentence } from '#lib/steps.js';
	import type { RoutineIdea } from '#lib/automations.js';
	import Page from '#lib/components/app/Page.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import SkeletonList from '#lib/components/app/SkeletonList.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import ScenesPanel from '#lib/components/app/panels/ScenesPanel.svelte';
	import RoutinesPanel from '#lib/components/app/panels/RoutinesPanel.svelte';
	import AutomationsPanel from '#lib/components/app/panels/AutomationsPanel.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Plus, Sparkles, TriangleAlert } from '@lucide/svelte';

	onMount(() => { behaviours.load(); });

	// Old links like ?tab=scenes or ?tab=automations still land on the right part of the one list.
	const tab = page.url.searchParams.get('tab');
	let show = $state<'all' | 'run' | 'auto'>(tab === 'automations' ? 'auto' : tab === 'scenes' || tab === 'routines' ? 'run' : 'all');

	const canAuto = $derived(session.can('automation.manage'));
	const canMake = $derived(home.canManageScenes || canAuto);
	const runCount = $derived(home.scenes.length + home.routines.length);
	const autoCount = $derived(behaviours.automations.length);
	const loaded = $derived(home.loaded && behaviours.loaded);
	const options = $derived([{ id: 'all' as const, label: 'All' }, { id: 'run' as const, label: 'Run now' }, ...(canAuto ? [{ id: 'auto' as const, label: 'Automatic' }] : [])]);

	const sentence = (x: string) => (/[.!?]$/.test(x) ? x : `${x}.`);
	type Idea = { key: string; name: string; blurb: string; summary: string; missing: string | null; href: string; runs: string };
	const ideas = $derived<Idea[]>([
		...(home.canManageScenes ? (home.suggested as RoutineIdea[]).map((t) => ({ key: `r-${t.key}`, name: t.name, blurb: t.blurb, summary: t.defaultSteps.length ? sentence(capitalize(stepsSentence(t.defaultSteps, words.nameOf))) : '', missing: t.missing ?? null, href: `/routines/new?template=${t.key}`, runs: 'Runs when you tap it' })) : []),
		...(canAuto ? behaviours.ideas.map((t) => ({ key: `a-${t.key}`, name: t.name, blurb: t.blurb, summary: t.actions.length ? automationDoes(t) : '', missing: t.missing ?? null, href: `/automations/new?template=${t.key}`, runs: 'Runs on its own' })) : [])
	]);
</script>

<Page title="Routines" subtitle="Everything your home can do for you. Run something now, or let it happen on its own." width="lg">
	{#snippet actions()}{#if canMake}<Button href="/routines/new"><Plus />New</Button>{/if}{/snippet}

	{#if loaded && runCount + autoCount > 0 && canAuto}<Segmented {options} bind:value={show} label="Show" />{/if}
	{#if behaviours.error}<p role="alert" class="text-sm text-signal">{behaviours.error}</p>{/if}

	{#if !loaded}<SkeletonList kind="rows" count={4} />{/if}
	{#if loaded && runCount + autoCount === 0}
		<div class="rounded-3xl bg-secondary/60 px-6 py-8">
			<span class="flex size-11 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Sparkles class="size-5" /></span>
			<h2 class="mt-4 text-xl font-semibold tracking-[-0.02em]">Nothing set up yet</h2>
			<p class="mt-1.5 max-w-[56ch] text-[0.9375rem] leading-relaxed text-muted-foreground">This is where your home’s habits live: “Good night” to switch things off and set the house to Night, “Leaving home” to lock up, or lights that come on at sunset. You can run them with a tap, or let them run on their own at a time you choose. {canMake ? 'It is empty because nothing has been made yet. Start from one of the ideas below, or build your own.' : 'It is empty because nothing has been made yet. Ask someone who manages the home to set some up.'}</p>
			{#if canMake}<div class="mt-4"><Button href="/routines/new"><Plus />Build your own</Button></div>{/if}
		</div>
	{:else if loaded}
		{#if show !== 'auto' && runCount > 0}
			<Section title="Run now" hint={`${plural(runCount, 'thing')} you can start with a tap.`}><Group><ScenesPanel /><RoutinesPanel /></Group></Section>
		{/if}
		{#if canAuto && show !== 'run'}
			<Section title="Automatic" hint="These run on their own, on your home hub.">
				{#if autoCount}<Group><AutomationsPanel /></Group>
				{:else}<p class="rounded-2xl bg-secondary/60 px-4 py-4 text-sm text-muted-foreground">Nothing runs on its own yet. Start one from an idea below, for example lights that come on at sunset.</p>{/if}
			</Section>
		{/if}
	{/if}

	{#if loaded && ideas.length}
		<Section title="Ideas to start from" hint="Nothing happens until you check the details and save.">
			<div class="grid gap-3 sm:grid-cols-2">
				{#each ideas as t (t.key)}
					<div class="flex flex-col gap-2 rounded-tile bg-secondary/60 p-4">
						<h3 class="font-semibold tracking-[-0.015em]">{t.name}</h3>
						<p class="text-sm text-muted-foreground">{t.blurb}</p>
						{#if t.summary}<p class="flex-1 text-sm leading-snug"><span class="font-medium">It would: </span>{t.summary}</p>{:else}<span class="flex-1"></span>{/if}
						<p class="text-xs text-muted-foreground">{t.runs}</p>
						{#if t.missing}<p class="flex items-start gap-1.5 text-sm text-signal-foreground"><TriangleAlert class="mt-0.5 size-4 shrink-0" />{t.missing}</p>{/if}
						<div><Button size="sm" variant="secondary" href={t.href}>Set up</Button></div>
					</div>
				{/each}
			</div>
		</Section>
	{/if}
</Page>
