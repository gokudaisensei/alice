<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { ago } from '#lib/fmt.js';
	import { Button } from '#lib/components/ui/button';
	import { Switch } from '#lib/components/ui/switch';
	import { Play } from '@lucide/svelte';

	type Auto = { id: string; name: string; enabled: boolean; lastTriggered: string | null };
	type Script = { id: string; name: string; running: boolean; lastTriggered: string | null };
	let automations = $state<Auto[]>([]), scripts = $state<Script[]>([]), notice = $state(''), busy = $state<Record<string, boolean>>({});
	async function load() { const r = await api<{ automations: Auto[]; scripts: Script[] }>('GET', '/api/automations/native'); if (r.ok) { automations = r.data.automations; scripts = r.data.scripts; } }
	onMount(load);
	const when = (iso: string | null) => { if (!iso) return 'Has not run yet.'; const d = new Date(/^\d+$/.test(iso) ? Number(iso) : iso); return isNaN(+d) ? '' : `Last ran ${ago(+d)}.`; };
	async function run(id: string, name: string) {
		busy[id] = true; notice = '';
		const r = await api('POST', '/api/automations/native/run', { entityId: id });
		busy[id] = false; notice = r.ok ? `Started “${name}”.` : (r.data?.message ?? explain(r.data?.error));
	}
	async function toggle(a: Auto, enabled: boolean) {
		busy[a.id] = true; notice = '';
		const r = await api('POST', '/api/automations/native/enabled', { entityId: a.id, enabled });
		busy[a.id] = false; if (!r.ok) notice = r.data?.message ?? explain(r.data?.error);
		await load();
	}
</script>

{#if automations.length || scripts.length}
	<section class="space-y-2.5" aria-label="Made in Home Assistant">
		<div><h2 class="heading">Made in Home Assistant</h2><p class="meta mt-0.5">These were set up in Home Assistant itself. You can start or switch them here; change them there.</p></div>
		{#if notice}<p role="status" class="rounded-xl bg-accent px-3.5 py-2 text-sm">{notice}</p>{/if}
		<ul class="divide-y overflow-hidden rounded-tile border bg-card">
			{#each automations as a (a.id)}
				<li class="flex items-center gap-2 px-3.5 py-2.5"><span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{a.name}</span><span class="block text-xs text-muted-foreground">{a.enabled ? '' : 'Switched off. '}{when(a.lastTriggered)}</span></span>
					<Button size="icon-sm" variant="ghost" aria-label="Run {a.name} now" disabled={!!busy[a.id]} onclick={() => run(a.id, a.name)}><Play /></Button>
					<Switch checked={a.enabled} disabled={!!busy[a.id]} aria-label="{a.name} is {a.enabled ? 'on' : 'off'}" onCheckedChange={(v) => toggle(a, v)} /></li>
			{/each}
			{#each scripts as s (s.id)}
				<li class="flex items-center gap-2 px-3.5 py-2.5"><span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{s.name}</span><span class="block text-xs text-muted-foreground">Script. {s.running ? 'Running now.' : when(s.lastTriggered)}</span></span>
					<Button size="icon-sm" variant="ghost" aria-label="Run {s.name}" disabled={!!busy[s.id]} onclick={() => run(s.id, s.name)}><Play /></Button></li>
			{/each}
		</ul>
	</section>
{/if}
