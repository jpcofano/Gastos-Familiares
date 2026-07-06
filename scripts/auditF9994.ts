// Auditoría F9.99.4 — solo lectura, no modifica nada
import * as admin from 'firebase-admin';
import * as path from 'path';

const keyPath = path.join(__dirname, '../secrets/serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(keyPath) });
const db = admin.firestore();

async function main() {
  // ── A.1 Docs en error ────────────────────────────────────────────────────
  console.log('\n=== A.1 Documentos en estado "error" ===');
  const errSnap = await db.collection('resumenesTarjeta')
    .where('estado', '==', 'error').get();
  if (errSnap.empty) {
    console.log('  (ninguno)');
  } else {
    for (const d of errSnap.docs) {
      const x = d.data();
      console.log('  id:', d.id);
      console.log('  banco:', x.banco, '| tarjeta:', x.tarjeta, '| periodo:', x.periodo);
      console.log('  errorExtraccion:', x.errorExtraccion);
      console.log('  actualizadoEn:', x.actualizadoEn?.toDate?.()?.toISOString() ?? x.actualizadoEn);
      console.log('  refStoragePdf:', x.refStoragePdf ?? '(null)');
      console.log('  ---');
    }
  }

  // ── A.2 Visa BBVA julio ──────────────────────────────────────────────────
  console.log('\n=== A.2 Visa BBVA julio 2026 ===');
  // Buscar por banco BBVA + tarjeta Visa
  const bbvaSnap = await db.collection('resumenesTarjeta')
    .where('banco', '==', 'BBVA').get();
  const bbvaDocs = bbvaSnap.docs.filter(d => {
    const x = d.data();
    return (x.tarjeta || '').toLowerCase().includes('visa');
  });
  console.log(`  Docs BBVA Visa encontrados: ${bbvaDocs.length}`);
  for (const d of bbvaDocs) {
    const x = d.data();
    const movs: any[] = x.movimientosParseados ?? [];
    console.log('\n  id:', d.id);
    console.log('  estado:', x.estado, '| periodo:', x.periodo, '| titular:', x.titular);
    console.log('  totalARS:', x.totalARS, '| totalUSD:', x.totalUSD);
    console.log('  ajustesConsolidado:', JSON.stringify(x.ajustesConsolidado ?? []));
    console.log('  movimientosParseados count:', movs.length);

    // Contar por tipoLinea
    const byTipo: Record<string, number> = {};
    const byMoneda: Record<string, number> = {};
    for (const m of movs) {
      byTipo[m.tipoLinea] = (byTipo[m.tipoLinea] ?? 0) + 1;
      byMoneda[m.moneda] = (byMoneda[m.moneda] ?? 0) + 1;
    }
    console.log('  por tipoLinea:', JSON.stringify(byTipo));
    console.log('  por moneda:', JSON.stringify(byMoneda));

    // Recalcular cuadre a mano (misma lógica que calcularCuadre)
    const tiposIngreso = ['reintegro_percepcion', 'bonificacion', 'reverso'];
    let sumaARS = 0, sumaUSD = 0;
    for (const l of movs) {
      if (!l.incluir && l.incluir !== undefined) continue;
      if (l.monto <= 0) continue;
      const signo = tiposIngreso.includes(l.tipoLinea) ? -1 : 1;
      if (l.moneda === 'ARS') sumaARS += signo * l.monto;
      else sumaUSD += signo * l.monto;
    }
    const ajustes: any[] = x.ajustesConsolidado ?? [];
    for (const a of ajustes) {
      sumaARS += a.montoARS ?? 0;
      sumaUSD += a.montoUSD ?? 0;
    }
    const diffARS = Math.abs(sumaARS - (x.totalARS ?? 0));
    const diffUSD = Math.abs(sumaUSD - (x.totalUSD ?? 0));
    console.log('  sumaARS (recalc):', sumaARS.toFixed(2), '| totalARS PDF:', x.totalARS);
    console.log('  sumaUSD (recalc):', sumaUSD.toFixed(2), '| totalUSD PDF:', x.totalUSD);
    console.log('  diffARS:', diffARS.toFixed(2), '| diffUSD:', diffUSD.toFixed(2));

    // Hipótesis 1: calcularSplitCuotas — solo consumo + cuota
    let splitARS = 0, splitUSD = 0;
    for (const l of movs) {
      if (l.tipoLinea === 'consumo' || l.tipoLinea === 'cuota') {
        if (l.moneda === 'ARS') splitARS += l.monto;
        else splitUSD += l.monto;
      }
    }
    console.log('\n  [Hipótesis 1] split(consumo+cuota) ARS:', splitARS.toFixed(2), '| USD:', splitUSD.toFixed(2));
    console.log('  Diferencia vs totalARS:', (splitARS - (x.totalARS ?? 0)).toFixed(2));
    console.log('  (impuestos − reintegros podría explicar esa diff)');

    // Listar impuestos y reintegros
    let impARS = 0, impUSD = 0, reintARS = 0, reintUSD = 0;
    for (const l of movs) {
      if (l.tipoLinea === 'impuesto') {
        if (l.moneda === 'ARS') impARS += l.monto;
        else impUSD += l.monto;
      }
      if (tiposIngreso.includes(l.tipoLinea)) {
        if (l.moneda === 'ARS') reintARS += l.monto;
        else reintUSD += l.monto;
      }
    }
    console.log('  impuestos ARS:', impARS.toFixed(2), '| USD:', impUSD.toFixed(2));
    console.log('  reintegros/bonif/reversos ARS:', reintARS.toFixed(2), '| USD:', reintUSD.toFixed(2));
    console.log('  split + impuestos - reintegros (esperado = totalARS):',
      (splitARS + impARS - reintARS).toFixed(2), 'vs', x.totalARS);
  }

  // ── A.3 Falta cubrir (USD) — itemsEsperados activos de julio 2026 ─────────
  console.log('\n=== A.3 Items esperados julio 2026 ===');
  const mesJulio = '2026-07';
  // Cargar todos los itemsEsperados (sin filtro de mes, derivar aplicaEnMes)
  const iesSnap = await db.collection('itemsEsperados').get();
  const ies = iesSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

  // Filtrar los activos para julio (periodicidad mensual activos)
  // Todos los mensual se aplican — los bimestral/trimestral/anual son placeholder hoy
  const activos = ies.filter((ie: any) => ie.activo !== false);
  console.log(`  itemsEsperados activos: ${activos.length} (de ${ies.length} totales)`);

  let nullMontoCount = 0;
  for (const ie of activos) {
    const montoNull = ie.montoEsperado == null;
    if (montoNull) nullMontoCount++;
    const desc = [ie.categoria, ie.subcategoria].filter(Boolean).join(' › ') || '(sin cat)';
    console.log(`  ${ie.id} | ${desc} | ${ie.persona || 'familiar'} | moneda:${ie.moneda} | monto:${ie.montoEsperado ?? 'NULL'} | tipo:${ie.tipo}`);
  }
  console.log(`\n  Items con montoEsperado == null: ${nullMontoCount}`);

  // Calcular esperadosArsEq usando TC de hoy desde tcDiario
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
  // Obtener TC: get el doc exacto de hoy o el más cercano anterior
  let tc = 1330;
  const tcDoc = await db.collection('tcDiario').doc(today).get();
  if (tcDoc.exists) {
    tc = tcDoc.data()!.valor;
  } else {
    // fallback: buscar los últimos 7 días
    for (let i = 1; i <= 7; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toLocaleDateString('en-CA', { timeZone: 'America/Argentina/Buenos_Aires' });
      const snap = await db.collection('tcDiario').doc(dateStr).get();
      if (snap.exists) { tc = snap.data()!.valor; break; }
    }
  }
  console.log(`\n  TC usado (${today}): ${tc}`);

  let esperadosArsEq = 0;
  for (const ie of activos) {
    if (ie.montoEsperado == null) continue;
    esperadosArsEq += ie.moneda === 'ARS' ? ie.montoEsperado : ie.montoEsperado * tc;
  }
  console.log(`  esperadosArsEq (solo items con monto): ${esperadosArsEq.toFixed(0)} ARS`);

  // Cargar movimientos de julio para calcular pesosDisp (ingresos − gastos)
  const movsSnap = await db.collection('movimientos')
    .where('mes', '==', mesJulio).get();
  const movs = movsSnap.docs.map(d => d.data());
  let ingArs = 0, gasArs = 0;
  for (const m of movs) {
    if (m.incluirResumenMes !== true && m.excluirDash === true) continue; // scope Resumen
    if (m.moneda === 'ARS') {
      if (m.tipo === 'Ingreso') ingArs += m.monto;
      else gasArs += m.monto;
    } else if (m.moneda === 'USD' && tc > 0) {
      if (m.tipo === 'Ingreso') ingArs += m.monto * (m.tcUsdArs ?? tc);
      else gasArs += m.monto * (m.tcUsdArs ?? tc);
    }
  }
  const pesosDisp = ingArs - gasArs;
  const faltaCubrirUsd = tc > 0 ? (esperadosArsEq - pesosDisp) / tc : 0;
  console.log(`  ingArs: ${ingArs.toFixed(0)} | gasArs: ${gasArs.toFixed(0)} | pesosDisp: ${pesosDisp.toFixed(0)}`);
  console.log(`  faltaCubrirUsd (calculo): ${faltaCubrirUsd.toFixed(2)}`);
  console.log(`  => ${faltaCubrirUsd <= 0 ? '"Cubierto"' : '"Falta ' + faltaCubrirUsd.toFixed(0) + ' USD"'}`);

  // Mostrar los valores reales del Resumen del mes reportados por el usuario
  console.log('\n  [Referencia del usuario] ingArs ~8.343.247 | gasArs ~9.063.637 | neto ~-720.390');
  console.log('  pesosDisp reportado: 8.343.247 (= ingresos brutos, NO el neto)');
  console.log('  Nota: en Resumen.tsx, pesosDisp = ingArs (ingresos brutos), no el neto');

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
