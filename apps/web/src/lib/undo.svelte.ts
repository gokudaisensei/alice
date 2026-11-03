export type Undoable = { label: string; run: () => Promise<unknown> };

/** The last few things you did, newest first, so one gesture (a shake, or the toast button) can take the latest back. */
class Undo {
	stack = $state<Undoable[]>([]);
	push(e: Undoable) { this.stack = [e, ...this.stack].slice(0, 8); }
	/** Takes back the newest; returns what it was, or null when there was nothing. */
	async last(): Promise<string | null> {
		const [e, ...rest] = this.stack;
		if (!e) return null;
		this.stack = rest;
		await e.run();
		return e.label;
	}
}
export const undo = new Undo();
