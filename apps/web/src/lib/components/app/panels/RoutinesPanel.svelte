<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { routineDoes } from '#lib/behaviours.svelte.js';
	import BehaviourRow from '#lib/components/app/BehaviourRow.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Play } from '@lucide/svelte';
</script>

{#each home.routines as r (r.id)}
	<BehaviourRow kind="routine" name={r.name} does={routineDoes(r.steps)} alert={r.needsAttention ? 'Some steps use devices that are no longer available. Edit this routine to fix them.' : null}>
		{#snippet trailing()}
			{#if home.canManageScenes}<Button size="sm" variant="ghost" href="/routines/{r.id}">Edit</Button>{/if}
			<Button size="sm" disabled={!!home.busy[`routine:${r.id}`] || home.haHealth !== 'ok'} onclick={() => home.runRoutine(r)} aria-label="Run the routine {r.name}"><Play />Run</Button>
		{/snippet}
	</BehaviourRow>
{/each}
