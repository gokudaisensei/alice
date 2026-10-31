<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	let n = $state<{ version: string; emergency: boolean; reason: string; startsAt: string } | null>(null);
	async function load() { const r = await api('GET', '/api/updates/notice'); if (r.ok) n = r.data.notice; }
	onMount(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); });
	const at = $derived(n ? new Date(n.startsAt).toLocaleTimeString([], { timeStyle: 'short' }) : '');
	const soon = $derived(n ? Date.parse(n.startsAt) > Date.now() : false);
</script>

{#if n}
	<div role="status" class="border-b bg-amber-500/15 px-4 py-2 text-sm">
		{#if soon}{n.emergency ? 'An urgent security update' : 'An update'} (version {n.version}) will start at {at}. The app will be unavailable for a few minutes; your devices and automations keep running.
		{:else}Updating to version {n.version} now. The app may be unavailable for a few minutes. Your devices and automations keep running.{/if}
	</div>
{/if}
