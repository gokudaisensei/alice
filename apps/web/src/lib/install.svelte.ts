/** Adding the app to the home screen: Chrome offers a prompt we can trigger; iPhone has none, so we say how. */
type InstallEvent = Event & { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };

class Install {
	private event = $state<InstallEvent | null>(null);
	standalone = $state(false);
	dismissed = $state(false);
	ios = $state(false);

	start() {
		this.standalone = matchMedia('(display-mode: standalone)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
		this.ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent);
		try { this.dismissed = localStorage.getItem('install-dismissed') === '1'; } catch {}
		window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); this.event = e as InstallEvent; });
		window.addEventListener('appinstalled', () => { this.event = null; this.standalone = true; });
	}
	/** Worth showing: not already installed, not dismissed, and there is something to offer. */
	get offer(): 'prompt' | 'ios' | null { return this.standalone || this.dismissed ? null : this.event ? 'prompt' : this.ios ? 'ios' : null; }
	async install() { const e = this.event; if (!e) return; await e.prompt(); const r = await e.userChoice; if (r.outcome === 'accepted') this.event = null; }
	dismiss() { this.dismissed = true; try { localStorage.setItem('install-dismissed', '1'); } catch {} }
}
export const install = new Install();
