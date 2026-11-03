<script lang="ts">
	import { slide } from 'svelte/transition';
	import { dur } from '#lib/motion.js';
	import { onMount } from 'svelte';
	import { home } from '#lib/home.svelte.js';
	import { CloudOff, WifiOff } from '@lucide/svelte';
	let now = $state(Date.now());
	onMount(() => { const t = setInterval(() => (now = Date.now()), 20_000); return () => clearInterval(t); });
	const ago = $derived.by(() => {
		if (!home.lastOkAt) return null;
		const m = Math.max(0, Math.round((now - home.lastOkAt) / 60_000));
		return m < 1 ? 'just now' : m === 1 ? '1 minute ago' : m < 60 ? `${m} minutes ago` : `${Math.round(m / 60)} hours ago`;
	});
</script>

{#if !home.online}
	<div transition:slide={{ duration: dur(240) }} role="status" class="flex items-start gap-2.5 border-b bg-secondary px-4 py-2.5 text-sm md:px-10">
		<WifiOff class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
		<p><span class="font-medium">You’re offline.</span> This phone has no connection{#if ago}, so this is how things were {ago}{/if}. Controls are paused and will work again as soon as you’re back online.</p>
	</div>
{:else if home.haHealth !== 'ok'}
	<div transition:slide={{ duration: dur(240) }} role="status" class="flex items-start gap-2.5 border-b bg-secondary px-4 py-2.5 text-sm md:px-10">
		<CloudOff class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
		<p>{#if home.haHealth === 'auth_failed'}<span class="font-medium">The hub refused the app’s access.</span> Please contact support.
			{:else}<span class="font-medium">Can’t reach the home hub.</span> {#if ago}Showing how things were {ago}. {/if}Controls are paused until it’s back. Check that it has power and is on your network.{/if}</p>
	</div>
{/if}
