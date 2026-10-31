<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';
	onMount(() => goto('/activity?tab=alerts', { replaceState: true }));
</script>
