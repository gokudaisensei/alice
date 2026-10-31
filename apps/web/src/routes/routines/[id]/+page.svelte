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
	import Page from '#lib/components/app/Page.svelte';
	import Section from '#lib/components/app/Section.svelte';

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
		goto('/routines?tab=routines');
	}
	async function remove() {
		if (!confirm(`Delete “${name}”?`)) return;
		const r = await api('DELETE', `/api/routines/${id}`);
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		await home.load();
		goto('/routines?tab=routines');
	}
</script>

<Page title={id === 'new' ? 'Set up a routine' : 'Edit routine'} subtitle="Steps run in order when you start the routine. It never runs by itself." back={{ href: '/routines?tab=routines', label: 'Routines' }} width="md">
	<div class="space-y-1.5"><Label for="n">Name</Label><Input id="n" bind:value={name} maxlength={60} placeholder="e.g. Good night" /></div>
	<Section title="Steps"><StepsEditor bind:steps failed={failedStep} /></Section>

	{#if steps.length}
		<div class="rounded-2xl bg-secondary p-4"><h2 class="heading mb-1.5">In plain words</h2>
			<ol class="space-y-0.5 text-sm text-muted-foreground">{#each steps as s, i}<li>{i + 1}. {stepText(s, nameOf, s.type === 'device' ? optsOf(s.entityId) : undefined)}</li>{/each}</ol></div>
	{/if}

	{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
	<div class="flex gap-2">
		<Button onclick={save} disabled={saving || !name.trim() || !steps.length}>{saving ? 'Saving…' : 'Save routine'}</Button>
		{#if id !== 'new'}<Button variant="destructive" onclick={remove}>Delete</Button>{/if}
	</div>
</Page>
