// F9.196 H5 — `tesisPosicion/{ticker}`: lectura y edición de Juan desde la ficha. La importación del
// Chat 2 la escribe `importarAnalisisIA` (functions/), que respeta los campos `editadoPorJuan`.
// La lógica (fusión, edición, cálculos y señales) está en ./compartido/tesis.
import { collection, doc, getDoc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { editarTesis, type CampoTesis, type DocTesis, type Tesis } from './compartido/tesis';

export async function cargarTesis(ticker: string): Promise<DocTesis | null> {
  const snap = await getDoc(doc(db, 'tesisPosicion', ticker));
  return snap.exists() ? (snap.data() as DocTesis) : null;
}

export async function cargarTodasLasTesis(): Promise<Record<string, DocTesis>> {
  const snap = await getDocs(collection(db, 'tesisPosicion'));
  return Object.fromEntries(snap.docs.map(d => [d.id, d.data() as DocTesis]));
}

/** Guarda una edición de Juan: el campo queda `editadoPorJuan` y la próxima importación no lo pisa. */
export async function guardarEdicionTesis<C extends CampoTesis>(actual: DocTesis, campo: C, valor: Tesis[C]): Promise<DocTesis> {
  const nuevo = editarTesis(actual, campo, valor);
  await setDoc(doc(db, 'tesisPosicion', actual.ticker), {
    ...JSON.parse(JSON.stringify(nuevo)), editadoEn: serverTimestamp(),
  }, { merge: true });
  return nuevo;
}
