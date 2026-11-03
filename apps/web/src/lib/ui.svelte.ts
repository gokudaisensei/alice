// Comfort settings that belong to this phone, not to the household: kept on the device, applied as classes on <html>.
const KEY = 'ui:v1';
type Saved = { reduceMotion: boolean; oneHand: boolean; large: boolean; shake: boolean };
const defaults: Saved = { reduceMotion: false, oneHand: false, large: false, shake: false };

class Ui {
	reduceMotion = $state(false);
	oneHand = $state(false);
	large = $state(false);
	shake = $state(false);

	constructor() {
		if (typeof localStorage === 'undefined') return;
		try { Object.assign(this, { ...defaults, ...(JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Saved>) }); } catch { /* defaults */ }
		this.paint();
	}
	set<K extends keyof Saved>(k: K, v: Saved[K]) {
		this[k] = v;
		try { localStorage.setItem(KEY, JSON.stringify({ reduceMotion: this.reduceMotion, oneHand: this.oneHand, large: this.large, shake: this.shake })); } catch { /* not kept */ }
		this.paint();
	}
	private paint() {
		if (typeof document === 'undefined') return;
		const c = document.documentElement.classList;
		c.toggle('reduce-motion', this.reduceMotion); c.toggle('one-hand', this.oneHand); c.toggle('large-ui', this.large);
	}
}
export const ui = new Ui();
