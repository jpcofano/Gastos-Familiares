// F9.196 H5 — importación de la `tesis` del Chat 2 a `tesisPosicion/{ticker}`.
// Un campo con `editadoPorJuan` no se pisa: si el chat trae otro valor, queda en `distintoDelChat`
// ("dato del chat distinto: X"). Un informe viejo, sin `tesis`, importa igual que siempre: acá no
// hay nada que hacer.
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { normalizarTesis, fusionarTesis, type DocTesis, type Tesis } from './compartido/tesis';

/** PURO: las tesis que vienen en `posiciones.analisis[]` (las entradas sin `tesis` se ignoran). */
export function tesisDeItems(items: Array<{ ticker?: unknown; tesis?: unknown; resultado?: unknown }>): {
  tesis: Array<{ ticker: string; tesis: Tesis; ratioAusente?: boolean }>; avisos: string[];
} {
  const out: Array<{ ticker: string; tesis: Tesis; ratioAusente?: boolean }> = [];
  const avisos: string[] = [];
  for (const it of items) {
    if (typeof it.ticker !== 'string' || !it.ticker) continue;
    // Error típico del LLM: la tesis adentro de "resultado" en vez de al lado. Se acepta y se avisa.
    const dentro = (it.resultado && typeof it.resultado === 'object') ? (it.resultado as Record<string, unknown>).tesis : undefined;
    const cruda = it.tesis !== undefined ? it.tesis : dentro;
    if (cruda === undefined) continue;
    if (it.tesis === undefined) avisos.push(`${it.ticker}: la tesis vino dentro de "resultado" (va al lado); se importó igual`);
    if (it.ticker.includes('/')) { avisos.push(`${it.ticker}: ticker inválido para guardar la tesis`); continue; }
    const r = normalizarTesis(cruda);
    avisos.push(...r.avisos.map(a => `${it.ticker}: ${a}`));
    if (r.tesis) out.push({ ticker: it.ticker, tesis: r.tesis, ratioAusente: r.ratioAusente });
  }
  return { tesis: out, avisos };
}

export async function importarTesis(
  db: Firestore,
  items: Array<{ ticker?: unknown; tesis?: unknown; resultado?: unknown }>,
  meta: Record<string, unknown>,
): Promise<{ importadas: number; distintos: number; avisos: string[] }> {
  const { tesis, avisos } = tesisDeItems(items);
  let distintos = 0;
  for (const { ticker, tesis: delChat, ratioAusente } of tesis) {
    const ref = db.collection('tesisPosicion').doc(ticker);
    // En una transacción: una edición de Juan hecha entre la lectura y la escritura no se pierde.
    // `mergeFields`: esos campos se reemplazan enteros (se van las claves viejas de distintoDelChat)
    // y lo demás del documento (`editadoEn`) queda.
    distintos += await db.runTransaction(async tx => {
      const previo = (await tx.get(ref)).data() as DocTesis | undefined;
      const doc = fusionarTesis(previo ?? null, ticker, delChat, { ratioAusente });
      tx.set(ref, {
        ...JSON.parse(JSON.stringify(doc)),
        delChat: JSON.parse(JSON.stringify(delChat)),
        importadoEn: FieldValue.serverTimestamp(),
        generadoEnISO: meta.generadoEnISO ?? null,
      }, { mergeFields: ['ticker', 'tesis', 'editadoPorJuan', 'distintoDelChat', 'gatillosEditados', 'gatillosDistintos', 'delChat', 'importadoEn', 'generadoEnISO'] });
      return Object.keys(doc.distintoDelChat).length;
    });
  }
  return { importadas: tesis.length, distintos, avisos };
}
