<script lang="ts">
	import { onMount } from 'svelte';
	import { startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
	import { api, passkeyFailure } from '#lib/api.js';
	import type { Health } from '#lib/dto.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';

	let me = $state<{ name: string } | null>(null), loaded = $state(false), code = $state(''), msg = $state(''), busy = $state(false);
	/** The household's support grant as an operator sees it. `undefined` until asked; `null` when there is none. */
	type Grant = { id: string; scopes: string[]; expiresAt: number; claimedByYou: boolean; claimedByOther: boolean };
	/** Structure only: names of rooms, devices, routines and automations. */
	type Config = { rooms: { id: string; name: string }[]; devices: { id: string; name: string | null; roomId: string | null; hidden: boolean }[]; routines: { name: string; summary: string; needsAttention: boolean }[]; automations: { name: string; summary: string; enabled: boolean | null; needsAttention: boolean }[] };
	type Challenge<O> = { challengeId: string; options: O };
	let support = $state<Grant | null | undefined>(undefined), diag = $state<Health | null>(null), cfg = $state<Config | null>(null);

	async function refresh() { const r = await api<{ id: string; name: string }>('GET', '/api/ops/me'); me = r.ok ? r.data : null; loaded = true; if (me) { const s = await api<{ active: Grant | null }>('GET', '/api/ops/support'); support = s.ok ? s.data.active : null; } }
	onMount(refresh);
	async function run(f: () => Promise<void>) { busy = true; msg = ''; try { await f(); } catch (e) { msg = passkeyFailure(e, 'Cancelled.'); } busy = false; }
	const login = () => run(async () => {
		const o = await api<Challenge<PublicKeyCredentialRequestOptionsJSON>>('POST', '/api/ops/auth/login/options'); if (!o.ok) throw o.data.error;
		const v = await api('POST', '/api/ops/auth/login/verify', { challengeId: o.data.challengeId, response: await startAuthentication({ optionsJSON: o.data.options }) });
		if (!v.ok) throw v.data.error; await refresh();
	});
	const enroll = () => run(async () => {
		const o = await api<Challenge<PublicKeyCredentialCreationOptionsJSON>>('POST', '/api/ops/auth/enroll/options', { token: code.trim() }); if (!o.ok) throw o.data.error;
		const v = await api('POST', '/api/ops/auth/enroll/verify', { challengeId: o.data.challengeId, response: await startRegistration({ optionsJSON: o.data.options }) });
		if (!v.ok) throw v.data.error; await refresh();
	});
	const claim = () => run(async () => { const r = await api('POST', '/api/ops/support/claim'); if (!r.ok) throw r.data.error; await refresh(); });
	const end = () => run(async () => { await api('POST', '/api/ops/support/end'); diag = cfg = null; await refresh(); });
	const load = (what: 'diagnostics' | 'config') => run(async () => {
		if (what === 'diagnostics') { const r = await api<Health>('GET', '/api/ops/support/diagnostics'); if (!r.ok) throw r.data.error; diag = r.data; }
		else { const r = await api<Config>('GET', '/api/ops/support/config'); if (!r.ok) throw r.data.error; cfg = r.data; }
	});
	async function logout() { await api('POST', '/api/ops/auth/logout'); me = null; support = diag = cfg = null; }
</script>

<main class="mx-auto w-full max-w-2xl space-y-6 px-6 py-10">
	<h1 class="title">Support console</h1>
	{#if !loaded}<p>Loading…</p>
	{:else if !me}
		<section class="space-y-4 rounded-2xl border bg-card p-5"><div><h2 class="heading">Sign in</h2><p class="mt-0.5 text-sm text-muted-foreground">Staff only. Use your hardware security key.</p></div><div class="flex flex-wrap gap-2"><Button disabled={busy} onclick={login}>Sign in with security key</Button>
				<div class="space-y-2 border-t pt-4"><label class="text-sm" for="c">First time? Enter the enrollment code from the device.</label><Input id="c" bind:value={code} autocomplete="off" /><Button variant="secondary" disabled={busy || !code.trim()} onclick={enroll}>Register my security key</Button></div></div></section>
	{:else}
		<p class="text-sm text-muted-foreground">Signed in as {me.name}. <button class="underline" onclick={logout}>Sign out</button></p>
		{#if support === null}<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">The household hasn't allowed support access right now. Ask them to turn it on under System.</p>
		{:else if support}
			<section class="space-y-4 rounded-2xl border bg-card p-5"><div><h2 class="heading">Support session</h2><p class="mt-0.5 text-sm text-muted-foreground">Allowed until {new Date(support.expiresAt).toLocaleString()} · {support.scopes.join(', ')}. Everything you do here is recorded.</p></div><div class="flex flex-wrap gap-2">
					{#if support.claimedByOther}<p class="text-sm">Another operator is connected.</p>
					{:else if !support.claimedByYou}<Button disabled={busy} onclick={claim}>Connect</Button>
					{:else}
						{#if support.scopes.includes('diagnostics')}<Button variant="secondary" disabled={busy} onclick={() => load('diagnostics')}>Health checks</Button>{/if}
						{#if support.scopes.includes('read_config')}<Button variant="secondary" disabled={busy} onclick={() => load('config')}>Setup (read-only)</Button>{/if}
						<Button variant="ghost" disabled={busy} onclick={end}>Disconnect</Button>{/if}
				</div></section>
		{/if}
		{#if diag}<div class="rounded-2xl border bg-card"><div class="space-y-2 p-4"><h2 class="font-semibold">Health: {diag.overall}</h2>{#each diag.checks as c}<p class="text-sm"><strong>{c.label}</strong> ({c.status}): {c.detail}</p>{/each}<p class="text-xs text-muted-foreground">v{diag.facts.version} · schema {diag.facts.schema} · {diag.facts.memoryMb} MB</p></div></div>{/if}
		{#if cfg}<div class="rounded-2xl border bg-card"><div class="space-y-2 p-4 text-sm"><p>{cfg.rooms.length} rooms · {cfg.devices.length} named devices · {cfg.routines.length} routines · {cfg.automations.length} automations</p>
			{#each cfg.automations as a}<p><strong>{a.name}</strong> {a.enabled === false ? '(off)' : ''}: {a.summary}</p>{/each}{#each cfg.routines as r}<p><strong>{r.name}</strong>: {r.summary}</p>{/each}</div></div>{/if}
	{/if}
	{#if msg}<p role="alert" class="text-sm text-signal">{msg}</p>{/if}
</main>
