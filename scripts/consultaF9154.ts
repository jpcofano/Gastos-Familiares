// F9.154-pre — volcado crudo: Edenor vs Metrogas. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'node:fs';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();

const lineas: string[] = [];
function out(l = '') { lineas.push(l); console.log(l); }
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

// Firestore Timestamp → ISO legible, para que el volcado no escupa {_seconds:...}
function limpiar(v: unknown): unknown {
  if (v === null || v === undefined) return v;
  if (typeof v === 'object' && v !== null && '_seconds' in (v as Record<string, unknown>)) {
    return new Date((v as { _seconds: number })._seconds * 1000).toISOString();
  }
  if (Array.isArray(v)) return v.map(limpiar);
  if (typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) o[k] = limpiar(val);
    return o;
  }
  return v;
}

async function main() {
  const comps = await db.collection('comprobantes').get();
  const movs  = await db.collection('movimientos').get();
  const items = await db.collection('itemsEsperados').get();
  const dests = await db.collection('destinos').get();

  // ── (a) los dos comprobantes ───────────────────────────────────────────────
  const objetivo = comps.docs.filter(d => {
    const x = d.data();
    const dx = (x.datosExtraidos ?? {}) as Record<string, unknown>;
    const t = [dx.comercioRazonSocial, dx.destinoNombre, x.nombreArchivo].map(v => String(v ?? '')).join(' ').toUpperCase();
    return t.includes('EDENOR') || t.includes('METROGAS') || t.includes('DISTRIBUIDORA Y COMERCIALIZADORA NORTE');
  });

  out(`=== (a) comprobantes de Edenor y Metrogas: ${objetivo.length} ===`);
  out();
  objetivo.sort((a, b) => String((a.data().datosExtraidos ?? {}).fecha ?? '').localeCompare(String((b.data().datosExtraidos ?? {}).fecha ?? '')));
  for (const d of objetivo) {
    const x = d.data();
    const dx = (x.datosExtraidos ?? {}) as Record<string, unknown>;
    out(`${d.id.slice(0, 8)} | ${s(x.estado)} | ${s(dx.fecha)} | ${s(dx.montoTotal)} | ${s(dx.moneda)} | ${s(dx.tipoDocumento)}`);
    out(`  hash completo       = ${d.id}`);
    out(`  nombreArchivo       = ${s(x.nombreArchivo)}`);
    out(`  subidoEn            = ${s(limpiar(x.subidoEn))}`);
    out(`  comercioRazonSocial = ${s(dx.comercioRazonSocial)}`);
    out(`  numeroCliente       = ${s(dx.numeroCliente)}`);
    out(`  numeroOperacion     = ${s(dx.numeroOperacion)}`);
    out(`  periodoFacturado    = ${s(dx.periodoFacturado)}`);
    out(`  vencimientos        = ${JSON.stringify(dx.vencimientos)}`);
    out(`  cuit                = ${s(dx.cuit)}`);
    out(`  destinoCuit         = ${s(dx.destinoCuit)}`);
    out(`  destinoNombre       = ${s(dx.destinoNombre)}`);
    out(`  destinoCbu          = ${s(dx.destinoCbu)}`);
    out(`  destinoAlias        = ${s(dx.destinoAlias)}`);
    out(`  propuestaMatch      = ${JSON.stringify(limpiar(x.propuestaMatch), null, 4)}`);
    out();
  }

  // ── (b) ¿existe el movimiento? ─────────────────────────────────────────────
  out('=== (b) movimientos con hashPdf u origenComprobanteId de esos comprobantes ===');
  out();
  for (const d of objetivo) {
    const porHash   = movs.docs.filter(m => m.data().hashPdf === d.id);
    const porOrigen = movs.docs.filter(m => m.data().origenComprobanteId === d.id);
    const union = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const m of [...porHash, ...porOrigen]) union.set(m.id, m);
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    out(`${d.id.slice(0, 8)} (${s(dx.comercioRazonSocial)}, ${s(dx.fecha)}): ${union.size} movimiento(s)`);
    if (union.size === 0) { out('  >>> NO EXISTE NINGÚN MOVIMIENTO PARA ESTE COMPROBANTE'); out(); continue; }
    for (const m of union.values()) {
      const y = m.data();
      out(`  id=${m.id}`);
      out(`    mes=${s(y.mes)} | monto=${s(y.monto)} ${s(y.moneda)} | tipo=${s(y.tipo)} | descripcion=${s(y.descripcion)}`);
      out(`    itemEsperadoId=${s(y.itemEsperadoId)} | confirmadoPago=${s(y.confirmadoPago)} | pagado=${s(y.pagado)}`);
      out(`    origenComprobanteId=${s(y.origenComprobanteId)} | hashPdf=${s(y.hashPdf)?.slice(0, 12)}…`);
      out(`    fecha=${s(limpiar(y.fecha))} | categoria=${s(y.categoria)} > ${s(y.subcategoria)} | vencimientos=${JSON.stringify(y.vencimientos)}`);
    }
    out();
  }

  // ── (c) los ítems esperados ────────────────────────────────────────────────
  out('=== (c) itemsEsperados Casa › Luz y Casa › Gas (campos completos) ===');
  out();
  for (const d of items.docs) {
    const x = d.data();
    const sub = String(x.subcategoria ?? '');
    if (String(x.categoria) !== 'Casa' || !['Luz', 'Gas'].includes(sub)) continue;
    out(`${d.id} — ${s(x.categoria)} > ${s(x.subcategoria)}`);
    out(JSON.stringify(limpiar(x), null, 4));
    out();
  }

  // ── (d) destinos aprendidos ────────────────────────────────────────────────
  out('=== (d) destinos con "edenor", "metrogas" o "distribuidora" en destinoNorm ===');
  let hits = 0;
  for (const d of dests.docs) {
    const x = d.data();
    const norm = String(x.destinoNorm ?? '').toLowerCase();
    if (!/edenor|metrogas|distribuidora|30655116202|30659861909/.test(norm)) continue;
    hits++;
    const it = items.docs.find(i => i.id === x.itemEsperadoId)?.data();
    out(`docId=${d.id}`);
    out(`  destinoNorm=${s(x.destinoNorm)} | tipo=${s(x.tipo)} | confianza=${s(x.confianza)} | itemEsperadoId=${s(x.itemEsperadoId)}`);
    out(`  → item: ${s(it?.categoria)} > ${s(it?.subcategoria)}`);
    out(`  crudo: ${JSON.stringify(limpiar(x))}`);
    out();
  }
  if (hits === 0) out('(ninguno)');
  out();

  // Todos los destinos que apuntan a los ítems de Luz y Gas, por si el norm no tiene el nombre
  const idsLuzGas = items.docs.filter(d => String(d.data().categoria) === 'Casa' && ['Luz', 'Gas'].includes(String(d.data().subcategoria ?? ''))).map(d => d.id);
  out('=== (d bis) TODOS los destinos que apuntan a los ítems de Casa › Luz / Casa › Gas ===');
  let hits2 = 0;
  for (const d of dests.docs) {
    const x = d.data();
    if (!idsLuzGas.includes(String(x.itemEsperadoId))) continue;
    hits2++;
    const it = items.docs.find(i => i.id === x.itemEsperadoId)?.data();
    out(`  ${d.id} | norm="${s(x.destinoNorm)}" | tipo=${s(x.tipo)} | conf=${s(x.confianza)} | → ${s(it?.categoria)} > ${s(it?.subcategoria)}`);
  }
  if (hits2 === 0) out('  (ninguno)');
  out();

  // ── Movimientos del mes en esos ítems, para ver el estado del checklist ────
  out('=== (extra) TODOS los movimientos de los ítems Casa › Luz y Casa › Gas, últimos meses ===');
  const relevantes = movs.docs.filter(m => idsLuzGas.includes(String(m.data().itemEsperadoId)));
  relevantes.sort((a, b) => String(a.data().mes).localeCompare(String(b.data().mes)));
  for (const m of relevantes) {
    const y = m.data();
    const it = items.docs.find(i => i.id === y.itemEsperadoId)?.data();
    out(`  ${s(y.mes)} | ${s(it?.subcategoria).padEnd(4)} | ${s(y.monto).padStart(12)} | pagado=${String(y.pagado).padEnd(9)} confirmadoPago=${String(y.confirmadoPago).padEnd(9)} | hashPdf=${y.hashPdf ? String(y.hashPdf).slice(0, 8) : 'null'} | ${s(y.descripcion).slice(0, 34)}`);
  }
  out();

  fs.writeFileSync('docs/F9.154-pre-volcado-edenor.txt', lineas.join('\n'), 'utf8');
  console.log('(escrito también en docs/F9.154-pre-volcado-edenor.txt)');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
