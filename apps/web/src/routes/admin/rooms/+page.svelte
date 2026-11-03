<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import Page from '#lib/components/app/Page.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import RoomSuggestions from '#lib/components/app/RoomSuggestions.svelte';
	import HaAreas from '#lib/components/app/HaAreas.svelte';
	import HaLabels from '#lib/components/app/HaLabels.svelte';
	import { roomLook } from '#lib/roomLook.js';
	import DevicePicker from '#lib/components/app/DevicePicker.svelte';
	import * as Drawer from '#lib/components/ui/drawer';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Plus, Trash2, Layers } from '@lucide/svelte';

	type G = { id: string; name: string; entityIds: string[] };
	let groups = $state<G[]>([]), error = $state('');
	let roomOpen = $state(false), roomName = $state(''), creating = $state(false);
	let groupOpen = $state(false), groupName = $state(''), editing = $state<G | null>(null);
	const SUGGEST = ['Living room', 'Kitchen', 'Bedroom', 'Bathroom', 'Office', 'Hallway', 'Dining room', 'Garage', 'Garden'];
	const suggestions = $derived(SUGGEST.filter((s) => !home.rooms.some((r) => r.name.toLowerCase() === s.toLowerCase())).slice(0, 6));
	const unplaced = $derived(home.devices.filter((d) => !d.roomId && !['sensor', 'energy'].includes(d.category)).length);

	async function loadGroups() { const r = await api<{ groups: G[] }>('GET', '/api/admin/groups'); if (r.ok) groups = r.data.groups; else error = explain(r.data?.error); }
	onMount(loadGroups);

	async function createRoom() {
		creating = true; error = '';
		const r = await api<{ id: string }>('POST', '/api/admin/rooms', { name: roomName.trim() });
		creating = false;
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		haptics.success(); roomOpen = false; roomName = ''; await home.load();
		goto(`/admin/rooms/${r.data.id}?add=1`); // straight on to filling it
	}
	function newGroup() { editing = null; groupName = ''; groupOpen = true; }
	function editGroup(g: G) { editing = g; groupName = g.name; groupOpen = true; }
	async function saveGroup(ids: string[], name: string) {
		const r = editing ? await api('PUT', `/api/admin/groups/${editing.id}`, { name, entityIds: ids }) : await api('POST', '/api/admin/groups', { name, entityIds: ids });
		if (!r.ok) return r.data?.message ?? explain(r.data?.error);
		haptics.success(); await Promise.all([loadGroups(), home.load()]);
		return undefined;
	}
	async function delGroup(g: G) { if (!confirm(`Delete the group “${g.name}”? The devices stay.`)) return; const r = await api('DELETE', `/api/admin/groups/${g.id}`); if (!r.ok) error = explain(r.data?.error); await Promise.all([loadGroups(), home.load()]); }
</script>

<Page title="Edit rooms" subtitle="Organise your home. Open a room to add or rename its devices." width="md">
	{#snippet actions()}<Button onclick={() => (roomOpen = true)}><Plus />New room</Button>{/snippet}
	{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
	<HaAreas />
	<RoomSuggestions />

	<Section title="Rooms">
		{#if home.orderedRooms.length}
			<Group>{#each home.orderedRooms as r (r.id)}
				<Row href="/admin/rooms/{r.id}" title={r.name} description="{r.floor ? r.floor + ' · ' : ''}{home.inRoom(r.id).length} device{home.inRoom(r.id).length === 1 ? '' : 's'}">{#snippet icon()}{@const look = roomLook(r)}<look.icon class="size-[18px]" style="color: {look.color}" />{/snippet}</Row>
			{/each}</Group>
			{#if unplaced}<p class="text-sm text-muted-foreground">{unplaced} device{unplaced === 1 ? '' : 's'} {unplaced === 1 ? "isn't" : "aren't"} in a room yet. Open a room and tap Add to place {unplaced === 1 ? 'it' : 'them'}.</p>{/if}
		{:else}
			<Empty title="No rooms yet" description="Rooms make devices easy to find. Start with the one you use most."><Button onclick={() => (roomOpen = true)}><Plus />New room</Button></Empty>
		{/if}
	</Section>

	<HaLabels />
	<Section title="Groups" hint="Control several devices together from Home.">
		{#snippet actions()}<Button size="sm" variant="secondary" onclick={newGroup}><Plus />New group</Button>{/snippet}
		{#if groups.length}
			<Group>{#each groups as g (g.id)}
				<Row onclick={() => editGroup(g)} title={g.name} description="{g.entityIds.length} device{g.entityIds.length === 1 ? '' : 's'}">
					{#snippet icon()}<Layers class="size-[18px]" />{/snippet}
					{#snippet trailing()}<Button size="icon-sm" variant="ghost" aria-label="Delete {g.name}" onclick={(e) => { e.stopPropagation(); delGroup(g); }}><Trash2 /></Button>{/snippet}
				</Row>
			{/each}</Group>
		{:else}<p class="text-sm text-muted-foreground">No groups yet. A group like “Downstairs lights” gives you one tap for the lot.</p>{/if}
	</Section>
</Page>

<Drawer.Root bind:open={roomOpen}>
	<Drawer.Content class="rounded-t-3xl">
		<form class="space-y-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2" onsubmit={(e) => { e.preventDefault(); if (roomName.trim()) createRoom(); }}>
			<Drawer.Header class="px-0 pb-0"><Drawer.Title class="text-left text-xl font-semibold tracking-[-0.02em]">New room</Drawer.Title><Drawer.Description class="text-left">Name it, then choose what's in it.</Drawer.Description></Drawer.Header>
			<Input bind:value={roomName} maxlength={60} placeholder="Room name" aria-label="Room name" class="h-12 text-lg" autofocus />
			{#if suggestions.length}
				<div class="-mx-5 flex gap-2 overflow-x-auto no-scrollbar px-5" role="group" aria-label="Suggestions">
					{#each suggestions as s}<button type="button" onclick={() => { haptics.tap(); roomName = s; }} class="h-10 shrink-0 rounded-full border px-4 text-sm font-medium transition-[background-color,transform] duration-200 active:scale-[0.97] {roomName === s ? 'border-transparent bg-primary/12 text-primary' : 'bg-card'}">{s}</button>{/each}
				</div>
			{/if}
			{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
			<Button type="submit" size="lg" class="w-full" disabled={creating || !roomName.trim()}>{creating ? 'Creating…' : 'Create and add devices'}</Button>
		</form>
	</Drawer.Content>
</Drawer.Root>

<DevicePicker bind:open={groupOpen} bind:name={groupName} title={editing ? 'Edit group' : 'New group'} nameLabel="Group name, e.g. Downstairs lights" selected={editing?.entityIds ?? []} confirm={(n) => (editing ? `Save (${n} selected)` : `Create group (${n} selected)`)} onconfirm={saveGroup} />
