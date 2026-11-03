<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import * as Drawer from '#lib/components/ui/drawer';
	import { haptics } from '#lib/haptics.js';
	import Segmented from '#lib/components/app/Segmented.svelte';
	import { capitalize, only } from '#lib/utils.js';
	import { House, DoorOpen, Moon, Plane, ShieldAlert } from '@lucide/svelte';

	const icons: Record<string, typeof House> = { home: House, away: DoorOpen, night: Moon, vacation: Plane };
	const m = $derived(home.mode);
	/** The routines a switch to the current mode will run. */
	const runs = $derived(m?.current ? (m.linkedRoutines[m.current] ?? []) : []);

	// Before leaving: say what is still open or on, and offer to deal with it in the same tap.
	const doors = $derived(home.devices.filter((d) => d.category === 'lock' && d.available && d.state === 'unlocked'));
	const lights = $derived(home.devices.filter((d) => d.category === 'light' && d.available && d.state === 'on'));
	let check = $state<string | null>(null), working = $state(false);
	function choose(mode: string) {
		if ((mode === 'away' || mode === 'vacation') && (doors.length || lights.length)) { check = mode; return; }
		home.setMode(mode);
	}
	async function fixAndGo() {
		if (!check) return; working = true;
		for (const d of doors) await home.command(d.id, 'lock');
		for (const d of lights) await home.command(d.id, 'turn_off');
		await home.setMode(check); haptics.success(); working = false; check = null;
	}
	function setAnyway() { if (!check) return; const mode = check; check = null; home.setMode(mode); }
	const list = (xs: { name: string }[]) => (xs.length > 3 ? `${xs.slice(0, 2).map((x) => x.name).join(', ')} and ${xs.length - 2} more` : xs.map((x) => x.name).join(', '));
</script>

{#if m}
	<section aria-labelledby="mode-h" class="space-y-3">
		<div class="hidden items-baseline justify-between gap-3 sm:flex">
			<h2 id="mode-h" class="heading">Mode</h2>
			{#if runs.length}<span class="truncate text-sm text-muted-foreground">Runs {runs.join(', ')}</span>{/if}
		</div>
		{#if m.available}
			<Segmented stack label="Household mode" disabled={!m.canSet} value={m.current} options={m.modes.map((id) => ({ id, label: capitalize(id), icon: icons[id] }))} onselect={choose} />
			<p class="hidden text-sm text-muted-foreground sm:block">{m.note}</p>
			{#if m.suggestion && m.canSet}
				<div class="flex items-center justify-between gap-3 rounded-2xl bg-accent px-4 py-3 text-sm">
					<span>{m.suggestion.reason} Switch to {capitalize(m.suggestion.mode)}?</span>
					<Button size="sm" onclick={() => home.setMode(m.suggestion!.mode)}>Switch</Button>
				</div>
			{/if}
		{:else}
			<p class="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">Household modes aren’t available right now.</p>
		{/if}
	</section>
{/if}

<Drawer.Root open={!!check} onOpenChange={(o) => { if (!o) check = null; }}>
	<Drawer.Content class="rounded-t-3xl">
		<div class="space-y-4 px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2">
			<Drawer.Header class="px-0 pb-0"><Drawer.Title class="text-left text-xl font-semibold tracking-[-0.02em]">Before you go</Drawer.Title><Drawer.Description class="text-left">A few things are still open or on.</Drawer.Description></Drawer.Header>
			<div class="space-y-2">
				{#if doors.length}{@const lone = only(doors)}<div class="flex items-center gap-3 rounded-2xl bg-signal-soft px-4 py-3 text-signal-foreground"><ShieldAlert class="size-5 shrink-0" /><span class="text-[0.9375rem] font-medium">{lone ? `${lone.name} is unlocked` : `${doors.length} doors are unlocked`}<span class="block text-sm font-normal opacity-80">{list(doors)}</span></span></div>{/if}
				{#if lights.length}{@const lone = only(lights)}<div class="flex items-center gap-3 rounded-2xl bg-on-soft px-4 py-3 text-on-foreground"><span class="text-[0.9375rem] font-medium">{lone ? `${lone.name} is on` : `${lights.length} lights are on`}<span class="block text-sm font-normal opacity-80">{list(lights)}</span></span></div>{/if}
			</div>
			<Button size="lg" class="w-full" disabled={working} onclick={fixAndGo}>{working ? 'Getting things ready…' : `${doors.length ? 'Lock up' : ''}${doors.length && lights.length ? ', ' : ''}${lights.length ? (doors.length ? 'switch off' : 'Switch off') : ''} and set ${capitalize(check ?? '')}`}</Button>
			<Button size="lg" variant="secondary" class="w-full" disabled={working} onclick={setAnyway}>Set {capitalize(check ?? '')} anyway</Button>
		</div>
	</Drawer.Content>
</Drawer.Root>
