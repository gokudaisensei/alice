<script lang="ts">
	import { api } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { plural } from '#lib/fmt.js';
	import { suggestRooms } from '#lib/roomSuggest.js';
	import { Button } from '#lib/components/ui/button';
	import { Check, Sparkles } from '@lucide/svelte';

	/** "We found devices that might belong together": rooms worked out from device names, created and filled in one tap. */
	const found = $derived(suggestRooms(home.devices.filter((d) => !['sensor', 'energy'].includes(d.category)), home.rooms));
	let skip = $state<Record<string, boolean>>({}), busy = $state(false), error = $state(''), all = $state(false);
	const chosen = $derived(found.filter((s) => !skip[s.name]));
	const shown = $derived(all ? found : found.slice(0, 3));

	async function create() {
		busy = true; error = '';
		try {
			for (const s of chosen) {
				let id = s.roomId;
				if (!id) { const r = await api<{ id: string }>('POST', '/api/admin/rooms', { name: s.name }); if (!r.ok) throw new Error(); id = r.data.id; }
				for (const dev of s.deviceIds) { const r = await api('PUT', `/api/admin/devices/${encodeURIComponent(dev)}`, { roomId: id }); if (!r.ok) throw new Error(); }
			}
			haptics.success(); await home.load(); home.say('ok', `Organised ${plural(chosen.length, 'room')}.`);
		} catch { haptics.error(); error = 'Some of that didn’t save. Nothing is lost; try again.'; await home.load(); }
		busy = false;
	}
</script>

{#if found.length}
	<section class="space-y-3 rounded-2xl bg-accent px-4 py-4" aria-label="Suggested rooms">
		<div class="flex items-start gap-3"><Sparkles class="mt-0.5 size-5 shrink-0 text-primary" /><div class="min-w-0"><h2 class="heading">Organise your home</h2><p class="meta mt-0.5">We found devices that might belong together. Untick any you don’t want.</p></div></div>
		<ul class="space-y-1.5">
			{#each shown as s (s.name)}
				<li>
					<button type="button" role="checkbox" aria-checked={!skip[s.name]} class="flex w-full items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-left" onclick={() => (skip[s.name] = !skip[s.name])}>
						<span class="flex size-5 shrink-0 items-center justify-center rounded-md border {skip[s.name] ? 'border-input' : 'border-primary bg-primary text-primary-foreground'}">{#if !skip[s.name]}<Check class="size-3.5" strokeWidth={3} />{/if}</span>
						<span class="min-w-0 flex-1"><span class="block text-[0.9375rem] font-semibold">{s.name}{#if s.roomId}<span class="meta ml-1.5 font-normal">already exists</span>{/if}</span><span class="meta block truncate">{s.deviceIds.map((id) => home.byId(id)?.name).filter(Boolean).join(', ')}</span></span>
					</button>
				</li>
			{/each}
		</ul>
		{#if found.length > 3}<button type="button" class="text-sm font-medium text-primary" onclick={() => (all = !all)}>{all ? 'Show fewer' : `Show all ${found.length} rooms`}</button>{/if}
		{#if error}<p role="alert" class="text-sm text-signal-foreground">{error}</p>{/if}
		<Button class="h-11 w-full" disabled={busy || !chosen.length} onclick={create}>{busy ? 'Organising…' : chosen.length ? `Create ${plural(chosen.length, 'room')} and move ${plural(chosen.reduce((n, s) => n + s.deviceIds.length, 0), 'device')}` : 'Nothing selected'}</Button>
	</section>
{/if}
