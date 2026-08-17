// Reproduce el bug y verifica el fix contra la tcParaFecha REAL (bundleada con esbuild),
// no contra una reimplementacion. Stubea firebase/firestore para poder romper la consulta
// ordenada a voluntad, que es lo que hace un indice ausente.
import esbuild from 'esbuild';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs';

const OUT = path.join(process.env.TMP || '/tmp', 'f9146-bundle.mjs');

// Datos: tcDiario con huecos de fin de semana. 2026-08-15 y 16 son sabado y domingo.
const DOCS = {
  '2026-08-12': 1449,
  '2026-08-13': 1451,
  '2026-08-14': 1454,
  '2026-08-17': 1460,
};

const stub = `
export const collection = (_db, name) => ({ __kind: 'collection', name });
export const doc = (_db, name, id) => ({ __kind: 'doc', name, id });
export const query = (col, ...cs) => ({ __kind: 'query', col, cs });
export const orderBy = () => ({ t: 'orderBy' });
export const limit = (n) => ({ t: 'limit', n });
export const documentId = () => '__name__';
export const startAt = (v) => ({ t: 'startAt', v });
export const getDoc = async (ref) => {
  const v = globalThis.__DOCS[ref.id];
  return { exists: () => v !== undefined, data: () => ({ tcUsdArs: v }) };
};
export const getDocs = async (arg) => {
  if (arg.__kind === 'query') {
    if (globalThis.__ORDENADA_ROTA) {
      const e = new Error('The query requires an index. FAILED_PRECONDITION');
      e.code = 'failed-precondition';
      throw e;
    }
    const desde = arg.cs.find(c => c && c.t === 'startAt')?.v;
    const ids = Object.keys(globalThis.__DOCS).sort().reverse().filter(id => id <= desde);
    const docs = ids.slice(0, 1).map(id => ({ id, data: () => ({ tcUsdArs: globalThis.__DOCS[id] }) }));
    return { empty: docs.length === 0, docs };
  }
  if (globalThis.__COLECCION_ROTA) {
    const e = new Error('Missing or insufficient permissions.');
    e.code = 'permission-denied';
    throw e;
  }
  const docs = Object.keys(globalThis.__DOCS).map(id => ({ id, data: () => ({ tcUsdArs: globalThis.__DOCS[id] }) }));
  return { empty: docs.length === 0, docs };
};
export const where = () => ({});
export const endAt = (v) => ({ t: 'endAt', v });
export const setDoc = async () => {};
export const addDoc = async () => ({ id: 'x' });
export const updateDoc = async () => {};
export const deleteDoc = async () => {};
export const writeBatch = () => ({ set(){}, update(){}, delete(){}, commit: async () => {} });
export const onSnapshot = () => () => {};
export const serverTimestamp = () => new Date();
export const arrayUnion = (...v) => v;
export const Timestamp = { fromDate: d => d, now: () => new Date() };
`;

const plugin = {
  name: 'stubs',
  setup(build) {
    build.onResolve({ filter: /^firebase\/(firestore|functions|app)$/ }, a => ({ path: a.path, namespace: 'stub' }));
    build.onResolve({ filter: /firebase$/ }, a => (a.importer.includes('src') ? { path: a.path, namespace: 'stub' } : null));
    build.onLoad({ filter: /.*/, namespace: 'stub' }, a => ({
      contents: a.path.includes('firestore') ? stub
        : a.path.includes('functions') ? 'export const httpsCallable = () => async () => ({ data: {} });'
        : 'export const db = {}; export const functions = {}; export const app = {};',
      loader: 'js',
    }));
  },
};

await esbuild.build({
  entryPoints: ['src/datos/tcDiario.ts'],
  bundle: true, format: 'esm', outfile: OUT, plugins: [plugin], logLevel: 'error',
});

globalThis.localStorage = { getItem: () => null, setItem: () => {} };
const { tcParaFecha, cargarTCReciente } = await import(pathToFileURL(OUT).href);

let fallos = 0;
const chequear = (nombre, real, esperado) => {
  const ok = JSON.stringify(real) === JSON.stringify(esperado);
  if (!ok) fallos++;
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${nombre}  -> ${JSON.stringify(real)}${ok ? '' : ` (esperado ${JSON.stringify(esperado)})`}`);
};

globalThis.__DOCS = DOCS;

// ── Caso 1: todo sano, fecha con doc exacto ────────────────────────────────────
globalThis.__ORDENADA_ROTA = false; globalThis.__COLECCION_ROTA = false;
chequear('fecha con doc exacto', await tcParaFecha(new Date('2026-08-14T12:00:00Z')), 1454);

// ── Caso 2: todo sano, fecha SIN doc (domingo) -> cae al anterior ──────────────
chequear('domingo sin doc, consulta ordenada OK', await tcParaFecha(new Date('2026-08-16T12:00:00Z')), 1454);

// ── Caso 3: EL BUG. Consulta ordenada rota (indice ausente), fecha sin doc ─────
globalThis.__ORDENADA_ROTA = true;
let resultado, rechazo = null;
try { resultado = await tcParaFecha(new Date('2026-08-16T12:00:00Z')); }
catch (e) { rechazo = e; }
chequear('consulta ordenada rota: NO rechaza', rechazo, null);
chequear('consulta ordenada rota: cae al fallback y da el TC del viernes', resultado, 1454);

// ── Caso 4: fallback tambien reusado por cargarTCReciente (misma red) ──────────
const recientes = await cargarTCReciente(2);
chequear('cargarTCReciente usa el mismo fallback', recientes.map(r => r.fecha), ['2026-08-17', '2026-08-14']);

// ── Caso 5: fecha anterior a todo el historial -> null, no excepcion ───────────
chequear('fecha previa al historial con fallback', await tcParaFecha(new Date('2020-01-01T12:00:00Z')), null);

// ── Caso 6: TODO roto (no es el indice: reglas/red). Ahi si tiene que rechazar,
// para que el try/catch del wizard lo muestre en pantalla en vez de tragarlo.
globalThis.__COLECCION_ROTA = true;
let rechazo2 = null;
try { await tcParaFecha(new Date('2026-08-16T12:00:00Z')); } catch (e) { rechazo2 = e; }
chequear('coleccion tambien rota: rechaza (para que el wizard lo muestre)', rechazo2 !== null, true);
console.log(`     mensaje que llega crudo a pantalla: "${rechazo2?.message}"`);

fs.rmSync(OUT, { force: true });
console.log(`\n${fallos === 0 ? 'TODOS OK' : `${fallos} FALLOS`}`);
process.exit(fallos === 0 ? 0 : 1);
