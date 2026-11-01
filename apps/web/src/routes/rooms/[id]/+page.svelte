<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	// Rooms are one swipeable page now; old links still land on the right room.
	onMount(() => goto(`/rooms?room=${encodeURIComponent(page.params.id ?? '')}`, { replaceState: true }));
</script>
