// F9.177 §0 — qué cuenta el banner "Revisar pendientes del mes · N sin pagar · $X".
// `porRevisar` (Resumen.tsx:1383) cuenta ítems del checklist SIN movimiento asociado;
// el monto es `pendienteAgenda`, que incluye también los que SÍ tienen movimiento sin confirmar.
// SOLO LECTURA.
import { cargarTodo } from './auditF9177';
import { Timestamp } from 'firebase-admin/firestore';

const MES = '2026-09';
const dia = (t: unknown) => (t instanceof Timestamp ? new Date(t.toMillis() - 3 * 3600_000).toISOString().slice(0, 10) : null);
const fISO = (v: unknown) => (v instanceof Timestamp ? dia(v) : typeof v === 'string' ? v.slice(0, 10) : null);
const h8 = (s: unknown) => (s ? String(s).slice(0, 8) : '-');
const money = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '-');

async function main() {
  console.log(`F9.177 §0 — el banner de ${MES}. SOLO LECTURA.\n`);
  const E = await cargarTodo();

  const delMes = E.movs.filter(m => String(fISO(m.x.fecha) ?? '').startsWith(MES));
  const activos = [...E.items].filter(([, i]) => i.activo === true);
  console.log(`ítems esperados activos: ${activos.length} · movimientos de ${MES}: ${delMes.length}\n`);

  const sinMov: Array<[string, Record<string, unknown>]> = [];
  const conMovSinConfirmar: Array<[string, Record<string, unknown>, typeof delMes[number]]> = [];

  for (const [id, i] of activos) {
    const movs = delMes.filter(m => m.x.itemEsperadoId === id);
    if (movs.length === 0) sinMov.push([id, i]);
    else {
      const impago = movs.find(m => m.x.pagado !== true);
      if (impago) conMovSinConfirmar.push([id, i, impago]);
    }
  }

  console.log('══ Ítems activos SIN movimiento en el mes (= lo que cuenta "N sin pagar") ══\n');
  let tot = 0;
  for (const [id, i] of sinMov) {
    tot += Number(i.montoEsperado ?? 0);
    console.log(`  ${h8(id)}  ${i.categoria}›${i.subcategoria}  esperado=${money(i.montoEsperado)}  día=${i.diaVencimiento ?? '-'}  tipo=${i.tipo ?? '-'}`);
  }
  console.log(`\n  ${sinMov.length} ítems · esperado total ${money(tot)}`);

  console.log('\n══ Ítems CON movimiento pero sin pagar (no entran en el contador, sí en el monto) ══\n');
  let tot2 = 0;
  for (const [id, i, m] of conMovSinConfirmar) {
    tot2 += Number(m.x.monto ?? 0);
    console.log(`  ${h8(id)}  ${i.categoria}›${i.subcategoria}  mov ${h8(m.id)} ${fISO(m.x.fecha)} ${money(m.x.monto)}  conf=${m.x.confirmadoPago}`);
  }
  console.log(`\n  ${conMovSinConfirmar.length} ítems · ${money(tot2)}`);
  console.log(`\n  SUMA de los dos grupos: ${money(tot + tot2)}   (el banner muestra 185.994)`);
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
