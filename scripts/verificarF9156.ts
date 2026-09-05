// F9.156 §3 — verificación del arreglo, simulando `confirmarResumenTarjeta` con el CÓDIGO REAL:
// las expresiones de monto y las guardas se extraen del fuente, y el checklist se importa.
// F9.156 §4 — dry run de los movimientos-total duplicados. NO BORRA NADA. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import { calcularChecklist } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const fechaStr = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toISOString().replace('T', ' ').slice(0, 19) : s(v);
};

const src = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const srcComp = fs.readFileSync('src/datos/comprobantes.ts', 'utf8').replace(/\r\n/g, '\n');

function aJs(codigo: string): string {
  return ts.transpileModule(codigo, {
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
  }).outputText;
}
function bloque(fuente: string, desde: string, hasta: string): string {
  const i = fuente.indexOf(desde);
  if (i < 0) throw new Error(`no encontré "${desde}"`);
  const j = fuente.indexOf(hasta, i);
  if (j < 0) throw new Error(`no encontré el cierre de "${desde}"`);
  return fuente.slice(i, j + hasta.length);
}

// `confirmadoPagoPorFecha` vive en comprobantes.ts, que importa src/firebase (import.meta.env).
// Se extrae del fuente en vez de copiarla.
const fnConfirmado = [bloque(srcComp, 'function hoyArgentinaISO', '\n}'), bloque(srcComp, 'export function confirmadoPagoPorFecha', '\n}')].join('\n');
const confirmadoPagoPorFecha = new Function(`${aJs(fnConfirmado.replace('export ', ''))}\nreturn confirmadoPagoPorFecha;`)() as (f: string | null) => boolean;

// Las dos expresiones de monto, leídas del fuente.
const lineasClamp = src.split('\n').map(l => l.trim()).filter(l => l.startsWith('const totalARSMov') || l.startsWith('const totalUSDMov'));
if (lineasClamp.length !== 2) throw new Error(`esperaba 2 líneas de clamp, encontré ${lineasClamp.length}`);
const clamp = new Function('resumen', `${lineasClamp.join('\n')}\nreturn { ars: totalARSMov, usd: totalUSDMov };`) as (r: { totalARS: number; totalUSD: number }) => { ars: number; usd: number };

async function main() {
  console.log('=== §1 — guardas leídas del fuente (¿queda alguna condición `> 0`?) ===');
  for (const aguja of ['if (resumen.totalARS > 0)', 'if (resumen.totalUSD > 0)', 'if (itemARS && resumen.totalARS > 0)', 'if (itemUSD && resumen.totalUSD > 0)']) {
    console.log(`  ${src.includes(aguja) ? '>>> NO  SIGUE' : 'OK  eliminada'}: ${aguja}`);
  }
  for (const aguja of ['if (itemARS) {', 'if (itemUSD) {']) {
    console.log(`  ${src.includes(aguja) ? 'OK  presente' : '>>> NO  falta'}: ${aguja}`);
  }
  console.log(`  clamp: ${lineasClamp.join('  |  ')}`);
  for (const [ars, usd] of [[100, 50], [100, 0], [100, -14.69], [0, 0], [-5, -5]] as const) {
    const r = clamp({ totalARS: ars, totalUSD: usd });
    console.log(`    totalARS=${String(ars).padStart(7)} totalUSD=${String(usd).padStart(8)} → monto ARS=${String(r.ars).padStart(7)} USD=${String(r.usd).padStart(7)}`);
  }

  // ── datos reales ────────────────────────────────────────────────────────
  const resus = await db.collection('resumenesTarjeta').get();
  const itemsSnap = await db.collection('itemsEsperados').get();
  const movsSnap = await db.collection('movimientos').get();

  const items: ExpectedItem[] = itemsSnap.docs.map(d => {
    const y = d.data();
    return {
      id: d.id, tipo: y.tipo, activo: y.activo ?? false,
      categoria: y.categoria ?? null, subcategoria: y.subcategoria ?? null,
      etiqueta: y.etiqueta ?? null, persona: y.persona ?? null,
      moneda: y.moneda ?? 'ARS', banco: y.banco ?? null,
      montoEsperado: y.montoEsperado ?? null, diaVencimiento: y.diaVencimiento ?? null,
      autoCalendario: y.autoCalendario ?? false, notas: y.notas ?? null,
      tarjetaCodigo: y.tarjetaCodigo ?? null,
      matchTexto: y.matchTexto ? { incluye: y.matchTexto.incluye ?? [], excluye: y.matchTexto.excluye ?? [] } : null,
      periodicidad: y.periodicidad || 'mensual', pagoAutomatico: y.pagoAutomatico ?? false,
      clavesDesambiguacion: Array.isArray(y.clavesDesambiguacion) ? y.clavesDesambiguacion : null,
      diaCorteImputacion: y.diaCorteImputacion ?? null,
    } as ExpectedItem;
  });

  // Simula lo que `confirmarResumenTarjeta` escribiría HOY (código nuevo) para un resumen dado.
  function simular(r: FirebaseFirestore.QueryDocumentSnapshot) {
    const x = r.data();
    const tarj = String(x.tarjetaCodigo);
    const itemARS = items.find(i => i.tarjetaCodigo === tarj && i.moneda === 'ARS' && i.activo);
    const itemUSD = items.find(i => i.tarjetaCodigo === tarj && i.moneda === 'USD' && i.activo);
    const m = clamp({ totalARS: Number(x.totalARS ?? 0), totalUSD: Number(x.totalUSD ?? 0) });
    const vencISO = (x.fechaVencimiento as { toDate?: () => Date } | null)?.toDate?.()
      ?.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' }) ?? null;
    // `mesRef` y `confirmadoPagoTotal` NO se re-derivan: se toman del movimiento-total ARS que ese
    // mismo resumen YA generó. Es la verdad de campo, y reimplementar el cálculo (que usa
    // getFullYear/getMonth locales, no la fecha localizada a Argentina) me dio el mes equivocado
    // en el primer intento. El USD comparte los dos valores con el ARS: salen de las mismas dos
    // variables del código (fechaRef/mesRef y confirmadoPagoTotal).
    const claveLegacy = `${s(x.tarjetaCodigo)}_${s(x.nroResumen)}`;
    const totalArsReal = movsSnap.docs.find(m => {
      const y = m.data();
      const k = s(y.resumenTarjetaId);
      return (k === r.id || k === claveLegacy) && y.excluirDash === true && y.moneda === 'ARS';
    });
    const mesRef = s(totalArsReal?.data().mes ?? x.periodo);
    const confirmado = totalArsReal ? totalArsReal.data().confirmadoPago === true : confirmadoPagoPorFecha(vencISO);
    return { itemARS, itemUSD, montoARS: m.ars, montoUSD: m.usd, confirmado, mesRef, vencISO };
  }

  const casos = ['17e51e81', '879eb89a', 'fc31ca48', 'f9d9b308'];
  console.log('\n=== §3.1 — los 4 casos vivos, simulados con el código nuevo ===');
  const simulados: Array<{ pref: string; sim: ReturnType<typeof simular>; x: FirebaseFirestore.DocumentData }> = [];
  for (const pref of casos) {
    const r = resus.docs.find(d => d.id.startsWith(pref));
    if (!r) { console.log(`  ${pref}: no encontrado`); continue; }
    const x = r.data();
    const sim = simular(r);
    simulados.push({ pref, sim, x });
    const okUsd = sim.itemUSD !== undefined && sim.montoUSD === 0;
    console.log(`  ${okUsd ? 'OK ' : '>>> NO'} ${pref} | ${s(x.tarjeta).padEnd(18)} ${s(x.periodo)} | totalUSD=${String(s(x.totalUSD)).padStart(8)} → movimiento USD monto=${sim.montoUSD} | pagado=true confirmadoPago=${sim.confirmado} | mes=${sim.mesRef}`);
    console.log(`           itemUSD=${s(sim.itemUSD?.id)} | montoEsperado pasaría de ${s(sim.itemUSD?.montoEsperado)} a ${sim.montoUSD}`);
  }

  // ── §3.2 — el checklist con esos movimientos ────────────────────────────
  console.log('\n=== §3.2 — checklist ANTES vs DESPUÉS (calcularChecklist real) ===');
  const movimientos: Movement[] = movsSnap.docs.map(d => {
    const y = d.data();
    return {
      ...y, id: d.id,
      fecha: (y.fecha as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(0),
      creadoEn: (y.creadoEn as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(0),
      actualizadoEn: (y.actualizadoEn as { toDate?: () => Date } | null)?.toDate?.() ?? new Date(0),
      fechaConsumoOriginal: null, pagadoEn: null,
    } as unknown as Movement;
  });

  for (const { pref, sim, x } of simulados) {
    if (!sim.itemUSD) continue;
    const mes = sim.mesRef;
    // ANTES: los movimientos reales de hoy, quitando el parche manual de USD 1 para ver el bug puro.
    const reales = movimientos.filter(m => m.mes === mes);
    const sinParche = reales.filter(m => !(m.itemEsperadoId === sim.itemUSD!.id && (m as unknown as { origen?: string }).origen === 'Manual'));
    const itemsAntes = items.map(i => i.id === sim.itemUSD!.id ? { ...i, montoEsperado: null } : i);
    const antes = calcularChecklist(itemsAntes, sinParche, mes).find(c => c.item.id === sim.itemUSD!.id);

    // DESPUÉS: el movimiento en $0 que el código nuevo crearía, y el montoEsperado actualizado.
    const movNuevo = {
      id: `sim-${pref}-usd`, mes, moneda: 'USD', monto: sim.montoUSD, tipo: 'Gasto',
      subtipo: 'Tarjeta', origen: 'Tarjeta', descripcion: `Resumen ${s(x.tarjeta)} ${s(x.periodo)} (USD)`,
      categoria: 'Tarjetas', subcategoria: null, tarjetaCodigo: s(x.tarjetaCodigo),
      itemEsperadoId: sim.itemUSD.id, pagado: true, confirmadoPago: sim.confirmado,
      excluirDash: true, incluirResumenMes: true, fecha: new Date(),
    } as unknown as Movement;
    const itemsDespues = items.map(i => i.id === sim.itemUSD!.id ? { ...i, montoEsperado: sim.montoUSD } : i);
    const despues = calcularChecklist(itemsDespues, [...sinParche, movNuevo], mes).find(c => c.item.id === sim.itemUSD!.id);

    // El estado esperado NO es siempre `pagado`: depende de `confirmadoPagoTotal`, que es
    // `confirmadoPagoPorFecha(vencimiento)`. Con el vencimiento ya pasado el ítem queda `pagado`;
    // con el vencimiento por venir queda `por_confirmar`, que es exactamente lo mismo que hacen hoy
    // los ítems ARS de ese mes. Lo que importa en los dos casos es que DEJA de estar colgado sin
    // movimiento. La spec predijo `pagado` para los cuatro; vale para los dos ya vencidos.
    const esperado = sim.confirmado ? 'pagado' : 'por_confirmar';
    const colgadoAntes = antes?.matches.length === 0;
    const ok = colgadoAntes && despues?.matches.length === 1 && despues?.estado === esperado;
    console.log(`  ${ok ? 'OK ' : '>>> NO'} ${pref} | ${mes} | confirmadoPago=${String(sim.confirmado).padEnd(5)} | ANTES=${s(antes?.estado).padEnd(14)} (matches=${antes?.matches.length}) → DESPUÉS=${s(despues?.estado).padEnd(14)} (matches=${despues?.matches.length}) | esperado ${esperado}`);
  }

  // ── §3.3 — no regresión ─────────────────────────────────────────────────
  console.log('\n=== §3.3 — no regresión: resúmenes con los dos totales > 0 ===');
  let iguales = 0, distintos = 0;
  for (const r of resus.docs) {
    const x = r.data();
    const ars = Number(x.totalARS ?? 0), usd = Number(x.totalUSD ?? 0);
    if (!(ars > 0 && usd > 0)) continue;
    const m = clamp({ totalARS: ars, totalUSD: usd });
    if (m.ars === ars && m.usd === usd) iguales++;
    else { distintos++; console.log(`  >>> NO ${r.id.slice(0, 8)} | ${ars} → ${m.ars} | ${usd} → ${m.usd}`); }
  }
  console.log(`  ${distintos === 0 ? 'OK ' : '>>> NO'} ${iguales} resúmenes con ambos totales > 0 producen montos IDÉNTICOS a los de hoy; ${distintos} cambian`);

  // ── §3.5 — montoEsperado ────────────────────────────────────────────────
  console.log('\n=== §3.5 — montoEsperado de los ítems USD ===');
  for (const i of items.filter(i => i.tarjetaCodigo && i.moneda === 'USD')) {
    const conf = resus.docs.filter(d => d.data().tarjetaCodigo === i.tarjetaCodigo && d.data().estado === 'confirmado');
    const ultimo = conf.sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo))).pop();
    const nuevo = ultimo ? clamp({ totalARS: Number(ultimo.data().totalARS ?? 0), totalUSD: Number(ultimo.data().totalUSD ?? 0) }).usd : null;
    console.log(`  ${i.tarjetaCodigo!.padEnd(18)} ${i.id} | hoy=${s(i.montoEsperado).padStart(8)} → con el código nuevo, al confirmar ${s(ultimo?.data().periodo)}: ${s(nuevo)}`);
  }

  // ── §2 — los movimientos manuales del workaround ────────────────────────
  console.log('\n=== §2 — movimientos MANUALES en ítems de tarjeta (para que los borre el dueño) ===');
  const idsTarjeta = new Set(items.filter(i => i.tarjetaCodigo).map(i => i.id));
  const manuales = movsSnap.docs.filter(d => {
    const y = d.data();
    return idsTarjeta.has(String(y.itemEsperadoId)) && String(y.origen) === 'Manual';
  });
  if (manuales.length === 0) console.log('  (ninguno)');
  for (const d of manuales) {
    const y = d.data();
    const it = items.find(i => i.id === y.itemEsperadoId);
    console.log(`  id=${d.id}`);
    console.log(`     descripcion="${s(y.descripcion)}" | monto=${s(y.monto)} ${s(y.moneda)} | mes=${s(y.mes)}`);
    console.log(`     itemEsperadoId=${s(y.itemEsperadoId)} (${s(it?.tarjetaCodigo)} ${s(it?.moneda)}) | excluirDash=${s(y.excluirDash)} | creadoEn=${fechaStr(y.creadoEn)}`);
  }

  // ── §4 — dry run de duplicados ──────────────────────────────────────────
  console.log('\n\n=== §4 FASE 1 — DRY RUN de los movimientos-total duplicados (NO BORRA NADA) ===');
  const porResumen = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
  for (const d of movsSnap.docs) {
    const y = d.data();
    if (y.excluirDash !== true || !y.resumenTarjetaId) continue;
    const k = String(y.resumenTarjetaId);
    if (!porResumen.has(k)) porResumen.set(k, []);
    porResumen.get(k)!.push(d);
  }
  const duplicados = [...porResumen].filter(([, v]) => v.length > 2);
  console.log(`resúmenes con más de 2 movimientos-total: ${duplicados.length}\n`);

  let deltaArs = 0, deltaUsd = 0;
  const aBorrar: string[] = [];
  for (const [clave, movs] of duplicados) {
    // El join legacy: `{tarjetaCodigo}_{nroResumen}` en los 17 del seed.
    const r = resus.docs.find(d => d.id === clave || `${s(d.data().tarjetaCodigo)}_${s(d.data().nroResumen)}` === clave);
    const x = r?.data();
    console.log(`--- ${clave}  →  ${s(x?.banco)} ${s(x?.tarjeta)} ${s(x?.periodo)} | totalARS=${s(x?.totalARS)} totalUSD=${s(x?.totalUSD)} ---`);
    for (const moneda of ['ARS', 'USD'] as const) {
      const grupo = movs.filter(m => m.data().moneda === moneda)
        .sort((a, b) => ((a.data().creadoEn as { toMillis?: () => number })?.toMillis?.() ?? 0) - ((b.data().creadoEn as { toMillis?: () => number })?.toMillis?.() ?? 0));
      if (grupo.length <= 1) { console.log(`  ${moneda}: ${grupo.length} movimiento — sin duplicado`); continue; }
      console.log(`  ${moneda}: ${grupo.length} movimientos`);
      const campos = ['monto', 'moneda', 'mes', 'descripcion', 'itemEsperadoId', 'hashPdf', 'padreId', 'origenComprobanteId', 'categoria', 'subcategoria', 'tarjetaCodigo', 'subtipo', 'origen', 'pagado', 'confirmadoPago', 'incluirResumenMes', 'excluirDash'];
      for (const [n, m] of grupo.entries()) {
        const y = m.data();
        console.log(`    [${n === 0 ? 'CONSERVAR (más antiguo)' : 'candidato a borrar   '}] ${m.id}`);
        console.log(`        creadoEn=${fechaStr(y.creadoEn)} | ${campos.map(c => `${c}=${s(y[c])}`).join(' | ').slice(0, 400)}`);
      }
      // Comparación campo a campo entre el primero y el resto
      const base = grupo[0].data();
      for (const m of grupo.slice(1)) {
        const y = m.data();
        const difs = campos.filter(c => s(base[c]) !== s(y[c]));
        const ms = ((y.creadoEn as { toMillis?: () => number })?.toMillis?.() ?? 0) - ((base.creadoEn as { toMillis?: () => number })?.toMillis?.() ?? 0);
        console.log(`    ¿idénticos? ${difs.length === 0 ? 'SÍ (todos los campos coinciden)' : 'NO → difieren en: ' + difs.join(', ')}`);
        console.log(`    Δ creadoEn = ${ms} ms (${(ms / 1000).toFixed(1)} s)`);
        aBorrar.push(m.id);
        if (moneda === 'ARS') deltaArs += Number(y.monto ?? 0); else deltaUsd += Number(y.monto ?? 0);
      }
    }
    console.log();
  }

  console.log('--- §4.4 — ¿alguno de los candidatos a borrar está referenciado desde otro lado? ---');
  const setBorrar = new Set(aBorrar);
  let refs = 0;
  for (const d of movsSnap.docs) {
    const y = d.data();
    for (const campo of ['padreId', 'origenComprobanteId'] as const) {
      if (y[campo] && setBorrar.has(String(y[campo]))) {
        refs++;
        console.log(`  >>> ${d.id} tiene ${campo}=${s(y[campo])}, que está en la lista a borrar`);
      }
    }
  }
  console.log(`  ${refs === 0 ? 'OK  ninguno referenciado desde padreId ni origenComprobanteId' : `>>> ${refs} referencias`}`);

  console.log('\n--- §4.5 — impacto en los totales de esos meses ---');
  console.log(`  se quitarían ${aBorrar.length} movimientos: ARS ${deltaArs.toFixed(2)} | USD ${deltaUsd.toFixed(2)}`);
  const porMes = new Map<string, { ars: number; usd: number }>();
  for (const id of aBorrar) {
    const y = movsSnap.docs.find(d => d.id === id)!.data();
    const k = String(y.mes);
    const acc = porMes.get(k) ?? { ars: 0, usd: 0 };
    if (y.moneda === 'ARS') acc.ars += Number(y.monto ?? 0); else acc.usd += Number(y.monto ?? 0);
    porMes.set(k, acc);
  }
  for (const [mes, v] of [...porMes].sort()) console.log(`    ${mes}: −ARS ${v.ars.toFixed(2)} | −USD ${v.usd.toFixed(2)}`);

  console.log('\n--- LISTA DE IDs A BORRAR (Fase 2, NO EJECUTADA) ---');
  for (const id of aBorrar) console.log(`  ${id}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
