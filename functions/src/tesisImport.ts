// F9.196 H5 — importación de la `tesis` del Chat 2 a `tesisPosicion/{ticker}`.
// Un campo con `editadoPorJuan` no se pisa: si el chat trae otro valor, queda en `distintoDelChat`
// ("dato del chat distinto: X"). Un informe viejo, sin `tesis`, importa igual que siempre: acá no
// hay nada que hacer.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { normalizarTesis, fusionarTesis, type DocTesis, type Tesis } from './compartido/tesis';

/** PURO: las tesis que vienen en `posiciones.analisis[]` (las entradas sin `tesis` se ignoran). */
export function tesisDeItems(items: Array<{ ticker?: unknown; tesis?: unknown }>): {
  tesis: Array<{ ticker: string; tesis: Tesis }>; avisos: string[];
} {
  const out: Array<{ ticker: string; tesis: Tesis }> = [];
  const avisos: string[] = [];
  for (const it of items) {
    if (typeof it.ticker !== 'string' || !it.ticker || it.tesis === undefined) continue;
    const r = normalizarTesis(it.tesis);
    avisos.push(...r.avisos.map(a => `${it.ticker}: ${a}`));
    if (r.tesis) out.push({ ticker: it.ticker, tesis: r.tesis });
  }
  return { tesis: out, avisos };
}

export async function importarTesis(
  db: Firestore,
  items: Array<{ ticker?: unknown; tesis?: unknown }>,
  meta: Record<string, unknown>,
): Promise<{ importadas: number; distintos: number; avisos: string[] }> {
  const { tesis, avisos } = tesisDeItems(items);
  let distintos = 0;
  for (const { ticker, tesis: delChat } of tesis) {
    const ref = db.collection('tesisPosicion').doc(ticker);
    const previo = (await ref.get()).data() as DocTesis | undefined;
    const doc = fusionarTesis(previo ?? null, ticker, delChat);
    distintos += Object.keys(doc.distintoDelChat).length;
    await ref.set({
      ...JSON.parse(JSON.stringify(doc)),
      delChat: JSON.parse(JSON.stringify(delChat)),
      importadoEn: FieldValue.serverTimestamp(),
      generadoEnISO: meta.generadoEnISO ?? null,
    });
  }
  return { importadas: tesis.length, distintos, avisos };
}
