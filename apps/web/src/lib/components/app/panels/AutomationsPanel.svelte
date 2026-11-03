<script lang="ts">
	import Swipeable from '#lib/components/app/Swipeable.svelte';
	import { home } from '#lib/home.svelte.js';
	import { api, explain } from '#lib/api.js';
	import { ago } from '#lib/fmt.js';
	import { automationDoes, behaviours } from '#lib/behaviours.svelte.js';
	import type { AutomationView } from '#lib/automations.js';
	import BehaviourRow from '#lib/components/app/BehaviourRow.svelte';
	import { Button } from '#lib/components/ui/button';
	import { Switch } from '#lib/components/ui/switch';
	import { Copy } from '@lucide/svelte';

	let notice = $state('');
	let busy = $state<Record<string, boolean>>({});

	async function toggle(a: AutomationView, enabled: boolean) {
		busy[a.id] = true; notice = '';
		const r = await api('POST', `/api/automations/${a.id}/enabled`, { enabled });
		busy[a.id] = false;
		if (!r.ok) notice = r.data?.message ?? explain(r.data?.error);
		await behaviours.load();
	}
	async function duplicate(a: AutomationView) {
		busy[a.id] = true; notice = '';
		const r = await api('POST', `/api/automations/${a.id}/duplicate`);
		busy[a.id] = false;
		notice = r.ok ? `Copied “${a.name}”. The copy is switched off until you turn it on.` : (r.data?.message ?? explain(r.data?.error));
		await behaviours.load();
	}
	const when = (iso: string) => { const d = new Date(/^\d+$/.test(iso) ? Number(iso) : iso); return isNaN(+d) ? null : ago(+d); };
	const extra = (a: AutomationView) => (a.enabled === false ? 'Switched off. ' : '') + (a.lastTriggered && when(a.lastTriggered) ? `Last ran ${when(a.lastTriggered)}.` : 'Has not run yet.');
</script>

{#if home.haHealth !== 'ok' && home.loaded}<p role="status" class="px-4 py-3 text-sm">The home hub isn't reachable, so automatic things can't be changed right now. Any that are switched on keep running on the hub.</p>{/if}
{#if notice}<p role="status" class="bg-accent px-4 py-3 text-sm">{notice}</p>{/if}
{#each behaviours.automations as a (a.id)}
	<Swipeable actions={a.enabled === null ? [] : [{ label: a.enabled ? 'Turn off' : 'Turn on', tone: a.enabled ? 'default' : 'on', run: () => toggle(a, !a.enabled) }]}>
		<BehaviourRow kind="automation" name={a.name} does={automationDoes(a)} extra={extra(a)} dim={a.enabled === false}
			alert={a.needsAttention ? `${a.enabled === null ? 'The home hub doesn’t list this one.' : 'Some of the devices it uses are no longer available.'} Edit it to fix this.` : null}>
			{#snippet trailing()}
				<Button size="icon-sm" variant="ghost" aria-label="Make a copy of {a.name}" disabled={!!busy[a.id] || home.haHealth !== 'ok'} onclick={() => duplicate(a)}><Copy /></Button>
				<Button size="sm" variant="ghost" href="/automations/{a.id}">Edit</Button>
				{#if a.enabled === null}<span class="text-xs text-muted-foreground">Not on the hub</span>
				{:else}<Switch checked={a.enabled} disabled={!!busy[a.id] || home.haHealth !== 'ok'} aria-label="{a.name} is {a.enabled ? 'on' : 'off'}" onCheckedChange={(v) => toggle(a, v)} />{/if}
			{/snippet}
		</BehaviourRow>
	</Swipeable>
{/each}
