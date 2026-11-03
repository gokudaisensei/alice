<script lang="ts">
	import type { Snippet } from 'svelte';
	import { haptics } from '#lib/haptics.js';
	import { home } from '#lib/home.svelte.js';

	/** A button for things that must not happen by accident: press and keep pressing until it fills. A quick tap only explains. */
	let { onhold, ms = 700, hint = 'Hold to confirm', disabled = false, ring = false, class: cls = '', children, ...rest }: { onhold: () => unknown; ms?: number; hint?: string; disabled?: boolean; ring?: boolean; class?: string; children: Snippet; [k: string]: unknown } = $props();
	let down = $state(false), timer: ReturnType<typeof setTimeout> | undefined, done = false;

	function start(e: PointerEvent) {
		if (disabled) return;
		done = false; down = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId); haptics.grab();
		timer = setTimeout(() => { done = true; down = false; haptics.success(); void onhold(); }, ms);
	}
	function stop() {
		clearTimeout(timer);
		if (down && !done) home.say('info', hint);
		down = false;
	}
	// A keyboard or screen reader has no "hold", so Enter and Space confirm directly.
	function key(e: KeyboardEvent) { if ((e.key === 'Enter' || e.key === ' ') && !disabled) { e.preventDefault(); haptics.success(); void onhold(); } }
</script>

<button type="button" {disabled} onpointerdown={start} onpointerup={stop} onpointercancel={stop} onpointerleave={stop} onkeydown={key} oncontextmenu={(e) => e.preventDefault()} class="relative select-none {ring ? '' : 'overflow-hidden'} {cls}" style="touch-action: none; -webkit-touch-callout: none" {...rest}>
	{#if down && ring}<svg class="pointer-events-none absolute -inset-[5px] size-[calc(100%+10px)] -rotate-90" viewBox="0 0 44 44" aria-hidden="true"><circle cx="22" cy="22" r="20.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" pathLength="100" stroke-dasharray="100" class="hold-ring" style="animation-duration:{ms}ms" /></svg>{/if}
	{#if down && !ring}<span class="hold-fill pointer-events-none absolute inset-0 bg-current opacity-25" style="animation-duration:{ms}ms" aria-hidden="true"></span>{/if}
	<span class="relative flex size-full items-center justify-center gap-[inherit]">{@render children()}</span>
</button>
