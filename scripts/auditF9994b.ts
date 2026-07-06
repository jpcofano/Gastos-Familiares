// Auditoría F9.99.4 — Parte A bis (solo lectura)
import * as admin from 'firebase-admin';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

const keyPath = path.join(__dirname, '../secrets/serviceAccountKey.json');
admin.initializeApp({ credential: admin.credential.cert(keyPath) });
const db = admin.firestore();
const bucket = admin.storage().bucket('gastos-familiares-e6415.firebasestorage.app');

const ERROR_HASH = 'a677fa900687fc3438c4c9a3350e54d653cc14115fa67d593400746fc8272a44';

async function main() {
  // ── A.1bis — Identificar el doc en error ─────────────────────────────────
  console.log('\n=== A.1bis: Identificar doc en error ===');

  // 1. Comparar hash contra todos los docs existentes
  const allSnap = await db.collection('resumenesTarjeta').get();
  console.log(`  Total docs en resumenesTarjeta: ${allSnap.size}`);

  let hashMatch: string | null = null;
  for (const d of allSnap.docs) {
    if (d.id === ERROR_HASH) continue; // el propio doc
    const x = d.data();
    if (x.hashPdf === ERROR_HASH) {
      hashMatch = d.id;
      console.log(`  !! DUPLICADO: hash coincide con doc ${d.id} (estado:${x.estado}, banco:${x.banco}, periodo:${x.periodo})`);
    }
  }
  if (!hashMatch) console.log('  Sin duplicado: ningún otro doc tiene hashPdf = error hash');

  // 2. Descargar el PDF de Storage
  const storageRef = `entrantes/${ERROR_HASH}`;
  const tmpPdf = path.join(os.tmpdir(), `audit_error_${ERROR_HASH.slice(0, 8)}.pdf`);
  console.log(`\n  Descargando PDF de Storage: ${storageRef}`);
  try {
    await bucket.file(storageRef).download({ destination: tmpPdf });
    const stat = fs.statSync(tmpPdf);
    console.log(`  PDF descargado: ${tmpPdf} (${(stat.size / 1024).toFixed(1)} KB)`);

    // 3. Intentar extraer texto del PDF con pdf-parse si está disponible
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pdfParse = require('pdf-parse');
      const buf = fs.readFileSync(tmpPdf);
      const data = await pdfParse(buf, { max: 3 }); // solo primeras 3 páginas
      const text = data.text.slice(0, 3000);
      console.log('\n  --- TEXTO PDF (primeras 3 páginas, primeros 3000 chars) ---');
      console.log(text);
      console.log('  --- FIN TEXTO PDF ---');
    } catch (e: any) {
      console.log(`  pdf-parse no disponible (${e.message}). Mostrando bytes del inicio:`);
      const buf = fs.readFileSync(tmpPdf);
      // Los PDFs empiezan con %PDF; buscar texto legible en los primeros 2KB
      const raw = buf.slice(0, 2000).toString('latin1');
      // Buscar strings ASCII legibles (longitud > 4)
      const strings = raw.match(/[\x20-\x7E]{5,}/g) ?? [];
      console.log('  Strings legibles del inicio:', strings.slice(0, 30).join(' | '));
    }
  } catch (e: any) {
    console.log(`  Error descargando PDF: ${e.message}`);
  }

  // ── A.2bis — Todos los resumenesTarjeta ordenados ────────────────────────
  console.log('\n\n=== A.2bis: Todos los resumenesTarjeta (con detalle de venc. 13/7) ===');

  // Convertir a array con fecha normalizada para ordenar
  type Doc = {
    id: string;
    banco: string;
    tarjeta: string;
    periodo: string;
    estado: string;
    totalARS: number;
    totalUSD: number;
    fechaCierre: Date | null;
    fechaVenc: Date | null;
    tarjetaCodigo: string | null;
    hashPdf: string | null;
    movCount: number;
    ajustes: any[];
    ultimos4?: string;
    movs: any[];
  };

  // Cargar config para los ultimos4
  const cfgDoc = await db.collection('config').doc('familia').get();
  const tarjetas: any[] = cfgDoc.data()?.tarjetas ?? [];
  const ultimos4Map: Record<string, string> = {};
  for (const t of tarjetas) {
    if (t.codigo && t.ultimos4?.length) ultimos4Map[t.codigo] = t.ultimos4[0];
  }

  const docs: Doc[] = allSnap.docs.map(d => {
    const x = d.data();
    const toDate = (v: any): Date | null => {
      if (!v) return null;
      if (typeof v.toDate === 'function') return v.toDate();
      if (typeof v === 'string') return new Date(v + 'T00:00:00');
      return null;
    };
    return {
      id: d.id.slice(0, 16) + '...',
      banco: x.banco ?? '',
      tarjeta: x.tarjeta ?? '',
      periodo: x.periodo ?? '',
      estado: x.estado ?? '',
      totalARS: x.totalARS ?? 0,
      totalUSD: x.totalUSD ?? 0,
      fechaCierre: toDate(x.fechaCierre),
      fechaVenc: toDate(x.fechaVencimiento),
      tarjetaCodigo: x.tarjetaCodigo ?? null,
      hashPdf: x.hashPdf ?? d.id,
      movCount: (x.movimientosParseados ?? []).length,
      ajustes: x.ajustesConsolidado ?? [],
      ultimos4: x.tarjetaCodigo ? ultimos4Map[x.tarjetaCodigo] : undefined,
      movs: x.movimientosParseados ?? [],
    };
  });

  // Ordenar por fechaCierre desc (nulls al final)
  docs.sort((a, b) => {
    if (!a.fechaCierre && !b.fechaCierre) return 0;
    if (!a.fechaCierre) return 1;
    if (!b.fechaCierre) return -1;
    return b.fechaCierre.getTime() - a.fechaCierre.getTime();
  });

  console.log('\n  Lista completa (fechaCierre desc):');
  console.log('  ' + ['banco', 'tarjeta', 'periodo', 'estado', 'totalARS', 'totalUSD', 'fechaCierre', 'fechaVenc', 'ultimos4'].join('\t'));
  for (const d of docs) {
    const fc = d.fechaCierre ? d.fechaCierre.toISOString().slice(0, 10) : 'null';
    const fv = d.fechaVenc ? d.fechaVenc.toISOString().slice(0, 10) : 'null';
    console.log(`  ${d.banco}\t${d.tarjeta}\t${d.periodo}\t${d.estado}\t${d.totalARS}\t${d.totalUSD}\t${fc}\t${fv}\t${d.ultimos4 ?? '?'}`);
  }

  // Identificar los que vencen el 13/7/2026
  const VENC_TARGET = '2026-07-13';
  const venc13 = docs.filter(d => d.fechaVenc?.toISOString().slice(0, 10) === VENC_TARGET);
  console.log(`\n  Docs con fechaVencimiento == ${VENC_TARGET}: ${venc13.length}`);

  for (const d of venc13) {
    const movs: any[] = d.movs;
    // Recalcular split (consumo+cuota) vs total
    const tiposIngreso = ['reintegro_percepcion', 'bonificacion', 'reverso'];
    let splitARS = 0, splitUSD = 0;
    let impARS = 0, impUSD = 0;
    let reintARS = 0, reintUSD = 0;
    for (const m of movs) {
      if (m.monto <= 0) continue;
      if (m.tipoLinea === 'consumo' || m.tipoLinea === 'cuota') {
        if (m.moneda === 'ARS') splitARS += m.monto;
        else splitUSD += m.monto;
      }
      if (m.tipoLinea === 'impuesto') {
        if (m.moneda === 'ARS') impARS += m.monto;
        else impUSD += m.monto;
      }
      if (tiposIngreso.includes(m.tipoLinea)) {
        if (m.moneda === 'ARS') reintARS += m.monto;
        else reintUSD += m.monto;
      }
    }
    const splitConImpARS = splitARS + impARS - reintARS;
    const splitConImpUSD = splitUSD + impUSD - reintUSD;
    const ajusteARS = d.ajustes.reduce((s: number, a: any) => s + (a.montoARS ?? 0), 0);

    console.log(`\n  === ${d.banco} ${d.tarjeta} ••••${d.ultimos4 ?? '????'} | periodo:${d.periodo} | estado:${d.estado} ===`);
    console.log(`  totalARS (PDF):        ${d.totalARS.toFixed(2)}`);
    console.log(`  totalUSD (PDF):        ${d.totalUSD.toFixed(2)}`);
    console.log(`  split ARS (cons+cuota): ${splitARS.toFixed(2)}    ← lo que muestra calcularSplitCuotas`);
    console.log(`  diff card vs PDF ARS:   ${(splitARS - d.totalARS).toFixed(2)}`);
    console.log(`  impuestos ARS:         ${impARS.toFixed(2)}`);
    console.log(`  reintegros ARS:        ${reintARS.toFixed(2)}`);
    console.log(`  split+imp-reint ARS:   ${splitConImpARS.toFixed(2)}`);
    console.log(`  ajustesConsolidado ARS: ${ajusteARS.toFixed(2)}  (${d.ajustes.map((a: any) => a.concepto + ':' + a.montoARS).join('; ')})`);
    console.log(`  split+imp-reint+ajuste: ${(splitConImpARS + ajusteARS).toFixed(2)}`);
    console.log(`  movimientos: ${movs.length}  (${Object.entries(
      movs.reduce((acc: any, m: any) => { acc[m.tipoLinea] = (acc[m.tipoLinea]||0)+1; return acc; }, {})
    ).map(([k,v]) => `${k}:${v}`).join(', ')})`);

    if (movs.length === 0) {
      console.log(`  ⚠ Sin movimientosParseados → card usa fallback totalARS directamente`);
    }
  }

  process.exit(0);
}

main().catch(e => { console.error(e); process.exit(1); });
