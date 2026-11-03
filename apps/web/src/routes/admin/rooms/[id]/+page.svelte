<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api, explain } from '#lib/api.js';
	import { home, type Device } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import Page from '#lib/components/app/Page.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import DevicePicker from '#lib/components/app/DevicePicker.svelte';
	import * as Drawer from '#lib/components/ui/drawer';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { capitalize } from '#lib/utils.js';
	import type { IconComponent } from '#lib/icons.js';
	import { Pencil, Plus, Lightbulb, Plug, Fan, Thermometer, Lock, Camera, Tv, Gauge, Zap } from '@lucide/svelte';

	const id = $derived(page.params.id ?? '');
	const room = $derived(home.rooms.find((r) => r.id === id));
	const devices = $derived(home.inRoom(id));
	const icons: Record<string, IconComponent> = { light: Lightbulb, switch: Plug, fan: Fan, climate: Thermometer, lock: Lock, camera: Camera, media: Tv, sensor: Gauge, energy: Zap };
	let addOpen = $state(false), renameOpen = $state(false), name = $state(''), edit = $state<Device | null>(null), devName = $state(''), error = $state('');
	let ready = false;
	onMount(() => { ready = true; if (page.url.searchParams.get('add') === '1') addOpen = true; });
	$effect(() => { if (room && !renameOpen) name = room.name; });

	async function add(ids: string[]) {
		const r = await api('PUT', `/api/admin/rooms/${id}/devices`, { add: ids });
		if (!r.ok) return r.data?.message ?? explain(r.data?.error);
		haptics.success(); await home.load();
		return undefined;
	}
	async function removeDevice(d: Device) { const r = await api('PUT', `/api/admin/rooms/${id}/devices`, { remove: [d.id] }); if (!r.ok) error = explain(r.data?.error); else haptics.tap(); await home.load(); edit = null; }
	async function renameRoom() { const r = await api('PATCH', `/api/admin/rooms/${id}`, { name: name.trim() }); if (!r.ok) { error = explain(r.data?.error); return; } renameOpen = false; await home.load(); }
	async function deleteRoom() { if (!confirm(`Delete “${room?.name}”? Its devices stay, but won't be in a room.`)) return; const r = await api('DELETE', `/api/admin/rooms/${id}`); if (!r.ok) { error = explain(r.data?.error); return; } await home.load(); goto('/admin/rooms'); }
	async function saveDevice() { if (!edit) return; const r = await api('PUT', `/api/admin/devices/${encodeURIComponent(edit.id)}`, { name: devName.trim() }); if (!r.ok) { error = explain(r.data?.error); return; } edit = null; await home.load(); }
	function open(d: Device) { edit = d; devName = d.name; }
	void ready;
</script>

<Page title={room?.name ?? (home.loaded ? 'Room not found' : '')} back={{ href: '/admin/rooms', label: 'Rooms & devices' }} width="md">
	{#snippet actions()}{#if room}<Button variant="secondary" size="icon" aria-label="Rename room" onclick={() => (renameOpen = true)}><Pencil /></Button>{/if}{/snippet}
	{#if room}
		{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
		<Section title="Devices">
			{#snippet actions()}<Button size="sm" onclick={() => (addOpen = true)}><Plus />Add</Button>{/snippet}
			{#if devices.length}
				<Group>{#each devices as d (d.id)}
					{@const Icon = icons[d.category] ?? Gauge}
					<Row onclick={() => open(d)} title={d.name} description={d.available ? capitalize(d.category) : 'Offline'}>
						{#snippet icon()}<Icon class="size-[18px]" />{/snippet}
						{#snippet trailing()}<Pencil class="size-4 text-muted-foreground/70" />{/snippet}
					</Row>
				{/each}</Group>
			{:else}
				<Empty title="Nothing in this room yet" description="Add the devices that live here. You can search for them."><Button onclick={() => (addOpen = true)}><Plus />Add devices</Button></Empty>
			{/if}
		</Section>
		<div><Button variant="destructive" onclick={deleteRoom}>Delete room</Button></div>
	{:else if home.loaded}<Empty title="That room doesn't exist" description="It may have been deleted." />{/if}
</Page>

<DevicePicker bind:open={addOpen} title="Add devices to {room?.name ?? 'room'}" notRoom={id} confirm={(n) => (n ? `Add ${n} device${n === 1 ? '' : 's'}` : 'Choose devices to add')} onconfirm={add} />

<Drawer.Root open={!!edit} onOpenChange={(o) => { if (!o) edit = null; }}>
	<Drawer.Content class="rounded-t-3xl">
		{#if edit}
			<form class="space-y-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2" onsubmit={(e) => { e.preventDefault(); saveDevice(); }}>
				<Drawer.Header class="px-0 pb-0"><Drawer.Title class="text-left text-xl font-semibold tracking-[-0.02em]">Rename device</Drawer.Title><Drawer.Description class="text-left">This is the name everyone sees in the app.</Drawer.Description></Drawer.Header>
				<Input bind:value={devName} maxlength={60} aria-label="Device name" class="h-12 text-lg" />
				<Button type="submit" size="lg" class="w-full" disabled={!devName.trim()}>Save</Button>
				<Button type="button" variant="secondary" size="lg" class="w-full" onclick={() => removeDevice(edit!)}>Remove from this room</Button>
			</form>
		{/if}
	</Drawer.Content>
</Drawer.Root>

<Drawer.Root bind:open={renameOpen}>
	<Drawer.Content class="rounded-t-3xl">
		<form class="space-y-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2" onsubmit={(e) => { e.preventDefault(); if (name.trim()) renameRoom(); }}>
			<Drawer.Header class="px-0 pb-0"><Drawer.Title class="text-left text-xl font-semibold tracking-[-0.02em]">Rename room</Drawer.Title><Drawer.Description class="sr-only">Change this room's name</Drawer.Description></Drawer.Header>
			<Input bind:value={name} maxlength={60} aria-label="Room name" class="h-12 text-lg" />
			<Button type="submit" size="lg" class="w-full" disabled={!name.trim()}>Save</Button>
		</form>
	</Drawer.Content>
</Drawer.Root>
