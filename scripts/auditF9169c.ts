// F9.169 §2.5 — AUDITORÍA DEL ANCLAJE TEMPORAL. Solo lectura, no toca nada.
//
// La regla nueva dice: un documento de obligación cuyo PRIMER VENCIMIENTO todavía no venció no es
// un pago. La pregunta que hay que contestar antes de escribir el código: "todavía no venció"
// ¿contra qué fecha? Hay dos candidatos y para un comprobante re-extraído dan resultados distintos:
//
//   (a) HOY — la fecha en que corre el trigger.
//   (b) subidoEn — la fecha en que se subió el comprobante. Es el anclaje que eligió F9.154 para
//       `corregirAnioVencimientos`, con este fundamento textual:
//         "es el único anclaje temporal confiable que tenemos (el documento puede no traer emisión
//          — 6 de 132 comprobantes tienen `fecha: null`)".
//
// Este script mide cuántos comprobantes de producción clasifican distinto bajo cada anclaje.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'node:fs';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

// La lista de tipos se lee del FUENTE, no se recopia: si alguien agrega un tipo de obligación y
// este script sigue con la lista vieja, la medición miente en silencio.
const src = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
const mFn = src.match(/function esObligacionDoc\(tipo\?: string \| null\): boolean \{([\s\S]*?)\n\}/);
if (!mFn) throw new Error('no encontré esObligacionDoc en functions/src/index.ts');
const TIPOS_OBLIGACION = [...mFn[1].matchAll(/tipo === '([a-z_]+)'/g)].map(x => x[1]);
const esObligacionDoc = (t?: string | null) => TIPOS_OBLIGACION.includes(String(t ?? ''));

/** Un día calendario en ISO, sin hora: la comparación es por día, no por instante. */
const dia = (d: Date) => d.toISOString().slice(0, 10);

async function main() {
  console.log('F9.169 §2.5 — anclaje temporal de "futuro". SOLO LECTURA.\n');
  console.log(`tipos de obligación leídos del fuente: ${TIPOS_OBLIGACION.join(', ')}\n`);

  const hoy = dia(new Date());
  const comps = await db.collection('comprobantes').get();

  let obligaciones = 0, sinVenc = 0, sinSubidoEn = 0, difieren = 0;
  let futuroHoy = 0, futuroSubida = 0;
  const filas: string[] = [];
  const filasDif: string[] = [];

  for (const d of comps.docs) {
    const dt = d.data().datosExtraidos;
    if (!dt) continue;
    if (!esObligacionDoc(dt.tipoDocumento)) continue;
    obligaciones++;

    const v0 = dt.vencimientos?.[0]?.fecha;
    if (typeof v0 !== 'string' || v0.length < 10) { sinVenc++; continue; }
    const venc = v0.slice(0, 10);

    const subidoEnTs = d.data().subidoEn as Timestamp | undefined;
    if (!subidoEnTs) sinSubidoEn++;
    // Mismo fallback que el call site de F9.154 (`index.ts:259`): sin `subidoEn`, `new Date()`.
    const subida = dia(subidoEnTs ? subidoEnTs.toDate() : new Date());

    // "Futuro" = el vencimiento es POSTERIOR a la referencia. El día del vencimiento NO es futuro:
    // la boleta que vence hoy ya es exigible.
    const fHoy = venc > hoy;
    const fSub = venc > subida;
    if (fHoy) futuroHoy++;
    if (fSub) futuroSubida++;

    const diasEntre = Math.round(
      (new Date(hoy + 'T00:00:00Z').getTime() - new Date(subida + 'T00:00:00Z').getTime()) / 86400000,
    );
    filas.push(
      `${d.id.slice(0, 12)} | ${String(s(dt.tipoDocumento)).padEnd(16)} | venc ${venc} | subido ${subida} (hace ${String(diasEntre).padStart(3)}d) | ` +
      `hoy:${fHoy ? 'FUT' : 'ven'} subida:${fSub ? 'FUT' : 'ven'}${fHoy !== fSub ? '  <<< DIFIEREN' : ''}`,
    );
    if (fHoy !== fSub) {
      difieren++;
      filasDif.push(
        `  ${d.id.slice(0, 14)} | ${s(dt.comercioRazonSocial).slice(0, 28).padEnd(28)} | monto ${s(dt.montoTotal)}\n` +
        `      vence ${venc} · subido ${subida} · hoy ${hoy}\n` +
        `      con anclaje HOY    → ${fHoy ? 'obligación futura (la regla lo frena)' : 'ya venció (la regla NO aplica)'}\n` +
        `      con anclaje SUBIDA → ${fSub ? 'obligación futura (la regla lo frena)' : 'ya venció (la regla NO aplica)'}`,
      );
    }
  }

  console.log('=== todas las obligaciones con primer vencimiento ===');
  console.log('comprobante  | tipo             | vencimiento     | subida                    | clasificación');
  for (const f of filas) console.log(f);

  console.log(`\n  comprobantes totales:                       ${comps.size}`);
  console.log(`  documentos de obligación:                   ${obligaciones}`);
  console.log(`    sin vencimientos[0].fecha (fuera):        ${sinVenc}`);
  console.log(`    sin subidoEn (caen al fallback new Date): ${sinSubidoEn}`);
  console.log(`    "futuro" contra HOY:                      ${futuroHoy}`);
  console.log(`    "futuro" contra SUBIDA:                   ${futuroSubida}`);
  console.log(`    CLASIFICAN DISTINTO:                      ${difieren}   ← el número de la pregunta`);

  if (filasDif.length) {
    console.log('\n=== los que difieren, uno por uno ===');
    for (const f of filasDif) console.log(f);
  } else {
    console.log('\n  (ninguno difiere hoy — ver la nota del reporte sobre por qué eso NO cierra la pregunta)');
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
