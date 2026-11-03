<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { actionsFor, stepsSentence, type Step } from '#lib/steps.js';
	import { behaviours, words } from '#lib/behaviours.svelte.js';
	import type { RoutineIdea } from '#lib/automations.js';
	import StepsEditor from '#lib/components/app/StepsEditor.svelte';
	import Page from '#lib/components/app/Page.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import PlainWords from '#lib/components/app/builder/PlainWords.svelte';
	import BuilderBar from '#lib/components/app/builder/BuilderBar.svelte';
	import DeleteRow from '#lib/components/app/builder/DeleteRow.svelte';
	import NameField from '#lib/components/app/builder/NameField.svelte';
	import NewChooser from '#lib/components/app/builder/NewChooser.svelte';
	import { onMount } from 'svelte';

	const id = $derived(page.params.id ?? 'new');
	const templateKey = $derived(page.url.searchParams.get('template'));
	// /routines/new on its own asks how the new thing should run; a template or an answer goes straight to the builder.
	const choosing = $derived(id === 'new' && !templateKey && !page.url.searchParams.get('how'));
	let name = $state('');
	let steps = $state<Step[]>([]);
	let error = $state(''), notice = $state('');
	let saving = $state(false), trying = $state(false);
	let failedStep = $state<number | null>(null);
	let note = $state<string | null>(null);
	let seeded = false;

	const optsOf = (eid: string) => { const d = home.byId(eid); return d ? actionsFor(d) : []; };
	const said = $derived(steps.length ? `When you tap Run, ${stepsSentence(steps, words.nameOf, optsOf)}.` : 'Choose what this routine should do and it will be written out here.');

	onMount(() => { if (!behaviours.loaded) behaviours.load(); });
	$effect(() => {
		if (seeded || choosing || !home.loaded) return;
		seeded = true;
		if (id === 'new') {
			const t = (home.suggested as RoutineIdea[]).find((x) => x.key === templateKey);
			name = t?.name ?? ''; steps = t ? (t.defaultSteps as Step[]).map((s) => ({ ...s })) : [];
			note = t?.missing ?? null;
		} else {
			const r = home.routines.find((x) => x.id === id);
			if (r) { name = r.name; steps = r.steps.map(({ text, ...s }) => s as Step); }
		}
	});

	/** Save as it stands. Returns the routine's id, or null after saying what went wrong. */
	async function persist(): Promise<string | null> {
		error = ''; failedStep = null; notice = '';
		const body = { name: name.trim(), steps, ...(id === 'new' && templateKey ? { template: templateKey } : {}) };
		const r = id === 'new' ? await api<{ id: string }>('POST', '/api/routines', body) : await api('PUT', `/api/routines/${id}`, body);
		if (!r.ok) { failedStep = r.data?.step ?? null; error = `${r.data?.step != null ? `Step ${r.data.step + 1}: ` : ''}${r.data?.message ?? explain(r.data?.error)}`; return null; }
		return id === 'new' ? (r.data as { id: string }).id : id;
	}
	async function save() {
		saving = true;
		const rid = await persist();
		saving = false;
		if (!rid) return;
		await home.load();
		goto('/routines');
	}
	// A draft can't run until it exists, so trying it saves it first and then runs it once.
	async function tryIt() {
		trying = true;
		const rid = await persist();
		if (!rid) { trying = false; return; }
		await home.load();
		if (id === 'new') await goto(`/routines/${rid}`, { replaceState: true });
		const r = await api('POST', `/api/routines/${rid}/run`);
		trying = false;
		if (r.ok) notice = 'Saved, and started once. You can keep editing.'; else error = r.data?.message ?? explain(r.data?.error);
	}
	async function remove() {
		const r = await api('DELETE', `/api/routines/${id}`);
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		await home.load();
		goto('/routines');
	}
</script>

{#if choosing}
	<Page title="Make something new" subtitle="Answer two questions and we will open the right builder." back={{ href: '/routines', label: 'Routines' }} width="md"><NewChooser /></Page>
{:else}
	<Page title={id === 'new' ? 'New routine' : 'Edit routine'} subtitle="A list of things to do, in order, whenever you tap Run." back={{ href: '/routines', label: 'Routines' }} width="md">
		<PlainWords text={said} {note} />
		<NameField bind:value={name} placeholder="e.g. Good night" self={id === 'new' ? undefined : { kind: 'routine', id }} />
		<Section title="What it does"><StepsEditor bind:steps failed={failedStep} /></Section>
		{#if id !== 'new'}<DeleteRow what="routine" ondelete={remove} />{/if}
		<BuilderBar saveLabel={id === 'new' ? 'Save routine' : 'Save changes'} {saving} {trying} canSave={!!name.trim() && steps.length > 0} onsave={save} cancelHref="/routines" onTry={tryIt} canTry={!!name.trim() && steps.length > 0}
			tryNote="Saves your changes, then runs it once." {error} hint={notice || (!name.trim() ? 'Give it a name to save it.' : !steps.length ? 'Add at least one thing for it to do.' : '')} />
	</Page>
{/if}
