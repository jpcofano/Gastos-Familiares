// F9.132.2 — Medición previa. SOLO LEE.
//
// Responde las cuatro preguntas del prompt antes de tocar código:
//   1. Los impagos de hoy: ¿tienen `vencimientos[]`? ¿la card se apoya en eso o en `m.fecha`?
//   2. Totales esperados de Card 1 (pagado===false) y Card 2 (pagado===true) del día.
//   3. Cuántos ítems activos tienen `banco` distinto del banco del movimiento matcheado.
//   4. Cuántos ítems pasan a 'vencido' con la regla nueva vs. la actual, con nombres.
//
// Uso:
//   npx tsx scripts/auditF91322.ts --target=production [--dia=2026-08-07]

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const argDia = process.argv.find(a => a.startsWith('--dia='))?.slice(6);

const fmt = (n: number) => n.toLocaleString('es-AR', { maximumFractionDigits: 0 });

function aFecha(v: any): Date | null {
  if (!v) return null;
  if (typeof v.toDate === 'function') return v.toDate();
  if (v instanceof Date) return v;
  if (typeof v === 'string') { const d = new Date(v); return isNaN(+d) ? null : d; }
  return null;
}
const iso = (d: Date | null) => d ? d.toISOString().slice(0, 10) : '—';

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  const hoy = argDia ? new Date(`${argDia}T12:00:00`) : new Date();
  const diaIso = iso(hoy);
  const mes = diaIso.slice(0, 7);
  console.log(`día ${diaIso} · mes ${mes} · target ${target}\n`);

  const snapMov = await db.collection('movimientos').where('mes', '==', mes).get();
  const movs = snapMov.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const snapItems = await db.collection('itemsEsperados').get();
  const items = snapItems.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
  const activos = items.filter(i => i.activo);
  console.log(`${movs.length} movimientos del mes · ${items.length} ítems (${activos.length} activos)\n`);

  const delDia = movs.filter(m =>
    m.tipo === 'Gasto' && m.incluirResumenMes && iso(aFecha(m.fecha)) === diaIso
  );

  // ── 1. Fecha efectiva de los impagos de hoy
  console.log('=== PUNTO 1 — impagos del día: ¿vencimientos[] o m.fecha? ===');
  const impagos = delDia.filter(m => m.pagado !== true);
  if (impagos.length === 0) console.log('  (ninguno)');
  for (const m of impagos) {
    const v = Array.isArray(m.vencimientos) ? m.vencimientos : null;
    const fuente = v && v.length > 0 && v[0]?.fecha ? `vencimientos[0].fecha=${v[0].fecha}` : 'SIN vencimientos → m.fecha';
    console.log(`  ${(m.descripcion ?? '(sin desc)').slice(0, 42).padEnd(44)} ${String(m.banco ?? '—').padEnd(16)} ${m.moneda} ${fmt(m.monto).padStart(12)}  ${fuente}`);
  }

  // ── 2. Totales de las dos cards
  console.log('\n=== PUNTO 2 — totales de las dos cards ===');
  const agrupar = (ms: any[]) => {
    const map = new Map<string, { ars: number; usd: number }>();
    for (const m of ms) {
      const b = m.banco ?? 'Sin medio';
      const e = map.get(b) ?? { ars: 0, usd: 0 };
      if (m.moneda === 'USD') e.usd += m.monto; else e.ars += m.monto;
      map.set(b, e);
    }
    return [...map.entries()].sort((a, b) => b[1].ars - a[1].ars);
  };
  const total = (ms: any[]) => ms.reduce((s, m) => (
    m.moneda === 'USD' ? { ars: s.ars, usd: s.usd + m.monto } : { ars: s.ars + m.monto, usd: s.usd }
  ), { ars: 0, usd: 0 });

  const pagados = delDia.filter(m => m.pagado === true);
  for (const [rot, ms] of [['CARD 1 · a pagar (pagado===false)', impagos], ['CARD 2 · gastado (pagado===true)', pagados]] as const) {
    const t = total(ms as any[]);
    console.log(`  ${rot}: $ ${fmt(t.ars)}${t.usd ? ` + U$S ${fmt(t.usd)}` : ''}  (${(ms as any[]).length} movs)`);
    for (const [b, e] of agrupar(ms as any[])) {
      console.log(`      ${b.padEnd(24)} ${e.ars ? `$ ${fmt(e.ars)}` : ''} ${e.usd ? `U$S ${fmt(e.usd)}` : ''}`);
    }
  }
  const tt = total(delDia);
  console.log(`  FILA HOY (suma de las dos): $ ${fmt(tt.ars)}${tt.usd ? ` + U$S ${fmt(tt.usd)}` : ''}  (${delDia.length} movs)`);

  // ── 2b. Impagos de días anteriores del mes (sección "vencidos" de la Card 1)
  const anteriores = movs.filter(m =>
    m.tipo === 'Gasto' && m.incluirResumenMes && m.pagado !== true &&
    (iso(aFecha(m.fecha)) ?? '') < diaIso
  );
  const ta = total(anteriores);
  console.log(`\n  VENCIDOS (impagos de días anteriores del mes): $ ${fmt(ta.ars)}${ta.usd ? ` + U$S ${fmt(ta.usd)}` : ''}  (${anteriores.length} movs)`);
  for (const m of anteriores.slice(0, 15)) {
    console.log(`      ${iso(aFecha(m.fecha))}  ${(m.descripcion ?? '').slice(0, 40).padEnd(42)} ${m.moneda} ${fmt(m.monto).padStart(12)}`);
  }

  // ── 3. banco del ítem vs. banco del movimiento
  // Match aproximado por itemEsperadoId (el vínculo directo del pase 1 del checklist).
  console.log('\n=== PUNTO 3 — item.banco vs. mov.banco (ítems activos) ===');
  const porItem = new Map<string, any[]>();
  for (const m of movs) if (m.itemEsperadoId) {
    const arr = porItem.get(m.itemEsperadoId) ?? [];
    arr.push(m); porItem.set(m.itemEsperadoId, arr);
  }
  let conBanco = 0, discrepan = 0;
  for (const it of activos) {
    if (it.banco) conBanco++;
    const ms = porItem.get(it.id) ?? [];
    const mb = ms[0]?.banco;
    if (it.banco && mb && String(it.banco).toLowerCase() !== String(mb).toLowerCase()) {
      discrepan++;
      const rot = [it.categoria, it.subcategoria].filter(Boolean).join(' › ') || it.notas || it.id;
      console.log(`  ✗ ${rot.slice(0, 40).padEnd(42)} item.banco=${String(it.banco).padEnd(16)} mov.banco=${mb}`);
    }
  }
  console.log(`  ítems activos con banco poblado: ${conBanco}/${activos.length} · discrepancias: ${discrepan}`);

  // ── 4. 'vencido': regla actual vs. regla nueva
  console.log('\n=== PUNTO 4 — estado vencido: regla actual vs. regla nueva ===');
  const diaHoy = hoy.getDate();
  const fechaEfectivaItem = (it: any): string | null => {
    const ms = porItem.get(it.id) ?? [];
    const v = ms[0] && Array.isArray(ms[0].vencimientos) ? ms[0].vencimientos : null;
    if (v && v.length > 0 && v[0]?.fecha) return String(v[0].fecha).slice(0, 10);
    if (it.diaVencimiento) return `${mes}-${String(it.diaVencimiento).padStart(2, '0')}`;
    return null;
  };
  const cubiertoIt = (it: any): boolean => {
    const ms = porItem.get(it.id) ?? [];
    return ms.some(m => m.pagado === true || m.confirmadoPago === true);
  };
  const vencidoActual = activos.filter(it => it.diaVencimiento && it.diaVencimiento < diaHoy && (porItem.get(it.id) ?? []).length === 0);
  const vencidoNuevo = activos.filter(it => {
    const f = fechaEfectivaItem(it);
    return f != null && f < diaIso && !cubiertoIt(it);
  });
  console.log(`  regla ACTUAL (diaVencimiento < ${diaHoy}, sin matches): ${vencidoActual.length}`);
  for (const it of vencidoActual) console.log(`      ${([it.categoria, it.subcategoria].filter(Boolean).join(' › ') || it.notas || it.id)}`);
  console.log(`  regla NUEVA (fecha efectiva < hoy y no cubierto): ${vencidoNuevo.length}`);
  for (const it of vencidoNuevo) {
    const rot = [it.categoria, it.subcategoria].filter(Boolean).join(' › ') || it.notas || it.id;
    console.log(`      ${rot.slice(0, 40).padEnd(42)} fechaEfectiva=${fechaEfectivaItem(it)} diaVencimiento=${it.diaVencimiento ?? 'null'}`);
  }
  const conDiaVenc = activos.filter(it => it.diaVencimiento).length;
  console.log(`  ítems activos con diaVencimiento poblado: ${conDiaVenc}/${activos.length}`);
  const sinFechaEfectiva = activos.filter(it => fechaEfectivaItem(it) == null).length;
  console.log(`  ítems activos SIN fecha efectiva (no pueden vencer, caen a 'pendiente'): ${sinFechaEfectiva}/${activos.length}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
