// Shows push notifications. The payload is encrypted end to end and only carries a title, a line of text and a page to open.
self.addEventListener('push', (event) => {
	let d = {};
	try { d = event.data ? event.data.json() : {}; } catch {}
	event.waitUntil(self.registration.showNotification(d.title || 'Home', { body: d.body || '', data: { url: typeof d.url === 'string' && d.url.startsWith('/') ? d.url : '/' } }));
});
self.addEventListener('notificationclick', (event) => {
	event.notification.close();
	const url = event.notification.data?.url || '/';
	event.waitUntil(self.clients.matchAll({ type: 'window' }).then((all) => {
		for (const c of all) if ('focus' in c) { c.navigate(url); return c.focus(); }
		return self.clients.openWindow(url);
	}));
});
