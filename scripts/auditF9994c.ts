// Auditoría complementaria — cuadre exacto (respetando campo incluir) para BBVA 2308 julio
import * as admin from 'firebase-admin';
import * as path from 'path';

const keyPath = path.join(__dirname, '../secrets/serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(keyPath) });
const db = admin.firestore();

async function calcCuadreExacto(movs: any[], ajustes: any[], totalARS: number, totalUSD: number) {
  const tiposIngreso = ['reintegro_percepcion', 'bonificacion', 'reverso'];
  let sumaARS = 0, sumaUSD = 0;
  let skippedFalsy = 0, counted = 0;
  for (const l of movs) {
    // Replica EXACTA de calcularCuadre (resumenesTarjeta.ts:176)
    if (!l.incluir || l.monto <= 0) { skippedFalsy++; continue; }
    const signo = tiposIngreso.includes(l.tipoLinea) ? -1 : 1;
    if (l.moneda === 'ARS') sumaARS += signo * l.monto;
    else sumaUSD += signo * l.monto;
    counted++;
  }
  for (const a of ajustes) {
    sumaARS += a.montoARS ?? 0;
    sumaUSD += a.montoUSD ?? 0;
  }
  const diffARS = Math.abs(sumaARS - totalARS);
  const diffUSD = Math.abs(sumaUSD - totalUSD);
  return { sumaARS, sumaUSD, diffARS, diffUSD, skippedFalsy, counted };
}

async function main() {
  const snap = await db.collection('resumenesTarjeta').get();

  // Docs con vencimiento 2026-07-13
  const toDate = (v: any): Date | null => {
    if (!v) return null;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v === 'string') return new Date(v + 'T00:00:00');
    return null;
  };

  console.log('=== Cuadre exacto (respetando incluir) — venc. 2026-07-13 ===\n');

  for (const d of snap.docs) {
    const x = d.data();
    const fv = toDate(x.fechaVencimiento);
    if (!fv || fv.toISOString().slice(0, 10) !== '2026-07-13') continue;

    const movs: any[] = x.movimientosParseados ?? [];
    const ajustes: any[] = x.ajustesConsolidado ?? [];
    const res = await calcCuadreExacto(movs, ajustes, x.totalARS, x.totalUSD);

    // Verificar campo incluir
    const incluirTrue = movs.filter(m => m.incluir === true).length;
    const incluirFalse = movs.filter(m => m.incluir === false).length;
    const incluirUndef = movs.filter(m => m.incluir === undefined || m.incluir === null).length;

    console.log(`${x.banco} ${x.tarjeta} ••••${x.tarjetaCodigo ? '???' : ''}`);
    console.log(`  totalARS: ${x.totalARS.toFixed(2)}`);
    console.log(`  sumaARS (cuadre exacto): ${res.sumaARS.toFixed(2)}  diffARS: ${res.diffARS.toFixed(2)}`);
    console.log(`  lineas: total=${movs.length}, incluir=true:${incluirTrue}, false:${incluirFalse}, undef/null:${incluirUndef}`);
    console.log(`  líneas saltadas (falsy incluir + monto<=0): ${res.skippedFalsy}  contadas: ${res.counted}`);

    // Split exacto con incluir
    let splitARS = 0;
    for (const l of movs) {
      if (!l.incluir || l.monto <= 0) continue;
      if (l.tipoLinea === 'consumo' || l.tipoLinea === 'cuota') splitARS += l.monto;
    }
    console.log(`  split ARS (cons+cuota, con incluir): ${splitARS.toFixed(2)}`);
    console.log();
  }

  // También extraer nroResumen del doc del error
  const errDoc = await db.collection('resumenesTarjeta')
    .doc('a677fa900687fc3438c4c9a3350e54d653cc14115fa67d593400746fc8272a44').get();
  const errData = errDoc.data();
  console.log('=== Doc en error — campos disponibles ===');
  console.log('  estado:', errData?.estado);
  console.log('  banco:', errData?.banco || '(vacío)');
  console.log('  tarjeta:', errData?.tarjeta || '(vacío)');
  console.log('  periodo:', errData?.periodo || '(vacío)');
  console.log('  tarjetaCodigo:', errData?.tarjetaCodigo ?? '(null)');
  console.log('  nroResumen:', errData?.nroResumen ?? '(null)');
  console.log('  numeroCuenta:', errData?.numeroCuenta ?? '(null)');
  console.log('  titular:', errData?.titular ?? '(null)');
  console.log('  subidoPor:', errData?.subidoPor ?? '(null)');
  console.log('  subidoEn:', errData?.subidoEn?.toDate?.()?.toISOString() ?? '(null)');
  console.log('  refStoragePdf:', errData?.refStoragePdf ?? '(null)');
  console.log('  hashPdf:', errData?.hashPdf ?? '(null — id es el hash)');
  console.log('  Todos los campos:', Object.keys(errData ?? {}).join(', '));

  process.exit(0);
}
main().catch(e => { console.error(e); process.exit(1); });
