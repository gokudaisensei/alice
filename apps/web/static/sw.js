// Shows push notifications, and lets a button on one (like "Lock" on an open-door alert) act without opening the app.
// The payload is encrypted end to end and only carries a title, a line of text, a page to open, and optional action buttons.
self.addEventListener('push', (event) => {
	let d = {};
	try { d = event.data ? event.data.json() : {}; } catch {}
	const actions = Array.isArray(d.actions) ? d.actions.filter((a) => a && typeof a.action === 'string' && typeof a.title === 'string').slice(0, 2) : [];
	event.waitUntil(self.registration.showNotification(d.title || 'Home', {
		body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', actions,
		data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/', entityId: typeof d.entityId === 'string' ? d.entityId : null, switchId: typeof d.switchId === 'string' ? d.switchId : null }
	}));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const { url, entityId, switchId } = event.notification.data || {};
	// "Lock" from the notification: the same checked request the app would send, using the person's own sign-in.
	if (event.action === 'lock' && entityId) {
		event.waitUntil((async () => {
			try {
				const r = await fetch(`/api/devices/${encodeURIComponent(entityId)}/command`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'alice' }, body: JSON.stringify({ action: 'lock' }) });
				if (r.ok) return self.registration.showNotification('Locked', { body: 'The door is locked.', icon: '/icon-192.png', tag: 'lock-result' });
				if (r.status === 401) return self.clients.openWindow('/');
				return self.registration.showNotification("Couldn't lock it", { body: 'Open the app to try again.', icon: '/icon-192.png', tag: 'lock-result' });
			} catch { return self.registration.showNotification("Couldn't reach home", { body: 'Check your connection and try again.', icon: '/icon-192.png', tag: 'lock-result' }); }
		})());
		return;
	}
	// "Switch off" from a power alert: the same checked request, aimed at the plug's own switch.
	if (event.action === 'turn_off' && typeof switchId === 'string') {
		event.waitUntil((async () => {
			try {
				const r = await fetch(`/api/devices/${encodeURIComponent(switchId)}/command`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'alice' }, body: JSON.stringify({ action: 'turn_off' }) });
				if (r.ok) return self.registration.showNotification('Switched off', { body: 'The plug is off.', icon: '/icon-192.png', tag: 'power-result' });
				if (r.status === 401) return self.clients.openWindow('/');
				return self.registration.showNotification("Couldn't switch it off", { body: 'Open the app to try again.', icon: '/icon-192.png', tag: 'power-result' });
			} catch { return self.registration.showNotification("Couldn't reach home", { body: 'Check your connection and try again.', icon: '/icon-192.png', tag: 'power-result' }); }
		})());
		return;
	}
	event.waitUntil(self.clients.matchAll({ type: 'window' }).then((all) => {
		for (const c of all) if ('focus' in c) { c.navigate(url || '/'); return c.focus(); }
		return self.clients.openWindow(url || '/');
	}));
});

// Speed: the app opens from this device's copy and updates itself behind the scenes. Only the app's own files are kept here.
// Nothing from /api/ is ever stored: your home's data stays on the server (and in this device's private app storage).
const FILES = 'app-files-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil((async () => {
	for (const k of await caches.keys()) if (k !== FILES) await caches.delete(k);
	await self.clients.claim();
})()));

async function fromCacheThenUpdate(request, key) {
	const cache = await caches.open(FILES);
	const hit = await cache.match(key);
	const fresh = fetch(request).then((r) => { if (r.ok) cache.put(key, r.clone()); return r; });
	if (hit) { fresh.catch(() => {}); return hit; }
	return fresh;
}
self.addEventListener('fetch', (event) => {
	const req = event.request, url = new URL(req.url);
	if (req.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/') || url.pathname === '/sw.js') return;
	if (req.mode === 'navigate') { event.respondWith(fromCacheThenUpdate(req, '/')); return; } // every page is the same app shell
	if (url.pathname.startsWith('/_app/immutable/')) { // hashed names never change, so a copy is always right
		event.respondWith(caches.open(FILES).then(async (c) => (await c.match(req)) ?? fetch(req).then((r) => { if (r.ok) c.put(req, r.clone()); return r; })));
		return;
	}
	// The manifest is read when the app is installed or updated, so it must never be a stale copy: go to the network first.
	if (url.pathname.endsWith('.webmanifest')) { event.respondWith(fetch(req).catch(() => caches.match(req).then((r) => r ?? Response.error()))); return; }
	if (/\.(png|svg|woff2)$/.test(url.pathname)) event.respondWith(fromCacheThenUpdate(req, req));
});
