<script lang="ts">
	import { goto } from '$app/navigation';
	import * as Command from '#lib/components/ui/command';
	import { home } from '#lib/home.svelte.js';
	import { session } from '#lib/session.svelte.js';
	import { allPages } from '#lib/nav.js';
	import { parseIntent } from '#lib/intent.js';
	import { Lightbulb, Play, Sparkles, CornerDownLeft } from '@lucide/svelte';

	let { open = $bindable(false) }: { open: boolean } = $props();
	let query = $state('');
	// What you pick most often rises to the top when the box is empty. Kept on this phone.
	const USE = 'palette-use';
	let used = $state<Record<string, number>>({});
	$effect(() => { try { used = JSON.parse(localStorage.getItem(USE) ?? '{}'); } catch { used = {}; } });
	function note(id: string) { used[id] = (used[id] ?? 0) + 1; try { localStorage.setItem(USE, JSON.stringify(used)); } catch { /* not kept */ } }
	$effect(() => { if (!open) query = ''; });

	const pages = $derived(allPages(session.can, home.devices.some((d) => d.category === 'energy')));
	// Plain rules, no AI: understands "turn off the kitchen lights" if it matches something specific in this home.
	const intent = $derived(parseIntent(query, { devices: home.devices.map((d) => ({ id: d.id, name: d.name, category: d.category, roomId: d.roomId })), rooms: home.rooms, scenes: home.scenes, routines: home.routines }));
	// Things worth trying, drawn from this home. Choosing one fills the box; nothing runs until you press Enter on the result.
	const tries = $derived.by(() => {
		const t: string[] = [];
		const on = home.devices.filter((d) => d.category === 'light' && d.state === 'on' && d.available);
		const off = home.devices.find((d) => d.category === 'light' && d.state === 'off' && d.available);
		if (on.length > 1) t.push('Turn off all lights');
		if (home.devices.some((d) => d.category === 'lock')) t.push('Lock all doors');
		if (off) t.push(`Turn on ${off.name}`);
		if (home.scenes[0]) t.push(`Activate ${home.scenes[0].name}`);
		return t.slice(0, 4);
	});
	const acts = $derived(home.devices.filter((d) => query.trim() || d.controls.length > 0).sort((a, b) => query.trim() ? 0 : (used[b.id] ?? 0) - (used[a.id] ?? 0)).slice(0, query.trim() ? 200 : 40).map((d) => {
		const power = d.available && d.controls.some((c) => c.type === 'power');
		if (power) return { d, label: d.state === 'on' ? 'Turn off' : 'Turn on', run: () => home.command(d.id, d.state === 'on' ? 'turn_off' : 'turn_on') };
		if (d.available && d.category === 'lock' && d.state === 'unlocked') return { d, label: 'Lock', run: () => home.command(d.id, 'lock') };
		return { d, label: 'Open', run: () => goto(`/devices?q=${encodeURIComponent(d.name)}`) };
	}));
	const run = (f: () => unknown) => { open = false; f(); };
	function doIntent() {
		const i = intent; if (!i) return;
		if (i.kind === 'refused') return home.say('error', i.label);
		if (i.kind === 'scene') { const s = home.scenes.find((x) => x.id === i.id); if (s) home.activateScene(s); return; }
		if (i.kind === 'routine') { const r = home.routines.find((x) => x.id === i.id); if (r) home.runRoutine(r); return; }
		for (const id of i.ids) home.command(id, i.action, i.value);
	}
</script>

<Command.Dialog bind:open title="Search" description="Jump to a page, or control a device, scene or routine" class="max-w-xl">
	<Command.Input placeholder="Search, or type “turn off the kitchen lights”…" bind:value={query} />
	<Command.List class="max-h-[22rem]">
		<Command.Empty>Nothing matches that.</Command.Empty>
		{#if !query.trim() && tries.length}
			<Command.Group heading="Try">
				{#each tries as t (t)}<Command.Item value="try {t}" onSelect={() => (query = t)}><CornerDownLeft class="size-4 opacity-50" /><span class="flex-1 truncate">“{t}”</span></Command.Item>{/each}
			</Command.Group>
		{/if}
		{#if intent}
			<Command.Group heading="Do this">
				<Command.Item value="{query} do this" onSelect={() => run(doIntent)}>
					<CornerDownLeft class="size-4" /><span class="flex-1 truncate font-medium">{intent.label}</span>
				</Command.Item>
			</Command.Group>
		{/if}
		{#if acts.length}
			<Command.Group heading="Devices">
				{#each acts as a (a.d.id)}
					<Command.Item value="{a.d.name} {a.d.category}" onSelect={() => { note(a.d.id); run(a.run); }}>
						<Lightbulb class="size-4" /><span class="flex-1 truncate">{a.d.name}</span><span class="text-xs text-muted-foreground">{a.label}</span>
					</Command.Item>
				{/each}
			</Command.Group>
		{/if}
		{#if home.scenes.length || home.routines.length}
			<Command.Group heading="Scenes and routines">
				{#each home.scenes as s (s.id)}<Command.Item value="{s.name} scene" onSelect={() => run(() => home.activateScene(s))}><Sparkles class="size-4" /><span class="flex-1 truncate">{s.name}</span><span class="text-xs text-muted-foreground">Activate</span></Command.Item>{/each}
				{#each home.routines as r (r.id)}<Command.Item value="{r.name} routine" onSelect={() => run(() => home.runRoutine(r))}><Play class="size-4" /><span class="flex-1 truncate">{r.name}</span><span class="text-xs text-muted-foreground">Run</span></Command.Item>{/each}
			</Command.Group>
		{/if}
		{#if home.rooms.length}
			<Command.Group heading="Rooms">
				{#each home.rooms as r (r.id)}<Command.Item value="{r.name} room" onSelect={() => run(() => goto(`/rooms?room=${r.id}`))}><span class="flex-1 truncate">{r.name}</span><span class="text-xs text-muted-foreground">Open</span></Command.Item>{/each}
			</Command.Group>
		{/if}
		<Command.Group heading="Go to">
			{#each pages as p (p.href)}<Command.Item value="{p.label} {p.keywords ?? ''} page" onSelect={() => run(() => goto(p.href))}><p.icon class="size-4" /><span>{p.label}</span></Command.Item>{/each}
		</Command.Group>
	</Command.List>
</Command.Dialog>
