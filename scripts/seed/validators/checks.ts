import { Firestore } from 'firebase-admin/firestore';
import { SheetData } from '../readExcel';
import { buildTCMap, tcForDate } from '../transformers/movements';

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

  // F9.40 — contrato de scopes: Dashboard (devengado) y Resumen (caja) NO
  // reconcilian entre sí por diseño (ver docs/CLAUDE.md, "Dashboard = devengado
  // · Resumen = caja"). En vez de un assert cruzado Dashboard==Resumen (sería
  // falso), dos asserts INDEPENDIENTES Firestore-vs-Excel, uno por scope —
  // cualquier desvío de cada agregación salta solo. ARS-eq con TC por fecha
  // (mismo tcForDate que usa el seed real, no un TC único).
  const tcMap = buildTCMap(data.tcDiario);
  const arsEqExcel = (r: any): number =>
    r.Moneda === 'USD' ? (r.Monto ?? 0) * (tcForDate(tcMap, r.Fecha as Date) ?? 0) : (r.Monto ?? 0);
  const arsEqFs = (r: any): number =>
    r.moneda === 'USD' ? (r.monto ?? 0) * (r.tcUsdArs ?? 0) : (r.monto ?? 0);
  const PERIODO_REF = '2026-05';

  const dashFs = seedMovs
    .filter(r => r.mes === PERIODO_REF && r.tipo === 'Gasto' && r.excluirDash !== true)
    .reduce((s, r) => s + arsEqFs(r), 0);
  const dashXls = data.historico
    .filter(r => r.Fecha && (r.Fecha as Date).toISOString().startsWith(PERIODO_REF))
    .filter(r => r.Tipo === 'Gasto' && r.ExcluirDash !== true)
    .reduce((s, r) => s + arsEqExcel(r), 0);
  results.push({
    name: `Dashboard (devengado) gasto ${PERIODO_REF}`,
    ok: Math.abs(dashFs - dashXls) < 1,
    detail: `firestore=${dashFs.toFixed(2)} excel=${dashXls.toFixed(2)} (ARS-eq, scope ExcluirDash!=1)`,
  });

  const cajaFs = seedMovs
    .filter(r => r.mes === PERIODO_REF && r.tipo === 'Gasto' && r.incluirResumenMes === true)
    .reduce((s, r) => s + arsEqFs(r), 0);
  const cajaXls = data.historico
    .filter(r => r.Fecha && (r.Fecha as Date).toISOString().startsWith(PERIODO_REF))
    .filter(r => r.Tipo === 'Gasto' && (r.FlagResumenMes === true || r.Subtipo === 'TarjetaPago'))
    .reduce((s, r) => s + arsEqExcel(r), 0);
  results.push({
    name: `Resumen (caja) gasto ${PERIODO_REF}`,
    ok: Math.abs(cajaFs - cajaXls) < 1,
    detail: `firestore=${cajaFs.toFixed(2)} excel=${cajaXls.toFixed(2)} (ARS-eq, scope FlagResumenMes==1 ∨ TarjetaPago)`,
  });

  const dict = await db.collection('diccionario').count().get();
  results.push({
    name: 'diccionario count',
    ok: dict.data().count >= data.diccionarioAprendido.length - 15,
    detail: `firestore=${dict.data().count} excel=${data.diccionarioAprendido.length} (seed + entradas del trigger de aprendizaje)`,
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

  const totalItemsExcel = data.gastosEsperados.length + data.ingresosEsperados.length;
  const itemsCount = await db.collection('itemsEsperados').count().get();
  results.push({
    name: 'itemsEsperados sin colision',
    ok: itemsCount.data().count === totalItemsExcel,
    detail: `firestore=${itemsCount.data().count} excel=${totalItemsExcel}`,
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

  // Autorizados: cada email de miembro activo tiene su doc con memberId/rol correctos
  const activeEmails = new Map<string, { memberId: string; rol: string }>();
  for (const u of data.usuarios) {
    if (!u.Activo || !u.Persona || !u.Email || typeof u.Email !== 'string') continue;
    const email = u.Email.trim().toLowerCase();
    if (!activeEmails.has(email)) {
      activeEmails.set(email, {
        memberId: u.Persona,
        rol: u.Rol === 'admin' ? 'admin' : 'dependiente',
      });
    }
  }
  const authSnap = await db.collection('autorizados').get();
  const authMap = new Map(authSnap.docs.map(d => [d.id, d.data()]));
  const missingEmails = [...activeEmails.keys()].filter(e => !authMap.has(e));
  const badDocs = authSnap.docs.filter(d => {
    const fields = d.data();
    return !['admin', 'dependiente'].includes(fields.rol) || !fields.memberId;
  });
  const extraDocs = authSnap.docs.filter(d => !activeEmails.has(d.id));
  const authOk = missingEmails.length === 0 && badDocs.length === 0 && extraDocs.length === 0;
  results.push({
    name: 'autorizados integridad',
    ok: authOk,
    detail: authOk
      ? `OK (${authSnap.size} docs)`
      : `missing=${missingEmails.join(',')} bad=${badDocs.map(d => d.id).join(',')} extra=${extraDocs.map(d => d.id).join(',')}`,
  });

  // F9.31 — gate de verificación pre-migración: checks adicionales.

  // persona = memberId en el 100% de los movimientos (F9.24). Lista los no resueltos.
  const famData = fam.exists ? fam.data()! : null;
  const memberIds = new Set(Object.keys(famData?.miembros ?? {}));
  const personaInvalida = allMovs.filter(d => d.persona != null && !memberIds.has(d.persona as string));
  results.push({
    name: 'persona == memberId (100%)',
    ok: personaInvalida.length === 0,
    detail: personaInvalida.length === 0
      ? `OK (${allMovs.length} docs)`
      : `${personaInvalida.length} con persona no resuelta: ${[...new Set(personaInvalida.map(d => d.persona))].slice(0, 5).join(', ')} — correr scripts/seed/backfillPersonaMemberId.ts`,
  });

  // banco: valores válidos (los 4 canónicos del modelo real, ver scripts/seed/transformers/config.ts)
  const BANCOS_VALIDOS = new Set(['BBVA', 'Galicia', 'Personal Pay', 'Efectivo']);
  const bancoInvalido = allMovs.filter(d => d.banco != null && !BANCOS_VALIDOS.has(d.banco as string));
  results.push({
    name: 'banco en set canónico',
    ok: bancoInvalido.length === 0,
    detail: bancoInvalido.length === 0
      ? `OK (Efectivo cuenta aparte, se alias a Mercado Pago solo en display — F9.23)`
      : `${bancoInvalido.length} con banco fuera del set: ${[...new Set(bancoInvalido.map(d => d.banco))].slice(0, 5).join(', ')}`,
  });

  // taxonomía: categoria del movimiento debe estar en config/familia.categorias (o null)
  // F9.38 — categorias pasó de string[] a {id,nombre,activo}[]; valida contra el nombre.
  const categoriasValidas = new Set((famData?.categorias ?? []).map((c: { nombre: string }) => c.nombre));
  const catInvalida = allMovs.filter(d => d.categoria != null && !categoriasValidas.has(d.categoria as string));
  results.push({
    name: 'categoria en taxonomía conocida',
    ok: catInvalida.length === 0,
    detail: catInvalida.length === 0
      ? 'OK'
      : `${catInvalida.length} con categoría desconocida: ${[...new Set(catInvalida.map(d => d.categoria))].slice(0, 5).join(', ')}`,
  });

  // resumenesTarjeta: cuotaActual <= cuotaTotal en todas las líneas (F9.21)
  const resumenesSnap = await db.collection('resumenesTarjeta').get();
  const cuotasInconsistentes: string[] = [];
  for (const doc of resumenesSnap.docs) {
    const lineas = (doc.data().movimientosParseados ?? []) as Array<{ cuotaActual?: number; cuotaTotal?: number; seq?: number }>;
    for (const l of lineas) {
      if (l.cuotaTotal != null && l.cuotaActual != null && l.cuotaActual > l.cuotaTotal) {
        cuotasInconsistentes.push(`${doc.id}#${l.seq}`);
      }
    }
  }
  results.push({
    name: 'cuotaActual <= cuotaTotal',
    ok: cuotasInconsistentes.length === 0,
    detail: cuotasInconsistentes.length === 0
      ? `OK (${resumenesSnap.size} resúmenes)`
      : `${cuotasInconsistentes.length} líneas inconsistentes: ${cuotasInconsistentes.slice(0, 5).join(', ')}`,
  });

  // resumenesTarjeta: cuadre ARS/USD (Σ líneas ≈ total PDF, tolerancia $1 / U$S1 — mismo criterio que confirmarResumenTarjeta)
  const resumenesDescuadrados: string[] = [];
  for (const doc of resumenesSnap.docs) {
    const r = doc.data();
    const lineas = (r.movimientosParseados ?? []) as Array<{ tipoLinea: string; moneda: string; monto: number; incluir?: boolean }>;
    const ajustes = (r.ajustesConsolidado ?? []) as Array<{ montoARS: number; montoUSD: number }>;
    const sumar = (moneda: string) => lineas
      .filter(l => l.incluir !== false)
      .reduce((s, l) => {
        if (l.moneda !== moneda) return s;
        const signo = l.tipoLinea === 'reverso' || l.tipoLinea === 'bonificacion' || l.tipoLinea === 'reintegro_percepcion' ? -1 : 1;
        return s + signo * l.monto;
      }, 0) + ajustes.reduce((s, a) => s + (moneda === 'ARS' ? a.montoARS : a.montoUSD), 0);
    const totalARS = Number(r.totalARS ?? 0);
    const totalUSD = Number(r.totalUSD ?? 0);
    const diffARS = Math.abs(sumar('ARS') - totalARS);
    const diffUSD = Math.abs(sumar('USD') - totalUSD);
    if ((totalARS > 0 && diffARS > 1) || (totalUSD > 0 && diffUSD > 1)) {
      resumenesDescuadrados.push(`${doc.id} (difARS=${diffARS.toFixed(2)} difUSD=${diffUSD.toFixed(2)})`);
    }
  }
  results.push({
    name: 'resumenesTarjeta cuadre (±1)',
    ok: resumenesDescuadrados.length === 0,
    detail: resumenesDescuadrados.length === 0
      ? `OK (${resumenesSnap.size} resúmenes)`
      : `${resumenesDescuadrados.length} descuadrados: ${resumenesDescuadrados.slice(0, 5).join(', ')}`,
  });

  // tcDiario: valores en rango razonable (sanity, no exacto — el MEP real varía)
  const tcSnap = await db.collection('tcDiario').get();
  const tcFueraDeRango = tcSnap.docs.filter(d => {
    const v = Number(d.data().tcUsdArs);
    return !Number.isFinite(v) || v < 500 || v > 5000;
  });
  results.push({
    name: 'tcDiario en rango razonable (500-5000)',
    ok: tcFueraDeRango.length === 0,
    detail: tcFueraDeRango.length === 0
      ? `OK (${tcSnap.size} docs)`
      : `${tcFueraDeRango.length} fuera de rango: ${tcFueraDeRango.slice(0, 5).map(d => d.id).join(', ')}`,
  });

  // usuarios: distribución de roles esperada (2 admin + 2 dependiente)
  const miembrosVals = Object.values(famData?.miembros ?? {}) as Array<{ rol?: string; activo?: boolean }>;
  const admins = miembrosVals.filter(m => m.activo && m.rol === 'admin').length;
  const dependientes = miembrosVals.filter(m => m.activo && m.rol === 'dependiente').length;
  results.push({
    name: 'roles: 2 admin + 2 dependiente',
    ok: admins === 2 && dependientes === 2,
    detail: `admin=${admins} dependiente=${dependientes}`,
  });

  return results;
}
