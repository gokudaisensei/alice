<script lang="ts">
	import { onMount } from 'svelte';
	import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
	import { api, explain } from '#lib/api.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import * as Card from '#lib/components/ui/card';

	let me = $state<{ name: string } | null>(null), loaded = $state(false), code = $state(''), msg = $state(''), busy = $state(false);
	let support = $state<any>(undefined), diag = $state<any>(null), cfg = $state<any>(null);

	async function refresh() { const r = await api('GET', '/api/ops/me'); me = r.ok ? r.data : null; loaded = true; if (me) { const s = await api('GET', '/api/ops/support'); support = s.ok ? s.data.active : null; } }
	onMount(refresh);
	async function run(f: () => Promise<void>) { busy = true; msg = ''; try { await f(); } catch (e: any) { msg = typeof e === 'string' ? explain(e) : e?.name === 'NotAllowedError' ? 'Cancelled.' : explain(); } busy = false; }
	const login = () => run(async () => {
		const o = await api('POST', '/api/ops/auth/login/options'); if (!o.ok) throw o.data?.error;
		const v = await api('POST', '/api/ops/auth/login/verify', { challengeId: o.data.challengeId, response: await startAuthentication({ optionsJSON: o.data.options }) });
		if (!v.ok) throw v.data?.error; await refresh();
	});
	const enroll = () => run(async () => {
		const o = await api('POST', '/api/ops/auth/enroll/options', { token: code.trim() }); if (!o.ok) throw o.data?.error;
		const v = await api('POST', '/api/ops/auth/enroll/verify', { challengeId: o.data.challengeId, response: await startRegistration({ optionsJSON: o.data.options }) });
		if (!v.ok) throw v.data?.error; await refresh();
	});
	const claim = () => run(async () => { const r = await api('POST', '/api/ops/support/claim'); if (!r.ok) throw r.data?.error; await refresh(); });
	const end = () => run(async () => { await api('POST', '/api/ops/support/end'); diag = cfg = null; await refresh(); });
	const load = (what: 'diagnostics' | 'config') => run(async () => { const r = await api('GET', `/api/ops/support/${what}`); if (!r.ok) throw r.data?.error; if (what === 'diagnostics') diag = r.data; else cfg = r.data; });
	async function logout() { await api('POST', '/api/ops/auth/logout'); me = null; support = diag = cfg = null; }
</script>

<main class="mx-auto max-w-2xl space-y-4 p-4">
	<h1 class="text-2xl font-semibold">Support console</h1>
	{#if !loaded}<p>Loading…</p>
	{:else if !me}
		<Card.Root><Card.Header><Card.Title>Sign in</Card.Title><Card.Description>Staff only. Use your hardware security key.</Card.Description></Card.Header>
			<Card.Content class="space-y-4"><Button disabled={busy} onclick={login}>Sign in with security key</Button>
				<div class="space-y-2 border-t pt-4"><label class="text-sm" for="c">First time? Enter the enrollment code from the device.</label><Input id="c" bind:value={code} autocomplete="off" /><Button variant="outline" disabled={busy || !code.trim()} onclick={enroll}>Register my security key</Button></div></Card.Content></Card.Root>
	{:else}
		<p class="text-sm text-muted-foreground">Signed in as {me.name}. <button class="underline" onclick={logout}>Sign out</button></p>
		{#if support === null}<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">The household hasn't allowed support access right now. Ask them to turn it on under System.</p>
		{:else if support}
			<Card.Root><Card.Header><Card.Title>Support session</Card.Title><Card.Description>Allowed until {new Date(support.expiresAt).toLocaleString()} · {support.scopes.join(', ')}. Everything you do here is recorded.</Card.Description></Card.Header>
				<Card.Content class="flex flex-wrap gap-2">
					{#if support.claimedByOther}<p class="text-sm">Another operator is connected.</p>
					{:else if !support.claimedByYou}<Button disabled={busy} onclick={claim}>Connect</Button>
					{:else}
						{#if support.scopes.includes('diagnostics')}<Button variant="outline" disabled={busy} onclick={() => load('diagnostics')}>Health checks</Button>{/if}
						{#if support.scopes.includes('read_config')}<Button variant="outline" disabled={busy} onclick={() => load('config')}>Setup (read-only)</Button>{/if}
						<Button variant="ghost" disabled={busy} onclick={end}>Disconnect</Button>{/if}
				</Card.Content></Card.Root>
		{/if}
		{#if diag}<Card.Root class="gap-0 py-0"><div class="space-y-2 p-4"><h2 class="font-semibold">Health: {diag.overall}</h2>{#each diag.checks as c}<p class="text-sm"><strong>{c.label}</strong> ({c.status}): {c.detail}</p>{/each}<p class="text-xs text-muted-foreground">v{diag.facts.version} · schema {diag.facts.schema} · {diag.facts.memoryMb} MB</p></div></Card.Root>{/if}
		{#if cfg}<Card.Root class="gap-0 py-0"><div class="space-y-2 p-4 text-sm"><p>{cfg.rooms.length} rooms · {cfg.devices.length} named devices · {cfg.routines.length} routines · {cfg.automations.length} automations</p>
			{#each cfg.automations as a}<p><strong>{a.name}</strong> {a.enabled === false ? '(off)' : ''}: {a.summary}</p>{/each}{#each cfg.routines as r}<p><strong>{r.name}</strong>: {r.summary}</p>{/each}</div></Card.Root>{/if}
	{/if}
	{#if msg}<p role="alert" class="text-sm text-destructive">{msg}</p>{/if}
</main>
