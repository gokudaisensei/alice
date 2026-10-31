<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { home } from '#lib/home.svelte.js';
	import { notifications } from '#lib/notifications.svelte.js';
	import Page from '#lib/components/app/Page.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import AlertsPanel from '#lib/components/app/panels/AlertsPanel.svelte';
	import EnergyPanel from '#lib/components/app/panels/EnergyPanel.svelte';
	import Insights from '#lib/components/app/Insights.svelte';

	const options = $derived([{ id: 'alerts', label: 'Alerts', badge: notifications.unread }, { id: 'energy', label: 'Energy' }, { id: 'insights', label: 'Insights' }]);
	let tab = $state(page.url.searchParams.get('tab') ?? 'alerts');
	$effect(() => { const u = new URL(location.href); if (u.searchParams.get('tab') !== tab) { u.searchParams.set('tab', tab); replaceState(u, {}); } });
	const sub = { alerts: 'Things that need your attention. Problems are only reported once they have lasted a few minutes.', energy: 'What your meters are reading, and how the last week looked.', insights: 'Plain observations about your home. Nothing changes unless you choose.' } as Record<string, string>;
	void home;
</script>

<Page title="Activity" subtitle={sub[tab]} width="lg">
	<Segmented {options} bind:value={tab} label="Activity" />
	{#if tab === 'alerts'}<AlertsPanel />{:else if tab === 'energy'}<EnergyPanel />{:else}<Insights full />{/if}
</Page>
