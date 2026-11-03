<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain, sensitive } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button';
	import { ShieldAlert } from '@lucide/svelte';

	let data = $state<{ available: boolean; exposed: number; risky: { id: string; name: string }[] } | null>(null), busy = $state(false), msg = $state('');
	async function load() { const r = await api<NonNullable<typeof data>>('GET', '/api/admin/assist'); if (r.ok) data = r.data; }
	onMount(load);
	async function protect() {
		busy = true; msg = '';
		const r = await sensitive<{ hidden: number }>('POST', '/api/admin/assist/protect');
		busy = false;
		msg = r.ok ? 'Done. Home Assistant’s assistant can no longer reach those.' : (r.data?.message ?? explain(r.data?.error));
		await load();
	}
</script>

{#if data?.available && data.risky.length}
	<section class="space-y-2.5 rounded-2xl bg-signal-soft p-4 text-sm text-signal-foreground" aria-label="Doors and alarms reachable by voice">
		<div class="flex gap-3"><ShieldAlert class="mt-0.5 size-5 shrink-0" /><div>
			<p class="font-semibold">Home Assistant’s assistant can reach {data.risky.length === 1 ? 'something' : 'things'} that guard your home</p>
			<p class="mt-0.5">{data.risky.map((r) => r.name).join(', ')}. When you ask it to do something in the app, it can change these without a passkey check.</p>
		</div></div>
		<Button class="h-11 w-full" disabled={busy} onclick={protect}>{busy ? 'Protecting…' : 'Keep them out of reach'}</Button>
	</section>
{/if}
{#if msg}<p role="status" class="rounded-xl bg-accent px-3.5 py-2 text-sm">{msg}</p>{/if}
