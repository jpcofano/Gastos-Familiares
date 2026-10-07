// F9.187 — página mínima para reproducir la falta de actualización en vivo. Usa el src/firebase.ts REAL
// (mismo initializeFirestore con persistentLocalCache + persistentMultipleTabManager, y lo que §1 agregue
// ahí), conectado al emulador. La empaqueta scripts/reproducirF9187.ts con esbuild.
//
// Expone en window:
//   __ev     → cada snapshot del doc observado: { n, estado, t (Date.now()), deCache, pendiente }
//   __listo  → true cuando llegó el primer snapshot del servidor
//   __log    → los console.log de la página que empiezan con "[F9.187]"
//   __actualizar() → el botón "¿Sigue igual? Actualizar" de §3: getDocFromServer + reconexión
import { signInWithEmailAndPassword } from 'firebase/auth';
import { doc, onSnapshot, getDocFromServer } from 'firebase/firestore';
import { auth, db } from '../../src/firebase';

type Ev = { n: unknown; estado: unknown; t: number; deCache: boolean; pendiente: boolean };
const w = window as unknown as { __ev: Ev[]; __listo: boolean; __log: string[]; __error?: string; __actualizar: () => Promise<unknown> };
w.__ev = []; w.__listo = false; w.__log = [];

const log = console.log.bind(console);
console.log = (...a: unknown[]) => { if (typeof a[0] === 'string' && a[0].startsWith('[F9.187]')) w.__log.push(`${Date.now()} ${a.join(' ')}`); log(...a); };

const params = new URLSearchParams(location.search);
const ref = doc(db, 'resumenesTarjeta', params.get('doc') ?? 'f9187-prueba');

signInWithEmailAndPassword(auth, 'f9187@test.local', 'f9187-prueba')
  .then(() => {
    onSnapshot(ref, { includeMetadataChanges: true }, snap => {
      const d = snap.data() ?? {};
      w.__ev.push({ n: d.n, estado: d.estado, t: Date.now(), deCache: snap.metadata.fromCache, pendiente: snap.metadata.hasPendingWrites });
      if (!snap.metadata.fromCache) w.__listo = true;
    }, e => { w.__error = String(e); });
  })
  .catch(e => { w.__error = String(e); });

w.__actualizar = async () => (await getDocFromServer(ref)).data();
