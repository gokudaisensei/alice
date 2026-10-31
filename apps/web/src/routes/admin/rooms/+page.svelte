<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain, reauth } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Badge } from '#lib/components/ui/badge';
	import * as Card from '#lib/components/ui/card';

	type AdminDevice = { id: string; name: string; haName: string; category: string; ordinary: boolean; roomId: string | null; hidden: boolean };
	let devices = $state<AdminDevice[]>([]);
	let newRoom = $state('');
	let groupName = $state('');
	let groupPick = $state<string[]>([]);
	let error = $state('');

	async function refresh() {
		const r = await api('GET', '/api/admin/devices');
		if (r.ok) devices = r.data.devices; else error = explain(r.data?.error);
		await home.load();
	}
	onMount(refresh);

	async function act(p: Promise<{ ok: boolean; data: any }>) {
		const r = await p;
		if (!r.ok) home.say('error', explain(r.data?.error)); else await refresh();
		return r.ok;
	}
	const addRoom = async () => { if (newRoom.trim() && (await act(api('POST', '/api/admin/rooms', { name: newRoom.trim() })))) newRoom = ''; };
	const place = (d: AdminDevice, roomId: string) => act(api('PUT', `/api/admin/devices/${encodeURIComponent(d.id)}`, { roomId: roomId || null }));
	const rename = (d: AdminDevice, e: Event) => { const v = (e.currentTarget as HTMLInputElement).value.trim(); if (v && v !== d.name) act(api('PUT', `/api/admin/devices/${encodeURIComponent(d.id)}`, { name: v })); };
	const hide = (d: AdminDevice) => act(api('PUT', `/api/admin/devices/${encodeURIComponent(d.id)}`, { hidden: !d.hidden }));
	async function delRoom(id: string, name: string) { if (confirm(`Remove “${name}”? Its devices stay, but won’t be in a room.`)) act(api('DELETE', `/api/admin/rooms/${id}`)); }
	async function makeGroup() {
		if (!groupName.trim() || !groupPick.length) return;
		if (await act(api('POST', '/api/admin/groups', { name: groupName.trim(), entityIds: groupPick }))) { groupName = ''; groupPick = []; }
	}
</script>

<main class="mx-auto max-w-3xl space-y-6 p-4">
	<h1 class="text-2xl font-semibold">Rooms & devices</h1>
	{#if error}<p role="alert" class="text-destructive">{error}</p>{/if}

	<Card.Root><Card.Header><Card.Title>Rooms</Card.Title></Card.Header>
		<Card.Content class="space-y-3">
			<form class="flex gap-2" onsubmit={(e) => { e.preventDefault(); addRoom(); }}>
				<Input placeholder="New room name" bind:value={newRoom} maxlength={60} aria-label="New room name" /><Button type="submit">Add</Button>
			</form>
			{#each home.orderedRooms as r (r.id)}
				<div class="flex items-center justify-between rounded-md border p-2"><span>{r.name}</span><Button size="sm" variant="ghost" onclick={() => delRoom(r.id, r.name)}>Remove</Button></div>
			{/each}
		</Card.Content></Card.Root>

	<Card.Root><Card.Header><Card.Title>Devices</Card.Title><Card.Description>Name them and put them in rooms. Hidden devices disappear for everyone.</Card.Description></Card.Header>
		<Card.Content class="space-y-2">
			{#each devices as d (d.id)}
				<div class="space-y-2 rounded-md border p-3 {d.hidden ? 'opacity-60' : ''}">
					<div class="flex flex-wrap items-center gap-2">
						<Input class="min-w-40 flex-1" value={d.name} maxlength={60} aria-label="Name for {d.haName}" onchange={(e) => rename(d, e)} />
						<select class="h-9 rounded-md border bg-background px-2 text-sm" value={d.roomId ?? ''} aria-label="Room for {d.name}" onchange={(e) => place(d, e.currentTarget.value)}>
							<option value="">No room</option>
							{#each home.orderedRooms as r}<option value={r.id}>{r.name}</option>{/each}
						</select>
						{#if d.ordinary}<Button size="sm" variant="outline" onclick={() => hide(d)}>{d.hidden ? 'Show' : 'Hide'}</Button>{/if}
					</div>
					{#if !d.ordinary}<Badge variant="outline">Not available in the household app</Badge>{/if}
					{#if d.ordinary && !d.hidden}
						<label class="flex items-center gap-2 text-sm text-muted-foreground"><input type="checkbox" class="size-4" bind:group={groupPick} value={d.id} />Include in new group</label>
					{/if}
				</div>
			{/each}
		</Card.Content></Card.Root>

	<Card.Root><Card.Header><Card.Title>New group</Card.Title><Card.Description>Tick devices above, name the group, then create it. Groups are controlled together from Home.</Card.Description></Card.Header>
		<Card.Content class="flex gap-2">
			<Input placeholder="Group name, e.g. Downstairs lights" bind:value={groupName} maxlength={60} aria-label="Group name" />
			<Button onclick={makeGroup} disabled={!groupName.trim() || !groupPick.length}>Create ({groupPick.length})</Button>
		</Card.Content></Card.Root>
</main>
