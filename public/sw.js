// Minimal SW — instalabilidad PWA + share-target (F6.6). Sin caching de red.
// Offline de datos: F4-F5 (Firestore persistentLocalCache).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── IDB helpers (inline — sw.js no puede importar TS) ─────────────────────────
const IDB_NAME  = 'gastos-share';
const IDB_STORE = 'pendiente';
const IDB_KEY   = 'archivo';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(file) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(file, IDB_KEY);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
  });
}

// ── Share-target handler ───────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname === '/share-target') {
    e.respondWith((async () => {
      try {
        const data  = await e.request.formData();
        const files = data.getAll('files');
        const file  = files[0];
        if (file instanceof File) await idbPut(file);
      } catch (_) {
        // Si falla el IDB, igual redirige; la app verá IDB vacío y no hará nada.
      }
      return Response.redirect('/comprobantes?share=1', 303);
    })());
  }
});
