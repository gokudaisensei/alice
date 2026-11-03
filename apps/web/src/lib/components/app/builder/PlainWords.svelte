<script lang="ts">
	import { Info } from '@lucide/svelte';
	/** The hero of every builder: what this will do, in one sentence that follows each edit. */
	let { text, note }: { text: string; note?: string | null } = $props();
</script>

<section aria-labelledby="plain-words" class="rounded-3xl bg-primary/10 px-5 py-5 md:px-7 md:py-6">
	<h2 id="plain-words" class="text-[0.8125rem] font-semibold uppercase tracking-wide text-primary">In plain words</h2>
	<p class="mt-2 text-balance text-[1.375rem] font-semibold leading-snug tracking-[-0.02em] md:text-[1.75rem]" aria-live="polite" data-testid="summary">{text}</p>
	{#if note}<p class="mt-3 flex items-start gap-2 text-sm text-muted-foreground"><Info class="mt-0.5 size-4 shrink-0" />{note}</p>{/if}
</section>
