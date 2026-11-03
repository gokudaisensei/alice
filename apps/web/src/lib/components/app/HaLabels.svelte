<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { plural } from '#lib/fmt.js';
	import { Button } from '#lib/components/ui/button';
	import { Check, Tags } from '@lucide/svelte';

	type L = { id: string; name: string; devices: number; state: 'new' | 'match' | 'linked' };
	let labels = $state<L[]>([]), available = $state(false), skip = $state<Record<string, boolean>>({}), busy = $state(false), error = $state('');
	const todo = $derived(labels.filter((l) => l.state !== 'linked'));
	const chosen = $derived(todo.filter((l) => !skip[l.id]));

	async function load() { const r = await api<{ available: boolean; labels: L[] }>('GET', '/api/admin/groups/ha-labels'); if (r.ok) { available = r.data.available; labels = r.data.labels; } }
	onMount(load);
	async function bringIn() {
		busy = true; error = '';
		const r = await api('POST', '/api/admin/groups/ha-import', { labelIds: chosen.map((l) => l.id) });
		busy = false;
		if (!r.ok) { haptics.error(); error = r.data?.message ?? explain(r.data?.error); return; }
		haptics.success(); await Promise.all([load(), home.load()]); home.say('ok', `Brought in ${plural(chosen.length, 'group')} from Home Assistant.`);
	}
</script>

{#if available && todo.length}
	<section class="space-y-3 rounded-2xl bg-accent px-4 py-4" aria-label="Groups from Home Assistant labels">
		<div class="flex items-start gap-3"><Tags class="mt-0.5 size-5 shrink-0 text-primary" /><div class="min-w-0"><h2 class="heading">Use your Home Assistant labels</h2><p class="meta mt-0.5">Each label becomes a group, and its devices follow the label there.</p></div></div>
		<ul class="space-y-1.5">
			{#each todo as l (l.id)}
				<li><button type="button" role="checkbox" aria-checked={!skip[l.id]} class="flex w-full items-center gap-3 rounded-xl bg-card px-3.5 py-3 text-left" onclick={() => (skip[l.id] = !skip[l.id])}>
					<span class="flex size-5 shrink-0 items-center justify-center rounded-md border {skip[l.id] ? 'border-input' : 'border-primary bg-primary text-primary-foreground'}">{#if !skip[l.id]}<Check class="size-3.5" strokeWidth={3} />{/if}</span>
					<span class="min-w-0 flex-1"><span class="block text-[0.9375rem] font-semibold">{l.name}{#if l.state === 'match'}<span class="meta ml-1.5 font-normal">matches a group you have</span>{/if}</span><span class="meta block">{plural(l.devices, 'device')}</span></span>
				</button></li>
			{/each}
		</ul>
		{#if error}<p role="alert" class="text-sm text-signal-foreground">{error}</p>{/if}
		<Button class="h-11 w-full" disabled={busy || !chosen.length} onclick={bringIn}>{busy ? 'Bringing in…' : chosen.length ? `Bring in ${plural(chosen.length, 'group')}` : 'Nothing selected'}</Button>
	</section>
{/if}
