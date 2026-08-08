// F9.136 §5 — AUDITORÍA, no arreglo: resúmenes de tarjeta con monto 0 o null.
// Juan reporta un pago de tarjeta entre los esperados que habría entrado con monto 0.
// Responde: cuántos son, de dónde salen, qué estado de checklist les da, y si la card los muestra.
// SOLO LEE. No escribe nada.
//
// Uso: npx tsx scripts/auditF9136.ts --target=production [--dia=2026-08-08]

import { getDb } from './seed/utils/firestore';
import { calcularChecklist } from '../src/datos/checklist';
import type { Movement, ExpectedItem } from '../src/types';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const argDia = process.argv.find(a => a.startsWith('--dia='))?.slice(6);

const aFecha = (v: any) => (v && typeof v.toDate === 'function') ? v.toDate() : new Date(v);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const fmt = (n: number | null | undefined) =>
  n == null ? 'null' : n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  const hoy = argDia ? new Date(`${argDia}T12:00:00`) : new Date();
  const diaIso = iso(hoy);
  const mes = diaIso.slice(0, 7);
  console.log(`día ${diaIso} · mes ${mes} · target ${target}\n`);

  const snapMov = await db.collection('movimientos').where('mes', '==', mes).get();
  const movs = snapMov.docs.map(d => ({ id: d.id, ...(d.data() as any), fecha: aFecha(d.data().fecha) })) as Movement[];
  const snapItems = await db.collection('itemsEsperados').get();
  const items = snapItems.docs.map(d => ({ id: d.id, ...(d.data() as any) })) as ExpectedItem[];

  // ── 1. Movimientos de resumen de tarjeta con monto 0 o null
  console.log('=== 1 — movimientos de resumen de tarjeta con monto 0 / null ===');
  const deTarjeta = movs.filter(m =>
    m.subtipo === 'TarjetaPago' || m.resumenTarjetaId != null || m.tarjetaCodigo != null
  );
  const enCero = deTarjeta.filter(m => m.monto == null || m.monto === 0);
  console.log(`  movimientos de tarjeta en el mes: ${deTarjeta.length} · con monto 0/null: ${enCero.length}`);
  for (const m of enCero) {
    console.log(`  · ${(m.descripcion ?? '(sin desc)').slice(0, 44).padEnd(46)} monto=${fmt(m.monto)} ${m.moneda}`);
    console.log(`      origen=${m.origen} subtipo=${m.subtipo} resumenTarjetaId=${m.resumenTarjetaId ?? 'null'} tcUsdArs=${m.tcUsdArs ?? 'null'}`);
    console.log(`      pagado=${m.pagado} confirmadoPago=${m.confirmadoPago} incluirResumenMes=${m.incluirResumenMes} excluirDash=${m.excluirDash}`);
  }

  // ── 2. Ítems esperados de tarjeta: montoEsperado y estado
  console.log('\n=== 2 — ítems esperados de tarjeta: montoEsperado y estado de checklist ===');
  const checklist = calcularChecklist(items, movs, mes);
  const rotulo = (ci: any) => [ci.item.categoria, ci.item.subcategoria].filter(Boolean).join(' › ') || ci.item.notas || ci.item.id;
  const deTarjetaCl = checklist.filter(ci => ci.item.tarjetaCodigo != null);
  console.log(`  ítems de tarjeta en el checklist: ${deTarjetaCl.length}`);
  for (const ci of deTarjetaCl) {
    const real = ci.matches.reduce((s, m) => s + Math.abs(m.monto), 0);
    // Réplica EXACTA de la lógica de la card antes de F9.136 §1, para medir el efecto.
    const tieneMatchViejo = ci.estado === 'pagado' || ci.estado === 'parcial' || ci.estado === 'por_confirmar';
    const montoViejo = tieneMatchViejo ? real : (ci.item.montoEsperado ?? 0);
    const montoNuevo = ci.matches.length > 0 ? real : (ci.item.montoEsperado ?? 0);
    const marca = montoViejo !== montoNuevo ? '  ← LA CARD MOSTRABA MAL' : '';
    console.log(`  · ${rotulo(ci).slice(0, 34).padEnd(36)} ${String(ci.estado).padEnd(14)} m=${ci.matches.length} esp=${fmt(ci.item.montoEsperado)} real=${fmt(real)}`);
    console.log(`      card ANTES=${fmt(montoViejo)} · card AHORA=${fmt(montoNuevo)}${marca}`);
  }

  // ── 3. El efecto general del §1, sobre TODO el checklist (no solo tarjeta)
  console.log('\n=== 3 — ítems cuyo monto en la card cambia con el fix del §1 ===');
  let cambian = 0;
  for (const ci of checklist) {
    const real = ci.matches.reduce((s, m) => s + Math.abs(m.monto), 0);
    const viejo = (ci.estado === 'pagado' || ci.estado === 'parcial' || ci.estado === 'por_confirmar') ? real : (ci.item.montoEsperado ?? 0);
    const nuevo = ci.matches.length > 0 ? real : (ci.item.montoEsperado ?? 0);
    if (viejo !== nuevo) {
      cambian++;
      console.log(`  · ${rotulo(ci).slice(0, 34).padEnd(36)} ${String(ci.estado).padEnd(14)} ${fmt(viejo)} → ${fmt(nuevo)}`);
    }
  }
  if (cambian === 0) console.log('  (ninguno)');

  // ── 4. Ítems accionables sin ninguna acción disponible (el bloqueante del §1)
  console.log('\n=== 4 — ítems SIN ninguna acción disponible, por estado ===');
  const ACCIONABLE = ['pendiente', 'vencido', 'no_registrado', 'por_confirmar'];
  for (const ci of checklist) {
    const acc = ACCIONABLE.includes(ci.estado);
    const confirmarViejo = ci.estado === 'por_confirmar';
    const confirmarNuevo = (ci.estado === 'por_confirmar' || ci.estado === 'vencido') && ci.matches.length > 0;
    const registrar = acc && ci.matches.length === 0;
    const deshacer = ci.estado === 'pagado' && ci.matches.length > 0;
    const sinAccionAntes = !confirmarViejo && !registrar && !deshacer;
    const sinAccionAhora = !confirmarNuevo && !registrar && !deshacer;
    if (sinAccionAntes || sinAccionAhora) {
      console.log(`  · ${rotulo(ci).slice(0, 34).padEnd(36)} ${String(ci.estado).padEnd(14)} m=${ci.matches.length} accionable=${acc} · antes=${sinAccionAntes ? 'SIN ACCIÓN' : 'ok'} ahora=${sinAccionAhora ? 'SIN ACCIÓN' : 'ok'}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
