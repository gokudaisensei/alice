<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { Badge } from '#lib/components/ui/badge';
	import * as Card from '#lib/components/ui/card';

	let users = $state<{ id: string; displayName: string; role: string; status: string }[]>([]);
	let error = $state('');
	onMount(async () => {
		const r = await api('GET', '/api/admin/users');
		if (r.ok) users = r.data.users; else error = explain(r.data?.error);
	});
</script>

<main class="mx-auto max-w-2xl space-y-4 p-4">
	<h1 class="text-2xl font-semibold">Household</h1>
	{#if error}<p role="alert" class="text-destructive">{error}</p>{/if}
	<Card.Root>
		<Card.Content class="divide-y p-0">
			{#each users as u}
				<div class="flex items-center justify-between p-4">
					<span>{u.displayName}</span>
					<span class="flex items-center gap-2"><a class="text-sm underline" href="/admin/users/{u.id}">Devices</a><Badge variant="secondary" class="capitalize">{u.role}</Badge>{#if u.status !== 'active'}<Badge variant="outline" class="capitalize">{u.status}</Badge>{/if}</span>
				</div>
			{/each}
		</Card.Content>
	</Card.Root>
</main>
