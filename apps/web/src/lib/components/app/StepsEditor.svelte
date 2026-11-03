<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { actionsFor, type Step } from '#lib/steps.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import Picker from '#lib/components/app/Picker.svelte';
	import { ArrowDown, ArrowUp, Trash2 } from '@lucide/svelte';

	let { steps = $bindable(), failed = null }: { steps: Step[]; failed?: number | null } = $props();

	const controllable = $derived(home.devices.filter((d) => d.available && actionsFor(d).length));
	const optsOf = (eid: string) => { const d = home.byId(eid); return d ? actionsFor(d) : []; };

	function addDevice() {
		const d = controllable[0]; if (!d) return;
		const a = actionsFor(d)[0]; if (!a) return;
		steps.push({ type: 'device', entityId: d.id, action: a.action, ...(a.input ? { value: a.input.kind === 'number' ? a.input.start : a.input.options[0] } : {}) });
	}
	function onDevice(s: Extract<Step, { type: 'device' }>, eid: string) {
		s.entityId = eid; const a = optsOf(eid)[0]; if (!a) return;
		s.action = a.action; if (a.input) s.value = a.input.kind === 'number' ? a.input.start : a.input.options[0]; else delete s.value;
	}
	function onAction(s: Extract<Step, { type: 'device' }>, action: string) {
		s.action = action; const a = optsOf(s.entityId).find((x) => x.action === action);
		if (a?.input) s.value = a.input.kind === 'number' ? a.input.start : a.input.options[0]; else delete s.value;
	}
	const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= steps.length) return; steps.splice(j, 0, ...steps.splice(i, 1)); };
</script>

<ol class="space-y-2">
	{#each steps as s, i}
		<li class="rounded-2xl border bg-card {failed === i ? 'border-signal ring-2 ring-signal/20' : ''}"><div class="space-y-3 p-3.5">
			<div class="flex items-center justify-between gap-2">
				<span class="flex items-center gap-2 text-sm font-medium"><span class="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold tabular-nums">{i + 1}</span>{s.type === 'device' ? 'Device' : s.type === 'scene' ? 'Scene' : s.type === 'mode' ? 'Mode' : 'Wait'}</span>
				<span class="flex gap-1">
					<Button size="icon-sm" variant="ghost" aria-label="Move step {i + 1} up" disabled={i === 0} onclick={() => move(i, -1)}><ArrowUp /></Button>
					<Button size="icon-sm" variant="ghost" aria-label="Move step {i + 1} down" disabled={i === steps.length - 1} onclick={() => move(i, 1)}><ArrowDown /></Button>
					<Button size="icon-sm" variant="ghost" aria-label="Remove step {i + 1}" onclick={() => steps.splice(i, 1)}><Trash2 /></Button>
				</span>
			</div>
			{#if s.type === 'device'}
				<div class="flex flex-wrap gap-2">
					<Picker class="min-w-40 flex-1" label="Device for step {i + 1}" value={s.entityId} options={controllable.map((d) => ({ value: d.id, label: d.name }))} onchange={(v) => onDevice(s, v)} />
					<Picker class="min-w-36" label="Action for step {i + 1}" value={s.action} options={optsOf(s.entityId).map((a) => ({ value: a.action, label: a.label }))} onchange={(v) => onAction(s, v)} />
					{#each [optsOf(s.entityId).find((a) => a.action === s.action)?.input] as inp}
						{#if inp?.kind === 'number'}
							<span class="flex items-center gap-1"><Input type="number" class="w-24" min={inp.min} max={inp.max} step={inp.step} bind:value={s.value as number} aria-label="Value for step {i + 1}" /><span class="text-sm text-muted-foreground">{inp.unit}</span></span>
						{:else if inp?.kind === 'select'}
							<Picker capitalize label="Value for step {i + 1}" bind:value={s.value as string} options={inp.options.map((o: string) => ({ value: o, label: o }))} />
						{/if}
					{/each}
				</div>
			{:else if s.type === 'scene'}
				<Picker class="w-full" label="Scene for step {i + 1}" bind:value={s.entityId} options={home.scenes.map((sc) => ({ value: sc.id, label: sc.name }))} />
			{:else if s.type === 'mode'}
				<Picker capitalize label="Mode for step {i + 1}" bind:value={s.mode} options={(home.mode?.modes ?? []).map((m) => ({ value: m, label: m }))} />
			{:else}
				<span class="flex items-center gap-2 text-sm">Wait <Input type="number" class="w-24" min={1} max={600} bind:value={s.seconds} aria-label="Seconds to wait in step {i + 1}" /> seconds</span>
			{/if}
		</div></li>
	{:else}
		<li class="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No steps yet. Add one below.</li>
	{/each}
</ol>

<div class="mt-3 flex flex-wrap gap-2" role="group" aria-label="Add a step">
	<Button size="sm" variant="secondary" onclick={addDevice} disabled={!controllable.length}>+ Device</Button>
	<Button size="sm" variant="secondary" onclick={() => home.scenes[0] && steps.push({ type: 'scene', entityId: home.scenes[0].id })} disabled={!home.scenes.length}>+ Scene</Button>
	<Button size="sm" variant="secondary" onclick={() => steps.push({ type: 'mode', mode: 'home' })}>+ Mode</Button>
	<Button size="sm" variant="secondary" onclick={() => steps.push({ type: 'delay', seconds: 5 })}>+ Wait</Button>
</div>
