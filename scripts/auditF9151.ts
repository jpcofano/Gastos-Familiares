// F9.151 — auditoría de ruteo de entrantes / media_type / dirección de movimientos.
// SOLO LEE. No escribe una sola vez en Firestore ni en Storage.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

if (getApps().length === 0) {
  initializeApp({
    credential: cert('./secrets/serviceAccountKey.json'),
    storageBucket: process.env.BUCKET ?? 'gastos-familiares-e6415.firebasestorage.app',
  });
}
const db = getFirestore();

function sniff(b: Buffer): string {
  if (b.length >= 4 && b.subarray(0, 4).toString('latin1') === '%PDF') return 'application/pdf';
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length >= 8 && b[0] === 0x89 && b.subarray(1, 4).toString('latin1') === 'PNG') return 'image/png';
  if (b.length >= 6 && b.subarray(0, 3).toString('latin1') === 'GIF') return 'image/gif';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  if (b.length >= 12 && b.subarray(4, 8).toString('latin1') === 'ftyp') return 'image/heic-o-mp4';
  return 'desconocido(' + b.subarray(0, 8).toString('hex') + ')';
}

const s = (v: unknown) => String(v);

async function main() {
  const arg = process.argv[2] ?? 'all';

  const ents = await db.collection('entrantes').get();
  console.log('\n=== 2.1 entrantes: ' + ents.size + ' docs ===');
  const porEstado: Record<string, number> = {};
  const porOrigen: Record<string, number> = {};
  for (const d of ents.docs) {
    const x = d.data();
    porEstado[s(x.estado)] = (porEstado[s(x.estado)] ?? 0) + 1;
    porOrigen[s(x.origen)] = (porOrigen[s(x.origen)] ?? 0) + 1;
  }
  console.log('por estado:', JSON.stringify(porEstado));
  console.log('por origen:', JSON.stringify(porOrigen));

  console.log('\n--- destino x motivoDeteccion (ruteados) ---');
  const porMotivo: Record<string, number> = {};
  for (const d of ents.docs) {
    const x = d.data();
    if (x.estado !== 'ruteado') continue;
    const k = s(x.destino?.coleccion ?? '?') + ' | ' + s(x.motivoDeteccion ?? '(sin motivo)');
    porMotivo[k] = (porMotivo[k] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(porMotivo).sort((a, b) => b[1] - a[1])) {
    console.log(String(v).padStart(3) + '  ' + k);
  }

  console.log('\n--- ambiguo + error, uno por uno ---');
  for (const d of ents.docs) {
    const x = d.data();
    if (x.estado !== 'ambiguo' && x.estado !== 'error') continue;
    console.log('[' + s(x.estado) + '] ' + d.id.slice(0, 10) + ' | ' + s(x.origen) + ' | ' + s(x.mimeType) + ' | ' + s(x.nombreArchivo) + ' | motivo: ' + s(x.motivoDeteccion));
  }

  const comps = await db.collection('comprobantes').get();
  console.log('\n=== 2.3 comprobantes: ' + comps.size + ' docs ===');
  const compsPorEstado: Record<string, number> = {};
  for (const d of comps.docs) {
    const x = d.data();
    compsPorEstado[s(x.estado)] = (compsPorEstado[s(x.estado)] ?? 0) + 1;
  }
  console.log('por estado:', JSON.stringify(compsPorEstado));

  console.log('\n--- comprobantes en error (mensaje + contentType + origen del entrante) ---');
  for (const d of comps.docs) {
    const x = d.data();
    if (x.estado !== 'error') continue;
    const ent = ents.docs.find(e => e.id === d.id)?.data();
    const msg = s(x.errorExtraccion ?? x.error ?? x.motivoError ?? '(sin campo de error)').replace(/\s+/g, ' ').slice(0, 240);
    console.log(d.id.slice(0, 10) + ' | ct=' + s(x.contentType) + ' | origen=' + s(ent?.origen ?? 'sin entrante') + ' | ' + s(x.nombreArchivo));
    console.log('      ' + msg);
  }

  const resus = await db.collection('resumenesTarjeta').get();
  const resuPorEstado: Record<string, number> = {};
  for (const d of resus.docs) resuPorEstado[s(d.data().estado)] = (resuPorEstado[s(d.data().estado)] ?? 0) + 1;
  console.log('\n=== resumenesTarjeta: ' + resus.size + ' docs — ' + JSON.stringify(resuPorEstado) + ' ===');

  console.log('\n--- H2: comprobantes cuyo entrante dijo "0 marcadores" (posibles resúmenes mal ruteados) ---');
  for (const d of ents.docs) {
    const x = d.data();
    if (x.estado !== 'ruteado') continue;
    if (x.destino?.coleccion !== 'comprobantes') continue;
    if (!s(x.motivoDeteccion).startsWith('0 marcadores')) continue;
    const c = comps.docs.find(c => c.id === d.id)?.data();
    const dx = c?.datosExtraidos as Record<string, unknown> | undefined;
    console.log(d.id.slice(0, 10) + ' | ' + s(x.nombreArchivo).slice(0, 46).padEnd(46) + ' | tipoDoc=' + s(dx?.tipoDocumento ?? '?') + ' | ' + s(dx?.comercioRazonSocial ?? ''));
  }

  const movs = await db.collection('movimientos').get();
  const conComp = movs.docs.filter(d => d.data().origenComprobanteId);
  console.log('\n=== 2.4 movimientos totales: ' + movs.size + ' — con origenComprobanteId: ' + conComp.length + ' ===');
  const porTipo: Record<string, number> = {};
  for (const d of conComp) porTipo[s(d.data().tipo)] = (porTipo[s(d.data().tipo)] ?? 0) + 1;
  console.log('por tipo:', JSON.stringify(porTipo));

  console.log('\n--- los Gasto nacidos de comprobante, con tipoDocumento y payee ---');
  for (const d of conComp) {
    const m = d.data();
    if (m.tipo !== 'Gasto') continue;
    const c = comps.docs.find(c => c.id === m.origenComprobanteId)?.data();
    const dx = c?.datosExtraidos as Record<string, unknown> | undefined;
    console.log(s(m.mes) + ' | ' + s(m.monto).padStart(12) + ' ' + s(m.moneda) + ' | ' + s(m.descripcion).slice(0, 30).padEnd(30) + ' | doc=' + s(dx?.tipoDocumento ?? '?').padEnd(18) + ' | emisor=' + s(dx?.comercioRazonSocial ?? '').slice(0, 24).padEnd(24) + ' | destino=' + s(dx?.destinoNombre ?? '').slice(0, 24));
  }

  const ingr = movs.docs.filter(d => d.data().tipo === 'Ingreso');
  console.log('\n=== Ingresos totales: ' + ingr.length + ' — con origenComprobanteId: ' + ingr.filter(d => d.data().origenComprobanteId).length + ' ===');
  const items = await db.collection('itemsEsperados').get();
  const itemsIngr = items.docs.filter(d => d.data().tipo === 'Ingreso');
  console.log('itemsEsperados totales: ' + items.size + ' — tipo=Ingreso: ' + itemsIngr.length + ' (activos: ' + itemsIngr.filter(d => d.data().activo === true).length + ')');
  for (const d of itemsIngr) {
    const x = d.data();
    console.log('  ' + d.id + ' | activo=' + s(x.activo) + ' | ' + s(x.categoria) + ' > ' + s(x.subcategoria) + ' | notas=' + s(x.notas ?? '') + ' | matchTexto=' + JSON.stringify(x.matchTexto ?? null) + ' | moneda=' + s(x.moneda));
  }
  const sueltosIngrPend = ingr.filter(d => {
    const x = d.data();
    return x.pagado !== true && !x.itemEsperadoId;
  });
  console.log('Ingresos sin itemEsperadoId y pagado!==true (los que agenda.ts:18 excluye del picker): ' + sueltosIngrPend.length);

  const dests = await db.collection('destinos').get();
  const conItem = dests.docs.filter(d => d.data().itemEsperadoId);
  const auto = conItem.filter(d => ((d.data().confianza as number) ?? 0) >= 0.9);
  const banda = conItem.filter(d => { const c = (d.data().confianza as number) ?? 0; return c >= 0.7 && c < 0.9; });
  console.log('\n=== destinos: ' + dests.size + ' — con itemEsperadoId: ' + conItem.length + ' — conf>=0.9 (alta silenciosa): ' + auto.length + ' — 0.7-0.9 (card con selector de mes): ' + banda.length + ' ===');
  for (const d of auto) {
    const x = d.data();
    const it = items.docs.find(i => i.id === x.itemEsperadoId)?.data();
    console.log('  AUTO conf=' + s(x.confianza) + ' | item=' + s(x.itemEsperadoId) + ' (' + s(it?.categoria) + ' > ' + s(it?.subcategoria) + ', tipo=' + s(it?.tipo) + ') | norm=' + s(x.norm ?? x.patron ?? ''));
  }

  if (arg === 'firestore') return;

  console.log('\n=== H5 — mimeType declarado vs magic number real (todos los entrantes) ===');
  const bucket = getStorage().bucket();
  let mentiras = 0;
  let leidos = 0;
  for (const d of ents.docs) {
    const x = d.data();
    const ruta = x.rutaStorage as string;
    let buf: Buffer;
    try {
      const [b] = await bucket.file(ruta).download({ start: 0, end: 31 });
      buf = b as Buffer;
      leidos++;
    } catch (e) {
      console.log('  ??  ' + d.id.slice(0, 10) + ' | declara=' + s(x.mimeType).padEnd(26) + ' | ERROR storage: ' + (e as Error).message.slice(0, 90));
      continue;
    }
    const real = sniff(buf);
    const coincide = real === x.mimeType;
    if (!coincide) mentiras++;
    console.log((coincide ? '  ok  ' : '  NO  ') + d.id.slice(0, 10) + ' | declara=' + s(x.mimeType).padEnd(26) + ' | real=' + real.padEnd(20) + ' | ' + s(x.origen).padEnd(13) + ' | ' + s(x.estado).padEnd(9) + ' | ' + s(x.nombreArchivo).slice(0, 44));
  }
  console.log('\nentrantes leídos de Storage: ' + leidos + ' — con mimeType declarado != bytes reales: ' + mentiras);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
