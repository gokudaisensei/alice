<script lang="ts">
	import { goto } from '$app/navigation';
	import { home } from '#lib/home.svelte.js';
	import { sceneDoes } from '#lib/behaviours.svelte.js';
	import BehaviourRow from '#lib/components/app/BehaviourRow.svelte';
	import Swipeable from '#lib/components/app/Swipeable.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Play } from '@lucide/svelte';
</script>

{#each home.scenes as s (s.id)}
	<Swipeable actions={s.managed && home.canManageScenes ? [{ label: 'Edit', run: () => goto(`/scenes/${encodeURIComponent(s.id)}`) }] : []}>
		<BehaviourRow kind="scene" name={s.name} does={sceneDoes(s.deviceIds)}>
			{#snippet trailing()}
				{#if s.managed && home.canManageScenes}<Button size="sm" variant="ghost" href="/scenes/{encodeURIComponent(s.id)}">Edit</Button>{/if}
				<Button size="sm" disabled={!!home.busy[s.id] || home.haHealth !== 'ok'} onclick={() => home.activateScene(s)} aria-label="Run the scene {s.name}"><Play />Run</Button>
			{/snippet}
		</BehaviourRow>
	</Swipeable>
{/each}
