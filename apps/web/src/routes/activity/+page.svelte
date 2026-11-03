<script lang="ts">
	import { page } from '$app/state';
	import { replaceState } from '$app/navigation';
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { notifications } from '#lib/notifications.svelte.js';
	import Page from '#lib/components/app/Page.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import AlertsPanel from '#lib/components/app/panels/AlertsPanel.svelte';
	import EnergyPanel from '#lib/components/app/panels/EnergyPanel.svelte';
	import Insights from '#lib/components/app/Insights.svelte';

	const guest = $derived(session.me?.role === 'guest');
	const options = $derived(guest ? [] : [{ id: 'alerts', label: 'Alerts', badge: notifications.unread }, { id: 'energy', label: 'Energy' }, { id: 'insights', label: 'Insights' }]);
	let tab = $state(page.url.searchParams.get('tab') ?? 'alerts');
	$effect(() => { if (guest && tab !== 'alerts') tab = 'alerts'; });
	$effect(() => { const u = new URL(location.href); if (u.searchParams.get('tab') !== tab) { u.searchParams.set('tab', tab); replaceState(u, {}); } });
	const sub = { alerts: 'Things that need your attention.', energy: 'What your meters read now, and how the last week looked.', insights: 'Plain observations about your home. Nothing changes unless you choose.' } as Record<string, string>;
	void home;
</script>

<Page title="Activity" subtitle={sub[tab]} width="lg">
	{#if options.length}<Segmented {options} bind:value={tab} label="Activity" />{/if}
	{#if tab === 'alerts'}<AlertsPanel />{:else if tab === 'energy'}<EnergyPanel />{:else}<Insights full />{/if}
</Page>
