<script lang="ts">
	import { slide } from 'svelte/transition';
	import { dur } from '#lib/motion.js';
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	let n = $state<{ version: string; emergency: boolean; reason: string; startsAt: string } | null>(null);
	async function load() { const r = await api('GET', '/api/updates/notice'); if (r.ok) n = r.data.notice; }
	onMount(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); });
	const at = $derived(n ? new Date(n.startsAt).toLocaleTimeString([], { timeStyle: 'short' }) : '');
	const soon = $derived(n ? Date.parse(n.startsAt) > Date.now() : false);
</script>

{#if n}
	<div transition:slide={{ duration: dur(240) }} role="status" class="border-b bg-on-soft px-4 py-2.5 text-sm text-on-foreground md:px-10">
		{#if soon}{n.emergency ? 'An urgent security update' : 'An update'} (version {n.version}) will start at {at}. The app will be unavailable for a few minutes; your devices and automations keep running.
		{:else}Updating to version {n.version} now. The app may be unavailable for a few minutes. Your devices and automations keep running.{/if}
	</div>
{/if}
