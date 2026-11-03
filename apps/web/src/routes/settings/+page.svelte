<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import Page from '#lib/components/app/Page.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import { Switch } from '#lib/components/ui/switch';
	import { ArrowDown, ArrowUp } from '@lucide/svelte';
	import { haptics, hapticsAvailable, hapticsEnabled, setHaptics } from '#lib/haptics.js';
	import { ui } from '#lib/ui.svelte.js';
	import { allowShake, shakeSupported } from '#lib/shake.js';
	import { LayoutDashboard, Image } from '@lucide/svelte';
	async function setShake(on: boolean) {
		if (on && !(await allowShake())) { home.say('error', 'Shake needs motion access. Allow it when your phone asks, or in your browser’s site settings.'); return; }
		ui.set('shake', on); if (on) haptics.success();
	}
	let hapticsOn = $state(hapticsEnabled());

	const p = $derived(home.prefs);
	const templates = [
		{ id: 'comfort', name: 'Comfort', blurb: 'Large cards with sliders and quick controls.' },
		{ id: 'minimal', name: 'Minimal', blurb: 'A calm, compact list of your favorites.' }
	] as const;
	const sectionList = [['favorites', 'Favorites'], ['rooms', 'Rooms'], ['sensors', 'Sensors at a glance']] as const;

	/** `arr` with the item at `i` moved `d` places. Out of range leaves it as it was. */
	function move<T>(arr: T[], i: number, d: number): T[] {
		const j = i + d;
		if (i < 0 || i >= arr.length || j < 0 || j >= arr.length) return arr;
		const a = [...arr];
		a.splice(j, 0, ...a.splice(i, 1));
		return a;
	}
	const toggleSection = (id: string) => home.savePrefs({ sections: p!.sections.includes(id) ? p!.sections.filter((s) => s !== id) : [...p!.sections, id] });
</script>

<Page title="Appearance and home screen" subtitle="Only you see these choices." back={{ href: '/you', label: 'You' }} width="md">
	{#if p}
		<Section title="Appearance">
			<Segmented label="Appearance" value={p.appearance} options={[{ id: 'system', label: 'Match device' }, { id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} onselect={(a) => home.savePrefs({ appearance: a })} />
		</Section>

		{#if hapticsAvailable()}
			<Section title="Touch">
				<Group><Row title="Haptic feedback" description="A small tap you can feel when you switch, lock or dim something">{#snippet trailing()}<Switch checked={hapticsOn} aria-label="Haptic feedback" onCheckedChange={(v) => { hapticsOn = v; setHaptics(v); if (v) haptics.success(); }} />{/snippet}</Row></Group>
			</Section>
		{/if}

		<Section title="Comfort" hint="These stay on this phone.">
			<Group>
				<Row title="Reduce motion" description="Fewer animations and slides">{#snippet trailing()}<Switch checked={ui.reduceMotion} aria-label="Reduce motion" onCheckedChange={(v) => ui.set('reduceMotion', v)} />{/snippet}</Row>
				<Row title="One-handed mode" description="A search button within thumb reach, bottom right">{#snippet trailing()}<Switch checked={ui.oneHand} aria-label="One-handed mode" onCheckedChange={(v) => ui.set('oneHand', v)} />{/snippet}</Row>
				<Row title="Larger text and buttons" description="Bigger everything, easier to hit">{#snippet trailing()}<Switch checked={ui.large} aria-label="Larger text and buttons" onCheckedChange={(v) => ui.set('large', v)} />{/snippet}</Row>
				{#if shakeSupported()}<Row title="Shake to undo" description="Shake your phone to take back the last thing you did">{#snippet trailing()}<Switch checked={ui.shake} aria-label="Shake to undo" onCheckedChange={setShake} />{/snippet}</Row>{/if}
			</Group>
			<Group>
				<Row title="Wall panel" description="A full-screen control panel for an old phone or tablet on the wall" href="/panel">{#snippet icon()}<LayoutDashboard class="size-[18px]" />{/snippet}</Row>
				<Row title="Status picture" description="A shareable picture of how the home looks right now" href="/glance">{#snippet icon()}<Image class="size-[18px]" />{/snippet}</Row>
			</Group>
		</Section>

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
