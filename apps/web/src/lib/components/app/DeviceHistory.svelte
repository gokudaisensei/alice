<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';

	let { id }: { id: string } = $props();
	type P = { t: number; state: string };
	let data = $state<{ kind: 'state' | 'numeric'; points: P[]; now: number } | null>(null), failed = $state(false);
	onMount(async () => { const r = await api('GET', `/api/devices/${encodeURIComponent(id)}/history`); if (r.ok) data = r.data; else failed = true; });

	const DAY = 86400_000;
	const COLOR: Record<string, string> = { none: 'transparent', on: 'var(--on)', off: 'var(--border)', locked: 'var(--ok)', unlocked: 'var(--signal)', unavailable: 'var(--input)', playing: 'var(--primary)', heat: 'var(--on)', cool: 'var(--primary)' };
	const segs = $derived.by(() => {
		if (!data || data.kind !== 'state' || !data.points.length) return [];
		const start = data.now - DAY, pts = data.points;
		const run = pts.map((p, i) => { const a = Math.max(p.t, start), b = i + 1 < pts.length ? pts[i + 1].t : data!.now; return { state: p.state, a, b }; }).filter((s) => s.b > start);
		// Time before the first record is unknown, not "on": leave it blank.
		return run.length && run[0].a > start ? [{ state: 'none', a: start, b: run[0].a }, ...run] : run;
	});
	const total = (state: string) => segs.filter((s) => s.state === state).reduce((n, s) => n + (s.b - s.a), 0);
	const hrs = (ms: number) => (ms >= 3600_000 ? `${(ms / 3600_000).toFixed(ms >= 36e5 * 10 ? 0 : 1)} h` : `${Math.max(1, Math.round(ms / 60_000))} min`);
	const line = $derived.by(() => {
		if (!data || data.kind !== 'numeric' || data.points.length < 2) return null;
		const v = data.points.map((p) => Number(p.state)), lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1, t0 = data.now - DAY;
		return { d: data.points.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / DAY) * 100).toFixed(1)},${(28 - ((Number(p.state) - lo) / span) * 24).toFixed(1)}`).join(' '), lo, hi };
	});
	const summary = $derived(!segs.length ? '' : total('on') ? `On for ${hrs(total('on'))} in the last day` : total('unlocked') ? `Unlocked for ${hrs(total('unlocked'))} in the last day` : total('playing') ? `Playing for ${hrs(total('playing'))} in the last day` : 'No activity in the last day');
</script>

<div class="space-y-2">
	<h3 class="text-sm font-medium">Last 24 hours</h3>
	{#if failed}<p class="text-sm text-muted-foreground">History isn't available right now.</p>
	{:else if !data}<div class="h-9 animate-pulse rounded-lg bg-muted"></div>
	{:else if data.kind === 'numeric' && line}
		<svg viewBox="0 0 100 32" preserveAspectRatio="none" class="h-12 w-full overflow-visible" role="img" aria-label="Readings over the last day, from {line.lo} to {line.hi}"><path d={line.d} fill="none" stroke="var(--primary)" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" /></svg>
		<p class="flex justify-between text-xs text-muted-foreground"><span>24 h ago</span><span>Low {line.lo} · High {line.hi}</span><span>Now</span></p>
	{:else if segs.length}
		<div class="flex h-9 overflow-hidden rounded-lg bg-muted" role="img" aria-label={summary}>
			{#each segs as s}<div style="flex:{s.b - s.a}; background:{COLOR[s.state] ?? 'var(--accent)'}" title="{s.state}"></div>{/each}
		</div>
		<p class="flex justify-between text-xs text-muted-foreground"><span>24 h ago</span><span>{summary}</span><span>Now</span></p>
	{:else}<p class="text-sm text-muted-foreground">Nothing has changed in the last day.</p>{/if}
</div>
