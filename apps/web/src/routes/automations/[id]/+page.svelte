<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { DAYS, isSensor, statesFor, type AutomationView, type Condition, type Template, type Trigger } from '#lib/automations.js';
	import type { Step } from '#lib/steps.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import Page from '#lib/components/app/Page.svelte';
	import { Trash2 } from '@lucide/svelte';
	import StepsEditor from '#lib/components/app/StepsEditor.svelte';
	import Collapse from '#lib/components/app/Collapse.svelte';
	import { ChevronDown } from '@lucide/svelte';

	const id = $derived(page.params.id ?? 'new');
	let name = $state('');
	let triggers = $state<Trigger[]>([]);
	let conditions = $state<Condition[]>([]);
	let actions = $state<Step[]>([]);
	let error = $state(''), saving = $state(false), ready = $state(false);
	let problem = $state<{ where: string; index: number } | null>(null);
	let preview = $state('');

	const withState = $derived(home.devices.filter((d) => statesFor(d).length));
	const sensors = $derived(home.devices.filter(isSensor));
	const unitOf = (eid: string) => home.byId(eid)?.reading?.unit ?? '';
	const num = (v: string) => (v === '' ? undefined : Number(v));
	const FOR = [[0, 'right away'], [60, 'for 1 minute'], [300, 'for 5 minutes'], [900, 'for 15 minutes'], [1800, 'for 30 minutes'], [3600, 'for 1 hour']] as const;
	const sel = 'field';

	onMount(async () => {
		if (!home.loaded) await home.load();
		if (id === 'new') {
			const q = page.url.searchParams, key = q.get('template'), dev = q.get('device');
			const t = key ? ((await api('GET', '/api/automations')).data?.suggested as Template[] | undefined)?.find((x) => x.key === key) : undefined;
			if (t) { name = t.name; triggers = structuredClone(t.triggers); conditions = structuredClone(t.conditions); }
			const d = dev ? home.byId(dev) : undefined;
			if (d && !t) { // started from a device: begin with "when this device changes"
				if (isSensor(d)) triggers = [{ type: 'sensor', entityId: d.id, above: Number(d.reading?.value) || 0 }];
				else if (statesFor(d).length) triggers = [{ type: 'device_state', entityId: d.id, to: statesFor(d)[0] }];
				name = `When ${d.name} changes`;
			}
		} else {
			const r = await api('GET', `/api/automations/${id}`);
			if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
			const a: AutomationView = r.data;
			name = a.name;
			triggers = a.triggers.map(({ text, ...t }) => t as Trigger); conditions = a.conditions.map(({ text, ...c }) => c as Condition); actions = a.actions.map(({ text, ...s }) => s as Step);
		}
		ready = true;
	});

	const payload = $derived({ name: name.trim(), triggers, conditions, actions });
	// Ask the server to explain it as people edit, so what they read is exactly what will be saved.
	$effect(() => {
		const body = $state.snapshot(payload);
		if (!ready) return;
		const t = setTimeout(async () => {
			if (!body.triggers.length || !body.actions.length) { preview = ''; problem = null; return; }
			const r = await api('POST', '/api/automations/preview', body);
			if (r.ok) { preview = r.data.summary; problem = null; }
			else { preview = ''; problem = r.data?.where ? { where: r.data.where, index: r.data.index } : null; error = ''; previewError = r.data?.message ?? explain(r.data?.error); }
			if (r.ok) previewError = '';
		}, 300);
		return () => clearTimeout(t);
	});
	let previewError = $state('');
	let openWhen = $state(true), openOnly = $state(false), openThen = $state(true);
	// A problem is never hidden inside a folded section.
	$effect(() => { if (problem?.where === 'trigger') openWhen = true; else if (problem?.where === 'condition') openOnly = true; else if (problem?.where === 'action') openThen = true; });

	const addTrigger = (t: Trigger) => triggers.push(t);
	const addCondition = (c: Condition) => conditions.push(c);
	const firstWith = () => withState[0];
	const dayOn = (c: Extract<Condition, { type: 'days' }>, d: string) => c.days.includes(d);
	const flip = (c: Extract<Condition, { type: 'days' }>, d: string) => { c.days = dayOn(c, d) ? c.days.filter((x) => x !== d) : [...c.days, d]; };
	const bad = (where: string, i: number) => problem?.where === where && problem.index === i;

	async function save() {
		saving = true; error = '';
		const r = id === 'new' ? await api('POST', '/api/automations', payload) : await api('PUT', `/api/automations/${id}`, payload);
		saving = false;
		if (!r.ok) { problem = r.data?.where ? { where: r.data.where, index: r.data.index } : null; error = r.data?.message ?? explain(r.data?.error); return; }
		goto('/routines?tab=automations');
	}
	async function remove() {
		if (!confirm(`Delete “${name}”?`)) return;
		const r = await api('DELETE', `/api/automations/${id}`);
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		goto('/routines?tab=automations');
	}
</script>

<Page title={id === 'new' ? 'New automation' : 'Edit automation'} subtitle="Choose what starts it, what has to be true, and what happens. It runs on your home hub." back={{ href: '/routines?tab=automations', label: 'Routines' }} width="md">

	<div class="space-y-1.5"><Label for="n">Name</Label><Input id="n" bind:value={name} maxlength={60} placeholder="e.g. Evening lights" /></div>

	<section aria-labelledby="when" class="space-y-3">
		<button type="button" class="flex w-full items-center gap-3 text-left" aria-expanded={openWhen} onclick={() => (openWhen = !openWhen)}>
			<span class="min-w-0 flex-1"><span id="when" class="heading block">When any of these happens</span><span class="text-sm text-muted-foreground">{triggers.length ? `${triggers.length} trigger${triggers.length === 1 ? '' : 's'}` : 'Choose what starts it'}</span></span>
			<ChevronDown class="size-4 text-muted-foreground transition-transform duration-300 {openWhen ? 'rotate-180' : ''}" />
		</button>
		<Collapse open={openWhen}><div class="space-y-3 pt-1">
		{#each triggers as t, i}
			<div class="rounded-2xl border bg-card {bad('trigger', i) ? 'border-signal ring-2 ring-signal/20' : ''}"><div class="flex flex-wrap items-center gap-2 p-3">
				{#if t.type === 'device_state'}
					<select class="{sel} min-w-36 flex-1" aria-label="Device for trigger {i + 1}" value={t.entityId} onchange={(e) => { t.entityId = e.currentTarget.value; t.to = statesFor(home.byId(t.entityId)!)[0]; }}>{#each withState as d}<option value={d.id}>{d.name}</option>{/each}</select>
					<span class="text-sm">turns</span>
					<select class="{sel} capitalize" aria-label="State for trigger {i + 1}" bind:value={t.to}>{#each statesFor(home.byId(t.entityId) ?? withState[0]) as s}<option value={s}>{s}</option>{/each}</select>
					<select class={sel} aria-label="How long for trigger {i + 1}" value={t.forSeconds ?? 0} onchange={(e) => { const v = Number(e.currentTarget.value); if (v) t.forSeconds = v; else delete t.forSeconds; }}>{#each FOR as [v, l]}<option value={v}>{l}</option>{/each}</select>
				{:else if t.type === 'sensor'}
					<select class="{sel} min-w-36 flex-1" aria-label="Sensor for trigger {i + 1}" bind:value={t.entityId}>{#each sensors as d}<option value={d.id}>{d.name}</option>{/each}</select>
					<span class="flex items-center gap-1 text-sm">goes above <Input type="number" class="w-20" value={t.above ?? ''} oninput={(e) => (t.above = num(e.currentTarget.value))} aria-label="Above for trigger {i + 1}" /></span>
					<span class="flex items-center gap-1 text-sm">or below <Input type="number" class="w-20" value={t.below ?? ''} oninput={(e) => (t.below = num(e.currentTarget.value))} aria-label="Below for trigger {i + 1}" /> {unitOf(t.entityId)}</span>
				{:else if t.type === 'time'}
					<span class="text-sm">It is</span><Input type="time" class="w-32" bind:value={t.at} aria-label="Time for trigger {i + 1}" />
				{:else if t.type === 'sun'}
					<select class={sel} aria-label="Sun event for trigger {i + 1}" bind:value={t.event}><option value="sunset">Sunset</option><option value="sunrise">Sunrise</option></select>
					<select class={sel} aria-label="Offset for trigger {i + 1}" value={t.offsetMinutes ?? 0} onchange={(e) => { const v = Number(e.currentTarget.value); if (v) t.offsetMinutes = v; else delete t.offsetMinutes; }}>
						<option value={-60}>1 hour before</option><option value={-30}>30 minutes before</option><option value={0}>exactly</option><option value={30}>30 minutes after</option><option value={60}>1 hour after</option></select>
				{:else}
					<span class="text-sm">The household mode changes to</span>
					<select class="{sel} capitalize" aria-label="Mode for trigger {i + 1}" bind:value={t.mode}>{#each home.mode?.modes ?? [] as m}<option value={m}>{m}</option>{/each}</select>
				{/if}
				<Button size="icon-sm" variant="ghost" class="ml-auto" aria-label="Remove trigger {i + 1}" onclick={() => triggers.splice(i, 1)}><Trash2 /></Button>
			</div></div>
		{:else}
			<p class="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">Choose what should start it.</p>
		{/each}
		<div class="flex flex-wrap gap-2" role="group" aria-label="Add a trigger">
			<Button size="sm" variant="secondary" disabled={!withState.length} onclick={() => firstWith() && addTrigger({ type: 'device_state', entityId: firstWith().id, to: statesFor(firstWith())[0] })}>+ A device changes</Button>
			<Button size="sm" variant="secondary" disabled={!sensors.length} onclick={() => addTrigger({ type: 'sensor', entityId: sensors[0].id, above: 0 })}>+ A sensor reading</Button>
			<Button size="sm" variant="secondary" onclick={() => addTrigger({ type: 'time', at: '07:00' })}>+ A time</Button>
			<Button size="sm" variant="secondary" onclick={() => addTrigger({ type: 'sun', event: 'sunset' })}>+ Sunrise or sunset</Button>
			<Button size="sm" variant="secondary" onclick={() => addTrigger({ type: 'mode', mode: 'away' })}>+ A household mode</Button>
		</div>
	</div></Collapse></section>

	<section aria-labelledby="only" class="space-y-3">
		<button type="button" class="flex w-full items-center gap-3 text-left" aria-expanded={openOnly} onclick={() => (openOnly = !openOnly)}>
			<span class="min-w-0 flex-1"><span id="only" class="heading block">Only if all of these are true</span><span class="text-sm text-muted-foreground">{conditions.length ? `${conditions.length} condition${conditions.length === 1 ? '' : 's'}` : 'Optional. Add a limit, like a time or a mode'}</span></span>
			<ChevronDown class="size-4 text-muted-foreground transition-transform duration-300 {openOnly ? 'rotate-180' : ''}" />
		</button>
		<Collapse open={openOnly}><div class="space-y-3 pt-1">
		{#each conditions as c, i}
			<div class="rounded-2xl border bg-card {bad('condition', i) ? 'border-signal ring-2 ring-signal/20' : ''}"><div class="flex flex-wrap items-center gap-2 p-3">
				{#if c.type === 'device_state'}
					<select class="{sel} min-w-36 flex-1" aria-label="Device for condition {i + 1}" value={c.entityId} onchange={(e) => { c.entityId = e.currentTarget.value; c.is = statesFor(home.byId(c.entityId)!)[0]; }}>{#each withState as d}<option value={d.id}>{d.name}</option>{/each}</select>
					<span class="text-sm">is</span>
					<select class="{sel} capitalize" aria-label="State for condition {i + 1}" bind:value={c.is}>{#each statesFor(home.byId(c.entityId) ?? withState[0]) as s}<option value={s}>{s}</option>{/each}</select>
				{:else if c.type === 'sensor'}
					<select class="{sel} min-w-36 flex-1" aria-label="Sensor for condition {i + 1}" bind:value={c.entityId}>{#each sensors as d}<option value={d.id}>{d.name}</option>{/each}</select>
					<span class="flex items-center gap-1 text-sm">is above <Input type="number" class="w-20" value={c.above ?? ''} oninput={(e) => (c.above = num(e.currentTarget.value))} aria-label="Above for condition {i + 1}" /></span>
					<span class="flex items-center gap-1 text-sm">and below <Input type="number" class="w-20" value={c.below ?? ''} oninput={(e) => (c.below = num(e.currentTarget.value))} aria-label="Below for condition {i + 1}" /> {unitOf(c.entityId)}</span>
				{:else if c.type === 'time'}
					<span class="text-sm">The time is between</span><Input type="time" class="w-32" bind:value={c.after} aria-label="From time for condition {i + 1}" /><span class="text-sm">and</span><Input type="time" class="w-32" bind:value={c.before} aria-label="Until time for condition {i + 1}" />
				{:else if c.type === 'mode'}
					<span class="text-sm">The household mode is</span>
					<select class="{sel} capitalize" aria-label="Mode for condition {i + 1}" bind:value={c.mode}>{#each home.mode?.modes ?? [] as m}<option value={m}>{m}</option>{/each}</select>
				{:else}
					<span class="text-sm">Only on</span>
					<span class="flex flex-wrap gap-1" role="group" aria-label="Days for condition {i + 1}">{#each DAYS as [d, l]}<Button size="sm" variant={dayOn(c, d) ? 'secondary' : 'outline'} aria-pressed={dayOn(c, d)} onclick={() => flip(c, d)}>{l}</Button>{/each}</span>
				{/if}
				<Button size="icon-sm" variant="ghost" class="ml-auto" aria-label="Remove condition {i + 1}" onclick={() => conditions.splice(i, 1)}><Trash2 /></Button>
			</div></div>
		{/each}
		<div class="flex flex-wrap gap-2" role="group" aria-label="Add a condition">
			<Button size="sm" variant="secondary" disabled={!withState.length} onclick={() => firstWith() && addCondition({ type: 'device_state', entityId: firstWith().id, is: statesFor(firstWith())[0] })}>+ A device is</Button>
			<Button size="sm" variant="secondary" disabled={!sensors.length} onclick={() => addCondition({ type: 'sensor', entityId: sensors[0].id, above: 0 })}>+ A sensor reading</Button>
			<Button size="sm" variant="secondary" onclick={() => addCondition({ type: 'time', after: '18:00', before: '23:00' })}>+ Time of day</Button>
			<Button size="sm" variant="secondary" onclick={() => addCondition({ type: 'mode', mode: 'home' })}>+ Household mode</Button>
			<Button size="sm" variant="secondary" disabled={conditions.some((c) => c.type === 'days')} onclick={() => addCondition({ type: 'days', days: ['mon', 'tue', 'wed', 'thu', 'fri'] })}>+ Days of the week</Button>
		</div>
	</div></Collapse></section>

	<section aria-labelledby="then" class="space-y-3">
		<button type="button" class="flex w-full items-center gap-3 text-left" aria-expanded={openThen} onclick={() => (openThen = !openThen)}>
			<span class="min-w-0 flex-1"><span id="then" class="heading block">Then do this, in order</span><span class="text-sm text-muted-foreground">{actions.length ? `${actions.length} step${actions.length === 1 ? '' : 's'}` : 'Choose what happens'}</span></span>
			<ChevronDown class="size-4 text-muted-foreground transition-transform duration-300 {openThen ? 'rotate-180' : ''}" />
		</button>
		<Collapse open={openThen}><div class="space-y-3 pt-1">
		<StepsEditor bind:steps={actions} failed={problem?.where === 'action' ? problem.index : null} />
	</div></Collapse></section>

	<div class="h-24 md:hidden"></div>
	<div class="fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-20 space-y-2.5 border-t bg-background/95 px-5 py-3 backdrop-blur-xl md:sticky md:bottom-4 md:rounded-2xl md:border md:bg-card/95 md:px-4 md:shadow-sm">
		{#if preview}<p class="line-clamp-3 text-sm leading-snug md:line-clamp-none md:text-[0.9375rem]" data-testid="summary"><span class="font-semibold">In plain words: </span>{preview}</p>
		{:else if previewError}<p role="alert" class="text-sm text-signal">{previewError}</p>
		{:else}<p class="text-sm text-muted-foreground">Add a trigger and a step to see what this will do.</p>{/if}
		{#if error}<p role="alert" class="text-sm text-signal">{error}</p>{/if}
		<div class="flex items-center gap-2">
			<Button class="flex-1 md:flex-none" onclick={save} disabled={saving || !name.trim() || !triggers.length || !actions.length}>{saving ? 'Saving…' : 'Save automation'}</Button>
			{#if id !== 'new'}<Button variant="destructive" onclick={remove}>Delete</Button>{/if}
			<span class="ml-auto hidden text-sm text-muted-foreground md:inline">Your home hub runs this on its own. Doors are never unlocked by an automation.</span>
		</div>
	</div>
</Page>
