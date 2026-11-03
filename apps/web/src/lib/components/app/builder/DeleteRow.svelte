<script lang="ts">
	import { Button } from '#lib/components/ui/button';
	import { Trash2 } from '@lucide/svelte';
	/** Deleting lives apart from Save and asks once, in place, before anything is lost. */
	let { what, ondelete }: { what: string; ondelete: () => void | Promise<void> } = $props();
	let asking = $state(false), busy = $state(false);
	async function go() { busy = true; await ondelete(); busy = false; asking = false; }
</script>

<div class="mt-2 border-t pt-5">
	{#if asking}
		<div role="alertdialog" aria-label="Confirm delete" class="space-y-3 rounded-2xl bg-signal-soft p-4">
			<p class="text-sm font-medium text-signal-foreground">Delete this {what}? This can’t be undone.</p>
			<div class="flex gap-2"><Button variant="secondary" onclick={() => (asking = false)}>Keep it</Button><Button variant="destructive" disabled={busy} onclick={go}>{busy ? 'Deleting…' : `Yes, delete ${what}`}</Button></div>
		</div>
	{:else}
		<Button variant="ghost" class="text-signal" onclick={() => (asking = true)}><Trash2 />Delete this {what}</Button>
	{/if}
</div>
