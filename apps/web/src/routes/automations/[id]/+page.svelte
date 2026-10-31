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
	import * as Card from '#lib/components/ui/card';
	import StepsEditor from '#lib/components/app/StepsEditor.svelte';

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
	const sel = 'h-9 rounded-md border bg-background px-2 text-sm';

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
		goto('/automations');
	}
	async function remove() {
		if (!confirm(`Delete “${name}”?`)) return;
		const r = await api('DELETE', `/api/automations/${id}`);
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		goto('/automations');
	}
</script>

<main class="mx-auto max-w-2xl space-y-6 p-4">
	<a href="/automations" class="text-sm text-muted-foreground underline">← Automations</a>
	<h1 class="text-2xl font-semibold">{id === 'new' ? 'New automation' : 'Edit automation'}</h1>

	<div class="space-y-1"><Label for="n">Name</Label><Input id="n" bind:value={name} maxlength={60} placeholder="e.g. Evening lights" /></div>

	<section aria-labelledby="when" class="space-y-2">
		<h2 id="when" class="text-sm font-medium uppercase text-muted-foreground">When any of these happens</h2>
		{#each triggers as t, i}
			<Card.Root class="gap-0 py-0 {bad('trigger', i) ? 'border-destructive' : ''}"><div class="flex flex-wrap items-center gap-2 p-3">
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
				<Button size="sm" variant="ghost" class="ml-auto" aria-label="Remove trigger {i + 1}" onclick={() => triggers.splice(i, 1)}>Remove</Button>
			</div></Card.Root>
		{:else}
			<p class="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">Choose what should start it.</p>
		{/each}
		<div class="flex flex-wrap gap-2" role="group" aria-label="Add a trigger">
			<Button size="sm" variant="outline" disabled={!withState.length} onclick={() => firstWith() && addTrigger({ type: 'device_state', entityId: firstWith().id, to: statesFor(firstWith())[0] })}>+ A device changes</Button>
			<Button size="sm" variant="outline" disabled={!sensors.length} onclick={() => addTrigger({ type: 'sensor', entityId: sensors[0].id, above: 0 })}>+ A sensor reading</Button>
			<Button size="sm" variant="outline" onclick={() => addTrigger({ type: 'time', at: '07:00' })}>+ A time</Button>
			<Button size="sm" variant="outline" onclick={() => addTrigger({ type: 'sun', event: 'sunset' })}>+ Sunrise or sunset</Button>
			<Button size="sm" variant="outline" onclick={() => addTrigger({ type: 'mode', mode: 'away' })}>+ A household mode</Button>
		</div>
	</section>

	<section aria-labelledby="only" class="space-y-2">
		<h2 id="only" class="text-sm font-medium uppercase text-muted-foreground">Only if all of these are true (optional)</h2>
		{#each conditions as c, i}
			<Card.Root class="gap-0 py-0 {bad('condition', i) ? 'border-destructive' : ''}"><div class="flex flex-wrap items-center gap-2 p-3">
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
				<Button size="sm" variant="ghost" class="ml-auto" aria-label="Remove condition {i + 1}" onclick={() => conditions.splice(i, 1)}>Remove</Button>
			</div></Card.Root>
		{/each}
		<div class="flex flex-wrap gap-2" role="group" aria-label="Add a condition">
			<Button size="sm" variant="outline" disabled={!withState.length} onclick={() => firstWith() && addCondition({ type: 'device_state', entityId: firstWith().id, is: statesFor(firstWith())[0] })}>+ A device is</Button>
			<Button size="sm" variant="outline" disabled={!sensors.length} onclick={() => addCondition({ type: 'sensor', entityId: sensors[0].id, above: 0 })}>+ A sensor reading</Button>
			<Button size="sm" variant="outline" onclick={() => addCondition({ type: 'time', after: '18:00', before: '23:00' })}>+ Time of day</Button>
			<Button size="sm" variant="outline" onclick={() => addCondition({ type: 'mode', mode: 'home' })}>+ Household mode</Button>
			<Button size="sm" variant="outline" disabled={conditions.some((c) => c.type === 'days')} onclick={() => addCondition({ type: 'days', days: ['mon', 'tue', 'wed', 'thu', 'fri'] })}>+ Days of the week</Button>
		</div>
	</section>

	<section aria-labelledby="then" class="space-y-2">
		<h2 id="then" class="text-sm font-medium uppercase text-muted-foreground">Then do this, in order</h2>
		<StepsEditor bind:steps={actions} failed={problem?.where === 'action' ? problem.index : null} />
	</section>

	{#if preview}
		<Card.Root class="gap-0 py-0"><div class="p-4"><h2 class="mb-1 text-sm font-medium">In plain words</h2><p class="text-sm text-muted-foreground" data-testid="summary">{preview}</p></div></Card.Root>
	{:else if previewError}<p role="alert" class="text-sm text-destructive">{previewError}</p>{/if}

	<p class="text-xs text-muted-foreground">Once saved, your home hub runs this on its own. Doors are never unlocked by an automation.</p>
	{#if error}<p role="alert" class="text-sm text-destructive">{error}</p>{/if}
	<div class="flex gap-2">
		<Button onclick={save} disabled={saving || !name.trim() || !triggers.length || !actions.length}>{saving ? 'Saving…' : 'Save automation'}</Button>
		{#if id !== 'new'}<Button variant="outline" onclick={remove}>Delete</Button>{/if}
	</div>
</main>
