<script lang="ts">
	import { untrack } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import * as Drawer from '#lib/components/ui/drawer';
	import { Checkbox } from '#lib/components/ui/checkbox';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { haptics } from '#lib/haptics.js';
	import { Search, X } from '@lucide/svelte';

	type Row = { id: string; name: string; category: string; roomId: string | null };
	let { open = $bindable(false), title, selected = [], notRoom, nameLabel, name = $bindable(''), confirm, minimum = 1, onconfirm }: {
		open: boolean; title: string; selected?: string[]; notRoom?: string; nameLabel?: string; name?: string;
		confirm: (n: number) => string; minimum?: number; onconfirm: (ids: string[], name: string) => Promise<string | null | void> | string | null | void;
	} = $props();

	const PAGE = 40;
	let q = $state(''), rows = $state<Row[]>([]), total = $state(0), picked = $state<string[]>([]), loading = $state(false), saving = $state(false), error = $state(''), only = $state<'all' | 'none'>('all');
	let timer: ReturnType<typeof setTimeout>;
	const roomName = (id: string | null) => (id ? home.rooms.find((r) => r.id === id)?.name : null);
	const KIND: Record<string, string> = { light: 'Light', switch: 'Plug', fan: 'Fan', climate: 'Climate', lock: 'Lock', camera: 'Camera', media: 'Media', sensor: 'Sensor', energy: 'Energy' };

	async function fetchPage(offset: number) {
		loading = true;
		const qs = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
		if (q.trim()) qs.set('q', q.trim());
		if (notRoom) qs.set('notRoom', notRoom);
		if (only === 'none') qs.set('room', 'none');
		const r = await api('GET', `/api/admin/devices?${qs}`);
		loading = false;
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		rows = offset ? [...rows, ...r.data.devices] : r.data.devices; total = r.data.total;
	}
	// Every time the sheet opens: start clean, with what was already chosen ticked.
	$effect(() => { if (open) untrack(() => { q = ''; only = 'all'; picked = [...selected]; error = ''; fetchPage(0); }); });
	function search() { clearTimeout(timer); timer = setTimeout(() => fetchPage(0), 220); }
	const has = (id: string) => picked.includes(id);
	function flip(id: string) { haptics.tap(); picked = has(id) ? picked.filter((x) => x !== id) : [...picked, id]; }
	const valid = $derived(picked.length >= minimum && (nameLabel === undefined || name.trim().length > 0));
	async function save() {
		saving = true; error = '';
		const e = await onconfirm(picked, name.trim());
		saving = false;
		if (e) error = e; else open = false;
	}
</script>

<Drawer.Root bind:open>
	<Drawer.Content class="h-[88dvh] max-h-[88dvh] rounded-t-3xl">
		<div class="flex min-h-0 flex-1 flex-col">
			<div class="space-y-3 px-5 pb-3 pt-2">
				<Drawer.Header class="px-0 pb-0"><Drawer.Title class="text-left text-xl font-semibold tracking-[-0.02em]">{title}</Drawer.Title><Drawer.Description class="sr-only">Search and choose devices</Drawer.Description></Drawer.Header>
				{#if nameLabel !== undefined}<Input bind:value={name} maxlength={60} placeholder={nameLabel} aria-label={nameLabel} class="h-11 text-base" />{/if}
				<div class="relative"><Search class="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input type="search" class="h-11 pl-9 pr-9 text-base" placeholder="Search devices" bind:value={q} oninput={search} aria-label="Search devices" />{#if q}<button type="button" class="absolute right-2 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground" aria-label="Clear search" onclick={() => { q = ''; fetchPage(0); }}><X class="size-4" /></button>{/if}</div>
				{#if notRoom}
					<div class="flex gap-1.5" role="group" aria-label="Filter">
						{#each [['all', 'All devices'], ['none', 'Not in a room']] as [k, l]}<button type="button" aria-pressed={only === k} onclick={() => { only = k as 'all' | 'none'; fetchPage(0); }} class="h-8 rounded-full px-3.5 text-sm font-medium transition-colors {only === k ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground'}">{l}</button>{/each}
					</div>
				{/if}
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t">
				{#each rows as d (d.id)}
					<button type="button" role="checkbox" aria-checked={has(d.id)} onclick={() => flip(d.id)} class="flex min-h-14 w-full items-center gap-3 border-b px-5 py-2.5 text-left transition-colors active:bg-muted">
						<Checkbox checked={has(d.id)} />
						<span class="min-w-0 flex-1"><span class="block truncate text-[0.9375rem] font-medium">{d.name}</span><span class="text-sm text-muted-foreground">{KIND[d.category] ?? d.category}{#if roomName(d.roomId)}&nbsp;· in {roomName(d.roomId)}{/if}</span></span>
					</button>
				{:else}
					{#if !loading}<p class="px-5 py-10 text-center text-sm text-muted-foreground">{q ? 'Nothing matches that search.' : 'No devices to show.'}</p>{/if}
				{/each}
				{#if rows.length < total}<div class="p-4 text-center"><Button variant="secondary" disabled={loading} onclick={() => fetchPage(rows.length)}>Show more ({total - rows.length} left)</Button></div>{/if}
			</div>
			<div class="space-y-2 border-t px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3">
				{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
				<Button size="lg" class="w-full" disabled={!valid || saving} onclick={save}>{saving ? 'Saving…' : confirm(picked.length)}</Button>
			</div>
		</div>
	</Drawer.Content>
</Drawer.Root>
