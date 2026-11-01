<script lang="ts">
	import Swipeable from '#lib/components/app/Swipeable.svelte';
	import { goto } from '$app/navigation';
	import { home } from '#lib/home.svelte.js';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import { Play, Sparkles, Workflow, Plus } from '@lucide/svelte';
</script>

	<Section>
		{#snippet actions()}{#if home.canManageScenes}<Button size="sm" variant="secondary" href="/scenes/new"><Plus />New scene</Button>{/if}{/snippet}
		{#if home.scenes.length}
			<Group>{#each home.scenes as s (s.id)}
				<Swipeable actions={s.managed && home.canManageScenes ? [{ label: 'Edit', run: () => goto(`/scenes/${encodeURIComponent(s.id)}`) }] : []}><Row title={s.name} description="{s.deviceIds.length} device{s.deviceIds.length === 1 ? '' : 's'}">
					{#snippet icon()}<Sparkles class="size-[18px]" />{/snippet}
					{#snippet trailing()}
						{#if s.managed && home.canManageScenes}<Button size="sm" variant="ghost" href="/scenes/{encodeURIComponent(s.id)}">Edit</Button>{/if}
						<Button size="sm" disabled={!!home.busy[s.id] || home.haHealth !== 'ok'} onclick={() => home.activateScene(s)} aria-label="Activate {s.name}"><Play />Activate</Button>
					{/snippet}
				</Row></Swipeable>
			{/each}</Group>
		{:else if home.loaded}
			<Empty title="No scenes yet" description="A scene remembers how your lights, switches and fans are set right now.">{#if home.canManageScenes}<Button href="/scenes/new">Create a scene</Button>{/if}</Empty>
		{/if}
	</Section>

