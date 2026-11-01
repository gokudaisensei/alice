import { api, type Me } from './api';

/** Remove everything kept on this device about the household: on sign-out or when the sign-in is no longer valid. */
export function forget() {
	try { for (const k of Object.keys(localStorage)) if (k.startsWith('me:') || k.startsWith('home:')) localStorage.removeItem(k); } catch { /* ignore */ }
}

class Session {
	me = $state<Me | null>(null);
	loaded = $state(false);
	/** Last known sign-in, so a returning person sees their home before the network answers. The server still decides everything. */
	restore() {
		try { const v = localStorage.getItem('me:v1'); if (v && !this.me) { this.me = JSON.parse(v); this.loaded = true; } } catch { /* private mode: start normally */ }
	}
	remember(me: Me | null) {
		if (JSON.stringify(me) !== JSON.stringify(this.me)) this.me = me;
		this.loaded = true;
		try { if (me) localStorage.setItem('me:v1', JSON.stringify(me)); else forget(); } catch { /* ignore */ }
	}
	async refresh() {
		const r = await api<Me>('GET', '/api/me');
		this.remember(r.ok ? r.data : null);
	}
	// UI hint only. The server authorizes every request independently.
	can = (p: string) => !!this.me?.permissions.includes(p);
}
export const session = new Session();
