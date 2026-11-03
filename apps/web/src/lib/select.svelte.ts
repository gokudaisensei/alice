/** Picking several devices at once: hold one, tap others, then act on them together. */
class Selection {
	active = $state(false);
	ids = $state<string[]>([]);
	start(id: string) { this.active = true; this.ids = [id]; }
	toggle(id: string) {
		this.ids = this.ids.includes(id) ? this.ids.filter((x) => x !== id) : [...this.ids, id];
		if (!this.ids.length) this.active = false;
	}
	has = (id: string) => this.ids.includes(id);
	clear() { this.active = false; this.ids = []; }
}
export const selection = new Selection();
