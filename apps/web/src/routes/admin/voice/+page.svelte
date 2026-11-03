<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain, sensitive } from '#lib/api.js';
	import Page from '#lib/components/app/Page.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import { Switch } from '#lib/components/ui/switch';

	type Item = { id: string; name: string; kind: 'device' | 'scene' | 'routine'; enabled: boolean };
	let items = $state<Item[]>([]), cloud = $state<{ loggedIn: boolean } | null | undefined>(undefined), msg = $state(''), busy = $state<Record<string, boolean>>({});
	async function load() { const r = await api<{ items: Item[]; cloud: { loggedIn: boolean } | null }>('GET', '/api/admin/voice'); if (r.ok) { items = r.data.items; cloud = r.data.cloud; } }
	onMount(load);
	async function set(i: Item, enabled: boolean) {
		busy[i.id] = true; msg = '';
		const r = await sensitive('PUT', '/api/admin/voice', { entityId: i.id, enabled });
		busy[i.id] = false;
		if (!r.ok) msg = r.data?.message ?? explain(r.data?.error);
		await load();
	}
	const KIND = { device: 'Device', scene: 'Scene', routine: 'Routine' } as const;
</script>

<Page title="Voice control" subtitle="Choose what Alexa and Google Assistant may control. Nothing is on until you turn it on. Doors, locks and cameras can't be turned on for voice." width="md">
	<div class="space-y-1.5 rounded-2xl bg-secondary p-4 text-sm leading-relaxed">
		<p><span class="font-semibold">Good to know.</span> Voice commands go through Home Assistant Cloud and run on your home hub, so they don't check who is speaking and aren't recorded against a person. Only turn on things where that's fine.</p>
		<p class="text-muted-foreground">Voice needs the internet. If it's down, voice stops; the app and your automations keep working.</p>
		{#if cloud === null}<p class="text-signal">Couldn't check the Home Assistant Cloud link.</p>{:else if cloud && !cloud.loggedIn}<p class="text-signal">Home Assistant Cloud isn't linked on this home yet. Our support team sets that up.</p>{/if}
	</div>
	{#if msg}<p role="alert" class="text-sm text-signal">{msg}</p>{/if}
	<Group>
		{#each items as i (i.id)}
			<label class="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/60"><span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{i.name}</span><span class="text-sm text-muted-foreground">{KIND[i.kind]}</span></span>
				<Switch checked={i.enabled} disabled={!!busy[i.id]} onCheckedChange={(v) => set(i, v)} aria-label="Voice control for {i.name}" /></label>
		{:else}<p class="p-4 text-sm text-muted-foreground">Nothing to choose from yet.</p>{/each}
	</Group>
</Page>
