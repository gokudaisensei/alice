<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { notifications, type NotePrefs } from '#lib/notifications.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import * as Card from '#lib/components/ui/card';

	const LABEL: Record<string, string> = { device_offline: 'A device stays offline', lock_open: 'A door stays unlocked', hub: 'The home hub is unreachable', insight: 'Suggestions about energy and devices left on' };
	let p = $state<NotePrefs | null>(null), here = $state(false), msg = $state(''), busy = $state(false);
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

	async function load() { const r = await api('GET', '/api/me/notifications'); if (r.ok) p = r.data; here = await notifications.thisDevice(); }
	onMount(load);
	async function save(patch: object) {
		const r = await api('PUT', '/api/me/notifications', patch);
		if (r.ok) p = { ...p!, ...r.data }; else msg = r.data?.message ?? explain(r.data?.error);
	}
	const toggleKind = (k: string) => save({ muted: p!.muted.includes(k) ? p!.muted.filter((x) => x !== k) : [...p!.muted, k] });
	const quiet = (patch: object) => save({ quiet: { ...p!.quiet, tz, ...patch } });
	async function togglePush() {
		busy = true; msg = '';
		if (here) { await notifications.disablePush(); } else { const e = await notifications.enablePush(); if (e) msg = e; }
		await load(); busy = false;
	}
	async function test() {
		busy = true; const r = await api('POST', '/api/push/test'); busy = false;
		msg = !r.ok ? (r.status === 429 ? 'Please wait a moment before testing again.' : (r.data?.message ?? explain(r.data?.error))) : r.data.sent ? 'Sent. It should arrive in a few seconds.' : 'Nothing was sent: no device is set up for push yet.';
	}
</script>

<Card.Root id="notifications"><Card.Header><Card.Title>Notifications</Card.Title><Card.Description>Only you see these choices. Everything still appears under Alerts.</Card.Description></Card.Header>
	<Card.Content class="space-y-4">
		{#if p}
			<fieldset class="space-y-2"><legend class="text-sm font-medium">Tell me when</legend>
				{#each p.kinds as k}<label class="flex items-center gap-2"><input type="checkbox" class="size-4" checked={!p.muted.includes(k)} onchange={() => toggleKind(k)} />{LABEL[k] ?? k}</label>{/each}
			</fieldset>
			<fieldset class="space-y-2"><legend class="text-sm font-medium">Quiet hours</legend>
				<label class="flex items-center gap-2"><input type="checkbox" class="size-4" checked={p.quiet.enabled} onchange={(e) => quiet({ enabled: e.currentTarget.checked })} />Don't send push notifications during these hours</label>
				{#if p.quiet.enabled}
					<div class="flex flex-wrap items-center gap-2 text-sm">From <Input type="time" class="w-32" value={p.quiet.start} onchange={(e) => quiet({ start: e.currentTarget.value })} aria-label="Quiet hours start" /> until <Input type="time" class="w-32" value={p.quiet.end} onchange={(e) => quiet({ end: e.currentTarget.value })} aria-label="Quiet hours end" /> <span class="text-muted-foreground">({tz})</span></div>
					<p class="text-xs text-muted-foreground">Alerts still wait for you under Alerts.</p>
				{/if}
			</fieldset>
			{#if p.pushAvailable}
				<div class="space-y-2"><p class="text-sm font-medium">Push notifications on this device</p>
					<div class="flex flex-wrap gap-2"><Button variant={here ? 'outline' : 'default'} disabled={busy} onclick={togglePush}>{here ? 'Turn off on this device' : 'Turn on for this device'}</Button>
						{#if p.pushDevices}<Button variant="outline" disabled={busy} onclick={test}>Send a test</Button>{/if}</div>
					<p class="text-xs text-muted-foreground">{p.pushDevices} device{p.pushDevices === 1 ? '' : 's'} set up. Messages go through your browser's push service, so they need an internet connection. On an iPhone, add the app to your Home Screen first.</p></div>
			{/if}
			{#if msg}<p role="status" class="text-sm">{msg}</p>{/if}
		{/if}
	</Card.Content></Card.Root>
