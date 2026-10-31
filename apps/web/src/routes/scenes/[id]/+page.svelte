<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import * as Card from '#lib/components/ui/card';

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
		goto('/scenes');
	}
	async function remove() {
		if (!confirm(`Delete “${name}”? This can’t be undone.`)) return;
		const r = await api('DELETE', `/api/scenes/${encodeURIComponent(id)}`);
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		await home.load();
		goto('/scenes');
	}
</script>

<main class="mx-auto max-w-2xl space-y-4 p-4">
	<a href="/scenes" class="text-sm text-muted-foreground underline">← Scenes & routines</a>
	<h1 class="text-2xl font-semibold">{id === 'new' ? 'New scene' : 'Edit scene'}</h1>
	<p class="text-sm text-muted-foreground">Set your devices up the way you want them, tick them below, and save. The scene remembers how each one is <em>right now</em>{id !== 'new' ? ' (saving again updates it)' : ''}.</p>
	<div class="space-y-1"><Label for="n">Name</Label><Input id="n" bind:value={name} maxlength={60} placeholder="e.g. Movie night" /></div>
	<Card.Root><Card.Content class="divide-y p-0">
		{#each choices as d (d.id)}
			<label class="flex items-center justify-between p-4 {d.available ? '' : 'opacity-50'}">
				<span>{d.name} <span class="text-sm text-muted-foreground">· {d.available ? (d.state === 'on' ? 'on now' : 'off now') : 'offline'}</span></span>
				<input type="checkbox" class="size-5" bind:group={picked} value={d.id} disabled={!d.available} />
			</label>
		{:else}<p class="p-4 text-sm text-muted-foreground">No lights, switches or fans are available.</p>{/each}
	</Card.Content></Card.Root>
	{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
	<div class="flex gap-2">
		<Button onclick={save} disabled={saving || !name.trim() || !picked.length}>{saving ? 'Saving…' : id === 'new' ? 'Save scene' : 'Save current state'}</Button>
		{#if id !== 'new'}<Button variant="outline" onclick={remove}>Delete</Button>{/if}
	</div>
</main>
