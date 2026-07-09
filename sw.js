// Keim: one-shot service worker that clears any stale PWA cache from older
// versions and unregisters itself, so the browser stops serving cached old code.
self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        // Delete every cache the old app may have left behind.
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
        await self.registration.unregister();
    })());
});

self.addEventListener('fetch', (event) => {
    // Never serve cached responses — always go to network.
    event.respondWith(fetch(event.request).catch(() => fetch(event.request)));
});
