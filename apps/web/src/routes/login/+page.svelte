<script lang="ts">
	import { goto } from '$app/navigation';
	import { startAuthentication } from '@simplewebauthn/browser';
	import { api, explain } from '#lib/api.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';

	let busy = $state(false);
	let error = $state('');

	async function signIn() {
		busy = true; error = '';
		try {
			const o = await api('POST', '/api/auth/login/options');
			if (!o.ok) throw o.data?.error;
			const response = await startAuthentication({ optionsJSON: o.data.options });
			const v = await api('POST', '/api/auth/login/verify', { challengeId: o.data.challengeId, response });
			if (!v.ok) throw v.data?.error;
			await session.refresh();
			goto('/');
		} catch (e: any) {
			error = typeof e === 'string' ? explain(e) : e?.name === 'NotAllowedError' ? 'Sign-in was cancelled.' : explain();
		} finally { busy = false; }
	}
</script>

<main class="mx-auto flex min-h-dvh max-w-sm items-center p-4">
	<Card.Root class="w-full">
		<Card.Header><Card.Title class="text-xl">Welcome home</Card.Title><Card.Description>Sign in with your passkey.</Card.Description></Card.Header>
		<Card.Content class="space-y-3">
			<Button class="w-full" onclick={signIn} disabled={busy}>{busy ? 'Waiting for passkey…' : 'Sign in'}</Button>
			{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
			<p class="text-sm text-muted-foreground">Have a setup or invite code? <a class="underline" href="/setup">Use it here</a>.</p>
		</Card.Content>
	</Card.Root>
</main>
