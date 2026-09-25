const DB_NAME  = 'gastos-share';
const STORE    = 'pendiente';
// F9.178 — el SW guarda todos los compartidos en 'archivos'. 'archivo' (uno solo) es lo que
// escribía el SW anterior: se sigue leyendo porque el teléfono puede tener ese SW todavía.
const KEY        = 'archivos';
const KEY_LEGACY = 'archivo';
const KEY_DIAG   = 'diag';

// Lo que el SW anotó del intento: qué llegó y en qué etapa terminó. Nunca el contenido.
export interface DiagShare {
  fecha: string;
  recibidos: number;
  archivos: { nombre?: string; tipo?: string; tamano?: number; noEsArchivo?: string }[];
  etapa: string;
  error: string | null;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
}

// Lee y borra los archivos en una sola transacción — si la página se refresca, IDB ya está
// vacío. El diagnóstico NO se borra: queda el historial de los últimos intentos.
export async function leerYBorrarArchivosCompartidos(): Promise<{ archivos: File[]; diag: DiagShare | null }> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx    = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const reqNuevo  = store.get(KEY);
    const reqLegacy = store.get(KEY_LEGACY);
    const reqDiag   = store.get(KEY_DIAG);
    store.delete(KEY);
    store.delete(KEY_LEGACY);
    tx.oncomplete = () => {
      const nuevos: unknown[] = Array.isArray(reqNuevo.result) ? reqNuevo.result : [];
      const archivos = [...nuevos, reqLegacy.result].filter((f): f is File => f instanceof Blob);
      const diags: DiagShare[] = Array.isArray(reqDiag.result) ? reqDiag.result : [];
      resolve({ archivos, diag: diags[diags.length - 1] ?? null });
    };
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}
