<script lang="ts">
	import { KIND_SINGULAR } from '#lib/kinds.js';
	import { onMount } from 'svelte';
	import { api, explain, sensitive } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { plural } from '#lib/fmt.js';
	import Page from '#lib/components/app/Page.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import SkeletonList from '#lib/components/app/SkeletonList.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import AssistSafety from '#lib/components/app/AssistSafety.svelte';
	import { Switch } from '#lib/components/ui/switch';
	import { Mic, TriangleAlert } from '@lucide/svelte';

	type Item = { id: string; name: string; kind: 'device' | 'scene' | 'routine'; enabled: boolean };
	let items = $state<Item[]>([]), cloud = $state<{ loggedIn: boolean } | null | undefined>(undefined), loaded = $state(false), msg = $state(''), busy = $state<Record<string, boolean>>({});
	async function load() { const r = await api<{ items: Item[]; cloud: { loggedIn: boolean } | null }>('GET', '/api/admin/voice'); if (r.ok) { items = r.data.items; cloud = r.data.cloud; } loaded = true; }
	onMount(load);
	async function set(i: Item, enabled: boolean) {
		busy[i.id] = true; msg = '';
		const r = await sensitive('PUT', '/api/admin/voice', { entityId: i.id, enabled });
		busy[i.id] = false;
		if (!r.ok) msg = r.data?.message ?? explain(r.data?.error);
		await load();
	}
	const CAT: Record<string, string> = { ...KIND_SINGULAR, light: 'Light', switch: 'Switch or plug', fan: 'Fan', climate: 'Heating or cooling', media: 'Media player' };
	/** "Light · Kitchen", "Scene", "Routine": what it is, and where it lives. */
	function about(i: Item) {
		if (i.kind !== 'device') return i.kind === 'scene' ? 'Scene: sets several things at once' : 'Routine: runs a set of steps';
		const d = home.byId(i.id);
		const room = d?.roomId ? home.rooms.find((r) => r.id === d.roomId)?.name : null;
		return `${CAT[d?.category ?? ''] ?? 'Device'} · ${room ?? 'No room'}`;
	}
	const linked = $derived(cloud?.loggedIn === true);
	const blocked = $derived(cloud !== undefined && !linked);
	const on = $derived(items.filter((i) => i.enabled).length);
</script>

<Page title="Voice control" subtitle="Choose what Alexa and Google Assistant may control. Nothing is on until you turn it on." width="md">
	<AssistSafety />
	{#if blocked}
		<div role="status" class="flex gap-3 rounded-2xl bg-signal-soft p-4 text-sm text-signal-foreground">
			<TriangleAlert class="mt-0.5 size-5 shrink-0" />
			<div><p class="font-semibold">{cloud === null ? 'Couldn’t check Home Assistant Cloud' : 'Home Assistant Cloud isn’t linked yet'}</p><p class="mt-0.5">{cloud === null ? 'Try again in a moment. Nothing can be turned on for voice until the link is confirmed.' : 'Voice control needs a Home Assistant Cloud subscription linked to this home. Our support team can set that up. Until then nothing can be turned on for voice.'}</p></div>
		</div>
	{:else if cloud}
		<p class="text-sm text-muted-foreground">{plural(on, 'item')} available to voice.</p>
	{/if}
	<details class="rounded-2xl bg-secondary/60 px-4 py-3 text-sm leading-relaxed">
		<summary class="cursor-pointer font-medium">Good to know before you turn things on</summary>
		<div class="mt-2 space-y-1.5">
			<p>Voice commands run on your home hub and don’t check who is speaking, so they aren’t recorded against a person. Only turn on things where that is fine.</p>
			<p class="text-muted-foreground">Doors, locks and cameras can’t be turned on for voice. Voice needs the internet: if it’s down, voice stops, but the app and your automations keep working.</p>
		</div>
	</details>
	{#if msg}<p role="alert" class="text-sm text-signal">{msg}</p>{/if}
	{#if !loaded}<SkeletonList kind="rows" count={5} />
	{:else if blocked}
		<p class="text-sm text-muted-foreground">Once Home Assistant Cloud is linked, your lights, plugs and scenes will be listed here to choose from.</p>
	{:else if items.length}
		<Group>
			{#each items as i (i.id)}
				<label class="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors {blocked ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-muted/60'}"><span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{i.name}</span><span class="text-sm text-muted-foreground">{about(i)}</span></span>
					<Switch checked={i.enabled} disabled={blocked || !!busy[i.id]} onCheckedChange={(v) => set(i, v)} aria-label="Voice control for {i.name}" /></label>
			{/each}
		</Group>
	{:else if cloud !== undefined}
		<Empty icon={Mic} title="Nothing to choose from yet" description="Lights, plugs, fans, scenes and routines show up here once they are set up, so you can let Alexa or Google Assistant use them." action="Set up rooms and devices" href="/admin/rooms" />
	{/if}
</Page>
