var CACHE_NAME = 'markbook-v2';

self.addEventListener('install', function (e) {
    self.skipWaiting();
});

self.addEventListener('activate', function (e) {
    e.waitUntil(
        Promise.all([
            caches.keys().then(function (names) {
                return Promise.all(names.map(function (name) {
                    if (name !== CACHE_NAME) return caches.delete(name);
                }));
            }),
            self.clients.claim(),
        ])
    );
});

self.addEventListener('fetch', function (e) {
    e.respondWith(
        fetch(e.request).catch(function () {
            return new Response('Offline', { status: 503 });
        })
    );
});
