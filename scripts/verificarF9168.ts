// F9.168 arreglo 2 — el caso real + no regresión sobre TODOS los comprobantes.
//
// El guard se evalúa con la MISMA condición del fuente, extraída de `functions/src/index.ts`: si
// alguien cambia la línea, este script se rompe en vez de mentir. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import * as fs from 'node:fs';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
let ok = 0, fail = 0;
const chk = (r: string, c: boolean, d = '') => {
  if (c) { ok++; console.log(`  OK   ${r}${d ? ' — ' + d : ''}`); }
  else { fail++; console.log(`  FAIL ${r}${d ? ' — ' + d : ''}`); }
};

// ── la condición REAL del guard, leída del fuente ────────────────────────────
const src = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
const LINEA_GUARD = 'const impaga = obligacionesDelMes.find(m => !m.confirmadoPago && !m.origenComprobanteId);';
const LINEA_VIEJA = 'const impaga = obligacionesDelMes.find(m => !m.confirmadoPago);';
const tieneGuard = src.includes(LINEA_GUARD);
if (!tieneGuard && !src.includes(LINEA_VIEJA)) {
  throw new Error('no encontré la línea de rama 1 en functions/src/index.ts — el script quedó desactualizado');
}
/** Réplica de la elección de rama 1, con y sin el guard, para poder diffear. */
const eligeImpaga = (obligs: any[], conGuard: boolean) =>
  obligs.find(m => !m.confirmadoPago && (!conGuard || !m.origenComprobanteId));

const aDate = (v: unknown) => v instanceof Timestamp ? v.toDate() : new Date(0);
/**
 * El mes que usa matchPorDestino, replicando `mesDePago` (functions/src/index.ts:58): sale del
 * PRIMER VENCIMIENTO y solo cae a `fecha` si no hay. Mi primer barrido usaba `fecha` a secas y por
 * eso daba "0 cambian" incluso en el caso real, donde `fecha` es null y el mes vive en el
 * vencimiento. Un barrido que no reproduce el mes real no mide la no regresión, la simula.
 */
const mesDePago = (dt: any): string | null =>
  (typeof dt?.vencimientos?.[0]?.fecha === 'string' ? dt.vencimientos[0].fecha.slice(0, 7) : null)
  ?? (typeof dt?.fecha === 'string' ? dt.fecha.slice(0, 7) : null);
function ventanaMes(mes: string, k: number): string {
  const [a, m] = mes.split('-').map(Number);
  const d = new Date(a, m - 1 + k, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  console.log(`F9.168 arreglo 2 — verificación. Guard en el fuente: ${tieneGuard ? 'PUESTO' : 'NO PUESTO'}\n`);

  const comps = await db.collection('comprobantes').get();
  const movs = (await db.collection('movimientos').get()).docs.map(d => ({ id: d.id, ...d.data() })) as any[];
  const items = new Map((await db.collection('itemsEsperados').get()).docs.map(d => [d.id, d.data()]));
  const nombreItem = (id: string) => {
    const i = items.get(id);
    return i ? `${s(i.categoria)} > ${s(i.subcategoria)}` : id.slice(0, 10);
  };

  // ── 1. EL CASO REAL ────────────────────────────────────────────────────────
  console.log('=== 1. el caso real: la boleta de $23.301,99 contra la obligación de $51.672,34 ===');
  const compChico = comps.docs.find(d => Math.abs(Number(d.data().datosExtraidos?.montoTotal ?? 0) - 23301.99) < 0.01)!;
  const obligGrande = movs.find(m => Math.abs(Number(m.monto ?? 0) - 51672.34) < 0.01)!;
  console.log(`  comprobante ${compChico.id.slice(0, 14)} | monto ${s(compChico.data().datosExtraidos?.montoTotal)}`);
  console.log(`  obligación  ${String(obligGrande.id).slice(0, 14)} | monto ${s(obligGrande.monto)} | item ${nombreItem(s(obligGrande.itemEsperadoId))}`);
  console.log(`              confirmadoPago=${s(obligGrande.confirmadoPago)} | origenComprobanteId=${s(obligGrande.origenComprobanteId).slice(0, 14)}…`);

  // el conjunto que ve matchPorDestino: mismo item + mismo mes
  const itemId = s(obligGrande.itemEsperadoId);
  const mes = s(obligGrande.mes);
  const obligs = movs.filter(m => s(m.itemEsperadoId) === itemId && s(m.mes) === mes);
  const antes = eligeImpaga(obligs, false);
  const desp  = eligeImpaga(obligs, true);
  console.log(`  obligaciones del ítem+mes: ${obligs.length}`);
  console.log(`  SIN el guard → rama 1 contra ${antes ? `${String(antes.id).slice(0, 14)} ($${antes.monto})` : 'ninguna (cae a rama 2)'}`);
  console.log(`  CON el guard → rama 1 contra ${desp  ? `${String(desp.id).slice(0, 14)} ($${desp.monto})`  : 'ninguna (cae a rama 2 esAdicional)'}`);
  chk('SIN el guard la boleta chica reconciliaba la obligación grande',
      !!antes && Math.abs(Number(antes.monto) - 51672.34) < 0.01);
  chk('CON el guard NO reconcilia: cae a rama 2 esAdicional', !desp);

  // ── 2. NO REGRESIÓN sobre todos los comprobantes ───────────────────────────
  console.log('\n=== 2. no regresión: qué comprobantes cambian de rama con el guard puesto ===');
  console.log('comprobante | monto        | item                        | antes            | después');
  let cambian = 0, evaluados = 0, sinMes = 0;
  const filas: string[] = [];
  for (const d of comps.docs) {
    const dt = d.data().datosExtraidos;
    const pm = d.data().propuestaMatch;
    if (!dt || !pm) continue;
    // Solo importan los que hoy resuelven por destino con ítem: es donde vive rama 1.
    if (!pm.origenDestino || !pm.itemEsperadoId) continue;
    evaluados++;
    const it = s(pm.itemEsperadoId);
    const mm = mesDePago(dt);
    if (!mm) { sinMes++; continue; }        // sin mes no hay ventana que reproducir
    {
      // La obligación que el propio comprobante creó NO existía cuando se calculó su propuesta.
      // Incluirla es anacrónico: el replay compararía el comprobante contra su propia creación y
      // marcaría un cambio de rama que nunca pudo ocurrir. Medido: sin esta exclusión daban 6
      // cambios y 5 eran este artefacto (los 5 tienen `rama 2` hoy, nunca pasaron por rama 1).
      const obl = movs.filter(x => s(x.itemEsperadoId) === it && s(x.mes) === mm
        && s(x.origenComprobanteId) !== d.id);
      const a = eligeImpaga(obl, false);
      const b = eligeImpaga(obl, true);
      const ramaAntes = a ? 'rama 1' : (obl.length === 0 ? 'rama 2' : 'rama 2 esAdicional');
      const ramaDesp  = b ? 'rama 1' : (obl.length === 0 ? 'rama 2' : 'rama 2 esAdicional');
      if (ramaAntes !== ramaDesp) {
        cambian++;
        filas.push(`${d.id.slice(0, 11)} | ${String(s(dt.montoTotal)).padStart(12)} | ${nombreItem(it).padEnd(27)} | ${ramaAntes.padEnd(16)} | ${ramaDesp}`);
      }
    }
  }
  for (const f of filas) console.log(f);
  if (filas.length === 0) console.log('  (ninguno cambia)');
  console.log(`\n  comprobantes con propuesta por destino y con ítem: ${evaluados} de ${comps.size}`);
  console.log(`  cambian de rama con el guard puesto:               ${cambian}   | sin mes derivable: ${sinMes}`);

  // ── 3. ¿alguno de los que cambia estaba BIEN antes? ────────────────────────
  console.log('\n=== 3. de los que cambian, ¿alguno estaba bien? ===');
  console.log('  Un cambio rama 1 → rama 2 esAdicional está BIEN si la obligación que iba a saldar');
  console.log('  tiene un monto distinto (era otra factura). Está MAL si coincide en monto.');
  let sospechosos = 0;
  for (const d of comps.docs) {
    const dt = d.data().datosExtraidos; const pm = d.data().propuestaMatch;
    if (!dt || !pm?.origenDestino || !pm.itemEsperadoId) continue;
    const it = s(pm.itemEsperadoId);
    const m = mesDePago(dt); if (!m) continue;
    const obl = movs.filter(x => s(x.itemEsperadoId) === it && s(x.mes) === m
      && s(x.origenComprobanteId) !== d.id);
    const a = eligeImpaga(obl, false); const b = eligeImpaga(obl, true);
    if (!a || b) continue;                       // no cambia
    const monto = Number(dt.montoTotal ?? 0);
    // Se separan las dos formas de "coincidir" a propósito. `montoSalda` acepta las dos, pero
    // aportan evidencia MUY distinta:
    //   · por CABECERA: la obligación vale lo mismo que el comprobante → probablemente era la suya.
    //   · solo por VENCIMIENTOS: el importe de cabecera NO coincide, y el vencimiento sí. En el
    //     caso real eso es circular: `confirmarRama1` PISÓ los `vencimientos` de la obligación con
    //     los de la segunda boleta al reconciliarla mal, así que "coincide" con un dato que
    //     escribió el propio bug. Medido: la obligación tiene monto 51.672,34 y
    //     vencimientos [{monto: 23301.99, fecha: 2026-09-24}], que son los de la OTRA factura.
    const coincidePorMonto = Math.abs(Number(a.monto) - monto) < 0.01;
    const coincidePorVenc = !coincidePorMonto
      && ((a.vencimientos ?? []) as any[]).some(v => typeof v?.monto === 'number' && Math.abs(v.monto - monto) < 0.01);
    if (coincidePorVenc) {
      console.log(`  ~~~ ${d.id.slice(0, 14)} monto ${monto} NO coincide con la cabecera de ${String(a.id).slice(0, 14)} (${a.monto}),`);
      console.log(`      pero sí con sus vencimientos ${JSON.stringify(a.vencimientos)} — que los pisó la reconciliación equivocada`);
      continue;
    }
    if (coincidePorMonto) {
      sospechosos++;
      console.log(`  >>> ${d.id.slice(0, 14)} monto ${monto} COINCIDE con la obligación ${String(a.id).slice(0, 14)} (${a.monto}) — revisar`);
    } else {
      console.log(`  OK  ${d.id.slice(0, 14)} monto ${monto} vs obligación ${a.monto} — montos distintos, era otra factura`);
    }
  }
  chk('ninguno de los que cambia coincidía en monto (o sea, ninguno estaba bien)', sospechosos === 0,
      `${sospechosos} sospechosos`);

  console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
