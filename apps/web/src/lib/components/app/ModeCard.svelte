<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import { House, DoorOpen, Moon, Plane } from '@lucide/svelte';

	const icons: Record<string, any> = { home: House, away: DoorOpen, night: Moon, vacation: Plane };
	const label = (m: string) => m[0].toUpperCase() + m.slice(1);
	const m = $derived(home.mode);
</script>

{#if m}
	<section aria-labelledby="mode-h" class="space-y-3">
		<div class="hidden items-baseline justify-between gap-3 sm:flex">
			<h2 id="mode-h" class="heading">Mode</h2>
			{#if m.current && m.linkedRoutines[m.current]?.length}<span class="truncate text-sm text-muted-foreground">Runs {m.linkedRoutines[m.current].join(', ')}</span>{/if}
		</div>
		{#if m.available}
			<div class="grid grid-cols-4 gap-1 rounded-2xl bg-secondary p-1" role="group" aria-label="Household mode">
				{#each m.modes as mode}
					{@const Icon = icons[mode]}
					{@const active = m.current === mode}
					<button type="button" disabled={!m.canSet} aria-pressed={active} onclick={() => home.setMode(mode)}
						class="flex h-12 flex-col items-center justify-center gap-0.5 rounded-xl sm:h-14 text-[0.8125rem] font-medium transition-all duration-200 disabled:opacity-50 {active ? 'bg-card text-foreground shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-muted-foreground hover:text-foreground'}">
						<Icon class="size-[18px] {active ? 'text-primary' : ''}" aria-hidden="true" />{label(mode)}
					</button>
				{/each}
			</div>
			<p class="hidden text-sm text-muted-foreground sm:block">{m.note}</p>
			{#if m.suggestion && m.canSet}
				<div class="flex items-center justify-between gap-3 rounded-2xl bg-accent px-4 py-3 text-sm">
					<span>{m.suggestion.reason} Switch to {label(m.suggestion.mode)}?</span>
					<Button size="sm" onclick={() => home.setMode(m.suggestion!.mode)}>Switch</Button>
				</div>
			{/if}
		{:else}
			<p class="rounded-2xl border border-dashed px-4 py-3 text-sm text-muted-foreground">Household modes aren’t available right now.</p>
		{/if}
	</section>
{/if}
