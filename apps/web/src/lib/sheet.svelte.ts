import { pushState } from '$app/navigation';
import { page } from '$app/state';

/**
 * A bottom sheet that the Back button closes. Opening it adds one history entry, so Back (or the edge swipe) closes the
 * sheet and stays on the page; closing it any other way removes that entry again.
 * Use with `bind:open={sheet(() => key).open}`: one key per sheet, such as `device:light.kitchen`.
 */
export function sheet(key: () => string) {
	return {
		get open() { return page.state.sheet === key(); },
		set open(v: boolean) {
			const k = key();
			if (v && page.state.sheet !== k) pushState('', { sheet: k });
			else if (!v && page.state.sheet === k) history.back();
		}
	};
}
