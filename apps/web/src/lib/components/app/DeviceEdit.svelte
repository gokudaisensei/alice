<script lang="ts">
	import { api } from '#lib/api.js';
	import { home, type Device } from '#lib/home.svelte.js';
	import { haptics } from '#lib/haptics.js';
	import { ICON_CHOICES, iconFor } from '#lib/icons.js';
	import { Button } from '#lib/components/ui/button';
	import { onMount } from 'svelte';

	/** Rename a device, move it to a room and choose its icon. Used by the device sheet and the hold menu. */
	let { device, onsaved }: { device: Device; onsaved?: () => void } = $props();
	// The editor starts from the device as it is when opened; a later change from elsewhere must not overwrite what is being typed.
	// svelte-ignore state_referenced_locally
	let name = $state(device.name), room = $state<string>(device.roomId ?? ''), icon = $state<string | null>(device.icon ?? null), saving = $state(false);
	const Auto = $derived(iconFor({ ...device, icon: null }));

	async function save() {
		saving = true;
		const r = await api('PUT', `/api/admin/devices/${encodeURIComponent(device.id)}`, { name: name.trim() || null, roomId: room || null, icon });
		saving = false;
		if (!r.ok) { haptics.error(); home.say('error', 'That didn’t save. Please try again.'); return; }
		await home.load(); haptics.success(); home.say('ok', 'Saved.'); onsaved?.();
	}
	// What else relies on this device, so changing it holds no surprise. Only for people who manage automations; quiet when there is nothing.
	let usedBy = $state<{ kind: string; name: string; madeHere: boolean }[]>([]);
	onMount(async () => { const r = await api<{ items: typeof usedBy }>('GET', `/api/devices/${encodeURIComponent(device.id)}/used-by`); if (r.ok) usedBy = r.data.items; });
	const field = 'h-12 w-full rounded-xl border bg-card px-3.5 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring';
</script>

<div class="space-y-4">
	{#if usedBy.length}<p class="rounded-xl bg-secondary/60 px-3.5 py-2.5 text-sm text-muted-foreground">Used by {usedBy.map((x) => `${x.kind === 'automation' ? 'the automation' : x.kind === 'script' ? 'the script' : 'the scene'} “${x.name}”`).join(', ')}. Renaming keeps these working.</p>{/if}
	<label class="block space-y-1.5 text-sm font-medium">Name<input bind:value={name} maxlength="60" class={field} /></label>
	<label class="block space-y-1.5 text-sm font-medium">Room<select bind:value={room} class={field}><option value="">No room</option>{#each home.orderedRooms as r (r.id)}<option value={r.id}>{r.name}</option>{/each}</select></label>
	<div class="space-y-1.5">
		<p class="text-sm font-medium">Icon</p>
		<div class="grid grid-cols-6 gap-1.5" role="radiogroup" aria-label="Icon">
			<button type="button" role="radio" aria-checked={icon === null} aria-label="Automatic" class="flex h-11 items-center justify-center rounded-xl text-xs font-medium transition-colors {icon === null ? 'bg-primary/12 text-primary' : 'bg-secondary text-muted-foreground'}" onclick={() => (icon = null)}><Auto class="size-5" aria-hidden="true" /></button>
			{#each ICON_CHOICES as c (c.key)}
				<button type="button" role="radio" aria-checked={icon === c.key} aria-label={c.label} class="flex h-11 items-center justify-center rounded-xl transition-colors {icon === c.key ? 'bg-primary/12 text-primary' : 'bg-secondary text-muted-foreground'}" onclick={() => (icon = c.key)}><c.icon class="size-5" aria-hidden="true" /></button>
			{/each}
		</div>
		<p class="text-xs text-muted-foreground">The first one is chosen for you from the device’s type and name.</p>
	</div>
	<Button class="h-12 w-full" disabled={saving} onclick={save}>{saving ? 'Saving…' : 'Save'}</Button>
</div>
