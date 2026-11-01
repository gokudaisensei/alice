<script lang="ts">
	import type { Snippet } from 'svelte';
	import { haptics } from '#lib/haptics.js';

	type Act = { label: string; tone?: 'default' | 'on' | 'signal'; run: () => unknown };
	/** Swipe a row to the left to reveal what you can do with it. A long swipe does the first action straight away. */
	let { actions, children, class: cls = '' }: { actions: Act[]; children: Snippet; class?: string } = $props();
	const W = $derived(actions.length * 84);
	let x = $state(0), dragging = $state(false), startX = 0, startY = 0, base = 0, captured = false, dead = false, moved = false, past = false;
	const tone = { default: 'bg-secondary text-foreground', on: 'bg-on text-on-foreground', signal: 'bg-signal text-white' };

	function down(e: PointerEvent) { startX = e.clientX; startY = e.clientY; base = x; captured = false; dead = false; moved = false; past = false; dragging = true; }
	function move(e: PointerEvent) {
		if (!dragging || dead) return;
		const dx = e.clientX - startX, dy = e.clientY - startY;
		if (!captured) {
			if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { dead = true; dragging = false; return; } // it's a scroll, not a swipe
			if (Math.abs(dx) < 8) return;
			captured = true; (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
		}
		moved = true;
		x = Math.max(-W - 70, Math.min(0, base + dx));
		const nowPast = x < -(W + 40);
		if (nowPast !== past) { past = nowPast; haptics.grab(); }
	}
	function up() {
		if (!dragging) return; dragging = false;
		if (!captured) return;
		if (past) { x = 0; actions[0]?.run(); return; }
		x = x < -W / 2 ? -W : 0;
	}
	// A drag must not also count as a tap on whatever is inside the row.
	function swallow(e: MouseEvent) { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } else if (x !== 0) { x = 0; e.stopPropagation(); e.preventDefault(); } }
</script>

<div class="relative overflow-hidden {cls}">
	<div class="absolute inset-y-0 right-0 flex" style="width:{W}px" aria-hidden={x === 0}>
		{#each actions as a (a.label)}
			<button type="button" tabindex={x === 0 ? -1 : 0} class="flex-1 text-sm font-medium transition-colors active:brightness-95 {tone[a.tone ?? 'default']}" onclick={() => { haptics.tap(); x = 0; a.run(); }}>{a.label}</button>
		{/each}
	</div>
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="relative bg-card {dragging ? '' : 'transition-transform duration-300 ease-[cubic-bezier(.3,.7,.2,1)]'}" style="transform: translateX({x}px); touch-action: pan-y" onpointerdown={down} onpointermove={move} onpointerup={up} onpointercancel={up} onclickcapture={swallow}>
		{@render children()}
	</div>
</div>
