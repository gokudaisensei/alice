<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	let s = $state<any>(null);
	async function load() { const r = await api('GET', '/api/support'); if (r.ok) s = r.data.active; }
	onMount(() => { load(); const t = setInterval(load, 60_000); window.addEventListener('support-changed', load); return () => { clearInterval(t); window.removeEventListener('support-changed', load); }; });
	const until = $derived(s ? new Date(s.expiresAt).toLocaleTimeString([], { timeStyle: 'short' }) : '');
</script>

{#if s}
	<div role="status" class="flex flex-wrap items-center justify-between gap-2 border-b bg-primary/10 px-4 py-2 text-sm">
		<span>Support access is allowed until {until}.{s.connected ? ` ${s.operatorName} is connected.` : ''}</span>
		<a class="underline" href="/admin/system">Manage</a>
	</div>
{/if}
