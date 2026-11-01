<script lang="ts">
	import { Check } from '@lucide/svelte';
	/** A round, generous selection mark (like the ones in iOS lists). Purely visual when used inside a row that is itself the control. */
	let { checked = false, class: cls = '' }: { checked?: boolean; class?: string } = $props();
</script>

<span aria-hidden="true" class="flex size-6 shrink-0 items-center justify-center rounded-full border-2 transition-[background-color,border-color,transform] duration-150 {checked ? 'scale-100 border-primary bg-primary text-primary-foreground' : 'border-input bg-card'} {cls}">
	{#if checked}<Check class="size-3.5" strokeWidth={3.2} />{/if}
</span>
