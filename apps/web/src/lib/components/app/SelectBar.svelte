<script lang="ts">
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';
	import { dur } from '#lib/motion.js';
	import { home } from '#lib/home.svelte.js';
	import { selection } from '#lib/select.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { Button } from '#lib/components/ui/button';
	import { Star, X } from '@lucide/svelte';

	const chosen = $derived(selection.ids.map((id) => home.byId(id)).filter((d) => !!d));
	const switchable = $derived(chosen.filter((d) => d.available && d.controls.some((c) => c.type === 'power')));
	async function setAll(on: boolean) {
		haptics.tap();
		// Only what would actually change, so the message and the Undo are about the right things.
		const todo = switchable.filter((d) => (d.state === 'on') !== on), n = todo.length;
		selection.clear();
		if (!n) { home.say('info', on ? 'Those are already on.' : 'Those are already off.'); return; }
		await home.batch(`${on ? 'Turned on' : 'Turned off'} ${n} device${n === 1 ? '' : 's'}`, async () => { await Promise.all(todo.map((d) => home.command(d.id, on ? 'turn_on' : 'turn_off'))); });
	}
	// Leave room under the page so the bar never covers the last tiles.
	$effect(() => { document.documentElement.classList.toggle('selecting', selection.active); return () => document.documentElement.classList.remove('selecting'); });
	async function star() {
		haptics.tap();
		const cur = home.prefs?.favorites.devices ?? [], add = selection.ids.filter((id) => !cur.includes(id));
		await home.saveFavorites([...cur, ...add], home.prefs?.favorites.rooms ?? []);
		home.say('ok', add.length ? `Added ${add.length} to favorites.` : 'Already in your favorites.'); selection.clear();
	}
</script>

{#if selection.active}
	<div transition:fly={{ y: 40, duration: dur(240), easing: cubicOut }} class="fixed inset-x-0 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] z-40 flex justify-center px-4 md:bottom-6" role="toolbar" aria-label="Selected devices">
		<div class="flex w-full max-w-md items-center gap-1.5 rounded-2xl border bg-popover/95 p-2 pl-4 shadow-2xl backdrop-blur-xl">
			<span class="figure mr-auto text-[0.9375rem]">{selection.ids.length} selected</span>
			<Button size="sm" variant="secondary" disabled={!switchable.length} onclick={() => setAll(true)}>On</Button>
			<Button size="sm" variant="secondary" disabled={!switchable.length} onclick={() => setAll(false)}>Off</Button>
			<Button size="icon" variant="ghost" aria-label="Add to favorites" onclick={star}><Star class="size-[18px]" /></Button>
			<Button size="icon" variant="ghost" aria-label="Cancel selection" onclick={() => { haptics.tap(); selection.clear(); }}><X class="size-[18px]" /></Button>
		</div>
	</div>
{/if}
