// Minimal SW — solo habilita instalabilidad PWA. Sin caching.
// Offline de datos: F4-F5.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
