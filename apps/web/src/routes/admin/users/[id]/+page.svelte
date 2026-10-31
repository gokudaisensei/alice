<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { api, explain, sensitive } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import Page from '#lib/components/app/Page.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import { Switch } from '#lib/components/ui/switch';

	const uid = $derived(page.params.id);
	let roleDefault = $state<'all' | 'none'>('all');
	let overrides = $state<Record<string, boolean>>({});
	let all = $state<{ id: string; name: string; kind: string }[]>([]);
	let error = $state('');

	onMount(async () => {
		const [a, d, x] = await Promise.all([api('GET', `/api/admin/users/${uid}/devices`), api('GET', '/api/admin/devices'), api('GET', '/api/admin/actions')]);
		if (!a.ok || !d.ok || !x.ok) { error = explain((a.ok ? d : a).data?.error); return; }
		roleDefault = a.data.roleDefault;
		overrides = Object.fromEntries(a.data.overrides.map((o: any) => [o.id, !!o.allowed]));
		all = [
			...d.data.devices.filter((y: any) => y.ordinary).map((y: any) => ({ id: y.id, name: y.name, kind: 'Device' })),
			...x.data.scenes.map((y: any) => ({ id: y.id, name: y.name, kind: 'Scene' })),
			...x.data.routines.map((y: any) => ({ id: y.id, name: y.name, kind: 'Routine' }))
		];
	});
	const allowed = (id: string) => overrides[id] ?? roleDefault === 'all';

	async function toggle(id: string) {
		const want = !allowed(id);
		const r = await sensitive('PUT', `/api/admin/users/${uid}/devices`, want ? { allow: [id] } : { deny: [id] });
		if (r.ok) overrides[id] = want; else home.say('error', explain(r.data?.error));
	}
</script>

<Page title="What they can use" subtitle={roleDefault === 'none' ? 'Guests can only use what you switch on below.' : 'This person can use everything unless you switch it off.'} back={{ href: '/admin/users', label: 'People' }} width="md">
	{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
	<Group>
		{#each all as d (d.id)}
			<label class="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"><span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{d.name}</span><span class="text-sm text-muted-foreground">{d.kind}</span></span>
				<Switch checked={allowed(d.id)} onCheckedChange={() => toggle(d.id)} aria-label="Allow {d.name}" /></label>
		{/each}
	</Group>
</Page>
