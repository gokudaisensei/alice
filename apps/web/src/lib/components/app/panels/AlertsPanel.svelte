<script lang="ts">
	import Swipeable from '#lib/components/app/Swipeable.svelte';
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';
	import { notifications, type Note } from '#lib/notifications.svelte.js';
	import { clock } from '#lib/fmt.js';
	import { session } from '#lib/session.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import Group from '#lib/components/app/Group.svelte';
	import SkeletonList from '#lib/components/app/SkeletonList.svelte';
	import Empty from '#lib/components/app/Empty.svelte';
	import { ChevronDown, Settings2 } from '@lucide/svelte';
	import { slide } from 'svelte/transition';
	import { dur } from '#lib/motion.js';

	let list = $state<Note[]>([]);
	let loaded = $state(false);

	async function load() { const r = await api<{ notifications: Note[]; unread: number }>('GET', '/api/notifications'); if (r.ok) { list = r.data.notifications; notifications.unread = r.data.unread; } loaded = true; }
	onMount(load);
	let marking = $state(false);
	async function markAll() { if (marking) return; marking = true; const r = await api('POST', '/api/notifications/read'); if (r.ok) { list = list.map((n) => ({ ...n, read: true })); notifications.unread = 0; } marking = false; }
	async function markOne(n: Note) { if (n.read) return; const r = await api<{ unread: number }>('POST', '/api/notifications/read', { ids: [n.id] }); if (r.ok) { n.read = true; notifications.unread = r.data.unread; } }
	const dayKey = (ts: number) => new Date(ts).toDateString();
	function dayLabel(ts: number) {
		const d = new Date(ts), t = new Date(), y = new Date(Date.now() - 864e5);
		if (d.toDateString() === t.toDateString()) return 'Today';
		if (d.toDateString() === y.toDateString()) return 'Yesterday';
		return d.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' });
	}
	// Unread first by default: the list is for what still needs a look. "All" is one tap away.
	let only = $state<'unread' | 'all'>('unread'), open = $state<string | null>(null), chosen = false;
	let kept = $state<string[]>([]); // rows you've just opened stay put until you leave, even though opening marks them read
	$effect(() => { if (loaded && !chosen && !notifications.unread) only = 'all'; });
	const shown = $derived(only === 'unread' ? list.filter((n) => !n.read || kept.includes(n.id)) : list);
	const days = $derived.by(() => {
		const out: { key: string; label: string; items: Note[] }[] = [];
		for (const n of shown) { const k = dayKey(n.createdAt); const last = out[out.length - 1]; if (last?.key === k) last.items.push(n); else out.push({ key: k, label: dayLabel(n.createdAt), items: [n] }); }
		return out;
	});
	function toggle(n: Note) { open = open === n.id ? null : n.id; if (!kept.includes(n.id)) kept = [...kept, n.id]; void markOne(n); }
</script>

<div class="space-y-4">
	<div class="flex items-center gap-1.5">
		<div class="flex gap-1.5" role="tablist" aria-label="Show">
			{#each [['unread', `Unread${notifications.unread ? ` ${notifications.unread}` : ''}`], ['all', 'All']] as [id, label]}
				<button type="button" role="tab" aria-selected={only === id} onclick={() => { only = id as 'unread' | 'all'; chosen = true; }} class="h-8 rounded-full px-3.5 text-[0.8125rem] font-medium transition-colors {only === id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}">{label}</button>
			{/each}
		</div>
		<span class="flex-1"></span>
		<Button size="sm" variant="ghost" onclick={markAll} disabled={!notifications.unread || marking}>Mark all read</Button>
		<Button size="icon" variant="ghost" href="/settings/notifications" aria-label="Notifications"><Settings2 class="size-4" /></Button>
	</div>

	{#each days as d (d.key)}
		<section aria-label={d.label}>
			<h2 class="mb-1.5 px-1 text-xs font-medium text-muted-foreground">{d.label}</h2>
			<Group>
				{#each d.items as n (n.id)}
					{@const on = open === n.id}
					<Swipeable actions={n.read ? [] : [{ label: 'Read', run: () => markOne(n) }]}>
						<div class="{n.read ? 'opacity-70' : ''}">
							<button type="button" class="flex w-full items-start gap-3 px-4 py-2.5 text-left" aria-expanded={on} onclick={() => toggle(n)}>
								<span class="mt-[7px] size-2 shrink-0 rounded-full {n.read ? 'bg-transparent' : 'bg-primary'}" aria-label={n.read ? undefined : 'Unread'}></span>
								<span class="min-w-0 flex-1">
									<span class="flex items-baseline justify-between gap-3"><span class="text-[0.9375rem] font-semibold leading-snug tracking-[-0.01em] {on ? '' : 'line-clamp-1'}">{n.title}</span><span class="shrink-0 text-xs text-muted-foreground tabular-nums">{clock(n.createdAt)}</span></span>
									{#if !on}<span class="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{n.body}</span>{/if}
								</span>
								<ChevronDown class="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200 {on ? 'rotate-180' : ''}" />
							</button>
							{#if on}
								<div class="space-y-1.5 pb-3 pl-[2.375rem] pr-4" transition:slide={{ duration: dur(200) }}>
									<p class="text-sm text-muted-foreground">{n.body}</p>
									<div class="-ml-2.5 flex gap-1">{#if n.entityId && session.can('automation.manage')}<Button size="sm" variant="ghost" href="/automations/new?device={encodeURIComponent(n.entityId)}">Automate this</Button>{/if}</div>
								</div>
							{/if}
						</div>
					</Swipeable>
				{/each}
			</Group>
		</section>
	{/each}

	{#if !loaded}<SkeletonList kind="rows" count={4} />{/if}

	{#if loaded && !shown.length}
		<Empty title="You're all caught up" description={only === 'unread' ? 'Nothing needs your attention right now.' : 'No alerts yet.'} />
	{/if}
</div>
