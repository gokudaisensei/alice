<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { WifiOff } from '@lucide/svelte';
</script>

{#if home.haHealth !== 'ok'}
	<div role="alert" class="flex items-start gap-2.5 border-b bg-signal-soft px-4 py-2.5 text-sm text-signal-foreground md:px-10">
		<WifiOff class="mt-0.5 size-4 shrink-0" />
		<p>{home.haHealth === 'auth_failed'
			? 'The home hub rejected the app’s connection. Please contact support.'
			: 'Can’t reach the home hub. Devices show their last known state and can’t be controlled until it’s back. Check that it is powered on and connected to your network.'}</p>
	</div>
{/if}
