<script lang="ts">
	import { goto } from '$app/navigation';
	import { startRegistration } from '@simplewebauthn/browser';
	import { api, explain } from '#lib/api.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import * as Card from '#lib/components/ui/card';

	let code = $state('');
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

<main class="mx-auto flex min-h-dvh max-w-sm items-center p-4">
	<Card.Root class="w-full">
		<Card.Header><Card.Title class="text-xl">Set up your passkey</Card.Title><Card.Description>Enter the code you were given. Your name is only used for a first-time setup.</Card.Description></Card.Header>
		<Card.Content>
			<form class="space-y-3" onsubmit={enroll}>
				<div class="space-y-1"><Label for="code">Code</Label><Input id="code" bind:value={code} autocomplete="one-time-code" required /></div>
				<div class="space-y-1"><Label for="name">Your name</Label><Input id="name" bind:value={name} autocomplete="name" /></div>
				<Button type="submit" class="w-full" disabled={busy}>{busy ? 'Waiting for passkey…' : 'Create passkey'}</Button>
				{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
			</form>
		</Card.Content>
	</Card.Root>
</main>
