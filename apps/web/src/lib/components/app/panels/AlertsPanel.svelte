<script lang="ts">
	import Swipeable from '#lib/components/app/Swipeable.svelte';
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import { notifications, type Note } from '#lib/notifications.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import Group from '#lib/components/app/Group.svelte';
	import Empty from '#lib/components/app/Empty.svelte';

	let list = $state<Note[]>([]);
	let loaded = $state(false);

	async function load() { const r = await api('GET', '/api/notifications'); if (r.ok) { list = r.data.notifications; notifications.unread = r.data.unread; } loaded = true; }
	onMount(load);
	async function markAll() { const r = await api('POST', '/api/notifications/read'); if (r.ok) { list = list.map((n) => ({ ...n, read: true })); notifications.unread = 0; } }
	async function markOne(n: Note) { if (n.read) return; const r = await api('POST', '/api/notifications/read', { ids: [n.id] }); if (r.ok) { n.read = true; notifications.unread = r.data.unread; } }
	const when = (ts: number) => new Date(ts).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
</script>

<div class="space-y-4">
<div class="flex justify-end gap-1"><Button size="sm" variant="ghost" href="/settings/notifications">Notification settings</Button><Button size="sm" variant="secondary" onclick={markAll} disabled={!notifications.unread}>Mark all read</Button></div>

		{#if list.length}
		<Group>
			{#each list as n (n.id)}
				<Swipeable actions={n.read ? [] : [{ label: 'Read', run: () => markOne(n) }]}><div class="flex gap-3 px-4 py-3.5 {n.read ? 'opacity-70' : ''}">
					<span class="mt-2 size-2 shrink-0 rounded-full {n.read ? 'bg-transparent' : 'bg-primary'}" aria-label={n.read ? undefined : 'Unread'}></span>
					<div class="min-w-0 flex-1">
						<div class="flex items-baseline justify-between gap-3"><h2 class="text-[0.9375rem] font-semibold tracking-[-0.01em]">{n.title}</h2><span class="shrink-0 text-xs text-muted-foreground">{when(n.createdAt)}</span></div>
						<p class="mt-0.5 text-sm text-muted-foreground">{n.body}</p>
						<div class="-ml-2.5 mt-1.5 flex gap-1">
							{#if n.entityId && session.can('automation.manage')}<Button size="sm" variant="ghost" href="/automations/new?device={encodeURIComponent(n.entityId)}">Automate this</Button>{/if}
							{#if !n.read}<Button size="sm" variant="ghost" onclick={() => markOne(n)}>Mark read</Button>{/if}
						</div>
					</div>
				</div></Swipeable>
			{/each}
		</Group>
	{:else if loaded}
		<Empty title="You're all caught up" description="Nothing needs your attention right now." />
	{/if}

</div>
