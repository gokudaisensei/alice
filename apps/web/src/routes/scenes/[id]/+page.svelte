<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox';
	import { haptics } from '#lib/haptics.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { behaviours } from '#lib/behaviours.svelte.js';
	import { joinNames } from '#lib/steps.js';
	import Page from '#lib/components/app/Page.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import PlainWords from '#lib/components/app/builder/PlainWords.svelte';
	import BuilderBar from '#lib/components/app/builder/BuilderBar.svelte';
	import DeleteRow from '#lib/components/app/builder/DeleteRow.svelte';
	import NameField from '#lib/components/app/builder/NameField.svelte';

	const id = $derived(decodeURIComponent(page.params.id ?? 'new'));
	const existing = $derived(id === 'new' ? undefined : home.scenes.find((s) => s.id === id));
	let name = $state('');
	let picked = $state<string[]>([]);
	let error = $state(''), notice = $state('');
	let saving = $state(false), trying = $state(false);
	let seeded = false;

	// Only the device types a scene can restore reliably are offered.
	const choices = $derived(home.devices.filter((d) => ['light', 'switch', 'fan'].includes(d.category)));
	$effect(() => { if (!seeded && home.loaded) { seeded = true; if (existing) { name = existing.name; picked = [...existing.deviceIds]; } } });
	onMount(() => { if (!behaviours.loaded) behaviours.load(); });

	const stateOf = (d: { name: string; state: string }) => `${d.name} ${d.state === 'on' ? 'on' : 'off'}`;
	const said = $derived(picked.length
		? `When you tap Run, ${joinNames(picked.map((p) => home.byId(p)).filter((d) => !!d).map((d) => stateOf(d)))}, just as they are right now.`
		: 'Tick the devices below and it will be written out here.');

	async function save() {
		saving = true; error = ''; notice = '';
		const body = { name: name.trim(), entityIds: picked };
		const r = id === 'new' ? await api('POST', '/api/scenes', body) : await api('PUT', `/api/scenes/${encodeURIComponent(id)}`, body);
		saving = false;
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		await home.load();
		goto('/routines');
	}
	// A scene runs what was saved. A new one has to be saved before it can be tried.
	async function tryIt() {
		trying = true; error = ''; notice = '';
		const r = await api('POST', `/api/scenes/${encodeURIComponent(id)}/activate`);
		trying = false;
		if (r.ok) notice = 'Started the saved version of this scene.'; else error = r.data?.message ?? explain(r.data?.error);
	}
	async function remove() {
		const r = await api('DELETE', `/api/scenes/${encodeURIComponent(id)}`);
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		await home.load();
		goto('/routines');
	}
</script>

<Page title={id === 'new' ? 'New scene' : 'Edit scene'} subtitle="Set your devices the way you want them, tick them below, and save. The scene remembers how each one is right now." back={{ href: '/routines', label: 'Routines' }} width="md">
	<PlainWords text={said} />
	<NameField bind:value={name} placeholder="e.g. Movie night" self={id === 'new' ? undefined : { kind: 'scene', id }} />
	<Section title="Devices to include">
		<Group>
			{#each choices as d (d.id)}
				<button type="button" role="checkbox" aria-checked={picked.includes(d.id)} disabled={!d.available} onclick={() => { haptics.tap(); picked = picked.includes(d.id) ? picked.filter((x) => x !== d.id) : [...picked, d.id]; }} class="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted disabled:opacity-50 {picked.includes(d.id) ? 'bg-primary/10' : ''}">
					<Checkbox checked={picked.includes(d.id)} />
					<span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{d.name}</span><span class="text-sm text-muted-foreground">{d.available ? (d.state === 'on' ? 'On now' : 'Off now') : 'Offline'}</span></span>
				</button>
			{:else}<p class="p-4 text-sm text-muted-foreground">No lights, plugs or fans are available.</p>{/each}
		</Group>
	</Section>
	{#if id !== 'new'}<DeleteRow what="scene" ondelete={remove} />{/if}
	<BuilderBar saveLabel={id === 'new' ? 'Save scene' : 'Save current state'} {saving} {trying} canSave={!!name.trim() && picked.length > 0} onsave={save} cancelHref="/routines"
		onTry={tryIt} canTry={id !== 'new'} tryNote="Runs the saved scene once. Save first to include your changes." {error} hint={notice || (!name.trim() ? 'Give it a name to save it.' : !picked.length ? 'Tick at least one device.' : id === 'new' ? 'Save it first, then you can try it.' : '')} />
</Page>
