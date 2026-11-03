<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { plural } from '#lib/fmt.js';
	import { Button } from '#lib/components/ui/button';
	import { Check, House } from '@lucide/svelte';

	type Area = { id: string; name: string; floor: string | null; devices: number; state: 'new' | 'match' | 'linked'; roomId: string | null };
	let areas = $state<Area[]>([]), available = $state(false), skip = $state<Record<string, boolean>>({}), busy = $state(false), error = $state('');
	const todo = $derived(areas.filter((a) => a.state !== 'linked'));
	const chosen = $derived(todo.filter((a) => !skip[a.id]));

	async function load() { const r = await api<{ available: boolean; areas: Area[] }>('GET', '/api/admin/rooms/ha-areas'); if (r.ok) { available = r.data.available; areas = r.data.areas; } }
	onMount(load);

	async function bringIn() {
		busy = true; error = '';
		const r = await api<{ created: number; linked: number }>('POST', '/api/admin/rooms/ha-import', { areaIds: chosen.map((a) => a.id) });
		busy = false;
		if (!r.ok) { haptics.error(); error = r.data?.message ?? explain(r.data?.error); return; }
		haptics.success(); await Promise.all([load(), home.load()]); home.say('ok', `Brought in ${plural(r.data.created + r.data.linked, 'room')} from Home Assistant.`);
	}
</script>

{#if available && todo.length}
	<section class="space-y-3 rounded-2xl bg-accent px-4 py-4" aria-label="Rooms from Home Assistant">
		<div class="flex items-start gap-3"><House class="mt-0.5 size-5 shrink-0 text-primary" /><div class="min-w-0"><h2 class="heading">Use your Home Assistant rooms</h2><p class="meta mt-0.5">Devices will follow the room they are in there, and renames carry over. Nothing is deleted.</p></div></div>
		<ul class="space-y-1.5">
			{#each todo as a (a.id)}
				<li>
					<button type="button" role="checkbox" aria-checked={!skip[a.id]} class="flex w-full items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-left" onclick={() => (skip[a.id] = !skip[a.id])}>
						<span class="flex size-5 shrink-0 items-center justify-center rounded-md border {skip[a.id] ? 'border-input' : 'border-primary bg-primary text-primary-foreground'}">{#if !skip[a.id]}<Check class="size-3.5" strokeWidth={3} />{/if}</span>
						<span class="min-w-0 flex-1"><span class="block text-[0.9375rem] font-semibold">{a.name}{#if a.state === 'match'}<span class="meta ml-1.5 font-normal">matches a room you have</span>{/if}</span><span class="meta block truncate">{[a.floor, plural(a.devices, 'device')].filter(Boolean).join(' · ')}</span></span>
					</button>
				</li>
			{/each}
		</ul>
		{#if error}<p role="alert" class="text-sm text-signal-foreground">{error}</p>{/if}
		<Button class="h-11 w-full" disabled={busy || !chosen.length} onclick={bringIn}>{busy ? 'Bringing in…' : chosen.length ? `Bring in ${plural(chosen.length, 'room')}` : 'Nothing selected'}</Button>
	</section>
{/if}
