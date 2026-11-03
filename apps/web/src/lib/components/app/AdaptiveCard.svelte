<script lang="ts">
	import { home } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { Button } from '#lib/components/ui/button';
	import { Moon, Sunrise } from '@lucide/svelte';

	/** The top of Home follows the day: at night it offers to wind the house down, in the morning it says what was left on. Nothing runs by itself. */
	const hour = new Date().getHours();
	const night = hour >= 21 || hour < 4, morning = hour >= 5 && hour < 10;
	const by = (c: string[]) => home.devices.filter((d) => c.includes(d.category) && d.available);
	const lightsOn = $derived(by(['light']).filter((d) => d.state === 'on'));
	const plugsOn = $derived(by(['switch', 'fan']).filter((d) => d.state === 'on'));
	const unlocked = $derived(by(['lock']).filter((d) => d.state === 'unlocked'));
	const inside = $derived(home.devices.find((d) => d.category === 'climate' && d.available && d.reading));
	const todo = $derived(lightsOn.length + unlocked.length);
	const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

	async function windDown() {
		haptics.grab();
		await home.batch(`Wound down: ${[lightsOn.length ? plural(lightsOn.length, 'light') + ' off' : '', unlocked.length ? plural(unlocked.length, 'door') + ' locked' : ''].filter(Boolean).join(', ')}`, async () => {
			for (const d of unlocked) await home.command(d.id, 'lock');
			for (const d of lightsOn) await home.command(d.id, 'turn_off');
		});
		haptics.success();
	}
	async function lightsOff() { await home.batch(`Turned off ${plural(lightsOn.length, 'light')}`, async () => { for (const d of lightsOn) await home.command(d.id, 'turn_off'); }); }
</script>

{#if home.loaded && home.devices.length && home.haHealth === 'ok' && ((night && (todo || plugsOn.length)) || (morning && (lightsOn.length || inside)))}
	<section class="flex items-center gap-3.5 rounded-2xl border bg-card p-4" aria-label={night ? 'Good night' : 'This morning'}>
		<span class="flex size-11 shrink-0 items-center justify-center rounded-full {night ? 'bg-primary/15 text-primary' : 'bg-on-soft text-on-foreground'}">{#if night}<Moon class="size-5" />{:else}<Sunrise class="size-5" />{/if}</span>
		<div class="min-w-0 flex-1">
			{#if night}
				<h2 class="text-[0.9375rem] font-semibold tracking-[-0.01em]">Ready for bed?</h2>
				<p class="text-sm text-muted-foreground">{[unlocked.length ? `${plural(unlocked.length, 'door')} unlocked` : '', lightsOn.length ? `${plural(lightsOn.length, 'light')} on` : '', plugsOn.length ? `${plural(plugsOn.length, 'plug')} on` : ''].filter(Boolean).join(' · ') || 'Everything is quiet.'}</p>
			{:else}
				<h2 class="text-[0.9375rem] font-semibold tracking-[-0.01em]">{lightsOn.length ? `${plural(lightsOn.length, 'light')} still on` : 'Morning'}</h2>
				<p class="text-sm text-muted-foreground">{inside?.reading ? `${inside.reading.value}° inside` : 'Left on from last night.'}</p>
			{/if}
		</div>
		{#if night && todo}<Button size="sm" onclick={windDown}>Wind down</Button>
		{:else if morning && lightsOn.length}<Button size="sm" variant="secondary" onclick={lightsOff}>Lights off</Button>{/if}
	</section>
{/if}
