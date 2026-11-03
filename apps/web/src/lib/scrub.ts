// The arithmetic of press-hold-and-slide, kept apart from the screen so it can be tested.

/** A value after dragging `dx` pixels across a tile `width` wide: a full tile width is the whole range, snapped to `step`, held inside it. */
export function scrubbed(start: number, dx: number, width: number, min: number, max: number, step = 1): number {
	const raw = start + (dx / Math.max(1, width)) * (max - min);
	const snapped = Math.round(raw / step) * step;
	return Math.min(max, Math.max(min, Number(snapped.toFixed(4))));
}

/** True when the value has just crossed into a new notch of `every` units since the last tick. */
export const crossed = (last: number, now: number, every: number) => Math.floor(now / every) !== Math.floor(last / every);
