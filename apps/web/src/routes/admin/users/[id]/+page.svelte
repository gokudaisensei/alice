<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { ChevronDown, Search } from '@lucide/svelte';
	import { api, explain, sensitive } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import Page from '#lib/components/app/Page.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Collapse from '#lib/components/app/Collapse.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { Switch } from '#lib/components/ui/switch';
	import { Button } from '#lib/components/ui/button';

	type Item = { id: string; name: string; allowed: boolean };
	type Dev = Item & { category: string; roomId: string | null };
	type Data = {
		user: { id: string; name: string; role: 'admin' | 'member' | 'guest' }; roleDefault: 'all' | 'none'; tabs: string[];
		rooms: { id: string; name: string }[]; devices: Dev[]; scenes: Item[]; routines: Item[];
		automations: { id: string; name: string; visible: boolean; blockedBy: string[] }[];
		abilities: { id: string; on: boolean; byDefault: boolean }[];
	};
	const uid = $derived(page.params.id);
	let data = $state<Data | null>(null), error = $state(''), tab = $state('rooms'), q = $state(''), by = $state<'room' | 'type'>('room'), open = $state<Record<string, boolean>>({});

	async function load() {
		const r = await api('GET', `/api/admin/users/${uid}/access`);
		if (!r.ok) { error = explain(r.data?.error); return; }
		data = r.data; if (!data!.tabs.includes(tab)) tab = data!.tabs[0];
	}
	onMount(load);

	const LABEL: Record<string, string> = { rooms: 'Rooms', devices: 'Devices', scenes: 'Scenes', routines: 'Routines', automations: 'Automations', abilities: 'Abilities' };
	const TYPE: Record<string, string> = { light: 'Lights', switch: 'Switches and plugs', fan: 'Fans', climate: 'Climate', lock: 'Locks', camera: 'Cameras', media: 'Media players', sensor: 'Sensors', energy: 'Energy meters' };
	const ABILITY: Record<string, [string, string]> = {
		'device.control': ['Control devices', 'Switch, dim, lock and adjust the devices they can use'],
		'scene.activate': ['Run scenes and routines', 'Start the ones they can use'],
		'scenes.manage': ['Create scenes and routines', 'Make new ones and edit the ones they can use'],
		'automation.manage': ['Create automations', 'Set up rules that run by themselves'],
		'modes.set': ['Change the home mode', 'Switch between Home, Away and Night']
	};
	const guest = $derived(data?.user.role === 'guest');
	const count = (xs: Item[]) => xs.filter((x) => x.allowed).length;

	const roomOf = (id: string | null) => (id ? data!.rooms.find((r) => r.id === id)?.name ?? 'Other' : 'No room');
	const matches = (d: Dev) => !q.trim() || `${d.name} ${TYPE[d.category] ?? d.category} ${roomOf(d.roomId)}`.toLowerCase().includes(q.trim().toLowerCase());
	const sections = $derived.by(() => {
		if (!data) return [] as { key: string; title: string; items: Dev[] }[];
		const keys = by === 'room' ? [...data.rooms.map((r) => r.id), 'none'] : Object.keys(TYPE);
		return keys.map((k) => ({
			key: k, title: by === 'room' ? (k === 'none' ? 'No room' : data!.rooms.find((r) => r.id === k)!.name) : TYPE[k],
			items: data!.devices.filter((d) => (by === 'room' ? (d.roomId ?? 'none') === k : d.category === k) && matches(d))
		})).filter((s) => s.items.length);
	});
	const roomRows = $derived((data?.rooms ?? []).concat([{ id: 'none', name: 'No room' }]).map((r) => ({ ...r, items: data!.devices.filter((d) => (d.roomId ?? 'none') === r.id) })).filter((r) => r.items.length));

	/** One call for any number of items. The screen changes at once and goes back if the home says no. */
	async function setAllowed(items: Item[], want: boolean) {
		const todo = items.filter((i) => i.allowed !== want); if (!todo.length) return;
		for (const i of todo) i.allowed = want;
		for (let n = 0; n < todo.length; n += 200) {
			const ids = todo.slice(n, n + 200).map((i) => i.id);
			const r = await sensitive('PUT', `/api/admin/users/${uid}/devices`, want ? { allow: ids } : { deny: ids });
			if (!r.ok) { for (const i of todo) i.allowed = !want; home.say('error', explain(r.data?.error)); return; }
		}
		await load(); // automations depend on what was just changed
	}
	const toggleAll = (items: Item[]) => setAllowed(items, count(items) !== items.length);

	async function ability(a: { id: string; on: boolean; byDefault: boolean }) {
		const want = !a.on;
		const r = await sensitive('PUT', `/api/admin/users/${uid}/permissions`, { overrides: { [a.id]: want === a.byDefault ? null : want } });
		if (r.ok) a.on = want; else home.say('error', explain(r.data?.error));
	}
	const total = $derived(data ? { all: data.devices.length, on: count(data.devices) } : { all: 0, on: 0 });
	const badge = (t: string) => !data ? '' : t === 'rooms' ? `${roomRows.filter((r) => count(r.items) > 0).length}/${roomRows.length}` : t === 'devices' ? `${total.on}/${total.all}` : t === 'scenes' ? `${count(data.scenes)}/${data.scenes.length}` : t === 'routines' ? `${count(data.routines)}/${data.routines.length}` : t === 'automations' ? `${data.automations.filter((a) => a.visible).length}/${data.automations.length}` : '';
</script>

{#snippet bulk(items: Item[], noun: string)}
	<div class="flex items-center justify-between gap-3 px-1">
		<p class="text-sm text-muted-foreground">{count(items)} of {items.length} {noun} allowed</p>
		<div class="flex gap-1.5">
			<Button size="sm" variant="secondary" disabled={count(items) === items.length} onclick={() => setAllowed(items, true)}>Allow all</Button>
			<Button size="sm" variant="secondary" disabled={count(items) === 0} onclick={() => setAllowed(items, false)}>Allow none</Button>
		</div>
	</div>
{/snippet}

{#snippet row(i: Item, sub?: string)}
	<label class="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60 active:bg-muted">
		<span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{i.name}</span>{#if sub}<span class="block truncate text-sm text-muted-foreground">{sub}</span>{/if}</span>
		<Switch checked={i.allowed} onCheckedChange={(v) => setAllowed([i], v)} aria-label="Allow {i.name}" />
	</label>
{/snippet}

<Page title={data ? `${data.user.name}'s access` : 'Access'} subtitle={!data ? '' : guest ? 'A guest sees only what you switch on here.' : 'A member can use everything unless you switch it off here.'} back={{ href: '/admin/users', label: 'People' }} width="md">
	{#if error}<p role="alert" class="rounded-2xl bg-signal-soft px-4 py-3 text-sm text-signal-foreground">{error}</p>{/if}
	{#if data}
		<div class="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1" role="tablist" aria-label="What to manage">
			{#each data.tabs as t (t)}
				<button type="button" role="tab" aria-selected={tab === t} onclick={() => (tab = t)}
					class="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium transition-colors duration-200 active:scale-[0.97] {tab === t ? 'bg-primary/12 text-primary' : 'bg-secondary text-muted-foreground hover:text-foreground'}">
					{LABEL[t]}{#if badge(t)}<span class="text-xs opacity-70 tabular-nums">{badge(t)}</span>{/if}
				</button>
			{/each}
		</div>

		{#key tab}
		<div class="space-y-3 rise">
			{#if tab === 'rooms'}
				<p class="px-1 text-sm text-muted-foreground">Switching a room on or off changes every device in it. Fine-tune single devices under Devices.</p>
				<Group>
					{#each roomRows as r (r.id)}
						<label class="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60 active:bg-muted">
							<span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{r.name}</span>
								<span class="block text-sm text-muted-foreground">{count(r.items) === 0 ? 'None allowed' : count(r.items) === r.items.length ? `All ${r.items.length} devices` : `${count(r.items)} of ${r.items.length} devices`}</span></span>
							<Switch checked={count(r.items) === r.items.length} onCheckedChange={() => toggleAll(r.items)} aria-label="Allow all of {r.name}" />
						</label>
					{/each}
				</Group>

			{:else if tab === 'devices'}
				{@render bulk(data.devices, 'devices')}
				<div class="flex items-center gap-2">
					<div class="relative flex-1"><Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
						<input bind:value={q} placeholder="Search devices" aria-label="Search devices" class="h-10 w-full rounded-xl bg-secondary pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/40" /></div>
					<div class="flex rounded-xl bg-secondary p-0.5 text-sm font-medium">
						{#each [['room', 'Room'], ['type', 'Type']] as [k, l] (k)}<button type="button" onclick={() => (by = k as 'room' | 'type')} class="rounded-[10px] px-3 py-1.5 transition-colors {by === k ? 'bg-card shadow-sm' : 'text-muted-foreground'}">{l}</button>{/each}
					</div>
				</div>
				{#each sections as s (s.key)}
					{@const isOpen = !!q.trim() || !!open[by + s.key]}
					<div class="overflow-hidden rounded-2xl border bg-card">
						<div class="flex min-h-14 items-center gap-1 pr-4">
							<button type="button" class="flex min-w-0 flex-1 items-center gap-2 px-4 py-2.5 text-left" aria-expanded={isOpen} onclick={() => (open[by + s.key] = !open[by + s.key])}>
								<ChevronDown class="size-4 shrink-0 text-muted-foreground transition-transform duration-300 {isOpen ? '' : '-rotate-90'}" />
								<span class="min-w-0"><span class="block truncate text-[0.9375rem] font-medium">{s.title}</span><span class="block text-sm text-muted-foreground">{count(s.items)} of {s.items.length} allowed</span></span>
							</button>
							<Switch checked={count(s.items) === s.items.length} onCheckedChange={() => toggleAll(s.items)} aria-label="Allow all in {s.title}" />
						</div>
						<Collapse open={isOpen}><div class="divide-y divide-border border-t">{#each s.items as d (d.id)}{@render row(d, by === 'room' ? TYPE[d.category] : roomOf(d.roomId))}{/each}</div></Collapse>
					</div>
				{:else}<Empty title="No match" description="Try a different word." />{/each}

			{:else if tab === 'scenes' || tab === 'routines'}
				{@const list = tab === 'scenes' ? data.scenes : data.routines}
				{#if list.length}{@render bulk(list, tab)}<Group>{#each list as i (i.id)}{@render row(i)}{/each}</Group>
				{:else}<Empty title="Nothing here yet" description={tab === 'scenes' ? 'Scenes you make will show up here.' : 'Routines you make will show up here.'} />{/if}

			{:else if tab === 'automations'}
				<p class="px-1 text-sm text-muted-foreground">Automations aren't switched on one by one. {data.user.name} sees an automation only when they can use every device and scene it touches.</p>
				{#if data.automations.length}
					<Group>{#each data.automations as a (a.id)}
						<div class="flex min-h-14 items-center gap-3 px-4 py-2.5">
							<span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{a.name}</span>
								<span class="block text-sm text-muted-foreground">{a.visible ? 'Can see it' : `Hidden: needs ${a.blockedBy.join(', ')}`}</span></span>
							<span class="size-2.5 shrink-0 rounded-full {a.visible ? 'bg-on' : 'bg-border'}"></span>
						</div>
					{/each}</Group>
				{:else}<Empty title="No automations" description="Automations you build will show up here." />{/if}

			{:else if tab === 'abilities'}
				<p class="px-1 text-sm text-muted-foreground">What {data.user.name} can do, beyond which things they can use.</p>
				<Group>{#each data.abilities as a (a.id)}
					<label class="flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/60 active:bg-muted">
						<span class="min-w-0 flex-1"><span class="block text-[0.9375rem] font-medium">{ABILITY[a.id][0]}</span><span class="block text-sm text-muted-foreground">{ABILITY[a.id][1]}</span></span>
						<Switch checked={a.on} onCheckedChange={() => ability(a)} aria-label={ABILITY[a.id][0]} />
					</label>
				{/each}</Group>
			{/if}
		</div>
		{/key}
	{/if}
</Page>
