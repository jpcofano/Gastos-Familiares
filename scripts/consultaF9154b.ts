// F9.154-pre — ¿hay más movimientos que cayeron en un mes muy anterior a la fecha en que se subió
// el comprobante? Es la huella del año mal resuelto. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

function mesesEntre(mesA: string, mesB: string): number {
  const [ya, ma] = mesA.split('-').map(Number);
  const [yb, mb] = mesB.split('-').map(Number);
  return (yb - ya) * 12 + (mb - ma);
}

async function main() {
  const comps = await db.collection('comprobantes').get();
  const movs  = await db.collection('movimientos').get();
  const compById = new Map(comps.docs.map(d => [d.id, d.data()]));

  console.log('=== movimientos nacidos de un comprobante, ordenados por desfase mes ↔ subidoEn ===');
  console.log('(desfase negativo = el movimiento quedó ANTES del mes en que se subió el archivo)\n');

  type Fila = { desfase: number; linea: string };
  const filas: Fila[] = [];

  for (const d of movs.docs) {
    const m = d.data();
    const compId = m.origenComprobanteId as string | undefined;
    if (!compId) continue;
    const c = compById.get(compId);
    if (!c) continue;
    const subido = (c.subidoEn as FirebaseFirestore.Timestamp | undefined)?.toDate();
    if (!subido) continue;
    const mesSubida = `${subido.getFullYear()}-${String(subido.getMonth() + 1).padStart(2, '0')}`;
    const mesMov = s(m.mes);
    if (!/^\d{4}-\d{2}$/.test(mesMov)) continue;
    const desfase = mesesEntre(mesSubida, mesMov);
    const dx = (c.datosExtraidos ?? {}) as Record<string, unknown>;
    const venc = (dx.vencimientos as Array<{ fecha?: string }> | null)?.[0]?.fecha ?? null;
    filas.push({
      desfase,
      linea: `${String(desfase).padStart(3)} | mov.mes=${mesMov} | subido=${mesSubida} | venc[0]=${s(venc).padEnd(10)} | emision=${s(dx.fecha).padEnd(10)} | ${s(m.monto).padStart(11)} | ${s(m.descripcion).slice(0, 34)}`,
    });
  }

  filas.sort((a, b) => a.desfase - b.desfase);
  const sospechosos = filas.filter(f => f.desfase <= -3 || f.desfase >= 4);
  console.log(`movimientos con desfase <= -3 o >= +4 meses: ${sospechosos.length} de ${filas.length}`);
  for (const f of sospechosos) console.log('  ' + f.linea);

  console.log('\n--- distribución del desfase ---');
  const dist: Record<string, number> = {};
  for (const f of filas) dist[String(f.desfase)] = (dist[String(f.desfase)] ?? 0) + 1;
  for (const [k, v] of Object.entries(dist).sort((a, b) => Number(a[0]) - Number(b[0]))) {
    console.log(`  ${k.padStart(3)} mes(es): ${v}`);
  }

  // ── Fechas de vencimiento con año anterior al de subida ───────────────────
  console.log('\n=== comprobantes cuyo vencimientos[0].fecha cae en un AÑO anterior al de la subida ===');
  let n = 0;
  for (const d of comps.docs) {
    const c = d.data();
    const dx = (c.datosExtraidos ?? {}) as Record<string, unknown>;
    const venc = (dx.vencimientos as Array<{ fecha?: string }> | null)?.[0]?.fecha ?? null;
    const subido = (c.subidoEn as FirebaseFirestore.Timestamp | undefined)?.toDate();
    if (!venc || !subido) continue;
    if (Number(venc.slice(0, 4)) >= subido.getFullYear()) continue;
    n++;
    console.log(`  ${d.id.slice(0, 8)} | venc=${venc} | subido=${subido.toISOString().slice(0, 10)} | emision=${s(dx.fecha)} | ${s(dx.comercioRazonSocial)} | ${s(c.nombreArchivo)}`);
  }
  if (n === 0) console.log('  (ninguno más)');

  // ── ¿Cuántos comprobantes tienen `fecha` (emisión) en null? ───────────────
  const sinFecha = comps.docs.filter(d => {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    return dx.tipoDocumento && (dx.fecha === null || dx.fecha === undefined);
  });
  console.log(`\n=== comprobantes con datosExtraidos.fecha === null: ${sinFecha.length} de ${comps.size} ===`);
  for (const d of sinFecha) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    const venc = (dx.vencimientos as Array<{ fecha?: string }> | null)?.[0]?.fecha ?? null;
    console.log(`  ${d.id.slice(0, 8)} | tipo=${s(dx.tipoDocumento).padEnd(16)} | venc[0]=${s(venc).padEnd(10)} | ${s(dx.comercioRazonSocial).slice(0, 30).padEnd(30)} | ${s(d.data().nombreArchivo).slice(0, 40)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
