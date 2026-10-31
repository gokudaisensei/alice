<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain, sensitive } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Badge } from '#lib/components/ui/badge';
	import * as Card from '#lib/components/ui/card';

	type Check = { id: string; label: string; status: 'ok' | 'warn' | 'fail'; detail: string; advice?: string };
	type Backup = { id: string; createdAt: number; kind: string; size: number; level: 'failed' | 'integrity_checked' | 'restore_tested'; offDevice: boolean; copies: { name: string; local: boolean; state: string }[]; restoreTest: { at: number; ok: boolean; detail: string } | null };
	let health = $state<{ overall: string; checks: Check[]; facts: any } | null>(null);
	let bk = $state<{ recipientSet: boolean; recipient: string | null; destinations: { name: string; local: boolean; writable: boolean; freeBytes: number | null }[]; backups: Backup[] } | null>(null);
	let sup = $state<{ active: any; canManage: boolean } | null>(null);
	let msg = $state(''), busy = $state(false), newKey = $state(''), testing = $state<string | null>(null), identity = $state('');
	let upd = $state<any>(null);
	let scopes = $state<string[]>(['diagnostics']), hours = $state(4);

	async function load() {
		const [h, b, s, u] = await Promise.all([api('GET', '/api/admin/health'), api('GET', '/api/admin/backups'), api('GET', '/api/support'), api('GET', '/api/admin/updates')]);
		if (h.ok) health = h.data; if (b.ok) bk = b.data; if (s.ok) sup = s.data; if (u.ok) upd = u.data;
		window.dispatchEvent(new Event('support-changed'));
	}
	onMount(load);
	const fail = (r: { data: any }) => (msg = r.data?.message ?? explain(r.data?.error));
	const dot = { ok: 'bg-green-500', warn: 'bg-amber-500', fail: 'bg-destructive' } as const;
	const when = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
	const mb = (n: number) => `${(n / 1048576).toFixed(1)} MB`;
	const LEVEL = { failed: 'Failed its check', integrity_checked: 'Checked · not test-restored', restore_tested: 'Restore tested' } as const;

	async function makeKey() { busy = true; const r = await sensitive('POST', '/api/admin/backups/key'); busy = false; if (r.ok) { newKey = r.data.identity; msg = ''; await load(); } else fail(r); }
	function saveKey() {
		const url = URL.createObjectURL(new Blob([`# Smart Home backup key. Keep this OFF the home device.\n# Anyone with this file can read your backups; without it, nobody can.\n${newKey}\n`], { type: 'text/plain' }));
		const a = Object.assign(document.createElement('a'), { href: url, download: 'home-backup-key.txt' }); a.click(); URL.revokeObjectURL(url);
	}
	async function backupNow() { busy = true; msg = ''; const r = await api('POST', '/api/admin/backups'); busy = false; if (!r.ok) fail(r); else msg = 'Backup made and checked.'; await load(); }
	async function restoreTest(b: Backup) {
		busy = true; const r = await sensitive('POST', `/api/admin/backups/${b.id}/restore-test`, { identity: identity.trim() }); busy = false;
		if (!r.ok) fail(r); else { msg = r.data.detail; identity = ''; testing = null; } // the key is never kept
		await load();
	}
	async function download(b: Backup) {
		const r = await sensitive('GET', `/api/admin/backups/${b.id}/ready`);
		if (!r.ok) return fail(r);
		location.href = `/api/admin/backups/${b.id}/download`;
	}
	async function install() { if (!confirm(`Install version ${upd.available.version}? The app will be unavailable for a few minutes. Your devices and automations keep running.`)) return; busy = true; const r = await sensitive('POST', '/api/admin/updates/apply', { version: upd.available.version }); busy = false; if (!r.ok) fail(r); else msg = 'Update requested. The app will restart shortly; this page may go blank for a few minutes.'; await load(); }
	async function grant() { busy = true; const r = await sensitive('POST', '/api/admin/support', { scopes, hours }); busy = false; if (!r.ok) fail(r); await load(); }
	async function revoke() { const r = await api('DELETE', `/api/admin/support/${sup!.active.id}`); if (!r.ok) fail(r); await load(); }
	const toggle = (s: string) => (scopes = scopes.includes(s) ? scopes.filter((x) => x !== s) : [...scopes, s]);
</script>

<main class="mx-auto max-w-3xl space-y-6 p-4">
	<h1 class="text-2xl font-semibold">System</h1>
	{#if msg}<p role="status" class="rounded-lg border p-3 text-sm">{msg}</p>{/if}

	<Card.Root><Card.Header><Card.Title>Health</Card.Title>{#if health}<Card.Description>{health.overall === 'ok' ? 'Everything looks good.' : health.overall === 'warn' ? 'A few things need attention.' : 'Something needs attention now.'}</Card.Description>{/if}</Card.Header>
		<Card.Content class="space-y-3">
			{#each health?.checks ?? [] as c}
				<div class="flex gap-3"><span class="mt-1.5 size-2.5 shrink-0 rounded-full {dot[c.status]}" aria-hidden="true"></span>
					<div><p class="font-medium">{c.label} <span class="sr-only">{c.status}</span></p><p class="text-sm text-muted-foreground">{c.detail}</p>{#if c.advice}<p class="text-sm">{c.advice}</p>{/if}</div></div>
			{/each}
			{#if health}<p class="text-xs text-muted-foreground">Version {health.facts.version} · running {Math.round(health.facts.uptimeSeconds / 3600)} h · {health.facts.memoryMb} MB memory</p>{/if}
		</Card.Content></Card.Root>

	<Card.Root><Card.Header><Card.Title>Backups</Card.Title><Card.Description>Encrypted copies of the app's data. The home hub's own settings are backed up separately.</Card.Description></Card.Header>
		<Card.Content class="space-y-4">
			{#if bk && !bk.recipientSet}
				<p class="text-sm">First, create a backup key. You'll download a file that is the only way to open a backup. <strong>Keep it somewhere other than this home device</strong>, such as a password manager or a printout.</p>
				<Button disabled={busy} onclick={makeKey}>Create backup key</Button>
			{/if}
			{#if newKey}
				<div class="space-y-2 rounded-lg border border-primary p-3" role="alert"><p class="text-sm font-medium">This is the only time the key is shown.</p>
					<p class="break-all font-mono text-xs">{newKey}</p><Button onclick={saveKey}>Download the key file</Button> <Button variant="ghost" onclick={() => (newKey = '')}>I've saved it</Button></div>
			{/if}
			{#if bk?.recipientSet}
				<div class="space-y-1">{#each bk.destinations as d}
					<p class="flex items-center gap-2 text-sm"><span class="size-2 rounded-full {d.writable ? 'bg-green-500' : 'bg-destructive'}"></span>{d.name}{d.local ? ' (this device only)' : ''}: {d.writable ? (d.freeBytes !== null ? `${mb(d.freeBytes)} free` : 'ready') : 'not available'}</p>
				{/each}</div>
				{#if !bk.destinations.some((d) => !d.local && d.writable)}<p class="text-sm text-destructive">No backup drive or network share is connected. A backup only on this device is lost if the device fails.</p>{/if}
				<Button disabled={busy} onclick={backupNow}>Back up now</Button>
				<ul class="space-y-2">{#each bk.backups.slice(0, 8) as b (b.id)}
					<li class="space-y-1 rounded-lg border p-3"><div class="flex flex-wrap items-center justify-between gap-2"><span class="font-medium">{when(b.createdAt)} <span class="text-sm font-normal text-muted-foreground">· {mb(b.size)} · {b.kind === 'auto' ? 'automatic' : 'manual'}</span></span><Badge variant={b.level === 'restore_tested' ? 'default' : 'outline'}>{LEVEL[b.level]}</Badge></div>
						<p class="text-xs text-muted-foreground">{b.copies.map((c) => `${c.name}: ${c.state === 'ok' ? 'intact' : c.state}`).join(' · ')}</p>
						{#if b.restoreTest}<p class="text-xs {b.restoreTest.ok ? '' : 'text-destructive'}">{b.restoreTest.detail}</p>{/if}
						<div class="flex gap-1"><Button size="sm" variant="outline" onclick={() => (testing = testing === b.id ? null : b.id)}>Test restore</Button><Button size="sm" variant="ghost" onclick={() => download(b)}>Download</Button></div>
						{#if testing === b.id}<div class="space-y-2 pt-1"><label class="text-sm" for="id-{b.id}">Paste your backup key. It's used once, here, and never stored.</label><Input id="id-{b.id}" type="password" autocomplete="off" bind:value={identity} placeholder="AGE-SECRET-KEY-…" /><Button size="sm" disabled={busy || !identity.trim()} onclick={() => restoreTest(b)}>Run test</Button></div>{/if}
					</li>{:else}<li class="text-sm text-muted-foreground">No backups yet.</li>{/each}</ul>
				<p class="text-xs text-muted-foreground">To restore for real after a failure, use the offline restore command in the recovery guide; it needs your key.</p>
			{/if}
		</Card.Content></Card.Root>

	<Card.Root><Card.Header><Card.Title>Updates</Card.Title><Card.Description>Updates are checked for the home device's signature before they are installed, and undone automatically if they don't start properly.</Card.Description></Card.Header>
		<Card.Content class="space-y-3">
			{#if upd && !upd.configured}<p class="text-sm text-muted-foreground">Updates on this device are installed by your support team.</p>
			{:else if upd}
				<p class="text-sm">You have version <strong>{upd.current}</strong>.{#if upd.state === 'applying'} An update is being installed right now.{/if}</p>
				{#if upd.state === 'failed'}<p class="text-sm text-destructive">{upd.message}</p>{/if}
				{#if upd.available}
					<div class="space-y-2 rounded-lg border p-3"><p class="font-medium">Version {upd.available.version} is ready</p>{#if upd.available.notes}<p class="text-sm text-muted-foreground">{upd.available.notes}</p>{/if}
						<p class="text-xs text-muted-foreground">Takes a few minutes. The app is unavailable meanwhile; your devices and automations keep running on the home hub. A safety copy of your data is made first.</p>
						<Button disabled={busy || upd.state === 'applying'} onclick={install}>Install now</Button></div>
				{:else if upd.state !== 'applying'}<p class="text-sm text-muted-foreground">You're up to date.{#if upd.lastCheckAt} Last checked {new Date(upd.lastCheckAt).toLocaleString()}.{/if}</p>{/if}
				<p class="text-xs text-muted-foreground">Rarely, an urgent security fix may be installed without waiting for you. You'll always be told before it starts and after it finishes.</p>
			{/if}
		</Card.Content></Card.Root>

	<Card.Root><Card.Header><Card.Title>Support access</Card.Title><Card.Description>Our support team can only look at your home while you allow it. You can end it at any time.</Card.Description></Card.Header>
		<Card.Content class="space-y-3">
			{#if sup?.active}
				<p class="text-sm">Allowed until <strong>{when(sup.active.expiresAt)}</strong> for: {sup.active.scopes.map((s: string) => (s === 'diagnostics' ? 'health checks' : 'a read-only look at your setup')).join(' and ')}. {sup.active.connected ? `${sup.active.operatorName} is connected.` : 'Nobody has connected yet.'}</p>
				<Button variant="destructive" onclick={revoke}>End support access now</Button>
			{:else}
				<fieldset class="space-y-1"><legend class="text-sm font-medium">They may</legend>
					<label class="flex items-center gap-2 text-sm"><input type="checkbox" class="size-4" checked={scopes.includes('diagnostics')} onchange={() => toggle('diagnostics')} />See health checks (no personal data)</label>
					<label class="flex items-center gap-2 text-sm"><input type="checkbox" class="size-4" checked={scopes.includes('read_config')} onchange={() => toggle('read_config')} />Look at how your home is set up (rooms, device and automation names; no people, no history)</label></fieldset>
				<label class="flex items-center gap-2 text-sm">For <select class="h-9 rounded-md border bg-background px-2" bind:value={hours}>{#each [1, 4, 24, 72] as h}<option value={h}>{h} hour{h === 1 ? '' : 's'}</option>{/each}</select></label>
				<Button disabled={busy || !scopes.length} onclick={grant}>Allow support access</Button>
			{/if}
		</Card.Content></Card.Root>
</main>
