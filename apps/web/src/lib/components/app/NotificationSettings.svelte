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
	import { plural } from '#lib/fmt.js';
	import { BellRing, ShieldAlert } from '@lucide/svelte';

	const LABEL: Record<string, string> = { device_offline: 'A device stays offline', lock_open: 'A door stays unlocked', hub: 'The home hub is unreachable', insight: 'Suggestions about energy and devices left on', power: 'A plug stays above its power limit', safety: 'Smoke, gas, a water leak or an alarm', battery: 'A battery is running low', open_long: 'A door or window is left open', ha_issue: 'Home Assistant needs attention', from_ha: 'Messages from your home automations' };
	const GROUPS = [
		{ title: 'Security and safety', hint: 'Worth hearing about straight away. We suggest keeping these on.', kinds: ['safety', 'lock_open', 'hub'], essential: true },
		{ title: 'Home activity', hint: 'Things that need a look when you are able.', kinds: ['device_offline', 'battery', 'open_long', 'power', 'from_ha'], essential: false },
		{ title: 'Updates and suggestions', hint: 'Helpful, never urgent.', kinds: ['ha_issue', 'insight'], essential: false }
	];
	const ABOUT: Record<string, string> = { lock_open: 'A door has been left unlocked for a while.', hub: 'The app has lost contact with your home hub.', device_offline: 'Something has been unreachable for a while.', power: 'A plug is using more power than the limit you set.', insight: 'Ideas for saving energy.', safety: 'A smoke, carbon monoxide, gas or leak sensor has gone off, or your alarm has.', battery: 'A sensor or lock battery has stayed low.', open_long: 'A door or window has been open for a while.', ha_issue: 'Home Assistant has a repair, an update or a problem to look at.', from_ha: 'Something in Home Assistant sent you a message through Alice.' };
	let why = $state(false);
	let p = $state<NotePrefs | null>(null), here = $state(false), msg = $state(''), busy = $state(false);
	const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

	async function load() { const r = await api<NotePrefs>('GET', '/api/me/notifications'); if (r.ok) p = r.data; here = await notifications.thisDevice(); }
	onMount(load);
	async function save(patch: object) {
		const r = await api<Pick<NotePrefs, 'muted' | 'quiet' | 'criticalBypass'>>('PUT', '/api/me/notifications', patch);
		if (r.ok && p) p = { ...p, ...r.data };
		else if (r.ok) p = null; else msg = r.data?.message ?? explain(r.data?.error);
	}
	const toggleKind = (k: string) => p && save({ muted: p.muted.includes(k) ? p.muted.filter((x) => x !== k) : [...p.muted, k] });
	const quiet = (patch: object) => save({ quiet: { ...p!.quiet, tz, ...patch } });
	async function togglePush() {
		busy = true; msg = '';
		if (here) { await notifications.disablePush(); } else { const e = await notifications.enablePush(); if (e) msg = e; }
		await load(); busy = false;
	}
	async function test() {
		busy = true; const r = await api<{ sent: number }>('POST', '/api/push/test'); busy = false;
		msg = !r.ok ? (r.status === 429 ? 'Please wait a moment before testing again.' : (r.data?.message ?? explain(r.data?.error))) : r.data.sent ? 'Sent. It should arrive in a few seconds.' : 'Nothing was sent: no device is set up for push yet.';
	}
</script>

<div id="notifications" class="scroll-mt-20 space-y-9">
	{#if p}
		{#if p.pushAvailable}
			<Section title="Notifications on this device">
				<div class="rounded-2xl p-5 {here ? 'bg-primary/10' : 'bg-secondary/60'}">
					<div class="flex items-start gap-3">
						<span class="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary"><BellRing class="size-5" /></span>
						<div class="min-w-0 flex-1">
							<p class="font-semibold">{here ? 'Notifications are on' : 'Notifications are off'}</p>
							<p class="mt-0.5 text-sm text-muted-foreground">{here ? 'This device will be told when something needs you.' : 'Turn them on to be told about important things even when the app is closed.'}{#if p.pushDevices} {plural(p.pushDevices, 'device')} set up.{/if}</p>
							<div class="mt-3 flex flex-wrap gap-2">
								<Button disabled={busy} variant={here ? 'secondary' : 'default'} onclick={togglePush}>{here ? 'Turn off' : 'Turn on notifications'}</Button>
								{#if here || p.pushDevices}<Button variant="secondary" disabled={busy} onclick={test}>Send a test notification</Button>{/if}
							</div>
							<button type="button" class="mt-3 text-sm text-muted-foreground underline" aria-expanded={why} onclick={() => (why = !why)}>Why might this not work?</button>
							{#if why}<p class="mt-1 text-sm text-muted-foreground">Notifications are sent through your browser's push service, so they need an internet connection. On an iPhone, add the app to your Home Screen first.</p>{/if}
						</div>
					</div>
				</div>
				{#if msg}<p role="status" class="rounded-2xl bg-accent px-4 py-3 text-sm">{msg}</p>{/if}
			</Section>
		{:else}
			<p class="rounded-2xl bg-secondary/60 px-4 py-3 text-sm text-muted-foreground">Phone notifications are not available on this home yet. Alerts still appear in the app.</p>
		{/if}

		{#each GROUPS as g}
			{@const ks = g.kinds.filter((k) => p!.kinds.includes(k))}
			{#if ks.length}
				<Section title={g.title} hint={g.hint}>
					<Group>{#each ks as k}
						<Row title={LABEL[k] ?? k} description={ABOUT[k]}>{#snippet trailing()}{#if g.essential}<span class="inline-flex items-center gap-1 text-xs text-muted-foreground"><ShieldAlert class="size-3.5" />Essential</span>{/if}<Switch checked={!(p?.muted ?? []).includes(k)} aria-label={LABEL[k] ?? k} onCheckedChange={() => toggleKind(k)} />{/snippet}</Row>
					{/each}</Group>
				</Section>
			{/if}
		{/each}
		<p class="-mt-5 text-sm text-muted-foreground">Everything still appears under Alerts. These choices only decide what is worth a notification.</p>

		<Section title="Quiet hours" hint="Notifications wait until quiet hours end. Alerts stay in the app.">
			<Group>
				<Row title="Hold back notifications" description={p.quiet.enabled ? `From ${p.quiet.start} until ${p.quiet.end} (${tz})` : undefined}>{#snippet trailing()}<Switch checked={!!p?.quiet.enabled} aria-label="Quiet hours" onCheckedChange={(v) => quiet({ enabled: v })} />{/snippet}</Row>
				<Row title="Let safety alerts through" description="Smoke, gas, leak and alarm alerts will still sound during quiet hours.">{#snippet trailing()}<Switch checked={!!p?.criticalBypass} aria-label="Safety alerts during quiet hours" onCheckedChange={(v) => save({ criticalBypass: v })} />{/snippet}</Row>
				{#if p.quiet.enabled}
					<div class="flex flex-wrap items-center gap-2 px-4 py-3 text-sm">From <Input type="time" class="w-32" value={p.quiet.start} onchange={(e) => quiet({ start: e.currentTarget.value })} aria-label="Quiet hours start" /> until <Input type="time" class="w-32" value={p.quiet.end} onchange={(e) => quiet({ end: e.currentTarget.value })} aria-label="Quiet hours end" /></div>
				{/if}
			</Group>
		</Section>
		{#if msg && !p.pushAvailable}<p role="status" class="rounded-2xl bg-accent px-4 py-3 text-sm">{msg}</p>{/if}
	{/if}
</div>
