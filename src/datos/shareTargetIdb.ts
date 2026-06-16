const DB_NAME  = 'gastos-share';
const STORE    = 'pendiente';
const KEY      = 'archivo';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// Lee y borra en una sola transacción — si la página se refresca, IDB ya está vacío.
export async function leerYBorrarArchivoCompartido(): Promise<File | null> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const req   = store.get(KEY);
    req.onsuccess = () => {
      const file: File | undefined = req.result;
      if (file) store.delete(KEY);
      tx.oncomplete = () => resolve(file ?? null);
    };
    req.onerror = () => reject(req.error);
    tx.onerror  = () => reject(tx.error);
  });
}
