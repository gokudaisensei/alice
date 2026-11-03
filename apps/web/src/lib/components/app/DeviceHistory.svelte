<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';

	let { id }: { id: string } = $props();
	type P = { t: number; state: string };
	type History = { kind: 'state' | 'numeric'; points: P[]; now: number };
	let data = $state<History | null>(null), failed = $state(false), hours = $state(24);
	async function load(h: number) { const r = await api<History>('GET', `/api/devices/${encodeURIComponent(id)}/history?hours=${h}`); if (h !== hours) return; if (r.ok) { data = r.data; failed = false; } else failed = true; }
	onMount(() => load(24));
	function pick(h: number) { hours = h; data = null; void load(h); }

	const SPAN = $derived(hours * 3600_000);
	const when = $derived(hours === 24 ? 'last 24 hours' : hours === 168 ? 'last 7 days' : 'last 30 days');
	const COLOR: Record<string, string> = { none: 'transparent', on: 'var(--on)', off: 'var(--border)', locked: 'var(--ok)', unlocked: 'var(--signal)', unavailable: 'var(--input)', playing: 'var(--primary)', heat: 'var(--on)', cool: 'var(--primary)' };
	const segs = $derived.by(() => {
		if (!data || data.kind !== 'state' || !data.points.length) return [];
		const now = data.now, start = now - SPAN, pts = data.points;
		const run = pts.map((p, i) => ({ state: p.state, a: Math.max(p.t, start), b: pts[i + 1]?.t ?? now })).filter((s) => s.b > start);
		// Time before the first record is unknown, not "on": leave it blank.
		const first = run[0];
		return first && first.a > start ? [{ state: 'none', a: start, b: first.a }, ...run] : run;
	});
	const total = (state: string) => segs.filter((s) => s.state === state).reduce((n, s) => n + (s.b - s.a), 0);
	const hrs = (ms: number) => (ms >= 3600_000 ? `${(ms / 3600_000).toFixed(ms >= 36e5 * 10 ? 0 : 1)} h` : `${Math.max(1, Math.round(ms / 60_000))} min`);
	const line = $derived.by(() => {
		if (!data || data.kind !== 'numeric' || data.points.length < 2) return null;
		const v = data.points.map((p) => Number(p.state)), lo = Math.min(...v), hi = Math.max(...v), span = hi - lo || 1, t0 = data.now - SPAN;
		return { d: data.points.map((p, i) => `${i ? 'L' : 'M'}${(((p.t - t0) / SPAN) * 100).toFixed(1)},${(28 - ((Number(p.state) - lo) / span) * 24).toFixed(1)}`).join(' '), lo, hi };
	});
	const summary = $derived(!segs.length ? '' : total('on') ? `On for ${hrs(total('on'))} in the ${when}` : total('unlocked') ? `Unlocked for ${hrs(total('unlocked'))} in the ${when}` : total('playing') ? `Playing for ${hrs(total('playing'))} in the ${when}` : `No activity in the ${when}`);
</script>

<div class="space-y-2">
	<div class="flex items-center justify-between gap-3"><h3 class="text-sm font-medium capitalize">{when}</h3>
		<div class="flex gap-1" role="group" aria-label="Range">{#each [[24, '24 h'], [168, '7 d'], [720, '30 d']] as [h, l]}<button type="button" class="h-7 rounded-full px-2.5 text-xs font-medium {hours === h ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}" aria-pressed={hours === h} onclick={() => pick(h as number)}>{l}</button>{/each}</div></div>
	{#if failed}<p class="text-sm text-muted-foreground">History isn't available right now.</p>
	{:else if !data}<div class="h-9 animate-pulse rounded-lg bg-muted"></div>
	{:else if data.kind === 'numeric' && line}
		<svg viewBox="0 0 100 32" preserveAspectRatio="none" class="h-12 w-full overflow-visible" role="img" aria-label="Readings over the {when}, from {line.lo} to {line.hi}"><path d={line.d} fill="none" stroke="var(--primary)" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round" /></svg>
		<p class="flex justify-between text-xs text-muted-foreground"><span>{hours === 24 ? '24 h' : hours === 168 ? '7 d' : '30 d'} ago</span><span>Low {line.lo} · High {line.hi}</span><span>Now</span></p>
	{:else if segs.length}
		<div class="flex h-9 overflow-hidden rounded-lg bg-muted" role="img" aria-label={summary}>
			{#each segs as s}<div style="flex:{s.b - s.a}; background:{COLOR[s.state] ?? 'var(--accent)'}" title="{s.state}"></div>{/each}
		</div>
		<p class="flex justify-between text-xs text-muted-foreground"><span>{hours === 24 ? '24 h' : hours === 168 ? '7 d' : '30 d'} ago</span><span>{summary}</span><span>Now</span></p>
	{:else}<p class="text-sm text-muted-foreground">Nothing has changed in the {when}.</p>{/if}
</div>
