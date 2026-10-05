// Reconstrucción de la confirmación de resúmenes con el código REAL de src/ y un Firestore simulado.
//
// Nació en scripts/verificarF9179pre.ts (F9.179-pre). Se extrajo acá en F9.180 para que la
// verificación, el dry-run de §4 y el fixture del test de reglas usen la misma reconstrucción.
//
// · Las lecturas (getDoc/getDocs) van a producción por Admin SDK.
// · Las escrituras (writeBatch.set/update/delete) solo se anotan: `commit()` no manda nada, y
//   updateDoc/addDoc/setDoc tiran error si alguien las llama.
// · `cargar(ruta, ref)` transpila un .ts del repo y lo evalúa con stubs. Con `ref` (un commit) lee el
//   archivo de git en vez del árbol de trabajo, y los imports relativos se resuelven contra esa misma
//   versión: así un proceso corre el código viejo y el nuevo lado a lado.
// · `../firebase` (inicializa el SDK cliente con import.meta.env, no corre en node), hashArchivo,
//   storage y functions son stubs. `Timestamp` y `serverTimestamp` son los del SDK cliente de
//   verdad, para que una fecha inválida o un sentinel se comporten igual que en el teléfono.
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';

const rootReq = createRequire(process.cwd() + '/package.json');
const ts = rootReq('typescript') as typeof import('typescript');
export const clienteFS = rootReq('firebase/firestore') as typeof import('firebase/firestore');

export type RefSim = { __ref: true; path: string; id: string; col: string };
type ColSim = { __col: true; path: string };
type WhereSim = { campo: string; op: FirebaseFirestore.WhereFilterOp; valor: unknown };
type QuerySim = { __q: true; col: ColSim; ws: WhereSim[] };
export type OpBatch = { op: 'set' | 'update' | 'delete'; ref: RefSim; data?: Record<string, unknown> };
type Mod = Record<string, unknown>;

export interface Sim {
  /** Carga un módulo del repo. `ref` = commit de git; null/undefined = árbol de trabajo. */
  cargar<T>(ruta: string, ref?: string | null): T;
  lecturas: Array<{ que: string; n: number }>;
  batches: OpBatch[][];
  reset(): void;
}

const noEscribe = (que: string) => async () => { throw new Error(`${que} no tiene que correr en una reconstrucción`); };

export function crearSim(adminDb: FirebaseFirestore.Firestore): Sim {
  const lecturas: Sim['lecturas'] = [];
  const batches: OpBatch[][] = [];
  let autoId = 0;
  const DB_SIM = { __dbSimulado: true };

  const fsSimulado: Mod = {
    Timestamp: clienteFS.Timestamp,
    serverTimestamp: clienteFS.serverTimestamp,
    collection: (_db: unknown, ...segs: string[]): ColSim => ({ __col: true, path: segs.join('/') }),
    doc: (a: unknown, ...segs: string[]): RefSim => {
      if ((a as ColSim).__col) {
        const col = (a as ColSim).path;
        const id = segs[0] ?? `nuevo-${String(++autoId).padStart(2, '0')}`;
        return { __ref: true, path: `${col}/${id}`, id, col };
      }
      return { __ref: true, path: segs.join('/'), id: segs[segs.length - 1], col: segs.slice(0, -1).join('/') };
    },
    where: (campo: string, op: FirebaseFirestore.WhereFilterOp, valor: unknown): WhereSim => ({ campo, op, valor }),
    query: (col: ColSim, ...ws: WhereSim[]): QuerySim => ({ __q: true, col, ws }),
    getDocs: async (q: QuerySim | ColSim) => {
      const col = (q as QuerySim).__q ? (q as QuerySim).col.path : (q as ColSim).path;
      const ws = (q as QuerySim).__q ? (q as QuerySim).ws : [];
      let r: FirebaseFirestore.Query = adminDb.collection(col);
      for (const w of ws) r = r.where(w.campo, w.op, w.valor);
      const snap = await r.get();
      lecturas.push({ que: `${col} ${ws.map(w => `${w.campo} ${w.op} ${JSON.stringify(w.valor)}`).join(' & ')}`, n: snap.size });
      return {
        size: snap.size,
        empty: snap.empty,
        docs: snap.docs.map(d => ({ id: d.id, ref: { __ref: true, path: d.ref.path, id: d.id, col } as RefSim, data: () => d.data() })),
      };
    },
    getDoc: async (ref: RefSim) => {
      const snap = await adminDb.doc(ref.path).get();
      lecturas.push({ que: `${ref.path} (getDoc)`, n: snap.exists ? 1 : 0 });
      return { id: snap.id, exists: () => snap.exists, data: () => snap.data() };
    },
    writeBatch: () => {
      const ops: OpBatch[] = [];
      const b = {
        set: (ref: RefSim, data: Record<string, unknown>) => { ops.push({ op: 'set', ref, data }); return b; },
        update: (ref: RefSim, data: Record<string, unknown>) => { ops.push({ op: 'update', ref, data }); return b; },
        delete: (ref: RefSim) => { ops.push({ op: 'delete', ref }); return b; },
        commit: async () => { batches.push(ops); },   // NO escribe: solo registra
      };
      return b;
    },
    updateDoc: noEscribe('updateDoc'),
    addDoc: noEscribe('addDoc'),
    setDoc: noEscribe('setDoc'),
    deleteDoc: noEscribe('deleteDoc'),
    onSnapshot: () => { throw new Error('onSnapshot no tiene que correr en una reconstrucción'); },
  };

  const STUBS_PAQUETE: Record<string, Mod> = {
    'firebase/firestore': fsSimulado,
    'firebase/storage': { ref: () => ({}), uploadBytes: noEscribe('uploadBytes') },
    'firebase/functions': { httpsCallable: () => noEscribe('httpsCallable') },
  };
  const STUBS_RUTA: Record<string, Mod> = {
    'src/firebase': { db: DB_SIM, storage: {}, auth: {}, functions: {}, app: {} },
    'src/datos/hashArchivo': { sha256Archivo: noEscribe('sha256Archivo') },
  };

  const cache = new Map<string, Mod>();
  const leer = (ruta: string, ref: string | null) => ref
    ? execFileSync('git', ['show', `${ref}:${ruta}`], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    : fs.readFileSync(ruta, 'utf8');
  const existe = (ruta: string, ref: string | null) => {
    if (!ref) return fs.existsSync(ruta);
    try { execFileSync('git', ['cat-file', '-e', `${ref}:${ruta}`], { stdio: 'ignore' }); return true; } catch { return false; }
  };

  function cargarModulo(ruta: string, ref: string | null): Mod {
    const clave = `${ref ?? 'árbol'}:${ruta}`;
    const previo = cache.get(clave);
    if (previo) return previo;
    const js = ts.transpileModule(leer(ruta, ref), {
      fileName: ruta,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
    }).outputText;
    const modulo = { exports: {} as Mod };
    cache.set(clave, modulo.exports);
    const requireLocal = (spec: string): unknown => {
      if (spec in STUBS_PAQUETE) return STUBS_PAQUETE[spec];
      if (!spec.startsWith('.')) throw new Error(`import no previsto en la reconstrucción: ${spec} (desde ${ruta})`);
      const base = path.posix.normalize(path.posix.join(path.posix.dirname(ruta), spec));
      if (base in STUBS_RUTA) return STUBS_RUTA[base];
      const archivo = [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(f => existe(f, ref));
      if (!archivo) throw new Error(`no resuelvo ${spec} desde ${ruta}${ref ? ` @ ${ref}` : ''}`);
      return cargarModulo(archivo, ref);
    };
    new Function('require', 'module', 'exports', js)(requireLocal, modulo, modulo.exports);
    return modulo.exports;
  }

  return {
    cargar: <T>(ruta: string, ref?: string | null) => cargarModulo(ruta, ref ?? null) as unknown as T,
    lecturas,
    batches,
    reset: () => { lecturas.length = 0; batches.length = 0; autoId = 0; },
  };
}

/** El sentinel de serverTimestamp() del SDK cliente. */
export const esServerTimestamp = (v: unknown) => (v as { _methodName?: string } | null)?._methodName === 'serverTimestamp';
