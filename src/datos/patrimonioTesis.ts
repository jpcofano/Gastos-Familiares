// F9.196 H5 — `tesisPosicion/{ticker}`: lectura y edición de Juan desde la ficha. La importación del
// Chat 2 la escribe `importarAnalisisIA` (functions/), que respeta los campos `editadoPorJuan`.
// La lógica (fusión, edición, cálculos y señales) está en ./compartido/tesis.
import { collection, deleteField, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { CAMPOS_TESIS, type DocTesis } from './compartido/tesis';

export async function cargarTesis(ticker: string): Promise<DocTesis | null> {
  const snap = await getDoc(doc(db, 'tesisPosicion', ticker));
  return snap.exists() ? (snap.data() as DocTesis) : null;
}

export async function cargarTodasLasTesis(): Promise<Record<string, DocTesis>> {
  const snap = await getDocs(collection(db, 'tesisPosicion'));
  return Object.fromEntries(snap.docs.map(d => [d.id, d.data() as DocTesis]));
}

const limpio = (v: unknown) => (v === undefined ? null : JSON.parse(JSON.stringify(v)));

/**
 * Guarda de una vez todas las ediciones de la ficha (`antes` → `despues`, armado con editarTesis,
 * editarValorGatillo o aceptarDatoDelChat). Un solo updateDoc y solo de lo que cambió (rutas
 * `tesis.<campo>`, `editadoPorJuan.<campo>`, …): o queda todo o nada, y lo demás del documento —una
 * importación más nueva que la copia de la ficha, `importadoEn`— no se toca.
 */
export async function guardarTesis(antes: DocTesis, despues: DocTesis): Promise<DocTesis> {
  const cambios: Record<string, unknown> = {};
  const igual = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  for (const c of CAMPOS_TESIS) {
    if (!igual(antes.tesis[c], despues.tesis[c])) cambios[`tesis.${c}`] = limpio(despues.tesis[c]);
    if (!!antes.editadoPorJuan?.[c] !== !!despues.editadoPorJuan?.[c]) cambios[`editadoPorJuan.${c}`] = despues.editadoPorJuan?.[c] ? true : deleteField();
    const da = antes.distintoDelChat ?? {}, dd = despues.distintoDelChat ?? {};
    if ((c in da) !== (c in dd) || !igual(da[c], dd[c])) cambios[`distintoDelChat.${c}`] = c in dd ? limpio(dd[c]) : deleteField();
  }
  // Las claves de gatillo tienen puntos (el umbral): los dos mapas se escriben enteros.
  if (!igual(antes.gatillosEditados, despues.gatillosEditados)) cambios.gatillosEditados = limpio(despues.gatillosEditados ?? {});
  if (!igual(antes.gatillosDistintos, despues.gatillosDistintos)) cambios.gatillosDistintos = limpio(despues.gatillosDistintos ?? {});
  if (Object.keys(cambios).length === 0) return despues;
  await updateDoc(doc(db, 'tesisPosicion', antes.ticker), { ...cambios, editadoEn: serverTimestamp() });
  return despues;
}
