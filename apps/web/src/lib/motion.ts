// Transition durations that respect "reduce motion": zero when the device asks for less movement.
export const reduced = () => typeof document !== 'undefined' && (document.documentElement.classList.contains('reduce-motion') || (typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches));
export const dur = (ms: number) => (reduced() ? 0 : ms);
