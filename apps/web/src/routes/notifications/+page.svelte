<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import { notifications, type Note } from '#lib/notifications.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Badge } from '#lib/components/ui/badge';
	import * as Card from '#lib/components/ui/card';

	let list = $state<Note[]>([]);
	let loaded = $state(false);

	async function load() { const r = await api('GET', '/api/notifications'); if (r.ok) { list = r.data.notifications; notifications.unread = r.data.unread; } loaded = true; }
	onMount(load);
	async function markAll() { const r = await api('POST', '/api/notifications/read'); if (r.ok) { list = list.map((n) => ({ ...n, read: true })); notifications.unread = 0; } }
	async function markOne(n: Note) { if (n.read) return; const r = await api('POST', '/api/notifications/read', { ids: [n.id] }); if (r.ok) { n.read = true; notifications.unread = r.data.unread; } }
	const when = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
</script>

<main class="mx-auto max-w-2xl space-y-4 p-4">
	<div class="flex items-center justify-between gap-2">
		<h1 class="text-2xl font-semibold">Alerts</h1>
		<span class="flex gap-1"><Button size="sm" variant="ghost" href="/settings#notifications">Settings</Button><Button size="sm" variant="outline" onclick={markAll} disabled={!notifications.unread}>Mark all read</Button></span>
	</div>
	<p class="text-sm text-muted-foreground">Things that need your attention. Problems are only reported once they have lasted a few minutes.</p>
	<div class="space-y-2">
		{#each list as n (n.id)}
			<Card.Root class="gap-0 py-0 {n.read ? 'opacity-75' : ''}"><div class="space-y-1 p-4">
				<div class="flex items-start justify-between gap-2">
					<h2 class="font-semibold">{n.title}</h2>
					<span class="flex shrink-0 items-center gap-2 text-xs text-muted-foreground">{#if !n.read}<Badge>New</Badge>{/if}{when(n.createdAt)}</span>
				</div>
				<p class="text-sm text-muted-foreground">{n.body}</p>
				<div class="flex gap-1">
					{#if n.entityId && session.can('automation.manage')}<Button size="sm" variant="ghost" href="/automations/new?device={encodeURIComponent(n.entityId)}">Automate this</Button>{/if}
					{#if !n.read}<Button size="sm" variant="ghost" onclick={() => markOne(n)}>Mark read</Button>{/if}
				</div>
			</div></Card.Root>
		{:else}
			{#if loaded}<p class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">Nothing needs your attention.</p>{/if}
		{/each}
	</div>
</main>
