<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox';
	import { haptics } from '#lib/haptics.js';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import Page from '#lib/components/app/Page.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';

	const id = $derived(decodeURIComponent(page.params.id ?? 'new'));
	const existing = $derived(id === 'new' ? undefined : home.scenes.find((s) => s.id === id));
	let name = $state('');
	let picked = $state<string[]>([]);
	let error = $state('');
	let saving = $state(false);
	let seeded = false;

	// Only the device types a scene can restore reliably are offered.
	const choices = $derived(home.devices.filter((d) => ['light', 'switch', 'fan'].includes(d.category)));
	$effect(() => { if (!seeded && home.loaded) { seeded = true; if (existing) { name = existing.name; picked = [...existing.deviceIds]; } } });

	async function save() {
		saving = true; error = '';
		const body = { name: name.trim(), entityIds: picked };
		const r = id === 'new' ? await api('POST', '/api/scenes', body) : await api('PUT', `/api/scenes/${encodeURIComponent(id)}`, body);
		saving = false;
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		await home.load();
		goto('/routines?tab=scenes');
	}
	async function remove() {
		if (!confirm(`Delete “${name}”? This can’t be undone.`)) return;
		const r = await api('DELETE', `/api/scenes/${encodeURIComponent(id)}`);
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		await home.load();
		goto('/routines?tab=scenes');
	}
</script>

<Page title={id === 'new' ? 'New scene' : 'Edit scene'} subtitle="Set your devices the way you want them, tick them below, and save. The scene remembers how each one is right now." back={{ href: '/routines?tab=scenes', label: 'Routines' }} width="md">
	<div class="space-y-1.5"><Label for="n">Name</Label><Input id="n" bind:value={name} maxlength={60} placeholder="e.g. Movie night" /></div>
	<Section title="Devices">
		<Group>
			{#each choices as d (d.id)}
				<button type="button" role="checkbox" aria-checked={picked.includes(d.id)} disabled={!d.available} onclick={() => { haptics.tap(); picked = picked.includes(d.id) ? picked.filter((x) => x !== d.id) : [...picked, d.id]; }} class="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left transition-colors active:bg-muted disabled:opacity-50">
					<Checkbox checked={picked.includes(d.id)} />
					<span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{d.name}</span><span class="text-sm text-muted-foreground">{d.available ? (d.state === 'on' ? 'On now' : 'Off now') : 'Offline'}</span></span>
				</button>
			{:else}<p class="p-4 text-sm text-muted-foreground">No lights, switches or fans are available.</p>{/each}
		</Group>
	</Section>
	{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
	<div class="flex gap-2">
		<Button onclick={save} disabled={saving || !name.trim() || !picked.length}>{saving ? 'Saving…' : id === 'new' ? 'Save scene' : 'Save current state'}</Button>
		{#if id !== 'new'}<Button variant="destructive" onclick={remove}>Delete</Button>{/if}
	</div>
</Page>
