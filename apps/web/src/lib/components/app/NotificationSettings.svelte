<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { notifications, type NotePrefs } from '#lib/notifications.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import Row from '#lib/components/app/Row.svelte';
	import { Switch } from '#lib/components/ui/switch';

	const LABEL: Record<string, string> = { device_offline: 'A device stays offline', lock_open: 'A door stays unlocked', hub: 'The home hub is unreachable', insight: 'Suggestions about energy and devices left on', power: 'A plug stays above its power limit' };
	let p = $state<NotePrefs | null>(null), here = $state(false), msg = $state(''), busy = $state(false);
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

	async function load() { const r = await api('GET', '/api/me/notifications'); if (r.ok) p = r.data; here = await notifications.thisDevice(); }
	onMount(load);
	async function save(patch: object) {
		const r = await api('PUT', '/api/me/notifications', patch);
		if (r.ok) p = { ...p!, ...r.data }; else msg = r.data?.message ?? explain(r.data?.error);
	}
	const toggleKind = (k: string) => p && save({ muted: p.muted.includes(k) ? p.muted.filter((x) => x !== k) : [...p.muted, k] });
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

<div id="notifications" class="scroll-mt-20 space-y-9">
	{#if p}
		<Section title="Alerts" hint="Everything still appears under Alerts. These choices only decide what is worth a notification.">
			<Group>{#each p.kinds as k}
				<Row title={LABEL[k] ?? k}>{#snippet trailing()}<Switch checked={!(p?.muted ?? []).includes(k)} aria-label={LABEL[k] ?? k} onCheckedChange={() => toggleKind(k)} />{/snippet}</Row>
			{/each}</Group>
		</Section>

		<Section title="Quiet hours" hint="Push notifications wait until quiet hours end. Alerts stay in the app.">
			<Group>
				<Row title="Hold back push notifications" description={p.quiet.enabled ? `From ${p.quiet.start} until ${p.quiet.end} (${tz})` : undefined}>{#snippet trailing()}<Switch checked={!!p?.quiet.enabled} aria-label="Quiet hours" onCheckedChange={(v) => quiet({ enabled: v })} />{/snippet}</Row>
				{#if p.quiet.enabled}
					<div class="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">From <Input type="time" class="w-32" value={p.quiet.start} onchange={(e) => quiet({ start: e.currentTarget.value })} aria-label="Quiet hours start" /> until <Input type="time" class="w-32" value={p.quiet.end} onchange={(e) => quiet({ end: e.currentTarget.value })} aria-label="Quiet hours end" /></div>
				{/if}
			</Group>
		</Section>

		{#if p.pushAvailable}
			<Section title="Push notifications" hint="Sent through your browser's push service, so they need an internet connection. On an iPhone, add the app to your Home Screen first.">
				<Group>
					<Row title="This device" description={here ? 'Notifications are on' : 'Notifications are off'}>{#snippet trailing()}<Button size="sm" variant={here ? 'secondary' : 'default'} disabled={busy} onclick={togglePush}>{here ? 'Turn off' : 'Turn on'}</Button>{/snippet}</Row>
					{#if p.pushDevices}<Row title="Send a test" description="{p.pushDevices} device{p.pushDevices === 1 ? '' : 's'} set up">{#snippet trailing()}<Button size="sm" variant="secondary" disabled={busy} onclick={test}>Send</Button>{/snippet}</Row>{/if}
				</Group>
			</Section>
		{/if}
		{#if msg}<p role="status" class="rounded-2xl bg-accent px-4 py-3 text-sm">{msg}</p>{/if}
	{/if}
</div>
