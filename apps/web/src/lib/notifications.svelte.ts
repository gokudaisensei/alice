import { api } from './api.js';

export type Note = { id: string; kind: string; title: string; body: string; entityId: string | null; createdAt: number; read: boolean };
export type NotePrefs = { muted: string[]; quiet: { enabled: boolean; start: string; end: string; tz: string }; criticalBypass: boolean; kinds: string[]; pushDevices: number; pushAvailable: boolean };

const b64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

class Notifications {
	unread = $state(0);
	private timer: ReturnType<typeof setInterval> | null = null;

	async refresh() { const r = await api<{ unread: number }>('GET', '/api/notifications/unread'); if (r.ok) this.unread = r.data.unread; }
	start() {
		this.refresh();
		this.timer ??= setInterval(() => document.visibilityState === 'visible' && this.refresh(), 30_000);
		window.addEventListener('focus', this.onFocus);
	}
	stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.unread = 0; window.removeEventListener('focus', this.onFocus); }
	private onFocus = () => this.refresh();

	/** Whether this browser can do push at all, and whether it is switched on here. */
	static supported = () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
	async thisDevice() {
		if (!Notifications.supported()) return false;
		const reg = await navigator.serviceWorker.getRegistration('/sw.js');
		return !!(await reg?.pushManager.getSubscription());
	}
	/** Returns an explanation if it could not be switched on. */
	async enablePush(): Promise<string | null> {
		if (!Notifications.supported()) return "This browser can't receive push notifications. On an iPhone, add the app to your Home Screen first.";
		if ((await Notification.requestPermission()) !== 'granted') return 'Notifications are blocked for this site in your browser settings.';
		const k = await api<{ publicKey: string }>('GET', '/api/push/key');
		if (!k.ok) return 'Push notifications are not available on this home.';
		const reg = await navigator.serviceWorker.register('/sw.js');
		await navigator.serviceWorker.ready;
		const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64(k.data.publicKey) }));
		const j = sub.toJSON();
		const r = await api('POST', '/api/push/subscribe', { endpoint: j.endpoint, keys: j.keys });
		if (!r.ok) { await sub.unsubscribe(); return 'Could not switch notifications on. Please try again.'; }
		return null;
	}
	async disablePush() {
		const reg = await navigator.serviceWorker?.getRegistration('/sw.js');
		const sub = await reg?.pushManager.getSubscription();
		if (sub) { await api('POST', '/api/push/unsubscribe', { endpoint: sub.endpoint }); await sub.unsubscribe(); }
	}
}
export const notifications = new Notifications();
