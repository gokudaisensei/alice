<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api, explain, reauth } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';

	const uid = $derived(page.params.id);
	let roleDefault = $state<'all' | 'none'>('all');
	let overrides = $state<Record<string, boolean>>({});
	let all = $state<{ id: string; name: string }[]>([]);
	let error = $state('');

	onMount(async () => {
		const [a, d, x] = await Promise.all([api('GET', `/api/admin/users/${uid}/devices`), api('GET', '/api/admin/devices'), api('GET', '/api/admin/actions')]);
		if (!a.ok || !d.ok || !x.ok) { error = explain((a.ok ? d : a).data?.error); return; }
		roleDefault = a.data.roleDefault;
		overrides = Object.fromEntries(a.data.overrides.map((o: any) => [o.id, !!o.allowed]));
		all = [
			...d.data.devices.filter((y: any) => y.ordinary).map((y: any) => ({ id: y.id, name: y.name })),
			...x.data.scenes.map((y: any) => ({ id: y.id, name: `Scene: ${y.name}` })),
			...x.data.routines.map((y: any) => ({ id: y.id, name: `Routine: ${y.name}` }))
		];
	});
	const allowed = (id: string) => overrides[id] ?? roleDefault === 'all';

	async function toggle(id: string) {
		const want = !allowed(id);
		const body = want ? { allow: [id] } : { deny: [id] };
		let r = await api('PUT', `/api/admin/users/${uid}/devices`, body);
		if (r.status === 401 && r.data?.error === 'reauth_required' && (await reauth())) r = await api('PUT', `/api/admin/users/${uid}/devices`, body);
		if (r.ok) overrides[id] = want; else home.say('error', explain(r.data?.error));
	}
</script>

<main class="mx-auto max-w-2xl space-y-4 p-4">
	<a href="/admin/users" class="text-sm text-muted-foreground underline">← People</a>
	<h1 class="text-2xl font-semibold">Device, scene & routine access</h1>
	<p class="text-sm text-muted-foreground">{roleDefault === 'none' ? 'Guests can only use the devices you tick below.' : 'This person can use every device unless you untick it.'}</p>
	{#if error}<p role="alert" class="text-destructive">{error}</p>{/if}
	<Card.Root><Card.Content class="divide-y p-0">
		{#each all as d (d.id)}
			<label class="flex items-center justify-between p-4"><span>{d.name}</span>
				<input type="checkbox" class="size-5" checked={allowed(d.id)} onchange={() => toggle(d.id)} aria-label="Allow {d.name}" /></label>
		{/each}
	</Card.Content></Card.Root>
</main>
