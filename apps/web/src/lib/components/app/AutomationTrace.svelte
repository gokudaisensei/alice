<script lang="ts">
	import { api, explain } from '#lib/api.js';
	import { ago } from '#lib/fmt.js';
	import { Button } from '#lib/components/ui/button';
	import { CircleQuestionMark } from '@lucide/svelte';

	let { id }: { id: string } = $props();
	type Run = { at: number; outcome: 'ran' | 'skipped' | 'stopped' | 'error'; why: string | null };
	let data = $state<{ summary: string; runs: Run[] } | null>(null), busy = $state(false), error = $state('');
	async function load() {
		busy = true; error = '';
		const r = await api<{ summary: string; runs: Run[] }>('GET', `/api/automations/${id}/trace`);
		busy = false;
		if (r.ok) data = r.data; else error = r.data?.message ?? explain(r.data?.error);
	}
	const label = { ran: 'Ran', skipped: 'Skipped', stopped: 'Stopped', error: 'Failed' } as const;
</script>

<section class="space-y-2.5 rounded-2xl bg-secondary/60 p-3.5" aria-label="Why didn’t it run?">
	<div class="flex items-center justify-between gap-3"><h2 class="heading">Why didn’t it run?</h2>
		<Button size="sm" variant="secondary" disabled={busy} onclick={load}><CircleQuestionMark />{data ? 'Check again' : 'Check'}</Button></div>
	{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
	{#if data}
		<p class="text-sm font-medium">{data.summary}</p>
		{#if data.runs.length}
			<ul class="divide-y overflow-hidden rounded-xl border bg-card text-sm">{#each data.runs as r (r.at)}<li class="px-3 py-2"><span class="flex justify-between gap-3"><span class="font-medium">{label[r.outcome]}</span><span class="text-xs text-muted-foreground">{ago(r.at)}</span></span>{#if r.why}<span class="block text-xs text-muted-foreground">{r.why}</span>{/if}</li>{/each}</ul>
		{/if}
	{:else}<p class="text-sm text-muted-foreground">Look at the last few times the home hub woke this up, and what it decided.</p>{/if}
</section>
