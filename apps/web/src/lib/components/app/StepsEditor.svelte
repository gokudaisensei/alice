<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { actionsFor, type Step } from '#lib/steps.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import Picker from '#lib/components/app/Picker.svelte';
	import AddOptions from '#lib/components/app/builder/AddOptions.svelte';
		import { ArrowDown, ArrowUp, Hourglass, Lightbulb, Sparkles, SunMoon, Trash2, Undo2 } from '@lucide/svelte';

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

	// Removing a step is one tap, so it can always be taken back for a few seconds.
	let removed = $state<{ step: Step; at: number } | null>(null), undoTimer: ReturnType<typeof setTimeout>;
	function remove(i: number) {
		const [step] = steps.splice(i, 1); if (!step) return;
		removed = { step, at: i }; clearTimeout(undoTimer); undoTimer = setTimeout(() => (removed = null), 8000);
	}
	function undo() { if (!removed) return; steps.splice(Math.min(removed.at, steps.length), 0, removed.step); removed = null; clearTimeout(undoTimer); }
</script>

<ol class="space-y-2">
	{#each steps as s, i}
		<li class="rounded-2xl border bg-card {failed === i ? 'border-signal ring-2 ring-signal/20' : ''}"><div class="space-y-3 p-3.5">
			<div class="flex items-center justify-between gap-2">
				<span class="flex items-center gap-2 text-sm font-medium"><span class="flex size-6 items-center justify-center rounded-full bg-secondary text-xs font-semibold tabular-nums">{i + 1}</span>{s.type === 'device' ? 'Control a device' : s.type === 'scene' ? 'Run a scene' : s.type === 'mode' ? 'Set the house mode' : 'Wait'}</span>
				<span class="flex items-center gap-5">
					<span class="flex rounded-full bg-secondary p-0.5" role="group" aria-label="Move step {i + 1}">
						<Button size="icon-sm" variant="ghost" class="rounded-full" aria-label="Move step {i + 1} earlier" disabled={i === 0} onclick={() => move(i, -1)}><ArrowUp /></Button>
						<Button size="icon-sm" variant="ghost" class="rounded-full" aria-label="Move step {i + 1} later" disabled={i === steps.length - 1} onclick={() => move(i, 1)}><ArrowDown /></Button>
					</span>
					<Button size="icon-sm" variant="ghost" class="text-signal" aria-label="Remove step {i + 1}" onclick={() => remove(i)}><Trash2 /></Button>
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
				<span class="flex items-center gap-2 text-sm">Wait <Input type="number" class="w-24" min={1} max={600} bind:value={s.seconds} aria-label="Seconds to wait in step {i + 1}" /> {s.seconds === 1 ? 'second' : 'seconds'}</span>
			{/if}
		</div></li>
	{:else}
		<li class="rounded-2xl bg-secondary/60 p-5 text-center text-sm text-muted-foreground">Nothing here yet. Choose what should happen below.</li>
	{/each}
</ol>

{#if removed}
	<p role="status" class="mt-3 flex items-center justify-between gap-3 rounded-xl bg-secondary px-3.5 py-2 text-sm">Step removed.<Button size="sm" variant="ghost" onclick={undo}><Undo2 />Undo</Button></p>
{/if}

<div class="mt-3"><AddOptions label="Add a step" options={[
	{ title: 'Control a device', desc: 'Turn it on or off, dim it, lock it.', icon: Lightbulb, onclick: addDevice, disabled: !controllable.length, why: 'No devices can be controlled yet.' },
	{ title: 'Run a scene', desc: 'Set several devices at once.', icon: Sparkles, onclick: () => home.scenes[0] && steps.push({ type: 'scene', entityId: home.scenes[0].id }), disabled: !home.scenes.length, why: 'No scenes yet. Make one first.' },
	{ title: 'Set the house mode', desc: 'Home, Away or Night.', icon: SunMoon, onclick: () => steps.push({ type: 'mode', mode: 'home' }) },
	{ title: 'Wait', desc: 'Pause before the next step.', icon: Hourglass, onclick: () => steps.push({ type: 'delay', seconds: 5 }) }
]} /></div>
