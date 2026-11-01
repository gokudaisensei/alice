// Shows push notifications, and lets a button on one (like "Lock" on an open-door alert) act without opening the app.
// The payload is encrypted end to end and only carries a title, a line of text, a page to open, and optional action buttons.
self.addEventListener('push', (event) => {
	let d = {};
	try { d = event.data ? event.data.json() : {}; } catch {}
	const actions = Array.isArray(d.actions) ? d.actions.filter((a) => a && typeof a.action === 'string' && typeof a.title === 'string').slice(0, 2) : [];
	event.waitUntil(self.registration.showNotification(d.title || 'Home', {
		body: d.body || '', icon: '/icon-192.png', badge: '/icon-192.png', actions,
		data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/', entityId: typeof d.entityId === 'string' ? d.entityId : null }
	}));
});

self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const { url, entityId } = event.notification.data || {};
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
	event.waitUntil(self.clients.matchAll({ type: 'window' }).then((all) => {
		for (const c of all) if ('focus' in c) { c.navigate(url || '/'); return c.focus(); }
		return self.clients.openWindow(url || '/');
	}));
});
