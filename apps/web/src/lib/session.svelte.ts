import { api, type Me } from './api';

class Session {
	me = $state<Me | null>(null);
	loaded = $state(false);
	async refresh() {
		const r = await api<Me>('GET', '/api/me');
		this.me = r.ok ? r.data : null;
		this.loaded = true;
	}
	// UI hint only. The server authorizes every request independently.
	can = (p: string) => !!this.me?.permissions.includes(p);
}
export const session = new Session();
