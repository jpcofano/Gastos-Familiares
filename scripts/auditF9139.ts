// F9.139 §0 — AUDITORÍA, no arreglo: un ítem sigue en 'vencido' después de que el
// comprobante que lo pagó quedó 'vinculado' + 'Pagó una factura' (rama 1, reconciliación
// por payee). Caso reportado: ITPA SA, transferencia, $2.003.500, 2026-08-11.
//
// Responde, con valores reales de Firestore y sin suponer nada:
//   A. Qué tiene datosExtraidos del comprobante (tipoDocumento, fecha, vencimientos).
//   B. Cuánto da `quedaConfirmado` recalculado con la MISMA expresión de confirmarRama1.
//   C. Qué quedó escrito en el movimiento reconciliado (pagado / confirmadoPago / mes).
//   D. Qué ítems dan 'vencido' hoy y por qué (matches, cobertura, fecha efectiva).
//   E. Si hay OTRO movimiento del mismo payee sin confirmar en otro mes de la ventana
//      [mes-1..mes+3] — la hipótesis "se saldó la obligación del mes equivocado".
//
// SOLO LEE. No escribe nada.
//
// Uso: npx tsx scripts/auditF9139.ts --target=production
//      npx tsx scripts/auditF9139.ts --target=production --payee=ITPA --monto=2003500
//      npx tsx scripts/auditF9139.ts --target=production --comp=<idComprobante>

import { getDb } from './seed/utils/firestore';
import { calcularChecklist, fechaEfectivaItem, mesActualStr } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const argPayee = process.argv.find(a => a.startsWith('--payee='))?.slice(8) ?? 'ITPA';
const argMonto = Number(process.argv.find(a => a.startsWith('--monto='))?.slice(8) ?? '2003500');
const argComp  = process.argv.find(a => a.startsWith('--comp='))?.slice(7);

const aFecha = (v: any) => (v && typeof v.toDate === 'function') ? v.toDate() : new Date(v);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (n: number | null | undefined) =>
  n == null ? 'null' : n.toLocaleString('es-AR', { maximumFractionDigits: 2 });
const j = (v: unknown) => JSON.stringify(v ?? null);

// Gemelo EXACTO de src/datos/comprobantes.ts (no importar: ese módulo arrastra el SDK cliente).
function esObligacionDoc(tipo?: string | null): boolean {
  return tipo === 'recibo_servicio'
      || tipo === 'factura_a' || tipo === 'factura_b' || tipo === 'factura_c';
}
function hoyArgentinaISO(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
}
function confirmadoPagoPorFecha(fechaISO: string | null | undefined): boolean {
  if (!fechaISO) return false;
  return fechaISO <= hoyArgentinaISO();
}

function mesMas(mes: string, delta: number): string {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const hoyIso = hoyArgentinaISO();
  const mesHoy = mesActualStr();
  console.log(`hoy(ART) ${hoyIso} · mes ${mesHoy} · target ${target}`);
  console.log(`filtro payee~"${argPayee}" monto~${fmt(argMonto)}${argComp ? ` · comp=${argComp}` : ''}\n`);

  // ── A. Comprobante(s) candidatos ────────────────────────────────────────────
  console.log('=== A — comprobante y datosExtraidos ===');
  const snapComp = await db.collection('comprobantes').get();
  const todos = snapComp.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const comps = argComp
    ? todos.filter(c => c.id === argComp)
    : todos.filter(c => {
        const d = c.datosExtraidos ?? {};
        const texto = `${d.comercioRazonSocial ?? ''} ${d.destinoNombre ?? ''}`.toUpperCase();
        const montoOk = d.montoTotal != null && Math.abs(Number(d.montoTotal) - argMonto) < 1;
        return texto.includes(argPayee.toUpperCase()) || montoOk;
      });

  if (comps.length === 0) {
    console.log(`  (ninguno) — total comprobantes leídos: ${todos.length}`);
    console.log('  Volvé a correr con --comp=<id> o --payee=<texto> --monto=<numero>.\n');
  }

  const movIdsInteres = new Set<string>();

  for (const c of comps) {
    const d = c.datosExtraidos ?? {};
    const pm = c.propuestaMatch ?? {};
    console.log(`\n  comprobante ${c.id}`);
    console.log(`    estado            = ${j(c.estado)}`);
    console.log(`    tipoDocumento     = ${j(d.tipoDocumento)}   (esObligacionDoc=${esObligacionDoc(d.tipoDocumento)})`);
    console.log(`    fecha             = ${j(d.fecha)}`);
    console.log(`    vencimientos      = ${j(d.vencimientos)}`);
    console.log(`    montoTotal        = ${fmt(d.montoTotal)} ${d.moneda ?? ''}`);
    console.log(`    comercioRazonSocial = ${j(d.comercioRazonSocial)}`);
    console.log(`    destinoNombre     = ${j(d.destinoNombre)}`);
    console.log(`    destinoCuit/Cbu/Alias = ${j(d.destinoCuit)} / ${j(d.destinoCbu)} / ${j(d.destinoAlias)}`);
    console.log(`    propuestaMatch    = rama=${j(pm.rama)} movimientoId=${j(pm.movimientoId)} itemEsperadoId=${j(pm.itemEsperadoId)} origenReconciliacion=${j(pm.origenReconciliacion)} candidatos=${pm.candidatos?.length ?? 0}`);

    // ── B. quedaConfirmado, con la MISMA expresión de confirmarRama1 ──────────
    const fechaUsada = d.vencimientos?.[0]?.fecha ?? d.fecha;
    const quedaConfirmado = !esObligacionDoc(d.tipoDocumento) && confirmadoPagoPorFecha(fechaUsada);
    console.log(`  --- B. recálculo de confirmarRama1 ---`);
    console.log(`    fecha usada (venc[0].fecha ?? fecha) = ${j(fechaUsada)}`);
    console.log(`    quedaConfirmado   = ${quedaConfirmado}`);
    if (!quedaConfirmado) {
      console.log(`    >>> con quedaConfirmado=false, confirmarRama1 escribe confirmadoPago:false y NO escribe pagado.`);
      if (esObligacionDoc(d.tipoDocumento)) {
        console.log(`    >>> motivo: tipoDocumento es obligación ⇒ NO se toca ningún campo de pago (hipótesis A).`);
      } else {
        console.log(`    >>> motivo: la fecha usada (${j(fechaUsada)}) es posterior a hoy (${hoyIso}) (hipótesis B).`);
      }
    }
    // Contraste explícito: qué habría dado usando la fecha de PAGO en vez de la de vencimiento.
    const conFechaPago = !esObligacionDoc(d.tipoDocumento) && confirmadoPagoPorFecha(d.fecha);
    if (conFechaPago !== quedaConfirmado) {
      console.log(`    >>> con prioridad invertida (fecha ?? venc[0].fecha) daría: ${conFechaPago}  <-- la diferencia ES el bug`);
    }

    if (pm.movimientoId) movIdsInteres.add(pm.movimientoId);
  }

  // ── C. Movimientos reconciliados ────────────────────────────────────────────
  console.log('\n=== C — movimiento(s) reconciliado(s) ===');
  for (const movId of movIdsInteres) {
    const snap = await db.collection('movimientos').doc(movId).get();
    if (!snap.exists) { console.log(`  ${movId}: NO EXISTE`); continue; }
    const m = snap.data() as any;
    console.log(`  ${movId}`);
    console.log(`    mes             = ${j(m.mes)}   fecha=${m.fecha ? iso(aFecha(m.fecha)) : 'null'}   mesManual=${j(m.mesManual)}`);
    console.log(`    descripcion     = ${j(m.descripcion)}`);
    console.log(`    monto           = ${fmt(m.monto)} ${m.moneda}   tipo=${j(m.tipo)}`);
    console.log(`    pagado          = ${j(m.pagado)}`);
    console.log(`    confirmadoPago  = ${j(m.confirmadoPago)}`);
    console.log(`    pagadoEn        = ${m.pagadoEn ? iso(aFecha(m.pagadoEn)) : 'null'}`);
    console.log(`    itemEsperadoId  = ${j(m.itemEsperadoId)}`);
    console.log(`    vencimientos    = ${j(m.vencimientos)}`);
    console.log(`    hashPdf         = ${j(m.hashPdf)}`);
    console.log(`    actualizadoEn   = ${m.actualizadoEn ? aFecha(m.actualizadoEn).toISOString() : 'null'}`);
  }
  if (movIdsInteres.size === 0) console.log('  (la propuestaMatch no traía movimientoId)');

  // ── D. Checklist: quién da 'vencido' y por qué ──────────────────────────────
  const snapItems = await db.collection('itemsEsperados').get();
  const items = snapItems.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ExpectedItem[];

  for (const mes of [mesMas(mesHoy, -1), mesHoy]) {
    const snapMov = await db.collection('movimientos').where('mes', '==', mes).get();
    const movs = snapMov.docs.map(d => ({
      id: d.id, ...(d.data() as any), fecha: aFecha(d.data().fecha),
    })) as Movement[];
    const check = calcularChecklist(items, movs, mes);
    const vencidos = check.filter(ci => ci.estado === 'vencido');
    console.log(`\n=== D — checklist ${mes} · ${movs.length} movs · vencidos: ${vencidos.length} ===`);
    for (const ci of vencidos) {
      const label = ci.item.notas || [ci.item.categoria, ci.item.subcategoria].filter(Boolean).join(' › ') || ci.item.id;
      const fe = fechaEfectivaItem(ci.item, ci.matches, mes);
      console.log(`  · ${label}  (item ${ci.item.id})`);
      console.log(`      fechaEfectiva=${j(fe)}  esperado=${fmt(ci.item.montoEsperado)} ${ci.item.moneda}  matches=${ci.matches.length}`);
      for (const m of ci.matches) {
        console.log(`      - mov ${m.id} | ${fmt(m.monto)} ${m.moneda} | pagado=${j(m.pagado)} confirmadoPago=${j(m.confirmadoPago)} | ${String(m.descripcion ?? '').slice(0, 40)}`);
      }
      if (ci.matches.length === 0) console.log(`      - sin matches: el checklist no ve NINGÚN movimiento para este ítem en ${mes}`);
    }
    // ítems del payee buscado, en cualquier estado, para ver dónde cayó el pago
    const delPayee = check.filter(ci => {
      const txt = `${ci.item.notas ?? ''} ${ci.item.categoria ?? ''} ${ci.item.subcategoria ?? ''} ${(ci.item.matchTexto?.incluye ?? []).join(' ')}`.toUpperCase();
      return txt.includes(argPayee.toUpperCase());
    });
    for (const ci of delPayee) {
      const label = ci.item.notas || [ci.item.categoria, ci.item.subcategoria].filter(Boolean).join(' › ') || ci.item.id;
      console.log(`  [payee] ${label} → estado=${ci.estado} matches=${ci.matches.length} ${ci.matches.map(m => `${m.id}(pagado=${m.pagado},conf=${m.confirmadoPago})`).join(' ')}`);
    }
  }

  // ── E. ¿Se saldó la obligación del mes equivocado? ──────────────────────────
  console.log('\n=== E — movimientos del mismo payee en la ventana [mes-1..mes+3] ===');
  const ventana = [-1, 0, 1, 2, 3].map(d => mesMas(mesHoy, d));
  const snapVent = await db.collection('movimientos').where('mes', 'in', ventana).get();
  const delPayeeMovs = snapVent.docs
    .map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(m => {
      const txt = `${m.descripcion ?? ''} ${m.destinoNombre ?? ''}`.toUpperCase();
      const montoOk = m.monto != null && Math.abs(Math.abs(Number(m.monto)) - argMonto) < 1;
      return txt.includes(argPayee.toUpperCase()) || montoOk;
    })
    .sort((a, b) => String(a.mes).localeCompare(String(b.mes)));
  console.log(`  ventana: ${ventana.join(', ')} · coincidencias: ${delPayeeMovs.length}`);
  for (const m of delPayeeMovs) {
    console.log(`  · ${m.mes} | mov ${m.id} | ${fmt(m.monto)} ${m.moneda} | pagado=${j(m.pagado)} confirmadoPago=${j(m.confirmadoPago)} | item=${j(m.itemEsperadoId)} | ${String(m.descripcion ?? '').slice(0, 44)}`);
  }
  if (delPayeeMovs.length > 1) {
    console.log(`  >>> hay más de uno: verificar si confirmarRama1 saldó el de OTRO mes que el que se ve vencido.`);
  }

  console.log('\nfin.');
}

main().catch(e => { console.error(e); process.exit(1); });
