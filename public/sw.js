// Minimal SW — instalabilidad PWA + share-target (F6.6). Sin caching de red.
// Offline de datos: F4-F5 (Firestore persistentLocalCache).

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

// ── IDB helpers (inline — sw.js no puede importar TS) ─────────────────────────
const IDB_NAME  = 'gastos-share';
const IDB_STORE = 'pendiente';
// F9.178 — 'archivos' guarda TODOS los compartidos (antes 'archivo' = solo files[0]).
// 'diag' guarda los últimos intentos: fecha, qué llegó (nombre/tipo/tamaño, nunca el
// contenido), en qué etapa terminó y el error si hubo.
const IDB_KEY      = 'archivos';
const IDB_KEY_DIAG = 'diag';
const DIAG_MAX     = 20;

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(IDB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

async function idbPut(files) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(files, IDB_KEY);
    tx.oncomplete = resolve;
    tx.onerror    = () => reject(tx.error);
    tx.onabort    = () => reject(tx.error);
  });
}

// Nunca tira: si el diagnóstico mismo falla, el redirect igual lleva el resultado en la URL.
async function idbDiag(registro) {
  try {
    const db = await idbOpen();
    await new Promise((resolve, reject) => {
      const tx    = db.transaction(IDB_STORE, 'readwrite');
      const store = tx.objectStore(IDB_STORE);
      const req   = store.get(IDB_KEY_DIAG);
      req.onsuccess = () => {
        const prev = Array.isArray(req.result) ? req.result : [];
        store.put([...prev, registro].slice(-DIAG_MAX), IDB_KEY_DIAG);
      };
      tx.oncomplete = resolve;
      tx.onerror    = () => reject(tx.error);
    });
  } catch (_) { /* sin IDB no hay dónde dejar rastro; queda el ?sw= de la URL */ }
}

// ── Share-target handler ───────────────────────────────────────────────────────
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method === 'POST' && url.pathname === '/share-target') {
    e.respondWith((async () => {
      const diag = { fecha: new Date().toISOString(), recibidos: 0, archivos: [], etapa: 'formData', error: null };
      let sw = 'ok';
      try {
        const data  = await e.request.formData();
        diag.etapa  = 'getAll';
        const todos = data.getAll('files');
        diag.recibidos = todos.length;
        const files = todos.filter(f => f instanceof File);
        diag.archivos  = todos.map(f => f instanceof File
          ? { nombre: f.name, tipo: f.type, tamano: f.size }
          : { noEsArchivo: typeof f });
        if (!files.length) {
          sw = 'vacio';
        } else {
          diag.etapa = 'idbPut';
          await idbPut(files);
          diag.etapa = 'ok';
        }
      } catch (err) {
        sw = 'err';
        diag.error = `${err && err.name || 'Error'}: ${err && err.message || String(err)}`;
      }
      await idbDiag(diag);
      const etapa = sw === 'err' ? `&etapa=${diag.etapa}` : '';
      return Response.redirect(`/comprobantes?share=1&sw=${sw}&n=${diag.recibidos}${etapa}`, 303);
    })());
  }
});
