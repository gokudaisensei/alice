<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { session, forget } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import Page from '#lib/components/app/Page.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import { Switch } from '#lib/components/ui/switch';
	import { ArrowDown, ArrowUp } from '@lucide/svelte';
	import { haptics, hapticsAvailable, hapticsEnabled, setHaptics } from '#lib/haptics.js';
	let hapticsOn = $state(hapticsEnabled());

	const p = $derived(home.prefs);
	const templates = [
		{ id: 'comfort', name: 'Comfort', blurb: 'Large cards with sliders and quick controls.' },
		{ id: 'minimal', name: 'Minimal', blurb: 'A calm, compact list of your favorites.' }
	] as const;
	const sectionList = [['favorites', 'Favorites'], ['rooms', 'Rooms'], ['sensors', 'Sensors at a glance']] as const;

	function move<T>(arr: T[], i: number, d: number) { const a = [...arr], j = i + d; if (j < 0 || j >= a.length) return a; [a[i], a[j]] = [a[j], a[i]]; return a; }
	const toggleSection = (id: string) => home.savePrefs({ sections: p!.sections.includes(id) ? p!.sections.filter((s) => s !== id) : [...p!.sections, id] });
	async function logout() { await api('POST', '/api/auth/logout'); forget(); session.me = null; goto('/login'); }
</script>

<Page title="Appearance and home screen" subtitle="Only you see these choices." back={{ href: '/you', label: 'You' }} width="md">
	{#if p}
		<Section title="Appearance">
			<Segmented label="Appearance" value={p.appearance} options={[{ id: 'system', label: 'Match device' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} onselect={(a) => home.savePrefs({ appearance: a as any })} />
		</Section>

		{#if hapticsAvailable()}
			<Section title="Touch">
				<Group><Row title="Haptic feedback" description="A small tap you can feel when you switch, lock or dim something">{#snippet trailing()}<Switch checked={hapticsOn} aria-label="Haptic feedback" onCheckedChange={(v) => { hapticsOn = v; setHaptics(v); if (v) haptics.success(); }} />{/snippet}</Row></Group>
			</Section>
		{/if}

		<Section title="Home screen">
			<div class="grid gap-3 sm:grid-cols-2" role="group" aria-label="Home screen layout">
				{#each templates as t}
					<button type="button" class="rounded-tile border p-4 text-left transition-colors duration-200 {p.template === t.id ? 'border-transparent bg-primary/12' : 'bg-card hover:bg-muted/60'}" aria-pressed={p.template === t.id} onclick={() => home.savePrefs({ template: t.id })}>
						<span class="block font-semibold tracking-[-0.015em]">{t.name}</span><span class="mt-0.5 block text-sm text-muted-foreground">{t.blurb}</span>
					</button>
				{/each}
			</div>
			<Group>{#each sectionList as [id, label]}
				<Row title={label}>{#snippet trailing()}<Switch checked={p.sections.includes(id)} aria-label="Show {label} on Home" onCheckedChange={() => toggleSection(id)} />{/snippet}</Row>
			{/each}</Group>
		</Section>

		<Section title="Favorite devices" hint="Order them the way you like.">
			{#if p.favorites.devices.length}
				<Group>{#each p.favorites.devices as id, i (id)}
					<Row title={home.byId(id)?.name ?? id}>{#snippet trailing()}
						<Button size="icon-sm" variant="ghost" aria-label="Move up" disabled={i === 0} onclick={() => home.saveFavorites(move(p.favorites.devices, i, -1), p.favorites.rooms)}><ArrowUp /></Button>
						<Button size="icon-sm" variant="ghost" aria-label="Move down" disabled={i === p.favorites.devices.length - 1} onclick={() => home.saveFavorites(move(p.favorites.devices, i, 1), p.favorites.rooms)}><ArrowDown /></Button>
					{/snippet}</Row>
				{/each}</Group>
			{:else}<p class="rounded-2xl border border-dashed px-5 py-6 text-center text-sm text-muted-foreground">No favorites yet. Tap the star on a device.</p>{/if}
		</Section>

		<Section title="Rooms" hint="Order them, and choose which appear on Home.">
			{#if home.orderedRooms.length}
				<Group>{#each home.orderedRooms as r, i (r.id)}
					{@const ids = home.orderedRooms.map((x) => x.id)}
					<Row title={r.name}>{#snippet trailing()}
						<Button size="icon-sm" variant="ghost" aria-label="Move {r.name} up" disabled={i === 0} onclick={() => home.savePrefs({ roomOrder: move(ids, i, -1) })}><ArrowUp /></Button>
						<Button size="icon-sm" variant="ghost" aria-label="Move {r.name} down" disabled={i === ids.length - 1} onclick={() => home.savePrefs({ roomOrder: move(ids, i, 1) })}><ArrowDown /></Button>
						<Switch checked={p.favorites.rooms.includes(r.id)} aria-label="Show {r.name} on Home" onCheckedChange={() => home.saveFavorites(p.favorites.devices, p.favorites.rooms.includes(r.id) ? p.favorites.rooms.filter((x) => x !== r.id) : [...p.favorites.rooms, r.id])} />
					{/snippet}</Row>
				{/each}</Group>
			{:else}<p class="rounded-2xl border border-dashed px-5 py-6 text-center text-sm text-muted-foreground">No rooms yet.</p>{/if}
		</Section>
	{/if}

</Page>
