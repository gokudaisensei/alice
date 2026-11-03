<script lang="ts">
	import { Button } from '#lib/components/ui/button';
	import { Play } from '@lucide/svelte';
	/** The same bottom bar on every builder: Cancel, Try it now, Save. Sticks to the screen so Save is never lost. */
	let { saveLabel, saving = false, canSave, onsave, cancelHref, onTry, trying = false, canTry = true, tryNote = '', error = '', hint = '' }: {
		saveLabel: string; saving?: boolean; canSave: boolean; onsave: () => void; cancelHref: string;
		onTry?: () => void; trying?: boolean; canTry?: boolean; tryNote?: string; error?: string; hint?: string;
	} = $props();
</script>

<div class="h-28 md:hidden"></div>
<div class="fixed inset-x-0 bottom-[calc(3.25rem+env(safe-area-inset-bottom))] z-20 space-y-2 border-t bg-background/95 px-5 py-3 backdrop-blur-xl md:sticky md:bottom-4 md:rounded-2xl md:border md:bg-card/95 md:px-4 md:shadow-sm">
	{#if error}<p role="alert" class="text-sm text-signal">{error}</p>
	{:else if hint}<p class="text-sm text-muted-foreground">{hint}</p>{/if}
	<div class="flex items-center gap-2">
		<Button variant="ghost" href={cancelHref}>Cancel</Button>
		{#if onTry}<Button variant="secondary" onclick={onTry} disabled={!canTry || trying || saving} title={tryNote}><Play />{trying ? 'Starting…' : 'Try it now'}</Button>{/if}
		<Button class="ml-auto flex-1 md:flex-none" onclick={onsave} disabled={saving || trying || !canSave}>{saving ? 'Saving…' : saveLabel}</Button>
	</div>
	{#if onTry && tryNote}<p class="hidden text-xs text-muted-foreground md:block">{tryNote}</p>{/if}
</div>
