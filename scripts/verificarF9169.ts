// F9.169 §2.5 — VOLCADO DE CAMBIO DE RAMA sobre producción, antes de pushear. SOLO LEE.
//
// `esObligacionFutura`, `esCargoAdicional` y `mesImputado` se BUNDLEAN del fuente
// (`functions/src/matchLogica.ts`, que no importa el SDK): son las funciones REALES. Si alguien
// cambia la regla, este script cambia con ella en vez de mentir.
//
// Replica la decisión de rama de `matchPorDestino` con y sin §2.5 y diffea. Dos trampas que ya
// costaron una medición falsa en F9.168 y que acá están cubiertas:
//   · el mes sale de `mesDePago` (primer vencimiento), NO de `datos.fecha` — en el caso real
//     `fecha` es null y el mes vive en el vencimiento;
//   · la obligación que el PROPIO comprobante creó se excluye: no existía cuando se calculó su
//     propuesta, así que incluirla es anacrónico y marca cambios que nunca pudieron ocurrir.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const req = createRequire(process.cwd() + '/functions/package.json');
const esbuild = req('esbuild') as typeof import('esbuild');
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

const tmp = path.join(os.tmpdir(), `f9169-${Date.now()}.cjs`);
esbuild.buildSync({
  entryPoints: ['functions/src/matchLogica.ts'],
  bundle: true, platform: 'node', format: 'cjs', outfile: tmp, logLevel: 'silent',
});
const ml = require(tmp) as {
  esObligacionFutura: (d: any, ref: string) => boolean;
  esObligacionDoc: (t?: string | null) => boolean;
  esCargoAdicional: (o: any[], excl?: string) => boolean;
  mesImputado: (fecha: string | null, dia?: number | null) => string | null;
};

let ok = 0, fail = 0;
const chk = (r: string, c: boolean, d = '') => {
  if (c) { ok++; console.log(`  OK   ${r}${d ? ' — ' + d : ''}`); }
  else { fail++; console.log(`  FAIL ${r}${d ? ' — ' + d : ''}`); }
};

/** Réplica de `mesDePago` (functions/src/index.ts): primer vencimiento, fallback emisión. */
const mesDePago = (dt: any): string | null =>
  (typeof dt?.vencimientos?.[0]?.fecha === 'string' ? dt.vencimientos[0].fecha.slice(0, 7) : null)
  ?? (typeof dt?.fecha === 'string' ? dt.fecha.slice(0, 7) : null);

type Obl = { id: string; confirmadoPago: boolean; origenComprobanteId: string | null };

/** La decisión de rama de `matchPorDestino`, con §2.5 opcional para poder diffear. */
function decidir(dt: any, obl: Obl[], refISO: string, con25: boolean): string {
  if (con25 && ml.esObligacionFutura(dt, refISO)) return 'rama 2 (obligación futura)';
  const impaga = obl.find(m => !m.confirmadoPago && !m.origenComprobanteId);
  if (impaga) return 'rama 1';
  if (obl.length === 0) return 'rama 2';
  return `rama 2 esAdicional=${ml.esCargoAdicional(obl)}`;
}

async function main() {
  console.log('F9.169 §2.5 — qué comprobantes de producción cambian de rama. SOLO LECTURA.\n');

  const comps  = await db.collection('comprobantes').get();
  const movs   = (await db.collection('movimientos').get()).docs.map(d => ({ id: d.id, ...d.data() })) as any[];
  const items  = new Map((await db.collection('itemsEsperados').get()).docs.map(d => [d.id, d.data()]));
  const nombreItem = (id: string) => {
    const i = items.get(id);
    return i ? `${s(i.categoria)} > ${s(i.subcategoria)}` : id.slice(0, 10);
  };

  // ── 1. EL CASO DEL AGUA ────────────────────────────────────────────────────
  console.log('=== 1. el caso del agua: las dos boletas vencen en septiembre ===');
  for (const d of comps.docs) {
    const dt = d.data().datosExtraidos;
    if (!dt) continue;
    const m = Number(dt.montoTotal ?? 0);
    if (Math.abs(m - 23301.99) > 0.01 && Math.abs(m - 51672.34) > 0.01) continue;
    const sub = ((d.data().subidoEn as Timestamp | undefined)?.toDate() ?? new Date()).toISOString().slice(0, 10);
    const fut = ml.esObligacionFutura(dt, sub);
    console.log(`  ${d.id.slice(0, 14)} | ${s(dt.tipoDocumento).padEnd(16)} | monto ${String(m).padStart(10)} | vence ${s(dt.vencimientos?.[0]?.fecha)} | subido ${sub} → obligación futura: ${fut}`);
    chk(`la boleta de $${m} es obligación futura (nunca adicional, nunca rama 1)`, fut === true);
  }

  // ── 2. VOLCADO COMPLETO: quién cambia de rama ──────────────────────────────
  console.log('\n=== 2. volcado: qué comprobantes cambian de rama con §2.5 puesta ===');
  let evaluados = 0, sinMes = 0, cambian = 0;
  const filas: string[] = [];
  const detalle: string[] = [];

  for (const d of comps.docs) {
    const dt = d.data().datosExtraidos;
    const pm = d.data().propuestaMatch;
    if (!dt || !pm) continue;
    // Sólo los que hoy resuelven por destino con ítem: es donde vive esta decisión.
    if (!pm.origenDestino || !pm.itemEsperadoId) continue;
    evaluados++;

    const it = String(pm.itemEsperadoId);
    // `matchPorDestino` recalcula el mes por ítem (F9.154 §3): mesImputado si el ítem tiene
    // diaCorteImputacion, si no el mes del comprobante. Se replica para no medir otra ventana.
    const mm = ml.mesImputado(dt.fecha ?? null, (items.get(it) as any)?.diaCorteImputacion ?? null)
      ?? mesDePago(dt);
    if (!mm) { sinMes++; continue; }

    const obl: Obl[] = movs
      .filter(x => String(x.itemEsperadoId) === it && String(x.mes) === mm && String(x.origenComprobanteId) !== d.id)
      .map(x => ({
        id: x.id,
        confirmadoPago: (x.confirmadoPago as boolean | undefined) ?? false,
        origenComprobanteId: (x.origenComprobanteId as string | null) ?? null,
      }));

    const sub = ((d.data().subidoEn as Timestamp | undefined)?.toDate() ?? new Date()).toISOString().slice(0, 10);
    const antes = decidir(dt, obl, sub, false);
    const desp  = decidir(dt, obl, sub, true);
    if (antes === desp) continue;

    cambian++;
    filas.push(`${d.id.slice(0, 11)} | ${String(s(dt.montoTotal)).padStart(11)} | ${nombreItem(it).padEnd(24)} | ${antes.padEnd(24)} | ${desp}`);
    detalle.push(
      `  ${d.id.slice(0, 14)} | ${s(dt.comercioRazonSocial).slice(0, 30)}\n` +
      `      tipo ${s(dt.tipoDocumento)} · monto ${s(dt.montoTotal)} · vence ${s(dt.vencimientos?.[0]?.fecha)} · subido ${sub} · mes ${mm}\n` +
      `      obligaciones del ítem+mes (sin la que creó él mismo): ${obl.length}` +
      obl.map(o => `\n        - ${o.id.slice(0, 12)} confirmadoPago=${o.confirmadoPago} origenComp=${o.origenComprobanteId ? o.origenComprobanteId.slice(0, 10) + '…' : 'null'}`).join('') +
      `\n      ANTES:   ${antes}\n      DESPUÉS: ${desp}`,
    );
  }

  console.log('comprobante | monto       | item                     | antes                    | después');
  for (const f of filas) console.log(f);
  if (filas.length === 0) console.log('  (ninguno cambia)');
  console.log(`\n  con propuesta por destino y con ítem: ${evaluados} de ${comps.size}   | sin mes derivable: ${sinMes}`);
  console.log(`  cambian de rama con §2.5:             ${cambian}`);

  if (detalle.length) {
    console.log('\n=== 3. los que cambian, uno por uno ===');
    for (const f of detalle) console.log(f);
  }

  // ── 4. ¿ALGUNO QUE HOY ESTÁ BIEN PASA A ESTAR MAL? ─────────────────────────
  //
  // §2.5 sólo puede mover un comprobante HACIA rama 2 no-adicional. Los dos sentidos posibles:
  //   · rama 1 → rama 2: pasa a estar MAL si esa obligación era realmente suya, o sea si el
  //     comprobante la salda. Testigo: que el monto coincida con la obligación que iba a saldar.
  //   · rama 2 esAdicional=true → false: nunca es "mal": §2.5 dice que un documento que no venció
  //     no es un segundo cargo. Es el cambio de comportamiento real.
  //   · rama 2 (sin adicional) → rama 2 (obligación futura): MISMA SALIDA, distinto camino. Hoy es
  //     un no-op y hay que contarlo aparte: mezclarlo con lo anterior inflaría el número de
  //     "cambios" con casos donde no cambia nada, que es cómo el barrido de F9.168 mintió la
  //     primera vez.
  console.log('\n=== 4. ¿alguno que hoy está bien pasa a estar mal? ===');
  let sospechosos = 0, aRama2 = 0, pierdeAdicional = 0, mismaSalida = 0;
  for (const d of comps.docs) {
    const dt = d.data().datosExtraidos; const pm = d.data().propuestaMatch;
    if (!dt || !pm?.origenDestino || !pm.itemEsperadoId) continue;
    const it = String(pm.itemEsperadoId);
    const mm = ml.mesImputado(dt.fecha ?? null, (items.get(it) as any)?.diaCorteImputacion ?? null)
      ?? mesDePago(dt);
    if (!mm) continue;
    const obl: Obl[] = movs
      .filter(x => String(x.itemEsperadoId) === it && String(x.mes) === mm && String(x.origenComprobanteId) !== d.id)
      .map(x => ({ id: x.id, confirmadoPago: (x.confirmadoPago as boolean | undefined) ?? false,
                   origenComprobanteId: (x.origenComprobanteId as string | null) ?? null }));
    const sub = ((d.data().subidoEn as Timestamp | undefined)?.toDate() ?? new Date()).toISOString().slice(0, 10);
    const antes = decidir(dt, obl, sub, false);
    const desp  = decidir(dt, obl, sub, true);
    if (antes === desp) continue;

    if (antes === 'rama 1') {
      aRama2++;
      const impaga = obl.find(m => !m.confirmadoPago && !m.origenComprobanteId)!;
      const movImpaga = movs.find(x => x.id === impaga.id);
      const monto = Number(dt.montoTotal ?? 0);
      const coincide = Math.abs(Number(movImpaga?.monto ?? 0) - monto) < 0.01;
      if (coincide) {
        sospechosos++;
        console.log(`  >>> ${d.id.slice(0, 14)} monto ${monto} COINCIDE con la obligación ${impaga.id.slice(0, 12)} (${s(movImpaga?.monto)}) que dejará de saldar — REVISAR`);
      } else {
        console.log(`  OK  ${d.id.slice(0, 14)} monto ${monto} vs obligación ${s(movImpaga?.monto)} — montos distintos, no era la suya`);
      }
    } else if (antes.includes('esAdicional=true')) {
      pierdeAdicional++;
      console.log(`  ***  ${d.id.slice(0, 14)} DEJA DE SER ADICIONAL (${antes} → ${desp}) — cambio de comportamiento real, y es lo que §2.5 dice`);
    } else {
      mismaSalida++;
      console.log(`  --   ${d.id.slice(0, 14)} misma salida por otro camino (${antes} → ${desp}) — no cambia nada hoy`);
    }
  }
  console.log(`\n  rama 1 → rama 2 (los peligrosos):     ${aRama2}`);
  console.log(`  deja de ser adicional (real):         ${pierdeAdicional}`);
  console.log(`  misma salida, distinto camino (no-op): ${mismaSalida}`);
  chk('ningún comprobante que hoy salda su propia obligación deja de saldarla', sospechosos === 0,
      `${sospechosos} sospechosos`);

  // ── 5. §2 — `esAdicional` se recalcula al reasignar, en las DOS direcciones ─
  //
  // Se corre `esCargoAdicional` REAL sobre el conjunto real de obligaciones que vería la
  // reasignación, para cada ítem destino posible. No es un caso sintético: es la boleta de agua
  // que abrió F9.169, contra los ítems que existen en producción.
  console.log('\n=== 5. §2: reasignar recalcula esAdicional en las dos direcciones ===');
  //
  // EL TESTIGO NO ES EL DE $23.301,99. Ese comprobante se descartó, y `descartarEntrada` no dejó
  // movimiento con ese monto (es el mismo descarte que produjo el fantasma de §1). Buscar por un
  // monto que ya no existe daría "no se pudo correr" y quedaría pareciendo un problema del test.
  // El testigo es la obligación de agua de septiembre que SÍ está viva.
  const itemAgua = [...items.entries()].find(([, v]) => /agua/i.test(String((v as any).subcategoria ?? ''))
    && /casa/i.test(String((v as any).categoria ?? '')))?.[0];
  const movAgua = movs.find(m => String(m.itemEsperadoId) === itemAgua && String(m.mes) === '2026-09');
  if (!movAgua) {
    console.log('  (no hay obligación de Casa › Agua en 2026-09 — el caso testigo no se puede correr)');
  } else {
    console.log(`  testigo: mov ${String(movAgua.id).slice(0, 12)} | $${s(movAgua.monto)} | ${nombreItem(String(movAgua.itemEsperadoId))} | mes ${s(movAgua.mes)}`);
    const mesAgua = String(movAgua.mes ?? '');
    const oblDe = (itemId: string): Obl[] => movs
      .filter(x => String(x.itemEsperadoId) === itemId && String(x.mes) === mesAgua)
      .map(x => ({ id: x.id, confirmadoPago: (x.confirmadoPago as boolean | undefined) ?? false,
                   origenComprobanteId: (x.origenComprobanteId as string | null) ?? null }));

    // Destino SIN obligación de ese mes → deja de ser adicional, por definición.
    const sinObl = [...items.keys()].find(id => oblDe(id).filter(o => o.id !== movAgua.id).length === 0);
    // Destino CON obligación de ese mes (distinta de este movimiento) → pasa a adicional.
    const conObl = [...items.keys()].find(id => {
      const o = oblDe(id).filter(x => x.id !== movAgua.id);
      return o.length > 0 && !o.some(x => !x.confirmadoPago && !x.origenComprobanteId);
    });

    if (sinObl) {
      const r = ml.esCargoAdicional(oblDe(sinObl), movAgua.id);
      console.log(`  destino SIN obligación del mes (${nombreItem(sinObl)}) → esAdicional=${r}`);
      chk('movida a un ítem sin obligación del mes, deja de ser adicional', r === false);
    } else { console.log('  (no hay ítem sin obligación del mes para probar)'); }

    if (conObl) {
      const r = ml.esCargoAdicional(oblDe(conObl), movAgua.id);
      console.log(`  destino CON obligación del mes (${nombreItem(conObl)}) → esAdicional=${r}`);
      chk('movida a un ítem que sí tiene obligación del mes, pasa a adicional', r === true);
    } else { console.log('  (no hay ítem con obligación cubierta del mes para probar)'); }

    // No regresión: excluirse a sí mismo no puede hacer adicional a un movimiento solo.
    chk('un movimiento solo en su ítem+mes nunca es adicional (se excluye a sí mismo)',
        ml.esCargoAdicional([{ id: movAgua.id, confirmadoPago: false, origenComprobanteId: null }], movAgua.id) === false);
  }

  // ── 6. §3 — el comprobante de rama 1 ofrece desvincular ────────────────────
  console.log('\n=== 6. §3: qué comprobantes ofrecen "desvincular y volver a proponer" ===');
  // El predicado del cliente se lee del FUENTE. Si alguien lo cambia, esto se rompe en vez de
  // seguir midiendo una condición que ya no existe.
  const tsx = fs.readFileSync('src/vistas/Comprobantes.tsx', 'utf8').replace(/\r\n/g, '\n');
  const LINEA_PRED = "return pm.rama === 1 && pm.origenReconciliacion === true && !!pm.movimientoId;";
  chk('el predicado `comprobanteReconcilioObligacion` está en Comprobantes.tsx tal como se mide',
      tsx.includes(LINEA_PRED));
  // La primera versión de este check buscaba /deshacer/i en todo el bloque y daba FAIL: matcheaba
  // el propio comentario que explica que NO es un deshacer. Un test que se dispara con su propia
  // documentación no mide nada. Lo que importa es la ETIQUETA DEL BOTÓN, así que se mide esa.
  const mBoton = tsx.match(/\{guardando \? 'Desvinculando…' : '([^']+)'\}/);
  console.log(`  etiqueta del botón: ${mBoton ? `"${mBoton[1]}"` : '(no encontrada)'}`);
  chk('el botón NO se llama "deshacer"',
      !!mBoton && !/deshacer/i.test(mBoton[1]));
  chk('el botón dice qué hace de verdad (desvincular / volver a proponer)',
      !!mBoton && /desvincul/i.test(mBoton[1]));

  let rama1 = 0;
  for (const d of comps.docs) {
    const pm = d.data().propuestaMatch;
    if (!pm || pm.rama !== 1 || pm.origenReconciliacion !== true || !pm.movimientoId) continue;
    rama1++;
    const mv = movs.find(x => x.id === pm.movimientoId);
    const propio = mv && String(mv.origenComprobanteId) === d.id;
    console.log(`  ${d.id.slice(0, 14)} | ${s(d.data().datosExtraidos?.comercioRazonSocial).slice(0, 26).padEnd(26)} | mov ${String(pm.movimientoId).slice(0, 12)} | ${propio ? 'lo creó él mismo → el callable RECHAZA (correcto)' : 'obligación preexistente → desvinculable'}`);
  }
  console.log(`\n  comprobantes de rama 1 reconciliada: ${rama1}`);
  chk('hay al menos un comprobante de rama 1 al que la UI le abre la salida', rama1 > 0);

  console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
  fs.rmSync(tmp, { force: true });
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
