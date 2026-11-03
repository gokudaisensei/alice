<script lang="ts">
	import { slide } from 'svelte/transition';
	import { dur } from '#lib/motion.js';
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import type { Support } from '#lib/dto.js';
	let s = $state<Support | null>(null);
	async function load() { const r = await api<{ active: Support | null }>('GET', '/api/support'); if (r.ok) s = r.data.active; }
	onMount(() => { load(); const t = setInterval(load, 60_000); window.addEventListener('support-changed', load); return () => { clearInterval(t); window.removeEventListener('support-changed', load); }; });
	const until = $derived(s ? new Date(s.expiresAt).toLocaleTimeString([], { timeStyle: 'short' }) : '');
</script>

{#if s}
	<div transition:slide={{ duration: dur(240) }} role="status" class="flex flex-wrap items-center justify-between gap-2 border-b bg-accent px-4 py-2.5 text-sm md:px-10">
		<span>Support access is allowed until {until}.{s.connected ? ` ${s.operatorName} is connected.` : ''}</span>
		<a class="underline" href="/admin/system">Manage</a>
	</div>
{/if}
