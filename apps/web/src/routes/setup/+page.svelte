<script lang="ts">
	import { goto } from '$app/navigation';
	import { startRegistration } from '@simplewebauthn/browser';
	import { api, explain } from '#lib/api.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import { page } from '$app/state';
	import { Fingerprint } from '@lucide/svelte';

	let code = $state(page.url.searchParams.get('code') ?? '');
	let name = $state('');
	let busy = $state(false);
	let error = $state('');

	async function enroll(e: SubmitEvent) {
		e.preventDefault();
		busy = true; error = '';
		try {
			const o = await api('POST', '/api/auth/enroll/options', { token: code.trim(), displayName: name.trim() });
			if (!o.ok) throw o.data?.error;
			const response = await startRegistration({ optionsJSON: o.data.options });
			const v = await api('POST', '/api/auth/enroll/verify', { challengeId: o.data.challengeId, response });
			if (!v.ok) throw v.data?.error;
			await session.refresh();
			goto('/');
		} catch (e: any) {
			error = typeof e === 'string' ? explain(e) : e?.name === 'NotAllowedError' ? 'Passkey creation was cancelled.' : explain();
		} finally { busy = false; }
	}
</script>

<main class="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
	<span class="mb-8 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground" aria-hidden="true"><Fingerprint class="size-6" /></span>
	<h1 class="display">Set up your passkey.</h1>
	<p class="mt-3 text-[0.9375rem] text-muted-foreground">Your passkey is how you'll sign in on this device: a fingerprint, face or PIN, never a password.</p>
	<form class="mt-8 space-y-4" onsubmit={enroll}>
		<div class="space-y-1.5"><Label for="code">Code</Label><Input id="code" bind:value={code} autocomplete="one-time-code" required /></div>
		<div class="space-y-1.5"><Label for="name">Your name</Label><Input id="name" bind:value={name} autocomplete="name" /><p class="text-sm text-muted-foreground">Only needed the very first time the home is set up.</p></div>
		<Button type="submit" size="lg" class="w-full" disabled={busy}>{busy ? 'Waiting for your passkey…' : 'Create passkey'}</Button>
		{#if error}<p role="alert" class="rounded-xl bg-signal-soft px-3 py-2 text-sm text-signal-foreground">{error}</p>{/if}
	</form>
	<p class="mt-8 text-sm text-muted-foreground">Already have a passkey? <a class="font-medium text-primary underline-offset-2 hover:underline" href="/login">Sign in</a></p>
</main>
