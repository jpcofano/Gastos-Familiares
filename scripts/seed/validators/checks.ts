import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';

interface Result { name: string; ok: boolean; detail: string; }

function mesFromFecha(fecha: any): string | null {
  try {
    const d: Date = fecha && typeof fecha.toDate === 'function'
      ? fecha.toDate()
      : new Date(fecha);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

export async function runChecks(db: Firestore, data: SheetData): Promise<Result[]> {
  const results: Result[] = [];

  // Descarga completa una sola vez; el filtro por idLegacy se hace en JS
  // (Firestore != tiene semántica traicionera con campos ausentes vs null)
  const movsSnap = await db.collection('movimientos').get();
  const allMovs  = movsSnap.docs.map(d => ({ _id: d.id, ...d.data() }));
  const seedMovs = allMovs.filter(d => d.idLegacy != null);

  const expected = data.historico.filter(r => r.Fecha || r.Monto !== 0).length;
  results.push({
    name: 'movimientos count',
    ok: seedMovs.length === expected,
    detail: `firestore seed=${seedMovs.length} total=${allMovs.length} excel=${expected}`,
  });

  const sumFs = seedMovs
    .filter(r => r.mes === '2026-05' && r.tipo === 'Gasto' && r.moneda === 'ARS')
    .reduce((s, r) => s + (r.monto ?? 0), 0);
  const sumXls = data.historico
    .filter(r => r.Fecha && (r.Fecha as Date).toISOString().startsWith('2026-05'))
    .filter(r => r.Tipo === 'Gasto' && r.Moneda === 'ARS')
    .reduce((s, r) => s + (r.Monto ?? 0), 0);
  results.push({
    name: 'gastos ARS 2026-05',
    ok: Math.abs(sumFs - sumXls) < 0.01,
    detail: `firestore=${sumFs.toFixed(2)} excel=${sumXls.toFixed(2)}`,
  });

  const dict = await db.collection('diccionario').count().get();
  results.push({
    name: 'diccionario count',
    ok: dict.data().count >= data.diccionarioAprendido.length - 15
      && dict.data().count <= data.diccionarioAprendido.length,
    detail: `firestore=${dict.data().count} excel=${data.diccionarioAprendido.length} (consolidación esperada)`,
  });

  const etiqs = await db.collection('etiquetas').get();
  const tieneTecnicas = etiqs.docs.some(d => /^(Juan|Mar[ií]a)(ARS|USD)$/.test(d.data().valor));
  results.push({
    name: 'etiquetas sin tecnicas',
    ok: !tieneTecnicas,
    detail: tieneTecnicas ? 'hay tecnicas (mal)' : 'limpio',
  });

  const stmts = await db.collection('resumenesTarjeta').count().get();
  results.push({
    name: 'resumenesTarjeta count',
    ok: stmts.data().count === data.tarjetasResumen.length,
    detail: `firestore=${stmts.data().count} excel=${data.tarjetasResumen.length}`,
  });

  const tc = await db.collection('tcDiario').count().get();
  results.push({
    name: 'tcDiario count',
    ok: tc.data().count === data.tcDiario.filter(r => r.Fecha && r.TC_USDARS).length,
    detail: `firestore=${tc.data().count}`,
  });

  const sinTc = seedMovs.filter(d => d.tcUsdArs == null).length;
  results.push({
    name: 'movimientos sin TC',
    ok: sinTc < 10,
    detail: `${sinTc} (esperado 0 con fallback forward)`,
  });

  const fam = await db.collection('config').doc('familia').get();
  const numMiembros = fam.exists ? Object.keys(fam.data()!.miembros ?? {}).length : 0;
  results.push({
    name: 'config/familia 4 miembros',
    ok: numMiembros === 4,
    detail: `miembros=${numMiembros}`,
  });

  const tarjetaSinFlag = seedMovs
    .filter(d => d.subtipo === 'TarjetaPago' && d.incluirResumenMes !== true).length;
  results.push({
    name: 'TarjetaPago con incluirResumenMes',
    ok: tarjetaSinFlag === 0,
    detail: `${tarjetaSinFlag} TarjetaPago sin flag (esperado 0)`,
  });

  // Invariante mes: barrido completo de TODOS los movimientos (incluye manuales).
  // Un muestreo no alcanza — el caso Accenture era 1 fila en 1136.
  const mesErrors = allMovs.filter(d => mesFromFecha(d.fecha) !== d.mes);
  results.push({
    name: 'mes == YYYY-MM(fecha)',
    ok: mesErrors.length === 0,
    detail: mesErrors.length === 0
      ? `OK (${allMovs.length} docs barridos)`
      : `${mesErrors.length} docs con mes incorrecto: ${mesErrors.slice(0, 3).map(d => d._id).join(', ')}`,
  });

  return results;
}
