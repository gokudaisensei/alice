<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { actionsFor, stepText, type Step } from '#lib/steps.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import StepsEditor from '#lib/components/app/StepsEditor.svelte';
	import { Label } from '#lib/components/ui/label';
	import * as Card from '#lib/components/ui/card';

	const id = $derived(page.params.id ?? 'new');
	const templateKey = $derived(page.url.searchParams.get('template'));
	let name = $state('');
	let steps = $state<Step[]>([]);
	let error = $state('');
	let saving = $state(false);
	let failedStep = $state<number | null>(null);
	let seeded = false;

	const nameOf = (eid: string) => home.byId(eid)?.name ?? home.scenes.find((s) => s.id === eid)?.name ?? 'an unavailable device';
	const optsOf = (eid: string) => { const d = home.byId(eid); return d ? actionsFor(d) : []; };

	$effect(() => {
		if (seeded || !home.loaded) return;
		seeded = true;
		if (id === 'new') {
			const t = home.suggested.find((x) => x.key === templateKey);
			name = t?.name ?? ''; steps = t ? (t.defaultSteps as Step[]).map((s) => ({ ...s })) : [];
		} else {
			const r = home.routines.find((x) => x.id === id);
			if (r) { name = r.name; steps = r.steps.map(({ text, ...s }) => s as Step); }
		}
	});

	async function save() {
		saving = true; error = ''; failedStep = null;
		const body = { name: name.trim(), steps, ...(id === 'new' && templateKey ? { template: templateKey } : {}) };
		const r = id === 'new' ? await api('POST', '/api/routines', body) : await api('PUT', `/api/routines/${id}`, body);
		saving = false;
		if (!r.ok) { failedStep = r.data?.step ?? null; error = `${r.data?.step != null ? `Step ${r.data.step + 1}: ` : ''}${r.data?.message ?? explain(r.data?.error)}`; return; }
		await home.load();
		goto('/scenes');
	}
	async function remove() {
		if (!confirm(`Delete “${name}”?`)) return;
		const r = await api('DELETE', `/api/routines/${id}`);
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		await home.load();
		goto('/scenes');
	}
</script>

<main class="mx-auto max-w-2xl space-y-4 p-4">
	<a href="/scenes" class="text-sm text-muted-foreground underline">← Scenes & routines</a>
	<h1 class="text-2xl font-semibold">{id === 'new' ? 'Set up a routine' : 'Edit routine'}</h1>
	<p class="text-sm text-muted-foreground">Steps run in order when you start the routine. It only runs when you start it.</p>

	<div class="space-y-1"><Label for="n">Name</Label><Input id="n" bind:value={name} maxlength={60} placeholder="e.g. Good Night" /></div>

	<StepsEditor bind:steps failed={failedStep} />

	{#if steps.length}
		<Card.Root class="gap-0 py-0"><div class="p-4"><h2 class="mb-1 text-sm font-medium">What this routine will do</h2>
			<ol class="list-inside list-decimal space-y-0.5 text-sm text-muted-foreground">{#each steps as s}<li>{stepText(s, nameOf, s.type === 'device' ? optsOf(s.entityId) : undefined)}</li>{/each}</ol></div></Card.Root>
	{/if}

	{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
	<div class="flex gap-2">
		<Button onclick={save} disabled={saving || !name.trim() || !steps.length}>{saving ? 'Saving…' : 'Save routine'}</Button>
		{#if id !== 'new'}<Button variant="outline" onclick={remove}>Delete</Button>{/if}
	</div>
</main>
