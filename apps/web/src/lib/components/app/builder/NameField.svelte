<script lang="ts">
	import { Input } from '#lib/components/ui/input';
	import { Label } from '#lib/components/ui/label';
	import { behaviours, type Kind } from '#lib/behaviours.svelte.js';
	import { TriangleAlert } from '@lucide/svelte';
	let { value = $bindable(), placeholder, self }: { value: string; placeholder: string; self?: { kind: Kind; id: string } } = $props();
	const clash = $derived(behaviours.sameName(value, self));
</script>

<div class="space-y-1.5">
	<Label for="n">Name</Label>
	<Input id="n" bind:value maxlength={60} {placeholder} aria-describedby={clash.length ? 'name-clash' : undefined} />
	{#if clash.length}
		<p id="name-clash" role="status" class="flex items-start gap-2 rounded-xl bg-signal-soft px-3 py-2 text-sm text-signal-foreground">
			<TriangleAlert class="mt-0.5 size-4 shrink-0" />
			<span>{#each clash as c, i}{i ? ' ' : ''}There is already {c.kind === 'automation' ? 'an' : 'a'} {c.kind} with this name: {c.does}{/each} You can keep the name, but they will be easy to mix up.</span>
		</p>
	{/if}
</div>
