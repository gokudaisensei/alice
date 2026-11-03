<script lang="ts">
	import { Checkbox } from '#lib/components/ui/checkbox';
	import Picker from '#lib/components/app/Picker.svelte';
	import { onMount } from 'svelte';
	import { api, explain, sensitive, type ApiResult } from '#lib/api.js';
	import type { Check, Health, Support, UpdateStatus } from '#lib/dto.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Badge } from '#lib/components/ui/badge';
	import Page from '#lib/components/app/Page.svelte';
	import SkeletonList from '#lib/components/app/SkeletonList.svelte';
	import Section from '#lib/components/app/Section.svelte';
	import Group from '#lib/components/app/Group.svelte';
	import { clock, longDate, plural } from '#lib/fmt.js';
	import { Activity, CircleCheck, TriangleAlert } from '@lucide/svelte';

	type Backup = { id: string; createdAt: number; kind: string; size: number; level: 'failed' | 'integrity_checked' | 'restore_tested'; offDevice: boolean; copies: { name: string; local: boolean; state: string }[]; restoreTest: { at: number; ok: boolean; detail: string } | null };
	type Backups = { recipientSet: boolean; recipient: string | null; destinations: { name: string; local: boolean; writable: boolean; freeBytes: number | null }[]; backups: Backup[] };
	let health = $state<Health | null>(null);
	let bk = $state<Backups | null>(null);
	let sup = $state<{ active: Support | null; canManage: boolean } | null>(null);
	let msg = $state(''), busy = $state(false), newKey = $state(''), testing = $state<string | null>(null), identity = $state('');
	let upd = $state<UpdateStatus | null>(null), loaded = $state(false);
	let scopes = $state<string[]>(['diagnostics']), hours = $state(4);

	async function load() {
		const [h, b, s, u] = await Promise.all([api<Health>('GET', '/api/admin/health'), api<Backups>('GET', '/api/admin/backups'), api<{ active: Support | null; canManage: boolean }>('GET', '/api/support'), api<UpdateStatus>('GET', '/api/admin/updates')]);
		if (h.ok) health = h.data; if (b.ok) bk = b.data; if (s.ok) sup = s.data; if (u.ok) upd = u.data;
		loaded = true;
		window.dispatchEvent(new Event('support-changed'));
	}
	onMount(load);
	const SEV = { fail: 0, warn: 1, ok: 2 } as const;
	const issues = $derived((health?.checks ?? []).filter((c) => c.status !== 'ok').sort((a, b) => SEV[a.status] - SEV[b.status]));
	const worst = $derived(issues[0]?.status ?? 'ok');
	const headline = $derived(!health ? 'Checking your home' : !issues.length ? 'Everything is working' : worst === 'fail' ? (issues.length === 1 ? 'One thing needs attention now' : `${issues.length} things need attention, one of them now`) : issues.length === 1 ? 'One thing needs attention' : `${issues.length} things need attention`);
	const chk = (id: string) => health?.checks.find((c) => c.id === id);
	/** The questions a household actually asks, answered in plain words. */
	const outcomes = $derived.by(() => {
		const hub = chk('hub'), b = chk('backup'), u = chk('updates');
		const ans = (c: Check | undefined, ok: string, bad: string) => ({ status: c?.status ?? 'ok', a: !c || c.status === 'ok' ? ok : bad });
		return [
			{ q: 'Is the home hub online?', ...ans(hub, 'Yes, and the app is talking to it.', hub?.detail ?? '') },
			{ q: 'Are backups healthy?', ...ans(b, 'Yes, a recent backup is safely stored.', b?.detail ?? '') },
			{ q: 'Is an update available?', ...ans(u, upd?.configured && upd.available ? `Yes, version ${upd.available.version}.` : 'No, you are up to date.', u?.detail ?? '') }
		] as { q: string; status: 'ok' | 'warn' | 'fail'; a: string }[];
	});
	const fail = (r: Extract<ApiResult<unknown>, { ok: false }>) => (msg = r.data.message ?? explain(r.data.error));
	const dot = { ok: 'bg-ok', warn: 'bg-on', fail: 'bg-signal' } as const;
	const when = (ts: number) => `${longDate(ts)}, ${clock(ts)}`;
	const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
	const LEVEL = { failed: 'Failed its check', integrity_checked: 'Checked · not test-restored', restore_tested: 'Restore tested' } as const;

	async function makeKey() { busy = true; const r = await sensitive<{ identity: string }>('POST', '/api/admin/backups/key'); busy = false; if (r.ok) { newKey = r.data.identity; msg = ''; await load(); } else fail(r); }
	function saveKey() {
		const url = URL.createObjectURL(new Blob([`# Smart Home backup key. Keep this OFF the home device.\n# Anyone with this file can read your backups; without it, nobody can.\n${newKey}\n`], { type: 'text/plain' }));
		const a = Object.assign(document.createElement('a'), { href: url, download: 'home-backup-key.txt' }); a.click(); URL.revokeObjectURL(url);
	}
	async function backupNow() { busy = true; msg = ''; const r = await api('POST', '/api/admin/backups'); busy = false; if (!r.ok) fail(r); else msg = 'Backup made and checked.'; await load(); }
	async function restoreTest(b: Backup) {
		busy = true; const r = await sensitive<{ detail: string }>('POST', `/api/admin/backups/${b.id}/restore-test`, { identity: identity.trim() }); busy = false;
		if (!r.ok) fail(r); else { msg = r.data.detail; identity = ''; testing = null; } // the key is never kept
		await load();
	}
	async function download(b: Backup) {
		const r = await sensitive('GET', `/api/admin/backups/${b.id}/ready`);
		if (!r.ok) { fail(r); return; }
		location.href = `/api/admin/backups/${b.id}/download`;
	}
	async function install() { if (!upd?.configured || !upd.available) return; if (!confirm(`Install version ${upd.available.version}? The app will be unavailable for a few minutes. Your devices and automations keep running.`)) return; busy = true; const r = await sensitive('POST', '/api/admin/updates/apply', { version: upd.available.version }); busy = false; if (!r.ok) fail(r); else msg = 'Update requested. The app will restart shortly; this page may go blank for a few minutes.'; await load(); }
	async function grant() { busy = true; const r = await sensitive('POST', '/api/admin/support', { scopes, hours }); busy = false; if (!r.ok) fail(r); await load(); }
	async function revoke() { if (!sup?.active || busy) return; busy = true; const r = await api('DELETE', `/api/admin/support/${sup.active.id}`); busy = false; if (!r.ok) fail(r); await load(); }
	/** What a support operator can be allowed to do, in the order they're offered. */
	const SCOPES = [
		{ key: 'diagnostics', title: 'See health checks', hint: 'No personal data' },
		{ key: 'read_config', title: 'Look at how your home is set up', hint: 'Room, device and automation names. No people, no history.' }
	] as const;
	const toggle = (s: string) => (scopes = scopes.includes(s) ? scopes.filter((x) => x !== s) : [...scopes, s]);
</script>

<Page title="System" subtitle="Is everything working, and does anything need you?" width="md">
	{#if msg}<p role="status" class="rounded-2xl bg-accent px-4 py-3 text-sm">{msg}</p>{/if}

	<section class="space-y-3" aria-labelledby="sys-status">
		<div class="flex items-start gap-3 rounded-2xl p-5 {!health ? 'bg-secondary/60' : worst === 'ok' ? 'bg-ok/10' : worst === 'warn' ? 'bg-on-soft' : 'bg-signal-soft'}">
			<span class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl bg-background/60 {!health ? 'text-muted-foreground' : worst === 'ok' ? 'text-ok' : worst === 'warn' ? 'text-on-foreground' : 'text-signal'}">{#if worst === 'ok'}<CircleCheck class="size-5" />{:else if health}<TriangleAlert class="size-5" />{:else}<Activity class="size-5" />{/if}</span>
			<div><h2 id="sys-status" class="text-lg font-semibold tracking-[-0.02em]">{headline}</h2>
				<p class="mt-0.5 text-sm text-muted-foreground">{health ? (issues.length ? 'Start with the first item below.' : 'The connection, backups and updates are all fine.') : 'Checking your home…'}</p></div>
		</div>
		{#if !loaded}<SkeletonList kind="rows" count={3} />{/if}
		{#if issues.length}
			<Group>{#each issues as c (c.id)}
				<div class="flex gap-3 px-4 py-3"><span class="mt-1.5 size-2.5 shrink-0 rounded-full {dot[c.status]}" aria-hidden="true"></span>
					<div><p class="font-medium">{c.label}<span class="sr-only">: {c.status === 'fail' ? 'needs attention now' : 'needs a look'}</span></p><p class="text-sm text-muted-foreground">{c.detail}</p>{#if c.advice}<p class="text-sm">{c.advice}</p>{/if}</div></div>
			{/each}</Group>
		{/if}
		{#if health}
			<Group>
				{#each outcomes as o}<div class="flex items-center gap-3 px-4 py-3"><span class="size-2.5 shrink-0 rounded-full {dot[o.status]}" aria-hidden="true"></span><div class="min-w-0 flex-1"><p class="text-[0.9375rem] font-medium leading-tight">{o.q}</p><p class="text-sm text-muted-foreground">{o.a}</p></div></div>{/each}
			</Group>
			<details class="rounded-2xl bg-secondary/60 px-4 py-3 text-sm"><summary class="cursor-pointer font-medium">Advanced details</summary>
				<dl class="mt-3 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
					<dt class="text-muted-foreground">Version</dt><dd>{health.facts.version}</dd>
					<dt class="text-muted-foreground">Running for</dt><dd>{plural(Math.round(health.facts.uptimeSeconds / 3600), 'hour')}</dd>
					<dt class="text-muted-foreground">Memory in use</dt><dd>{health.facts.memoryMb} MB</dd>
					<dt class="text-muted-foreground">Data size</dt><dd>{mb(health.facts.dbBytes)}</dd>
					<dt class="text-muted-foreground">Data format</dt><dd>{health.facts.schema}</dd>
					<dt class="text-muted-foreground">Devices with notifications</dt><dd>{health.facts.pushDevices}</dd>
				</dl>
				{#each health.checks.filter((c) => c.status === 'ok') as c}<p class="mt-3 text-muted-foreground"><span class="font-medium text-foreground">{c.label}:</span> {c.detail}</p>{/each}
			</details>
		{/if}
	</section>

	{#if !loaded}
	<SkeletonList kind="rows" count={2} />
{:else}
	<Section title="Backups" hint="Encrypted copies of the app's data. The home hub's own settings are backed up separately."><div class="space-y-4 rounded-2xl border bg-card p-4">
			{#if bk && !bk.recipientSet}
				<p class="text-sm">First, create a backup key. You'll download a file that is the only way to open a backup. <strong>Keep it somewhere other than this home device</strong>, such as a password manager or a printout.</p>
				<Button disabled={busy} onclick={makeKey}>Create backup key</Button>
			{/if}
			{#if newKey}
				<div class="space-y-2 rounded-lg border border-transparent bg-primary/10 p-3" role="alert"><p class="text-sm font-medium">This is the only time the key is shown.</p>
					<p class="break-all font-mono text-xs">{newKey}</p><Button onclick={saveKey}>Download the key file</Button> <Button variant="ghost" onclick={() => (newKey = '')}>I've saved it</Button></div>
			{/if}
			{#if bk?.recipientSet}
				<div class="space-y-1">{#each bk.destinations as d}
					<p class="flex items-center gap-2 text-sm"><span class="size-2 rounded-full {d.writable ? 'bg-ok' : 'bg-signal'}"></span>{d.name}{d.local ? ' (this device only)' : ''}: {d.writable ? (d.freeBytes !== null ? `${mb(d.freeBytes)} free` : 'ready') : 'not available'}</p>
				{/each}</div>
				{#if !bk.destinations.some((d) => !d.local && d.writable)}<p class="text-sm text-signal">No backup drive or network share is connected. A backup only on this device is lost if the device fails.</p>{/if}
				<Button disabled={busy} onclick={backupNow}>Back up now</Button>
				<ul class="space-y-2">{#each bk.backups.slice(0, 8) as b (b.id)}
					<li class="space-y-1 rounded-xl border p-3"><div class="flex flex-wrap items-center justify-between gap-2"><span class="font-medium">{when(b.createdAt)} <span class="text-sm font-normal text-muted-foreground">· {mb(b.size)} · {b.kind === 'auto' ? 'automatic' : 'manual'}</span></span><Badge variant={b.level === 'restore_tested' ? 'default' : 'outline'}>{LEVEL[b.level]}</Badge></div>
						<p class="text-xs text-muted-foreground">{b.copies.map((c) => `${c.name}: ${c.state === 'ok' ? 'intact' : c.state}`).join(' · ')}</p>
						{#if b.restoreTest}<p class="text-xs {b.restoreTest.ok ? '' : 'text-signal'}">{b.restoreTest.detail}</p>{/if}
						<div class="flex gap-1"><Button size="sm" variant="secondary" onclick={() => (testing = testing === b.id ? null : b.id)}>Test restore</Button><Button size="sm" variant="ghost" onclick={() => download(b)}>Download</Button></div>
						{#if testing === b.id}<div class="space-y-2 pt-1"><label class="text-sm" for="id-{b.id}">Paste your backup key. It's used once, here, and never stored.</label><Input id="id-{b.id}" type="password" autocomplete="off" bind:value={identity} placeholder="AGE-SECRET-KEY-…" /><Button size="sm" disabled={busy || !identity.trim()} onclick={() => restoreTest(b)}>Run test</Button></div>{/if}
					</li>{:else}<li class="text-sm text-muted-foreground">No backups yet. Use “Back up now” to make the first one.</li>{/each}</ul>
				<p class="text-xs text-muted-foreground">To restore for real after a failure, use the offline restore command in the recovery guide; it needs your key.</p>
			{/if}
		</div></Section>

	<Section title="Updates" hint="Keep your home up to date."><div class="space-y-4 rounded-2xl border bg-card p-4">
			{#if upd && !upd.configured}<p class="text-sm text-muted-foreground">Updates on this device are installed by your support team.</p>
			{:else if upd}
				<p class="text-sm">You have version <strong>{upd.current}</strong>.{#if upd.state === 'applying'} An update is being installed right now.{/if}</p>
				{#if upd.state === 'failed'}<p class="text-sm text-signal">{upd.message}</p>{/if}
				{#if upd.available}
					<div class="space-y-2 rounded-xl border p-3"><p class="font-medium">Version {upd.available.version} is ready</p>{#if upd.available.notes}<p class="text-sm text-muted-foreground">{upd.available.notes}</p>{/if}
						<p class="text-xs text-muted-foreground">Takes a few minutes. The app is unavailable meanwhile; your devices and automations keep running on the home hub. A safety copy of your data is made first.</p>
						<Button disabled={busy || upd.state === 'applying'} onclick={install}>Install now</Button></div>
				{:else if upd.state !== 'applying'}<p class="text-sm text-muted-foreground">You're up to date.{#if upd.lastCheckAt} Last checked {longDate(upd.lastCheckAt)}, {clock(upd.lastCheckAt)}.{/if}</p>{/if}
				<details class="text-xs text-muted-foreground"><summary class="cursor-pointer">Why can I trust updates?</summary><p class="mt-1">Each update is checked for the right signature before it is installed, and undone automatically if it doesn't start properly. Rarely, an urgent security fix may be installed without waiting for you; you'll always be told before it starts and after it finishes.</p></details>
			{/if}
		</div></Section>

	<Section title="Support access" hint="Our support team can only look at your home while you allow it. You can end it at any time."><div class="space-y-4 rounded-2xl border bg-card p-4">
			{#if sup?.active}
				<p class="text-sm">Allowed until <strong>{when(sup.active.expiresAt)}</strong> for: {sup.active.scopes.map((s) => (s === 'diagnostics' ? 'health checks' : 'a read-only look at your setup')).join(' and ')}. {sup.active.connected ? `${sup.active.operatorName} is connected.` : 'Nobody has connected yet.'}</p>
				<Button variant="destructive" disabled={busy} onclick={revoke}>End support access now</Button>
			{:else}
				<div class="space-y-2">
					<p class="text-sm font-medium">They may</p>
					<div class="overflow-hidden rounded-xl border">
						{#each SCOPES as { key: k, title: t, hint: d }}
							<button type="button" role="checkbox" aria-checked={scopes.includes(k)} onclick={() => toggle(k)} class="flex min-h-14 w-full items-center gap-3 border-b px-3.5 py-2.5 text-left last:border-b-0 active:bg-muted"><Checkbox checked={scopes.includes(k)} /><span><span class="block text-sm font-medium">{t}</span><span class="text-sm text-muted-foreground">{d}</span></span></button>
						{/each}
					</div>
				</div>
				<div class="flex items-center gap-3 text-sm">For <Picker class="w-36" label="How long" bind:value={hours} options={[1, 4, 24, 72].map((h) => ({ value: h, label: plural(h, 'hour') }))} /></div>
				<Button disabled={busy || !scopes.length} onclick={grant}>Allow support access</Button>
			{/if}
		</div></Section>
{/if}
</Page>
