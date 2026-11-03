<script lang="ts">
	import { goto } from '$app/navigation';
	import { startAuthentication, type PublicKeyCredentialRequestOptionsJSON } from '@simplewebauthn/browser';
	import { api, passkeyFailure } from '#lib/api.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Fingerprint } from '@lucide/svelte';

	// Already signed in on this device? There is nothing to do here.
	$effect(() => { if (session.me) goto('/', { replaceState: true }); });
	let busy = $state(false);
	let error = $state('');

	async function signIn() {
		busy = true; error = '';
		try {
			const o = await api<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('POST', '/api/auth/login/options');
			if (!o.ok) throw o.data.error;
			const response = await startAuthentication({ optionsJSON: o.data.options });
			const v = await api('POST', '/api/auth/login/verify', { challengeId: o.data.challengeId, response });
			if (!v.ok) throw v.data.error;
			await session.refresh();
			goto('/');
		} catch (e) {
			error = passkeyFailure(e, 'Sign-in was cancelled.');
		} finally { busy = false; }
	}
</script>

<main class="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center px-6 py-12">
	<span class="mb-8 flex size-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground" aria-hidden="true"><svg viewBox="0 0 24 24" class="size-6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.2 12 4.5l8 6.7"/><path d="M6.2 10v9.5h11.6V10"/><path d="M10 19.5v-5h4v5"/></svg></span>
	<h1 class="display">Welcome home.</h1>
	<p class="mt-3 text-[0.9375rem] text-muted-foreground">Sign in with the passkey on this device. No password to remember.</p>
	<Button size="lg" class="mt-8 w-full" onclick={signIn} disabled={busy}><Fingerprint />{busy ? 'Waiting for your passkey…' : 'Sign in with passkey'}</Button>
	{#if error}<p role="alert" class="mt-3 rounded-xl bg-signal-soft px-3 py-2 text-sm text-signal-foreground">{error}</p>{/if}
	<p class="mt-8 text-sm text-muted-foreground">Have an invite or setup code? <a class="font-medium text-primary underline-offset-2 hover:underline" href="/setup">Use it here</a></p>
</main>
