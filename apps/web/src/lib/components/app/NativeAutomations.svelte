<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { ago } from '#lib/fmt.js';
	import { Button } from '#lib/components/ui/button';
	import { Switch } from '#lib/components/ui/switch';
	import { ChevronDown, Eye, EyeOff, Play } from '@lucide/svelte';

	type Auto = { id: string; name: string; enabled: boolean; lastTriggered: string | null };
	type Script = { id: string; name: string; running: boolean; lastTriggered: string | null };
	let automations = $state<Auto[]>([]), scripts = $state<Script[]>([]), away = $state<{ automations: Auto[]; scripts: Script[] }>({ automations: [], scripts: [] });
	let open = $state(false), showAway = $state(false), notice = $state(''), busy = $state<Record<string, boolean>>({});
	const count = $derived(automations.length + scripts.length), awayCount = $derived(away.automations.length + away.scripts.length);
	async function load() {
		const r = await api<{ automations: Auto[]; scripts: Script[] }>('GET', '/api/automations/native');
		if (r.ok) { automations = r.data.automations; scripts = r.data.scripts; }
		const h = await api<{ automations: Auto[]; scripts: Script[] }>('GET', '/api/automations/native?hidden=1');
		if (h.ok) away = { automations: h.data.automations, scripts: h.data.scripts };
	}
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
	async function put(id: string, hidden: boolean) {
		busy[id] = true; notice = '';
		const r = await api('POST', '/api/automations/native/hidden', { entityId: id, hidden });
		busy[id] = false; if (!r.ok) notice = r.data?.message ?? explain(r.data?.error);
		await load();
	}
</script>

{#if count || awayCount}
	<section class="space-y-2.5" aria-label="Made in Home Assistant">
		<button type="button" class="flex min-h-11 w-full items-center gap-3 text-left" aria-expanded={open} onclick={() => (open = !open)}>
			<span class="min-w-0 flex-1"><span class="heading block">Made in Home Assistant{count ? ` (${count})` : ''}</span><span class="meta block">{open ? 'Set up in Home Assistant itself. You can start or switch them here, or put them away; change them there.' : 'Not made here. Open to start, switch or put them away.'}</span></span>
			<ChevronDown class="size-4 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none {open ? 'rotate-180' : ''}" />
		</button>
		{#if open}
			{#if notice}<p role="status" class="rounded-xl bg-accent px-3.5 py-2 text-sm">{notice}</p>{/if}
			{#snippet autoRow(a: Auto, hidden: boolean)}
				<li class="flex items-center gap-2 px-3.5 py-2.5"><span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{a.name}</span><span class="block text-xs text-muted-foreground">{a.enabled ? '' : 'Switched off. '}{when(a.lastTriggered)}</span></span>
					{#if hidden}<Button size="sm" variant="ghost" disabled={!!busy[a.id]} onclick={() => put(a.id, false)}><Eye />Show again</Button>
					{:else}
						<Button size="icon-sm" variant="ghost" aria-label="Run {a.name} now" disabled={!!busy[a.id]} onclick={() => run(a.id, a.name)}><Play /></Button>
						<Button size="icon-sm" variant="ghost" aria-label="Put {a.name} away" disabled={!!busy[a.id]} onclick={() => put(a.id, true)}><EyeOff /></Button>
						<Switch checked={a.enabled} disabled={!!busy[a.id]} aria-label="{a.name} is {a.enabled ? 'on' : 'off'}" onCheckedChange={(v) => toggle(a, v)} />
					{/if}</li>
			{/snippet}
			{#snippet scriptRow(s: Script, hidden: boolean)}
				<li class="flex items-center gap-2 px-3.5 py-2.5"><span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{s.name}</span><span class="block text-xs text-muted-foreground">Script. {s.running ? 'Running now.' : when(s.lastTriggered)}</span></span>
					{#if hidden}<Button size="sm" variant="ghost" disabled={!!busy[s.id]} onclick={() => put(s.id, false)}><Eye />Show again</Button>
					{:else}
						<Button size="icon-sm" variant="ghost" aria-label="Run {s.name}" disabled={!!busy[s.id]} onclick={() => run(s.id, s.name)}><Play /></Button>
						<Button size="icon-sm" variant="ghost" aria-label="Put {s.name} away" disabled={!!busy[s.id]} onclick={() => put(s.id, true)}><EyeOff /></Button>
					{/if}</li>
			{/snippet}
			{#if count}<ul class="divide-y overflow-hidden rounded-tile border bg-card">{#each automations as a (a.id)}{@render autoRow(a, false)}{/each}{#each scripts as s (s.id)}{@render scriptRow(s, false)}{/each}</ul>
			{:else}<p class="text-sm text-muted-foreground">Everything from Home Assistant is put away.</p>{/if}
			{#if awayCount}
				<button type="button" class="min-h-11 text-sm font-medium text-primary" aria-expanded={showAway} onclick={() => (showAway = !showAway)}>{showAway ? 'Hide the ones put away' : `${awayCount} put away`}</button>
				{#if showAway}<ul class="divide-y overflow-hidden rounded-tile border bg-card">{#each away.automations as a (a.id)}{@render autoRow(a, true)}{/each}{#each away.scripts as s (s.id)}{@render scriptRow(s, true)}{/each}</ul>{/if}
			{/if}
		{/if}
	</section>
{/if}
