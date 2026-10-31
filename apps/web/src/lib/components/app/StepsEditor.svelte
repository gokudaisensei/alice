<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { actionsFor, type Step } from '#lib/steps.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import * as Card from '#lib/components/ui/card';

	let { steps = $bindable(), failed = null }: { steps: Step[]; failed?: number | null } = $props();

	const controllable = $derived(home.devices.filter((d) => d.available && actionsFor(d).length));
	const optsOf = (eid: string) => { const d = home.byId(eid); return d ? actionsFor(d) : []; };

	function addDevice() {
		const d = controllable[0]; if (!d) return;
		const a = actionsFor(d)[0];
		steps.push({ type: 'device', entityId: d.id, action: a.action, ...(a.input ? { value: a.input.kind === 'number' ? a.input.start : a.input.options[0] } : {}) });
	}
	function onDevice(s: Extract<Step, { type: 'device' }>, eid: string) {
		s.entityId = eid; const a = optsOf(eid)[0];
		s.action = a.action; if (a.input) s.value = a.input.kind === 'number' ? a.input.start : a.input.options[0]; else delete s.value;
	}
	function onAction(s: Extract<Step, { type: 'device' }>, action: string) {
		s.action = action; const a = optsOf(s.entityId).find((x) => x.action === action);
		if (a?.input) s.value = a.input.kind === 'number' ? a.input.start : a.input.options[0]; else delete s.value;
	}
	const move = (i: number, d: number) => { const j = i + d; if (j < 0 || j >= steps.length) return; [steps[i], steps[j]] = [steps[j], steps[i]]; };
</script>

<ol class="space-y-2">
	{#each steps as s, i}
		<li><Card.Root class="gap-0 py-0 {failed === i ? 'border-destructive' : ''}"><div class="space-y-2 p-3">
			<div class="flex items-center justify-between gap-2">
				<span class="text-sm font-medium">Step {i + 1}</span>
				<span class="flex gap-1">
					<Button size="sm" variant="ghost" aria-label="Move step {i + 1} up" disabled={i === 0} onclick={() => move(i, -1)}>↑</Button>
					<Button size="sm" variant="ghost" aria-label="Move step {i + 1} down" disabled={i === steps.length - 1} onclick={() => move(i, 1)}>↓</Button>
					<Button size="sm" variant="ghost" aria-label="Remove step {i + 1}" onclick={() => steps.splice(i, 1)}>Remove</Button>
				</span>
			</div>
			{#if s.type === 'device'}
				<div class="flex flex-wrap gap-2">
					<select class="h-9 min-w-40 flex-1 rounded-md border bg-background px-2 text-sm" aria-label="Device for step {i + 1}" value={s.entityId} onchange={(e) => onDevice(s, e.currentTarget.value)}>
						{#each controllable as d}<option value={d.id}>{d.name}</option>{/each}
					</select>
					<select class="h-9 rounded-md border bg-background px-2 text-sm" aria-label="Action for step {i + 1}" value={s.action} onchange={(e) => onAction(s, e.currentTarget.value)}>
						{#each optsOf(s.entityId) as a}<option value={a.action}>{a.label}</option>{/each}
					</select>
					{#each [optsOf(s.entityId).find((a) => a.action === s.action)?.input] as inp}
						{#if inp?.kind === 'number'}
							<span class="flex items-center gap-1"><Input type="number" class="w-24" min={inp.min} max={inp.max} step={inp.step} bind:value={s.value as number} aria-label="Value for step {i + 1}" /><span class="text-sm text-muted-foreground">{inp.unit}</span></span>
						{:else if inp?.kind === 'select'}
							<select class="h-9 rounded-md border bg-background px-2 text-sm capitalize" aria-label="Value for step {i + 1}" bind:value={s.value}>{#each inp.options as o}<option value={o}>{o}</option>{/each}</select>
						{/if}
					{/each}
				</div>
			{:else if s.type === 'scene'}
				<select class="h-9 w-full rounded-md border bg-background px-2 text-sm" aria-label="Scene for step {i + 1}" bind:value={s.entityId}>{#each home.scenes as sc}<option value={sc.id}>{sc.name}</option>{/each}</select>
			{:else if s.type === 'mode'}
				<select class="h-9 rounded-md border bg-background px-2 text-sm capitalize" aria-label="Mode for step {i + 1}" bind:value={s.mode}>{#each home.mode?.modes ?? [] as m}<option value={m}>{m}</option>{/each}</select>
			{:else}
				<span class="flex items-center gap-2 text-sm">Wait <Input type="number" class="w-24" min={1} max={600} bind:value={s.seconds} aria-label="Seconds to wait in step {i + 1}" /> seconds</span>
			{/if}
		</div></Card.Root></li>
	{:else}
		<li class="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">No steps yet. Add one below.</li>
	{/each}
</ol>

<div class="mt-2 flex flex-wrap gap-2" role="group" aria-label="Add a step">
	<Button size="sm" variant="outline" onclick={addDevice} disabled={!controllable.length}>+ Device</Button>
	<Button size="sm" variant="outline" onclick={() => home.scenes[0] && steps.push({ type: 'scene', entityId: home.scenes[0].id })} disabled={!home.scenes.length}>+ Scene</Button>
	<Button size="sm" variant="outline" onclick={() => steps.push({ type: 'mode', mode: 'home' })}>+ Mode</Button>
	<Button size="sm" variant="outline" onclick={() => steps.push({ type: 'delay', seconds: 5 })}>+ Wait</Button>
</div>
