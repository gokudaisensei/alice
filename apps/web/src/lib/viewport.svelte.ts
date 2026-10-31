/** Screen class. `phone` = under 640px (compact tiles, bottom drawers). `wide` = 1024px and up (right-hand rail fits). */
class Viewport {
	phone = $state(false);
	wide = $state(false);
	constructor() {
		if (typeof matchMedia === 'undefined') return;
		const p = matchMedia('(max-width: 639px)'), w = matchMedia('(min-width: 1024px)');
		this.phone = p.matches; this.wide = w.matches;
		p.addEventListener('change', (e) => (this.phone = e.matches));
		w.addEventListener('change', (e) => (this.wide = e.matches));
	}
}
export const viewport = new Viewport();
