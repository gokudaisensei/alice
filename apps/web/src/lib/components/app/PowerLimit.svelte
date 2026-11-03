<script lang="ts">
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { home, type Device } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Switch } from '#lib/components/ui/switch';
	import { Label } from '#lib/components/ui/label';

	let { device }: { device: Device } = $props();
	let saved = $state<{ watts: number; enabled: boolean } | null>(null), text = $state(''), on = $state(true), busy = $state(false), ready = $state(false);
	const watts = $derived(Number(text.replace(/[ ,]/g, '')));
	const valid = $derived(Number.isInteger(watts) && watts >= 1 && watts <= 100000);
	const dirty = $derived(!saved || saved.watts !== watts || saved.enabled !== on);
	const now = $derived(device.reading ? `${device.reading.value} ${device.reading.unit ?? ''}`.trim() : null);

	onMount(async () => {
		const r = await api<{ limits: { entityId: string; watts: number; enabled: boolean }[] }>('GET', '/api/power-limits');
		const mine = r.ok ? r.data.limits.find((l) => l.entityId === device.id) : null;
		if (mine) { saved = { watts: mine.watts, enabled: mine.enabled }; text = String(mine.watts); on = mine.enabled; }
		ready = true;
	});
	async function save() {
		if (!valid || busy) return; busy = true;
		const r = await api('PUT', `/api/power-limits/${encodeURIComponent(device.id)}`, { watts, enabled: on });
		busy = false;
		if (r.ok) { saved = { watts, enabled: on }; home.say('ok', on ? `You'll be told if it stays above ${watts.toLocaleString()} W.` : 'Alert saved, but switched off.'); }
		else home.say('error', explain(r.data?.error));
	}
	async function remove() {
		busy = true; const r = await api('DELETE', `/api/power-limits/${encodeURIComponent(device.id)}`); busy = false;
		if (r.ok) { saved = null; text = ''; on = true; home.say('ok', 'Alert removed.'); } else home.say('error', explain(r.data?.error));
	}
</script>

{#if ready}
	<section class="space-y-3 rounded-2xl bg-secondary/60 p-4" aria-label="Power alert">
		<div class="flex items-center justify-between gap-3">
			<div><h3 class="text-[0.9375rem] font-semibold tracking-[-0.01em]">Alert me above</h3>{#if now}<p class="text-xs text-muted-foreground">Right now: {now}</p>{/if}</div>
			{#if saved}<Switch checked={on} onCheckedChange={(v) => (on = v)} aria-label="Alert is on" />{/if}
		</div>
		<div class="flex items-end gap-2">
			<div class="flex-1 space-y-1.5"><Label for="plimit-{device.id}" class="sr-only">Limit in watts</Label>
				<div class="relative"><Input id="plimit-{device.id}" inputmode="numeric" placeholder="e.g. 2000" bind:value={text} class="pr-9" onkeydown={(e) => e.key === 'Enter' && save()} /><span class="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">W</span></div></div>
			<Button onclick={save} disabled={!valid || !dirty || busy}>{saved ? 'Save' : 'Set alert'}</Button>
		</div>
		<p class="text-xs text-muted-foreground">You get a notification if it stays above this for 5 minutes. A short burst is ignored.{#if saved} <button type="button" class="font-medium text-primary underline-offset-4 hover:underline" onclick={remove} disabled={busy}>Remove alert</button>{/if}</p>
	</section>
{/if}
