<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { session } from '#lib/session.svelte.js';
	import Page from '#lib/components/app/Page.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import ScenesPanel from '#lib/components/app/panels/ScenesPanel.svelte';
	import RoutinesPanel from '#lib/components/app/panels/RoutinesPanel.svelte';
	import AutomationsPanel from '#lib/components/app/panels/AutomationsPanel.svelte';

	const options = $derived([{ id: 'scenes', label: 'Scenes' }, { id: 'routines', label: 'Routines' }, ...(session.can('automation.manage') ? [{ id: 'automations', label: 'Automations' }] : [])]);
	let tab = $state(page.url.searchParams.get('tab') ?? 'scenes');
	$effect(() => { const u = new URL(location.href); if (u.searchParams.get('tab') !== tab) { u.searchParams.set('tab', tab); replaceState(u, {}); } });
	const sub = { scenes: 'A scene sets several devices at once.', routines: 'A routine does a list of things in order when you start it.', automations: 'Things your home does on its own, on your home hub.' } as Record<string, string>;
</script>

<Page title="Routines" subtitle={sub[tab]} width="lg">
	<Segmented {options} bind:value={tab} label="Routines" />
	{#if tab === 'scenes'}<ScenesPanel />{:else if tab === 'routines'}<RoutinesPanel />{:else}<AutomationsPanel />{/if}
</Page>
