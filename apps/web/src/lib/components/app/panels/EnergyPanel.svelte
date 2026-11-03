<script lang="ts">
	import { onMount } from 'svelte';
	import { ChevronDown, Share2 } from '@lucide/svelte';
	import { drawEnergy, sharePicture } from '#lib/sharePicture.js';
	import { haptics } from '#lib/haptics.js';
	import { api } from '#lib/api.js';
	import Empty from '#lib/components/app/Empty.svelte';

	type Meter = { id: string; name: string; available: boolean; unit: string; now: number | null; kind: 'energy' | 'power' | 'other'; todayKwh?: number | null; days?: { date: string; kwh: number }[]; peak24h?: number | null; low24h?: number | null };
	let meters = $state<Meter[]>([]), note = $state(''), since = $state<number | null>(null), loaded = $state(false);
	let picked = $state<string | null>(null), showAll = $state(false), showOther = $state(false);
	onMount(async () => { const r = await api<{ meters: Meter[]; note: string; sampledSince: number | null }>('GET', '/api/energy'); if (r.ok) { meters = r.data.meters; note = r.data.note; since = r.data.sampledSince; } loaded = true; });

	// The few meters that describe the whole home come first; the many plugs are a ranked list below.
	const headline = /whole|house|grid|solar|total/i;
	const power = $derived(meters.filter((m) => m.kind === 'power'));
	const top = $derived(power.filter((m) => headline.test(m.name)).slice(0, 2));
	const users = $derived(power.filter((m) => !top.includes(m) && m.available && m.now !== null).sort((a, b) => (b.now ?? 0) - (a.now ?? 0)));
	const offline = $derived(power.filter((m) => !top.includes(m) && !(m.available && m.now !== null)));
	const energy = $derived(meters.filter((m) => m.kind === 'energy' && m.days?.length));
	const other = $derived(meters.filter((m) => m.kind === 'other'));
	const cur = $derived(energy.find((m) => m.id === picked) ?? energy[0]);
	const shown = $derived(showAll ? users : users.slice(0, 6));
	const biggest = $derived(Math.max(1, ...users.map((m) => m.now ?? 0)));

	const num = (n: number) => (Math.abs(n) >= 100 ? Math.round(n).toLocaleString() : (Math.round(n * 10) / 10).toLocaleString());
	/** 4329.557 W reads as 4.33 kW; small values are whole watts. */
	function watts(m: Meter, v: number | null | undefined): { v: string; u: string } {
		if (v == null) return { v: '—', u: m.unit };
		if (m.unit === 'W') return Math.abs(v) >= 1000 ? { v: (v / 1000).toFixed(2), u: 'kW' } : { v: String(Math.round(v)), u: 'W' };
		return { v: num(v), u: m.unit };
	}
	/** "395 W to 4.92 kW": each end keeps its own unit so a range never reads as one number. */
	const range = (m: Meter) => { const a = watts(m, m.low24h), b = watts(m, m.peak24h); return a.u === b.u ? `${a.v}–${b.v} ${b.u}` : `${a.v} ${a.u} to ${b.v} ${b.u}`; };
	const day = (iso: string) => new Date(iso + 'T12:00').toLocaleDateString([], { weekday: 'short' });
	const stats = $derived.by(() => {
		const d = cur?.days ?? [];
		const [first] = d;
		if (!first) return null;
		const total = d.reduce((a, x) => a + x.kwh, 0), avg = total / d.length, best = d.reduce((a, x) => (x.kwh > a.kwh ? x : a), first);
		return { total, avg, best, max: Math.max(0.1, ...d.map((x) => x.kwh)) };
	});
	async function share() {
		if (!cur || !stats) return;
		haptics.tap();
		const label = cur.name.replace(/ energy( produced)?$/i, cur.name.match(/produced/i) ? ' produced' : '');
		await sharePicture((g, w, h) => drawEnergy(g, w, h, { name: label, today: cur.todayKwh ?? null, avg: stats.avg, days: (cur.days ?? []).map((d) => ({ label: day(d.date), kwh: d.kwh })) }), 'energy-week', `${label}, this week`);
	}
	const pct = (v: number, lo: number, hi: number) => (hi > lo ? Math.min(100, Math.max(0, ((v - lo) / (hi - lo)) * 100)) : 0);
</script>

<div class="space-y-5">
	{#if loaded && !meters.length}<Empty title="No energy meters" description="Energy meters appear here once they're shared with you." />{/if}

	{#if top.length}
		<div class="grid grid-cols-2 gap-2.5">
			{#each top as m (m.id)}
				{@const w = watts(m, m.now)}
				<section class="rounded-tile border bg-card p-3.5 {m.available ? '' : 'opacity-65'}">
					<h2 class="truncate text-[0.8125rem] text-muted-foreground">{m.name.replace(/ power$/i, '')}</h2>
					<p class="figure mt-0.5 text-[1.75rem] leading-tight">{m.available ? w.v : '—'}<span class="ml-1 text-base font-medium text-muted-foreground">{m.available ? w.u : 'offline'}</span></p>
					{#if m.peak24h != null && m.low24h != null}
						<div class="mt-2 h-1.5 rounded-full bg-muted" aria-hidden="true"><div class="relative h-full"><span class="absolute top-0 h-1.5 rounded-full bg-primary/25" style="left:0;right:0"></span><span class="absolute -top-[3px] size-3 -translate-x-1/2 rounded-full bg-primary ring-2 ring-card" style="left:{pct(m.now ?? 0, m.low24h, m.peak24h)}%"></span></div></div>
						<p class="mt-1.5 text-xs text-muted-foreground">24 h: {range(m)}</p>
					{:else}<p class="mt-2 text-xs text-muted-foreground">Collecting readings…</p>{/if}
				</section>
			{/each}
		</div>
	{/if}

	{#if cur && stats}
		<section class="rounded-tile border bg-card p-3.5" aria-label="Energy over the past week">
			<div class="no-scrollbar -mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="Meter">
				{#each energy as m (m.id)}
					<button type="button" role="tab" aria-selected={m.id === cur.id} onclick={() => (picked = m.id)} class="h-8 shrink-0 rounded-full px-3 text-[0.8125rem] font-medium transition-colors {m.id === cur.id ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground'}">{m.name.replace(/ energy( produced)?$/i, m.name.match(/produced/i) ? ' produced' : '')}</button>
				{/each}
			</div>
			<div class="mt-3 flex items-end justify-between gap-3">
				<p class="figure text-[1.75rem] leading-none">{cur.todayKwh != null ? num(cur.todayKwh) : '—'}<span class="ml-1 text-base font-medium text-muted-foreground">kWh today</span></p>
				<p class="text-right text-xs text-muted-foreground">Average {num(stats.avg)} kWh a day<br />Best {day(stats.best.date)}, {num(stats.best.kwh)}</p>
			</div>
			<div class="mt-3 flex justify-end"><button type="button" onclick={share} class="flex h-9 items-center gap-1.5 rounded-full bg-secondary px-3.5 text-[0.8125rem] font-medium text-foreground transition-transform active:scale-95"><Share2 class="size-4" />Share this week</button></div>
			<div class="relative mt-4 flex h-24 items-end gap-1.5" role="img" aria-label="Daily kWh: {(cur.days ?? []).map((d) => `${day(d.date)} ${d.kwh}`).join(', ')}">
				<span class="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/25" style="bottom:{(stats.avg / stats.max) * 100}%" aria-hidden="true"></span>
				{#each cur.days ?? [] as d, i}
					<div class="flex flex-1 flex-col items-center justify-end gap-1" style="height:100%">
						<span class="text-[10px] leading-none text-muted-foreground tabular-nums">{num(d.kwh)}</span>
						<div class="w-full rounded-t-md {i === (cur.days?.length ?? 0) - 1 ? 'bg-primary' : 'bg-primary/30'}" style="height:{Math.max(4, (d.kwh / stats.max) * 78)}%"></div>
					</div>
				{/each}
			</div>
			<div class="mt-1.5 flex gap-1.5 text-center text-[11px] text-muted-foreground">{#each cur.days ?? [] as d}<span class="flex-1">{day(d.date)}</span>{/each}</div>
		</section>
	{/if}

	{#if users.length}
		<section aria-label="Using power now">
			<div class="mb-2 flex items-baseline justify-between"><h2 class="heading">Using power now</h2><span class="text-xs text-muted-foreground">{users.length} meters</span></div>
			<ul class="divide-y overflow-hidden rounded-tile border bg-card">
				{#each shown as m (m.id)}
					{@const w = watts(m, m.now)}
					<li class="px-3.5 py-2.5">
						<div class="flex items-baseline justify-between gap-3"><span class="truncate text-[0.9375rem]">{m.name.replace(/ (plug )?power$/i, '')}</span><span class="figure shrink-0 text-[0.9375rem] tabular-nums">{w.v}<span class="ml-0.5 text-xs font-medium text-muted-foreground">{w.u}</span></span></div>
						<div class="mt-1.5 h-1 rounded-full bg-muted" aria-hidden="true"><div class="h-full rounded-full bg-primary/70 transition-[width] duration-500" style="width:{Math.max(2, ((m.now ?? 0) / biggest) * 100)}%"></div></div>
						{#if m.peak24h != null}<p class="mt-1 text-[11px] text-muted-foreground">24 h range {range(m)}</p>{/if}
					</li>
				{/each}
			</ul>
			{#if users.length > 6}
				<button type="button" class="mx-auto mt-2 flex h-9 items-center gap-1 rounded-full px-3 text-sm font-medium text-primary" onclick={() => (showAll = !showAll)} aria-expanded={showAll}>{showAll ? 'Show fewer' : `Show all ${users.length}`}<ChevronDown class="size-4 transition-transform {showAll ? 'rotate-180' : ''}" /></button>
			{/if}
		</section>
	{/if}

	{#if other.length || offline.length}
		<section>
			<button type="button" class="flex w-full items-center justify-between rounded-xl bg-secondary px-3.5 py-2.5 text-sm font-medium" onclick={() => (showOther = !showOther)} aria-expanded={showOther}>Other readings and offline meters<span class="flex items-center gap-1 text-muted-foreground">{other.length + offline.length}<ChevronDown class="size-4 transition-transform {showOther ? 'rotate-180' : ''}" /></span></button>
			{#if showOther}
				<ul class="mt-2 divide-y overflow-hidden rounded-tile border bg-card text-sm">
					{#each [...other, ...offline] as m (m.id)}<li class="flex justify-between gap-3 px-3.5 py-2"><span class="truncate">{m.name}</span><span class="shrink-0 text-muted-foreground tabular-nums">{m.available && m.now !== null ? `${num(m.now)} ${m.unit}` : 'offline'}</span></li>{/each}
				</ul>
			{/if}
		</section>
	{/if}

	{#if loaded && meters.length}<p class="max-w-[70ch] text-xs text-muted-foreground">{note}{#if since} Sampling began {new Date(since).toLocaleDateString()}.{/if} Meters are shown separately and never added together, since one may already include another.</p>{/if}
</div>
