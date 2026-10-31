<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { Button } from '#lib/components/ui/button';
	import * as Card from '#lib/components/ui/card';
	import { House, DoorOpen, Moon, Plane } from '@lucide/svelte';

	const icons: Record<string, any> = { home: House, away: DoorOpen, night: Moon, vacation: Plane };
	const label = (m: string) => m[0].toUpperCase() + m.slice(1);
	const m = $derived(home.mode);
</script>

{#if m}
	<Card.Root class="gap-0 py-0" aria-labelledby="mode-h">
		<div class="space-y-3 p-4">
			<div class="flex items-baseline justify-between">
				<h2 id="mode-h" class="text-sm font-medium uppercase text-muted-foreground">Household mode</h2>
				{#if m.current}<span class="text-sm text-muted-foreground">Now: <strong class="text-foreground">{label(m.current)}</strong></span>{/if}
			</div>
			{#if m.available}
				<div class="grid grid-cols-4 gap-2" role="group" aria-label="Household mode">
					{#each m.modes as mode}
						{@const Icon = icons[mode]}
						<Button variant={m.current === mode ? 'default' : 'outline'} class="h-auto flex-col gap-1 py-2" disabled={!m.canSet} aria-pressed={m.current === mode} onclick={() => home.setMode(mode)}>
							<Icon class="size-5" aria-hidden="true" /><span class="text-xs">{label(mode)}</span>
						</Button>
					{/each}
				</div>
				{#if m.current && m.linkedRoutines[m.current]?.length}
					<p class="text-sm text-muted-foreground">Connected routines: {m.linkedRoutines[m.current].join(', ')}</p>
				{/if}
				<p class="text-xs text-muted-foreground">{m.note}</p>
				{#if m.suggestion && m.canSet}
					<div class="flex items-center justify-between gap-2 rounded-md border border-dashed p-3 text-sm">
						<span>{m.suggestion.reason} Switch to {label(m.suggestion.mode)}?</span>
						<Button size="sm" variant="secondary" onclick={() => home.setMode(m.suggestion!.mode)}>Switch</Button>
					</div>
				{/if}
			{:else}
				<p class="text-sm text-muted-foreground">Household modes aren’t available right now.</p>
			{/if}
		</div>
	</Card.Root>
{/if}
