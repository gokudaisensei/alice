<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	import type { Component } from 'svelte';
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { behaviours } from '#lib/behaviours.svelte.js';
	import type { RoutineIdea } from '#lib/automations.js';
	import { Button } from '#lib/components/ui/button';
	import { Check, Clock, Hand, ListOrdered, SlidersHorizontal, Zap } from '@lucide/svelte';

	onMount(() => { if (!behaviours.loaded) behaviours.load(); });

	type How = 'demand' | 'time' | 'event';
	type What = 'scene' | 'steps';
	let how = $state<How>('demand'), what = $state<What>('steps');

	const canAuto = $derived(session.can('automation.manage'));
	const canMake = $derived(home.canManageScenes);
	const auto = $derived(how !== 'demand');
	const noScenes = $derived(auto && what === 'scene' && !home.scenes.length);

	const HOW: { id: How; title: string; desc: string; icon: Component<{ class?: string }>; needsAuto?: boolean }[] = [
		{ id: 'demand', title: 'When I ask', desc: 'You tap Run when you want it.', icon: Hand },
		{ id: 'time', title: 'At a set time', desc: 'Every day, on weekdays, at weekends or on days you pick.', icon: Clock, needsAuto: true },
		{ id: 'event', title: 'When something happens', desc: 'A door opens, the sun sets, the house is set to Away.', icon: Zap, needsAuto: true }
	];
	const WHAT: { id: What; title: string; desc: string; icon: Component<{ class?: string }> }[] = [
		{ id: 'steps', title: 'A list of things, in order', desc: 'Turn things off, set the house mode, wait, and more.', icon: ListOrdered },
		{ id: 'scene', title: 'Devices set just so', desc: 'Remembers how your lights, plugs and fans are right now.', icon: SlidersHorizontal }
	];

	function next() {
		if (how === 'demand') return goto(what === 'scene' ? '/scenes/new' : '/routines/new?how=demand', { replaceState: true });
		return goto(`/automations/new?when=${how}${what === 'scene' ? '&scene=1' : ''}`, { replaceState: true });
	}
	const ideas = $derived([
		...(canMake ? (home.suggested as RoutineIdea[]).map((t) => ({ name: t.name, href: `/routines/new?template=${t.key}` })) : []),
		...(canAuto ? behaviours.ideas.map((t) => ({ name: t.name, href: `/automations/new?template=${t.key}` })) : [])
	]);
</script>

{#snippet card(sel: boolean, off: boolean, title: string, desc: string, Icon: Component<{ class?: string }>, pick: () => void, why: string)}
	<button type="button" role="radio" aria-checked={sel} disabled={off} onclick={pick} class="flex min-h-16 w-full items-center gap-3 rounded-2xl px-4 py-3 text-left transition-colors disabled:opacity-50 {sel ? 'bg-primary/10' : 'bg-secondary hover:bg-secondary/70'}">
		<span class="flex size-10 shrink-0 items-center justify-center rounded-xl {sel ? 'bg-primary text-primary-foreground' : 'bg-card text-muted-foreground'}"><Icon class="size-5" /></span>
		<span class="min-w-0 flex-1"><span class="block font-medium">{title}</span><span class="block text-sm leading-snug text-muted-foreground">{off ? why : desc}</span></span>
		{#if sel}<Check class="size-5 shrink-0 text-primary" />{/if}
	</button>
{/snippet}

<section class="space-y-3" aria-labelledby="how">
	<h2 id="how" class="heading">1. When should it happen?</h2>
	<div role="radiogroup" aria-labelledby="how" class="space-y-2">
		{#each HOW as o}{@render card(how === o.id, !!o.needsAuto && !canAuto, o.title, o.desc, o.icon, () => (how = o.id), 'Only people who manage automations can set this up.')}{/each}
	</div>
</section>

<section class="space-y-3" aria-labelledby="what">
	<h2 id="what" class="heading">2. What should it do?</h2>
	<div role="radiogroup" aria-labelledby="what" class="space-y-2">
		{#each WHAT as o}{@render card(what === o.id, false, o.title, o.desc, o.icon, () => (what = o.id), '')}{/each}
	</div>
	{#if auto && what === 'scene'}<p class="text-sm text-muted-foreground">{noScenes ? 'Automatic things can run a scene you already have. You have none yet, so choose “When I ask” first to make one, then come back.' : 'It will run a scene you already have, at the time or moment you choose.'}</p>{/if}
</section>

<div class="flex items-center gap-2"><Button variant="ghost" href="/routines">Cancel</Button><Button class="ml-auto" disabled={!canMake && how === 'demand' || noScenes} onclick={next}>Continue</Button></div>

{#if ideas.length}
	<section class="space-y-2 border-t pt-5" aria-labelledby="ideas">
		<h2 id="ideas" class="heading">Or start from an idea</h2>
		<div class="flex flex-wrap gap-2">{#each ideas as i}<Button size="sm" variant="secondary" href={i.href}>{i.name}</Button>{/each}</div>
	</section>
{/if}
