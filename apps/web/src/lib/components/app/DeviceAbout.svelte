<script lang="ts">
	import { onMount } from 'svelte';
	import { api } from '#lib/api.js';

	let { id }: { id: string } = $props();
	type About = { device: string | null; manufacturer: string | null; model: string | null; firmware: string | null; integration: string | null; room: string | null; floor: string | null; battery: number | null; labels: string[] };
	let about = $state<About | null>(null);
	onMount(async () => { const r = await api<About>('GET', `/api/devices/${encodeURIComponent(id)}/about`); if (r.ok) about = r.data; });

	const rows = $derived(!about ? [] : ([
		['Device', about.device], ['Made by', [about.manufacturer, about.model].filter(Boolean).join(' ') || null], ['Firmware', about.firmware],
		['Connected through', about.integration], ['Home Assistant room', [about.floor, about.room].filter(Boolean).join(' · ') || null],
		['Battery', about.battery === null ? null : `${about.battery}%`], ['Labels', about.labels.length ? about.labels.join(', ') : null],
	] as [string, string | null][]).filter((r): r is [string, string] => !!r[1]));
</script>

{#if rows.length}
	<details class="group rounded-2xl bg-secondary/40 px-4 py-3">
		<summary class="cursor-pointer list-none text-sm font-medium">About this device</summary>
		<dl class="mt-3 space-y-1.5 text-sm">
			{#each rows as [k, v] (k)}<div class="flex justify-between gap-4"><dt class="text-muted-foreground">{k}</dt><dd class="min-w-0 truncate text-right">{v}</dd></div>{/each}
		</dl>
	</details>
{/if}
