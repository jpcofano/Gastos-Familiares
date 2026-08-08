// F9.138 §4 — limpieza one-shot de `confirmadoPago: true` con `pagado: false`.
//
// Ese par es imposible bajo la semántica de F9.138 §2: `pagado` = la plata salió,
// `confirmadoPago` = alguien verificó que salió. No se puede verificar lo que no pasó.
// Lo escribía `confirmarPagoEsperado` (movimientos.ts), que tocaba `confirmadoPago` y no
// `pagado` — arreglado en el mismo commit. Esto limpia lo que ese botón ya dejó escrito.
//
// El fix es `pagado: true`, NO `confirmadoPago: false`: alguien apretó "Confirmar pago" sobre
// un movimiento real, así que la verificación es el dato bueno y `pagado` es el que quedó atrás.
//
// Dry-run por defecto, `--apply` para escribir. Mismo patrón que limpiarPersonaVacia.ts:
// se reporta ANTES de tocar nada, con fechas, porque una limpieza que no se puede revisar antes
// es un borrado a ciegas.
//
// Uso:
//   tsx scripts/limpiarPagadoIncoherente.ts --target=production
//   tsx scripts/limpiarPagadoIncoherente.ts --target=production --apply

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';
const apply = process.argv.includes('--apply');

const iso = (v: any): string => {
  if (!v) return '—';
  const d = typeof v.toDate === 'function' ? v.toDate() : new Date(v);
  return isNaN(+d) ? '—' : d.toISOString().slice(0, 10);
};

async function main() {
  const db = getDb(target as 'emulator' | 'production');

  // Los dos campos están indexados por igualdad; no hace falta índice compuesto para este par
  // porque se filtra el segundo en memoria (el volumen es chico y la query simple no falla).
  const snap = await db.collection('movimientos').where('confirmadoPago', '==', true).get();
  const rotos = snap.docs.filter(d => d.data().pagado !== true);

  console.log(`\n=== movimientos con confirmadoPago: true y pagado: false ===`);
  console.log(`  confirmados en total: ${snap.size} · incoherentes: ${rotos.length}\n`);

  if (rotos.length === 0) {
    console.log('Nada que limpiar.');
    console.log(JSON.stringify({ encontrados: 0, actualizados: 0 }));
    return;
  }

  // Ordenados por cuándo se confirmaron: así se ve si son de esta semana o vienen de más atrás.
  const filas = rotos
    .map(d => {
      const m = d.data() as Record<string, any>;
      return {
        id: d.id,
        mes: String(m.mes),
        desc: String(m.descripcion ?? '').slice(0, 38),
        monto: `${m.moneda} ${Number(m.monto).toLocaleString('es-AR', { maximumFractionDigits: 0 })}`,
        fechaMov: iso(m.fecha),
        pagadoEn: iso(m.pagadoEn),
        actualizado: iso(m.actualizadoEn),
        origen: String(m.origen ?? '—'),
        item: m.itemEsperadoId ? 'sí' : 'no',
      };
    })
    .sort((a, b) => a.pagadoEn.localeCompare(b.pagadoEn));

  console.log('  pagadoEn    actualizadoEn  fechaMov    mes      origen      item  descripción / monto');
  for (const f of filas) {
    console.log(`  ${f.pagadoEn.padEnd(11)} ${f.actualizado.padEnd(14)} ${f.fechaMov.padEnd(11)} ${f.mes.padEnd(8)} ${f.origen.padEnd(11)} ${f.item.padEnd(5)} ${f.desc} · ${f.monto}`);
  }

  const fechas = filas.map(f => f.pagadoEn).filter(f => f !== '—');
  if (fechas.length > 0) {
    console.log(`\n  rango de confirmación: ${fechas[0]} → ${fechas[fechas.length - 1]}`);
  }
  const sinPagadoEn = filas.filter(f => f.pagadoEn === '—').length;
  if (sinPagadoEn > 0) console.log(`  sin pagadoEn (anteriores a F9.99.7): ${sinPagadoEn}`);

  if (!apply) {
    console.log('\nDRY-RUN: no se escribió nada. Volver a correr con --apply.');
    console.log(JSON.stringify({ encontrados: rotos.length, actualizados: 0 }));
    return;
  }

  const BATCH = 400;
  for (let i = 0; i < rotos.length; i += BATCH) {
    const batch = db.batch();
    for (const d of rotos.slice(i, i + BATCH)) batch.update(d.ref, { pagado: true });
    await batch.commit();
  }

  console.log(`\nActualizados ${rotos.length} movimientos: pagado false → true.`);
  console.log(JSON.stringify({ encontrados: rotos.length, actualizados: rotos.length }));
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
