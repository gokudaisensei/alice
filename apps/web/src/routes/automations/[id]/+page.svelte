<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { api, explain } from '#lib/api.js';
	import { home } from '#lib/home.svelte.js';
	import { DAYS, WEEKDAYS, WEEKEND, dayModeOf, firstState, isSensor, plainWords, statesFor, statesOf, type AutomationView, type Condition, type DayMode, type Template, type Trigger } from '#lib/automations.js';
	import { actionsFor, type Step } from '#lib/steps.js';
	import { behaviours, words } from '#lib/behaviours.svelte.js';
	import { plural } from '#lib/fmt.js';
	import { Button } from '#lib/components/ui/button';
	import { Input } from '#lib/components/ui/input';
	import Page from '#lib/components/app/Page.svelte';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import StepsEditor from '#lib/components/app/StepsEditor.svelte';
	import Collapse from '#lib/components/app/Collapse.svelte';
	import Picker from '#lib/components/app/Picker.svelte';
	import PlainWords from '#lib/components/app/builder/PlainWords.svelte';
	import BuilderBar from '#lib/components/app/builder/BuilderBar.svelte';
	import DeleteRow from '#lib/components/app/builder/DeleteRow.svelte';
	import NameField from '#lib/components/app/builder/NameField.svelte';
	import AddOptions from '#lib/components/app/builder/AddOptions.svelte';
	import AutomationTrace from '#lib/components/app/AutomationTrace.svelte';
	import { ChevronDown, Clock, Gauge, House, Lightbulb, Sunrise, Timer, Trash2, Undo2, Users } from '@lucide/svelte';

	const id = $derived(page.params.id ?? 'new');
	let name = $state('');
	let triggers = $state<Trigger[]>([]);
	let conditions = $state<Condition[]>([]);
	let actions = $state<Step[]>([]);
	let error = $state(''), notice = $state(''), saving = $state(false), trying = $state(false), ready = $state(false);
	let problem = $state<{ where: string; index: number } | null>(null);
	let previewError = $state('');
	let note = $state<string | null>(null);
	let dayMode = $state<DayMode>('every');

	let people = $state<{ id: string; name: string }[]>([]);
	const withState = $derived(home.devices.filter((d) => statesFor(d).length));
	const sensors = $derived(home.devices.filter(isSensor));
	const unitOf = (eid: string) => home.byId(eid)?.reading?.unit ?? '';
	const num = (v: string) => (v === '' ? undefined : Number(v));
	const FOR = [[0, 'right away'], [60, 'for 1 minute'], [300, 'for 5 minutes'], [900, 'for 15 minutes'], [1800, 'for 30 minutes'], [3600, 'for 1 hour']] as const;
	const OFFSETS = [{ value: -60, label: '1 hour before' }, { value: -30, label: '30 minutes before' }, { value: 0, label: 'exactly' }, { value: 30, label: '30 minutes after' }, { value: 60, label: '1 hour after' }];
	const optsOf = (eid: string) => { const d = home.byId(eid); return d ? actionsFor(d) : []; };

	onMount(async () => {
		void api<{ people: { id: string; name: string }[] }>('GET', '/api/automations/people').then((r) => { if (r.ok) people = r.data.people; });
		if (!home.loaded) await home.load();
		if (!behaviours.loaded) behaviours.load();
		if (id === 'new') {
			const q = page.url.searchParams, key = q.get('template'), dev = q.get('device'), when = q.get('when');
			const listed = key ? await api<{ suggested: Template[] }>('GET', '/api/automations') : null;
			const t = listed?.ok ? listed.data.suggested.find((x) => x.key === key) : undefined;
			if (t) { name = t.name; triggers = structuredClone(t.triggers); conditions = structuredClone(t.conditions); actions = structuredClone(t.actions); note = t.missing ?? null; }
			const d = dev ? home.byId(dev) : undefined;
			if (d && !t) { // started from a device: begin with "when this device changes"
				if (isSensor(d)) triggers = [{ type: 'sensor', entityId: d.id, above: Number(d.reading?.value) || 0 }];
				else if (statesFor(d).length) triggers = [{ type: 'device_state', entityId: d.id, to: firstState(d) }];
				name = `When ${d.name} changes`;
			}
			if (!t && !d && when === 'time') triggers = [{ type: 'time', at: '07:00' }]; // from the "how should it run" question
			if (!t && !d && q.get('scene') && home.scenes[0]) actions = [{ type: 'scene', entityId: home.scenes[0].id }];
		} else {
			const r = await api<AutomationView>('GET', `/api/automations/${id}`);
			if (!r.ok) { error = r.data.message ?? explain(r.data.error); return; }
			const a = r.data;
			name = a.name;
			triggers = a.triggers.map(({ text, ...t }) => t as Trigger); conditions = a.conditions.map(({ text, ...c }) => c as Condition); actions = a.actions.map(({ text, ...s }) => s as Step);
		}
		dayMode = dayModeOf(daysCond()?.days);
		ready = true;
	});

	const payload = $derived({ name: name.trim(), triggers, conditions, actions });
	const said = $derived(plainWords(triggers, conditions, actions, { ...words, optsOf }));
	// Ask the server to check it as people edit, so a problem is pointed at before they save.
	$effect(() => {
		const body = $state.snapshot(payload);
		if (!ready) return;
		const t = setTimeout(async () => {
			if (!body.triggers.length || !body.actions.length) { previewError = ''; problem = null; return; }
			const r = await api<{ summary: string }>('POST', '/api/automations/preview', body);
			if (r.ok) { problem = null; previewError = ''; }
			else { problem = r.data.where ? { where: r.data.where, index: r.data.index ?? 0 } : null; error = ''; previewError = r.data?.message ?? explain(r.data?.error); }
		}, 300);
		return () => clearTimeout(t);
	});
	let openWhen = $state(true), openOnly = $state(false), openThen = $state(true);
	// A problem is never hidden inside a folded section.
	$effect(() => { if (problem?.where === 'trigger') openWhen = true; else if (problem?.where === 'condition') openOnly = true; else if (problem?.where === 'action') openThen = true; });
	// Limits other than days are folded away until there are some, then they open by themselves once.
	const limits = $derived(conditions.filter((c) => c.type !== 'days').length);

	// ----- days: a real condition, offered as a simple choice -----
	const daysCond = () => conditions.find((c): c is Extract<Condition, { type: 'days' }> => c.type === 'days');
	function setDayMode(m: DayMode) {
		dayMode = m;
		const keep = daysCond()?.days;
		conditions = conditions.filter((c) => c.type !== 'days');
		if (m === 'weekdays') conditions.push({ type: 'days', days: [...WEEKDAYS] });
		else if (m === 'weekends') conditions.push({ type: 'days', days: [...WEEKEND] });
		else if (m === 'pick') conditions.push({ type: 'days', days: keep && keep.length && keep.length < 7 ? [...keep] : [...WEEKDAYS] });
	}
	const dayOn = (d: string) => !!daysCond()?.days.includes(d);
	function flipDay(d: string) {
		const c = daysCond(); if (!c) return;
		if (c.days.includes(d)) { if (c.days.length > 1) c.days = c.days.filter((x) => x !== d); } else c.days = [...c.days, d];
	}

	const addTrigger = (t: Trigger) => triggers.push(t);
	const addCondition = (c: Condition) => conditions.push(c);
	function addDeviceTrigger() { const d = withState[0]; if (d) addTrigger({ type: 'device_state', entityId: d.id, to: firstState(d) }); }
	function addDeviceCondition() { const d = withState[0]; if (d) addCondition({ type: 'device_state', entityId: d.id, is: firstState(d) }); }
	function addSensorTrigger() { const s = sensors[0]; if (s) addTrigger({ type: 'sensor', entityId: s.id, above: 0 }); }
	function addSensorCondition() { const s = sensors[0]; if (s) addCondition({ type: 'sensor', entityId: s.id, above: 0 }); }
	const bad = (where: string, i: number) => problem?.where === where && problem.index === i;

	// Removing is one tap, so it can always be taken back for a few seconds.
	let undoer = $state<{ label: string; restore: () => void } | null>(null), undoTimer: ReturnType<typeof setTimeout>;
	function removable<T>(list: T[], i: number, label: string) {
		const [x] = list.splice(i, 1); if (x === undefined) return;
		undoer = { label, restore: () => { list.splice(Math.min(i, list.length), 0, x); undoer = null; } };
		clearTimeout(undoTimer); undoTimer = setTimeout(() => (undoer = null), 8000);
	}

	async function persist(): Promise<string | null> {
		error = ''; notice = '';
		const r = id === 'new' ? await api<{ id: string }>('POST', '/api/automations', payload) : await api('PUT', `/api/automations/${id}`, payload);
		if (!r.ok) { problem = r.data.where ? { where: r.data.where, index: r.data.index ?? 0 } : null; error = r.data?.message ?? explain(r.data?.error); return null; }
		return id === 'new' ? (r.data as { id: string }).id : id;
	}
	async function save() {
		saving = true;
		const rid = await persist();
		saving = false;
		if (rid) goto('/routines?tab=automations');
	}
	// The steps can't run until the automation exists, so trying it saves it first and then runs the steps once.
	async function tryIt() {
		trying = true;
		const rid = await persist();
		if (!rid) { trying = false; return; }
		if (id === 'new') await goto(`/automations/${rid}`, { replaceState: true });
		const r = await api('POST', `/api/automations/${rid}/run`);
		trying = false;
		if (r.ok) notice = 'Saved, and the steps were started once. Its trigger and limits were skipped for this test.'; else error = r.data?.message ?? explain(r.data?.error);
	}
	async function remove() {
		const r = await api('DELETE', `/api/automations/${id}`);
		if (!r.ok) { error = r.data?.message ?? explain(r.data?.error); return; }
		goto('/routines?tab=automations');
	}
	const canSave = $derived(!!name.trim() && triggers.length > 0 && actions.length > 0);
</script>

<Page title={id === 'new' ? 'New automatic routine' : 'Edit automatic routine'} subtitle="Choose what starts it, any limits, and what happens. Your home hub runs it on its own." back={{ href: '/routines?tab=automations', label: 'Routines' }} width="md">
	<PlainWords text={said} {note} />
	<NameField bind:value={name} placeholder="e.g. Evening lights" self={id === 'new' ? undefined : { kind: 'automation', id }} />

	<section aria-labelledby="when" class="space-y-3">
		<button type="button" class="flex w-full items-center gap-3 text-left" aria-expanded={openWhen} onclick={() => (openWhen = !openWhen)}>
			<span class="min-w-0 flex-1"><span id="when" class="heading block">When something happens</span><span class="text-sm text-muted-foreground">{triggers.length ? `${plural(triggers.length, 'thing')} can start it` : 'Choose what starts it'}</span></span>
			<ChevronDown class="size-4 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none {openWhen ? 'rotate-180' : ''}" />
		</button>
		<Collapse open={openWhen}><div class="space-y-3 pt-1">
		{#each triggers as t, i}
			<div class="rounded-2xl border bg-card {bad('trigger', i) ? 'border-signal ring-2 ring-signal/20' : ''}"><div class="flex flex-wrap items-center gap-2 p-3">
				{#if t.type === 'device_state'}
					<Picker class="min-w-36 flex-1" label="Device for trigger {i + 1}" value={t.entityId} options={withState.map((d) => ({ value: d.id, label: d.name }))} onchange={(v) => { t.entityId = v; t.to = firstState(home.byId(v)); }} />
					<span class="text-sm">turns</span>
					<Picker capitalize label="State for trigger {i + 1}" bind:value={t.to} options={statesOf(home.byId(t.entityId) ?? withState[0]).map((x) => ({ value: x, label: x }))} />
					<Picker label="How long for trigger {i + 1}" value={t.forSeconds ?? 0} options={FOR.map(([v, l]) => ({ value: v, label: l }))} onchange={(v) => { if (Number(v)) t.forSeconds = Number(v); else delete t.forSeconds; }} />
				{:else if t.type === 'sensor'}
					<Picker class="min-w-36 flex-1" label="Sensor for trigger {i + 1}" bind:value={t.entityId} options={sensors.map((d) => ({ value: d.id, label: d.name }))} />
					<span class="flex items-center gap-1 text-sm">goes above <Input type="number" class="w-20" value={t.above ?? ''} oninput={(e) => (t.above = num(e.currentTarget.value))} aria-label="Above for trigger {i + 1}" /></span>
					<span class="flex items-center gap-1 text-sm">or below <Input type="number" class="w-20" value={t.below ?? ''} oninput={(e) => (t.below = num(e.currentTarget.value))} aria-label="Below for trigger {i + 1}" /> {unitOf(t.entityId)}</span>
				{:else if t.type === 'time'}
					<span class="text-sm">It is</span><Input type="time" class="w-32" bind:value={t.at} aria-label="Time for trigger {i + 1}" />
				{:else if t.type === 'sun'}
					<Picker label="Sun event for trigger {i + 1}" bind:value={t.event} options={[{ value: 'sunset', label: 'Sunset' }, { value: 'sunrise', label: 'Sunrise' }]} />
					<Picker label="Offset for trigger {i + 1}" value={t.offsetMinutes ?? 0} options={OFFSETS} onchange={(v) => { if (Number(v)) t.offsetMinutes = Number(v); else delete t.offsetMinutes; }} />
				{:else if t.type === 'presence'}
					<Picker label="Who for trigger {i + 1}" value={t.personId ?? ''} options={[{ value: '', label: 'Someone' }, ...people.map((x) => ({ value: x.id, label: x.name }))]} onchange={(v) => (t.personId = v === '' ? null : String(v))} />
					<Picker label="Arrives or leaves for trigger {i + 1}" bind:value={t.to} options={[{ value: 'home', label: 'arrives home' }, { value: 'not_home', label: 'leaves home' }]} />
				{:else}
					<span class="text-sm">The household mode changes to</span>
					<Picker capitalize label="Mode for trigger {i + 1}" bind:value={t.mode} options={(home.mode?.modes ?? []).map((m) => ({ value: m, label: m }))} />
				{/if}
				<Button size="icon-sm" variant="ghost" class="ml-auto text-signal" aria-label="Remove trigger {i + 1}" onclick={() => removable(triggers, i, 'Trigger removed.')}><Trash2 /></Button>
			</div></div>
		{:else}
			<p class="rounded-2xl bg-secondary/60 p-4 text-sm text-muted-foreground">Nothing starts it yet. Pick something below.</p>
		{/each}
		<AddOptions label="Add something that starts it" options={[
			{ title: 'A device changes', desc: 'A door unlocks, a light turns on.', icon: Lightbulb, disabled: !withState.length, why: 'No devices to watch yet.', onclick: addDeviceTrigger },
			{ title: 'A sensor reading', desc: 'Temperature or power goes above or below a number.', icon: Gauge, disabled: !sensors.length, why: 'No sensors to watch yet.', onclick: addSensorTrigger },
			{ title: 'A time', desc: 'At a set time, such as 23:00.', icon: Clock, onclick: () => addTrigger({ type: 'time', at: '07:00' }) },
			{ title: 'Sunrise or sunset', desc: 'When it gets light or dark.', icon: Sunrise, onclick: () => addTrigger({ type: 'sun', event: 'sunset' }) },
			{ title: 'Someone arrives or leaves', desc: 'A person gets home, or goes out.', icon: Users, disabled: !people.length, why: 'Home Assistant has no people set up.', onclick: () => addTrigger({ type: 'presence', personId: null, to: 'home' }) },
			{ title: 'A household mode', desc: 'The house is set to Away, Night or Home.', icon: House, onclick: () => addTrigger({ type: 'mode', mode: 'away' }) }
		]} />

		<div class="space-y-2 rounded-2xl bg-secondary/60 p-3.5">
			<p class="text-sm font-medium">On which days?</p>
			<Segmented label="Days it can run" bind:value={dayMode} onselect={setDayMode} options={[{ id: 'every', label: 'Every day' }, { id: 'weekdays', label: 'Weekdays' }, { id: 'weekends', label: 'Weekends' }, { id: 'pick', label: 'Pick days' }]} />
			{#if dayMode === 'pick'}
				<div class="flex flex-wrap gap-1.5" role="group" aria-label="Days it can run">{#each DAYS as [d, l]}<button type="button" aria-pressed={dayOn(d)} onclick={() => flipDay(d)} class="h-10 min-w-12 rounded-full px-3 text-sm font-medium transition-colors {dayOn(d) ? 'bg-primary/15 text-primary' : 'bg-card text-muted-foreground'}">{l}</button>{/each}</div>
			{/if}
		</div>
	</div></Collapse></section>

	<section aria-labelledby="only" class="space-y-3">
		<button type="button" class="flex w-full items-center gap-3 text-left" aria-expanded={openOnly} onclick={() => (openOnly = !openOnly)}>
			<span class="min-w-0 flex-1"><span id="only" class="heading block">Only if</span><span class="text-sm text-muted-foreground">{limits ? `${plural(limits, 'limit')} must all be true` : 'Optional. Add a limit, like a time of day or a mode'}</span></span>
			<ChevronDown class="size-4 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none {openOnly ? 'rotate-180' : ''}" />
		</button>
		<Collapse open={openOnly}><div class="space-y-3 pt-1">
		{#each conditions as c, i}
			{#if c.type !== 'days'}
			<div class="rounded-2xl border bg-card {bad('condition', i) ? 'border-signal ring-2 ring-signal/20' : ''}"><div class="flex flex-wrap items-center gap-2 p-3">
				{#if c.type === 'device_state'}
					<Picker class="min-w-36 flex-1" label="Device for limit {i + 1}" value={c.entityId} options={withState.map((d) => ({ value: d.id, label: d.name }))} onchange={(v) => { c.entityId = v; c.is = firstState(home.byId(v)); }} />
					<span class="text-sm">is</span>
					<Picker capitalize label="State for limit {i + 1}" bind:value={c.is} options={statesOf(home.byId(c.entityId) ?? withState[0]).map((x) => ({ value: x, label: x }))} />
				{:else if c.type === 'sensor'}
					<Picker class="min-w-36 flex-1" label="Sensor for limit {i + 1}" bind:value={c.entityId} options={sensors.map((d) => ({ value: d.id, label: d.name }))} />
					<span class="flex items-center gap-1 text-sm">is above <Input type="number" class="w-20" value={c.above ?? ''} oninput={(e) => (c.above = num(e.currentTarget.value))} aria-label="Above for limit {i + 1}" /></span>
					<span class="flex items-center gap-1 text-sm">and below <Input type="number" class="w-20" value={c.below ?? ''} oninput={(e) => (c.below = num(e.currentTarget.value))} aria-label="Below for limit {i + 1}" /> {unitOf(c.entityId)}</span>
				{:else if c.type === 'time'}
					<span class="text-sm">The time is between</span><Input type="time" class="w-32" bind:value={c.after} aria-label="From time for limit {i + 1}" /><span class="text-sm">and</span><Input type="time" class="w-32" bind:value={c.before} aria-label="Until time for limit {i + 1}" />
				{:else if c.type === 'mode'}
					<span class="text-sm">The household mode is</span>
					<Picker capitalize label="Mode for limit {i + 1}" bind:value={c.mode} options={(home.mode?.modes ?? []).map((m) => ({ value: m, label: m }))} />
				{:else if c.type === 'presence'}
					<Picker label="Who is home for limit {i + 1}" bind:value={c.people} options={[{ value: 'anyone', label: 'Someone is home' }, { value: 'nobody', label: 'Nobody is home' }]} />
				{/if}
				<Button size="icon-sm" variant="ghost" class="ml-auto text-signal" aria-label="Remove limit {i + 1}" onclick={() => removable(conditions, i, 'Limit removed.')}><Trash2 /></Button>
			</div></div>
			{/if}
		{/each}
		<AddOptions label="Add a limit" options={[
			{ title: 'A device is', desc: 'Only if a device is on, off or locked.', icon: Lightbulb, disabled: !withState.length, why: 'No devices to check yet.', onclick: addDeviceCondition },
			{ title: 'A sensor reading', desc: 'Only if a reading is above or below a number.', icon: Gauge, disabled: !sensors.length, why: 'No sensors to check yet.', onclick: addSensorCondition },
			{ title: 'Time of day', desc: 'Only between two times, such as 18:00 and 23:00.', icon: Timer, onclick: () => addCondition({ type: 'time', after: '18:00', before: '23:00' }) },
			{ title: 'Who is home', desc: 'Only if someone is home, or only if nobody is.', icon: Users, disabled: !people.length, why: 'Home Assistant has no people set up.', onclick: () => addCondition({ type: 'presence', people: 'anyone' }) },
			{ title: 'Household mode', desc: 'Only while the house is in Home, Away or Night.', icon: House, onclick: () => addCondition({ type: 'mode', mode: 'home' }) }
		]} />
	</div></Collapse></section>

	<section aria-labelledby="then" class="space-y-3">
		<button type="button" class="flex w-full items-center gap-3 text-left" aria-expanded={openThen} onclick={() => (openThen = !openThen)}>
			<span class="min-w-0 flex-1"><span id="then" class="heading block">Then do</span><span class="text-sm text-muted-foreground">{actions.length ? `${plural(actions.length, 'step')}, in order` : 'Choose what happens'}</span></span>
			<ChevronDown class="size-4 text-muted-foreground transition-transform duration-300 motion-reduce:transition-none {openThen ? 'rotate-180' : ''}" />
		</button>
		<Collapse open={openThen}><div class="space-y-3 pt-1">
		<StepsEditor bind:steps={actions} failed={problem?.where === 'action' ? problem.index : null} />
	</div></Collapse></section>

	{#if undoer}<p role="status" class="flex items-center justify-between gap-3 rounded-xl bg-secondary px-3.5 py-2 text-sm">{undoer.label}<Button size="sm" variant="ghost" onclick={() => undoer?.restore()}><Undo2 />Undo</Button></p>{/if}

	{#if id !== 'new'}<AutomationTrace {id} />{/if}

	{#if id !== 'new'}<DeleteRow what="automatic routine" ondelete={remove} />{/if}

	<BuilderBar saveLabel={id === 'new' ? 'Save' : 'Save changes'} {saving} {trying} {canSave} onsave={save} cancelHref="/routines?tab=automations" onTry={tryIt} canTry={canSave}
		tryNote="Saves it, then runs the steps once, skipping the trigger and limits." error={error || previewError}
		hint={notice || (!name.trim() ? 'Give it a name to save it.' : !triggers.length ? 'Choose what starts it.' : !actions.length ? 'Choose what it should do.' : 'Doors are never unlocked by something automatic.')} />
</Page>
