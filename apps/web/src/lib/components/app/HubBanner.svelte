<script lang="ts">
	import { home } from '#lib/home.svelte.js';
</script>

{#if home.haHealth !== 'ok'}
	<div role="alert" class="border-b bg-destructive/10 px-4 py-3 text-sm text-destructive">
		{home.haHealth === 'auth_failed'
			? 'The home hub rejected the app’s connection. Please contact support.'
			: 'Can’t reach the home hub. Devices below show their last known state and can’t be controlled until it’s back. Check that it is powered on and connected to your network.'}
	</div>
{/if}
