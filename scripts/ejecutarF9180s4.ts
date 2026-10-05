// F9.180 §4 — saca de 2a0f81f8 (GAL-VISA 2026-10) el ajuste manual "dolares que estan en negativo".
//
//   npx tsx scripts/ejecutarF9180s4.ts             → DRY-RUN: muestra el antes y el después, no escribe
//   npx tsx scripts/ejecutarF9180s4.ts --aplicar   → escribe. Lo corre Juan DESPUÉS del deploy de F9.180
//
// El ajuste (2026-10-05 13:09:54, ARS −149,96 / USD −14,69) tapaba dos cosas: el arrastre USD del
// mes anterior, que F9.180 §1 resuelve, y el reverso de 149,96 destildado por error. Con §1 sobra
// entero: si queda, el USD cuenta el saldo dos veces. La UI no tiene cómo borrar un ajuste.
//
// Busca EXACTAMENTE uno: origen 'manual', montoARS −149,96, montoUSD −14,69, creadoEn 2026-10-05 13:09
// (hora AR). Si no hay exactamente 1, aborta. Lo saca de `ajustesConsolidado` y no toca nada más.
// Antes y después imprime los ajustes y el cuadre con el calcularCuadre NUEVO sobre las líneas
// guardadas (reverso tildado). Si el después no cuadra en las dos monedas, no escribe.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { crearSim } from './simConfirmarResumen';
import type { AjusteConsolidado, CardStatement, MovimientoParseado } from '../src/types';
import type { CuadreResult } from '../src/datos/resumenesTarjeta';

const APLICAR = process.argv.includes('--aplicar');
const PREFIJO = '2a0f81f8';
const OBJETIVO = { montoARS: -149.96, montoUSD: -14.69, creadoEnAR: '2026-10-05 13:09' };

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
type RTMod = {
  docACardStatement: (id: string, data: FirebaseFirestore.DocumentData) => CardStatement;
  calcularCuadre: (l: MovimientoParseado[], tARS: number, tUSD: number, aj: AjusteConsolidado[], c?: CardStatement | null) => CuadreResult;
};
const RT = crearSim(db).cargar<RTMod>('src/datos/resumenesTarjeta.ts');

const casi = (a: unknown, b: number) => typeof a === 'number' && Math.abs(a - b) < 0.005;
const enAR = (iso: unknown) => (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))
  ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' })
  : String(iso));
const num = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function mostrar(titulo: string, r: CardStatement, ajustes: AjusteConsolidado[]): CuadreResult {
  console.log(`--- ${titulo} ---`);
  console.log(`  ajustesConsolidado: ${ajustes.length}`);
  ajustes.forEach((a, i) => console.log(`    [${i}] origen=${a.origen ?? 'pdf'} ARS=${a.montoARS} USD=${a.montoUSD} creadoPor=${a.creadoPor ?? '-'} ` +
    `creadoEn=${enAR(a.creadoEn)} concepto=${JSON.stringify(a.concepto)}`));
  const c = RT.calcularCuadre(r.movimientosParseados, r.totalARS, r.totalUSD, ajustes, r);
  console.log(`  cuadre ARS: objetivo=${num(c.objetivoARS)} suma=${num(c.sumaARS)} diff=${num(c.diffARS)} balance=${c.balanceARS}`);
  console.log(`  cuadre USD: objetivo=${num(c.objetivoUSD)} (neto ${num(c.netoUSD)} − arrastre ${num(c.arrastreUSD)}) suma=${num(c.sumaUSD)} diff=${num(c.diffUSD)} balance=${c.balanceUSD}`);
  return c;
}

async function main() {
  console.log(`F9.180 §4 — ${APLICAR ? '=== MODO ESCRITURA (--aplicar) ===' : 'dry-run (sin --aplicar: no escribe nada)'}\n`);
  const snap = await db.collection('resumenesTarjeta').get();
  const docs = snap.docs.filter(d => d.id.startsWith(PREFIJO));
  if (docs.length !== 1) throw new Error(`se esperaba 1 resumen ${PREFIJO}…, hay ${docs.length}. Aborta.`);
  const ref = docs[0].ref;
  const r = RT.docACardStatement(docs[0].id, docs[0].data());
  console.log(`resumen ${PREFIJO} · ${r.tarjetaCodigo} ${r.periodo} · estado=${r.estado} · líneas=${r.movimientosParseados.length}` +
    ` (incluir=${r.movimientosParseados.filter(l => l.incluir).length}) · reverso 149,96 tildado: ` +
    `${r.movimientosParseados.some(l => l.tipoLinea === 'reverso' && casi(l.monto, 149.96) && l.incluir) ? 'sí' : 'NO'}\n`);

  const ajustes = r.ajustesConsolidado;
  const candidatos = ajustes
    .map((a, i) => ({ a, i }))
    .filter(({ a }) => a.origen === 'manual' && casi(a.montoARS, OBJETIVO.montoARS) && casi(a.montoUSD, OBJETIVO.montoUSD)
      && enAR(a.creadoEn).startsWith(OBJETIVO.creadoEnAR));
  if (candidatos.length !== 1) {
    throw new Error(`se esperaba exactamente 1 ajuste manual ARS ${OBJETIVO.montoARS} / USD ${OBJETIVO.montoUSD} del ` +
      `${OBJETIVO.creadoEnAR}, hay ${candidatos.length}. Aborta sin escribir.`);
  }
  const { i: idx } = candidatos[0];
  const despues = ajustes.filter((_, i) => i !== idx);

  mostrar('ANTES', r, ajustes);
  console.log('');
  const c = mostrar(`DESPUÉS (sin el ajuste [${idx}])`, r, despues);
  const cuadra = c.balanceARS && c.balanceUSD;
  console.log(`\n  el después cuadra en las dos monedas: ${cuadra ? 'sí' : 'NO'}`);
  if (!cuadra) throw new Error('el después no cuadra: no se escribe nada. Revisar antes de seguir.');

  if (!APLICAR) {
    console.log('\n(dry-run: no se escribió nada. Para escribir, después del deploy: --aplicar)');
    return;
  }

  // Escritura: en una transacción, y solo si el array sigue siendo el que se leyó recién.
  await db.runTransaction(async tx => {
    const actual = await tx.get(ref);
    const ahora = (actual.data()?.ajustesConsolidado ?? []) as AjusteConsolidado[];
    if (JSON.stringify(ahora) !== JSON.stringify(ajustes)) throw new Error('ajustesConsolidado cambió desde la lectura. Aborta.');
    tx.update(ref, { ajustesConsolidado: despues });
  });
  console.log('\n=== ESCRITO ===');
  const releido = await ref.get();
  mostrar('RE-LEÍDO DE FIRESTORE', RT.docACardStatement(releido.id, releido.data()!), (releido.data()!.ajustesConsolidado ?? []) as AjusteConsolidado[]);
}

main().then(() => process.exit(0)).catch(e => { console.error(`\n>>> ${(e as Error).message}`); process.exit(1); });
