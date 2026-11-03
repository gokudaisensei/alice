<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain, sensitive } from '#lib/api.js';
	import { ago, plural } from '#lib/fmt.js';
	import { Button } from '#lib/components/ui/button';
	import Section from '#lib/components/app/Section.svelte';

	type S = {
		notifications: { id: string; title: string; message: string; at: number | null }[];
		repairs: { id: string; severity: string; title: string }[];
		updates: { id: string; name: string; installed: string | null; latest: string | null; inProgress: boolean }[];
		integrations: { id: string; name: string; state: string }[];
		backup: { count: number; lastAt: number | null; lastAutomaticAt: number | null; scheduled: boolean } | null;
	};
	let s = $state<S | null>(null), failed = $state(false), msg = $state(''), busy = $state(false);
	async function load() { const r = await api<S>('GET', '/api/admin/ha-status'); if (r.ok) { s = r.data; failed = false; } else failed = true; }
	onMount(load);
	const quiet = $derived(!!s && !s.notifications.length && !s.repairs.length && !s.updates.length && !s.integrations.length);

	async function install(id: string, name: string) {
		if (!confirm(`Install the update for ${name}? Home Assistant may restart.`)) return;
		busy = true; msg = '';
		const r = await sensitive('POST', '/api/admin/ha-status/update', { entityId: id });
		busy = false; msg = r.ok ? `Started installing ${name}.` : (r.data?.message ?? explain(r.data?.error));
		await load();
	}
	async function backUp() {
		busy = true; msg = '';
		const r = await api('POST', '/api/admin/ha-status/backup');
		busy = false; msg = r.ok ? 'Home Assistant has started a backup. It can take a few minutes.' : (r.data?.message ?? explain(r.data?.error));
		await load();
	}
	const words = (x: string) => x.replace(/_/g, ' ');
</script>

<Section title="Home Assistant" hint="What your home hub itself is reporting.">
	<div class="space-y-3 rounded-2xl border bg-card p-4">
		{#if failed}<p class="text-sm text-muted-foreground">The home hub can’t be reached, so there’s nothing to show right now.</p>
		{:else if !s}<div class="h-12 animate-pulse rounded-xl bg-muted"></div>
		{:else}
			{#if quiet}<p class="text-sm">Nothing needs attention.</p>{/if}
			{#each s.repairs as r (r.id)}<p class="text-sm"><strong class={r.severity === 'critical' || r.severity === 'error' ? 'text-signal' : ''}>{r.title}</strong><span class="block text-xs text-muted-foreground">A repair is waiting in Home Assistant (Settings, Repairs).</span></p>{/each}
			{#each s.integrations as c (c.id)}<p class="text-sm"><strong>{c.name}</strong> isn’t working<span class="block text-xs text-muted-foreground">Home Assistant says: {words(c.state)}.</span></p>{/each}
			{#each s.notifications as n (n.id)}<p class="text-sm"><strong>{n.title}</strong>{#if n.message}<span class="block text-xs text-muted-foreground">{n.message}</span>{/if}</p>{/each}
			{#each s.updates as u (u.id)}
				<div class="flex items-center justify-between gap-3 text-sm"><span class="min-w-0"><strong>{u.name}</strong><span class="block text-xs text-muted-foreground">{u.latest ? `Version ${u.latest} is ready` : 'An update is ready'}{u.installed ? `, you have ${u.installed}` : ''}.</span></span>
					<Button size="sm" variant="secondary" disabled={busy || u.inProgress} onclick={() => install(u.id, u.name)}>{u.inProgress ? 'Installing…' : 'Install'}</Button></div>
			{/each}
			{#if s.backup}
				<div class="flex items-center justify-between gap-3 border-t pt-3 text-sm"><span class="min-w-0">Home Assistant’s own backups<span class="block text-xs text-muted-foreground">{s.backup.count ? `${plural(s.backup.count, 'backup')}${s.backup.lastAt ? `, latest ${ago(s.backup.lastAt)}` : ''}.` : 'None yet.'}{s.backup.scheduled ? '' : ' No automatic schedule.'}</span></span>
					<Button size="sm" variant="secondary" disabled={busy} onclick={backUp}>Back up now</Button></div>
			{/if}
			{#if msg}<p role="status" class="rounded-xl bg-accent px-3 py-2 text-sm">{msg}</p>{/if}
		{/if}
	</div>
</Section>
