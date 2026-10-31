<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';
	import NotificationSettings from '#lib/components/app/NotificationSettings.svelte';

	const p = $derived(home.prefs);
	const templates = [
		{ id: 'comfort', name: 'Comfort', blurb: 'Large cards with sliders and quick controls.' },
		{ id: 'minimal', name: 'Minimal', blurb: 'A calm, compact list of your favorites.' }
	] as const;
	const sectionList = [['favorites', 'Favorites'], ['rooms', 'Rooms'], ['sensors', 'Sensors at a glance']] as const;

	function move<T>(arr: T[], i: number, d: number) { const a = [...arr], j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; }
	const toggleSection = (id: string) => home.savePrefs({ sections: p!.sections.includes(id) ? p!.sections.filter((s) => s !== id) : [...p!.sections, id] });
	async function logout() { await api('POST', '/api/auth/logout'); session.me = null; goto('/login'); }
</script>

<main class="mx-auto max-w-2xl space-y-6 p-4">
	<h1 class="text-2xl font-semibold">Settings</h1>
	{#if p}
		<Card.Root><Card.Header><Card.Title>Appearance</Card.Title></Card.Header>
			<Card.Content class="flex gap-2" role="group" aria-label="Appearance">
				{#each ['system', 'light', 'dark'] as a}<Button variant={p.appearance === a ? 'default' : 'outline'} class="capitalize" onclick={() => home.savePrefs({ appearance: a as any })}>{a}</Button>{/each}
			</Card.Content></Card.Root>

		<Card.Root><Card.Header><Card.Title>Home screen</Card.Title><Card.Description>Only you see these choices.</Card.Description></Card.Header>
			<Card.Content class="space-y-4">
				<div class="grid gap-2 sm:grid-cols-2" role="group" aria-label="Home screen layout">
					{#each templates as t}
						<button class="rounded-lg border p-3 text-left {p.template === t.id ? 'border-primary ring-2 ring-primary' : ''}" aria-pressed={p.template === t.id} onclick={() => home.savePrefs({ template: t.id })}>
							<span class="font-medium">{t.name}</span><br /><span class="text-sm text-muted-foreground">{t.blurb}</span>
						</button>
					{/each}
				</div>
				<fieldset class="space-y-2"><legend class="text-sm font-medium">Show on Home</legend>
					{#each sectionList as [id, label]}
						<label class="flex items-center gap-2"><input type="checkbox" class="size-4" checked={p.sections.includes(id)} onchange={() => toggleSection(id)} />{label}</label>
					{/each}
				</fieldset>
			</Card.Content></Card.Root>

		<Card.Root><Card.Header><Card.Title>Favorite devices</Card.Title><Card.Description>Order them the way you like.</Card.Description></Card.Header>
			<Card.Content class="space-y-1">
				{#each p.favorites.devices as id, i (id)}
					<div class="flex items-center justify-between gap-2 rounded-md border p-2">
						<span>{home.byId(id)?.name ?? id}</span>
						<span class="flex gap-1">
							<Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onclick={() => home.saveFavorites(move(p.favorites.devices, i, -1), p.favorites.rooms)}>↑</Button>
							<Button size="sm" variant="ghost" aria-label="Move down" disabled={i === p.favorites.devices.length - 1} onclick={() => home.saveFavorites(move(p.favorites.devices, i, 1), p.favorites.rooms)}>↓</Button>
						</span>
					</div>
				{:else}<p class="text-sm text-muted-foreground">No favorites yet. Tap the star on a device.</p>{/each}
			</Card.Content></Card.Root>

		<Card.Root><Card.Header><Card.Title>Rooms</Card.Title><Card.Description>Order, and choose which appear on Home.</Card.Description></Card.Header>
			<Card.Content class="space-y-1">
				{#each home.orderedRooms as r, i (r.id)}
					{@const ids = home.orderedRooms.map((x) => x.id)}
					<div class="flex items-center justify-between gap-2 rounded-md border p-2">
						<label class="flex items-center gap-2"><input type="checkbox" class="size-4" checked={p.favorites.rooms.includes(r.id)} onchange={() => home.saveFavorites(p.favorites.devices, p.favorites.rooms.includes(r.id) ? p.favorites.rooms.filter((x) => x !== r.id) : [...p.favorites.rooms, r.id])} />{r.name}</label>
						<span class="flex gap-1">
							<Button size="sm" variant="ghost" aria-label="Move {r.name} up" disabled={i === 0} onclick={() => home.savePrefs({ roomOrder: move(ids, i, -1) })}>↑</Button>
							<Button size="sm" variant="ghost" aria-label="Move {r.name} down" disabled={i === ids.length - 1} onclick={() => home.savePrefs({ roomOrder: move(ids, i, 1) })}>↓</Button>
						</span>
					</div>
				{:else}<p class="text-sm text-muted-foreground">No rooms yet.</p>{/each}
			</Card.Content></Card.Root>
	{/if}

	<NotificationSettings />

	{#if session.can('admin.access')}
		<Card.Root><Card.Header><Card.Title>Manage your home</Card.Title></Card.Header>
			<Card.Content class="flex flex-wrap gap-2">
				{#if session.can('rooms.manage')}<Button variant="outline" href="/admin/rooms">Rooms & devices</Button>{/if}
				{#if session.can('users.manage')}<Button variant="outline" href="/admin/users">People</Button>{/if}
			</Card.Content></Card.Root>
	{/if}
	<Button variant="outline" onclick={logout}>Sign out</Button>
</main>
