// F9.151 — hallazgos no previstos. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => String(v);
const esObligacionDoc = (t?: string | null) =>
  t === 'recibo_servicio' || t === 'factura_a' || t === 'factura_b' || t === 'factura_c';

async function main() {
  const comps = await db.collection('comprobantes').get();
  const movs  = await db.collection('movimientos').get();

  // Hallazgo: el server gatea mesDePago por esObligacionDoc; el cliente NO.
  console.log('=== divergencia mesComp (server) vs mesPagoDefault (cliente) ===');
  let divergen = 0;
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    const venc = (dx.vencimientos as Array<{ fecha?: string }> | null)?.[0]?.fecha ?? null;
    const fecha = (dx.fecha as string | null) ?? null;
    const tipo = s(dx.tipoDocumento);
    const mesServer = esObligacionDoc(tipo) ? (venc ?? fecha ?? '').slice(0, 7) : (fecha ?? '').slice(0, 7);
    const mesCliente = (venc ?? fecha ?? '').slice(0, 7);
    if (mesServer === mesCliente) continue;
    divergen++;
    const mov = movs.docs.find(m => m.data().origenComprobanteId === d.id)?.data();
    console.log(d.id.slice(0, 8) + ' | doc=' + tipo.padEnd(16) + ' | server=' + mesServer + ' cliente=' + mesCliente +
      ' | mes guardado=' + s(mov?.mes) + ' | ' + s(dx.comercioRazonSocial));
  }
  console.log('comprobantes donde el mes del server != el mes que propone el cliente: ' + divergen + ' de ' + comps.size);

  // Comprobantes con vencimientos no vacíos por tipoDocumento
  console.log('\n=== comprobantes con vencimientos[0].fecha, por tipoDocumento ===');
  const porTipo: Record<string, number> = {};
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    const venc = (dx.vencimientos as Array<{ fecha?: string }> | null)?.[0]?.fecha ?? null;
    if (!venc) continue;
    porTipo[s(dx.tipoDocumento)] = (porTipo[s(dx.tipoDocumento)] ?? 0) + 1;
  }
  console.log(JSON.stringify(porTipo));

  // Estado de los destinos de cada entrante ruteado: ¿descartarEntranteCompleto podría correr?
  const ents = await db.collection('entrantes').get();
  const resus = await db.collection('resumenesTarjeta').get();
  const compEstado = new Map(comps.docs.map(d => [d.id, s(d.data().estado)]));
  const resuEstado = new Map(resus.docs.map(d => [d.id, s(d.data().estado)]));
  let bloqueados = 0, descartables = 0, sinDestino = 0;
  for (const d of ents.docs) {
    const x = d.data();
    if (x.estado !== 'ruteado') continue;
    const col = s(x.destino?.coleccion);
    const est = col === 'comprobantes' ? compEstado.get(d.id) : resuEstado.get(d.id);
    if (!est) { sinDestino++; continue; }
    if (est === 'vinculado' || est === 'confirmado') bloqueados++; else descartables++;
  }
  console.log('\n=== botón "Descartar" del card de entrante (descartarEntranteCompleto) ===');
  console.log('entrantes ruteados cuyo destino está vinculado/confirmado (el callable tira failed-precondition): ' + bloqueados);
  console.log('entrantes ruteados realmente descartables por esa vía: ' + descartables + ' | sin doc destino: ' + sinDestino);

  // tipoDetectado de los entrantes resueltos a mano
  console.log('\n=== entrantes ruteados que siguen con tipoDetectado === "ambiguo" (resueltos a mano) ===');
  for (const d of ents.docs) {
    const x = d.data();
    if (x.estado !== 'ruteado' || x.tipoDetectado !== 'ambiguo') continue;
    console.log('  ' + d.id.slice(0, 8) + ' → ' + s(x.destino?.coleccion) + ' | tipoDetectado=' + s(x.tipoDetectado) + ' | motivo="' + s(x.motivoDeteccion) + '" | ' + s(x.nombreArchivo));
  }

  // ¿Hay algún movimiento Ingreso suelto pendiente que el picker excluye?
  const ingrPend = movs.docs.filter(d => {
    const m = d.data();
    return m.tipo === 'Ingreso' && m.pagado !== true;
  });
  console.log('\n=== Ingresos con pagado !== true (nunca ofrecidos por el picker, agenda.ts:18) ===');
  for (const d of ingrPend) {
    const m = d.data();
    console.log('  ' + s(m.mes) + ' | ' + s(m.monto).padStart(12) + ' ' + s(m.moneda) + ' | ' + s(m.descripcion).slice(0, 40) + ' | item=' + s(m.itemEsperadoId ?? '-') + ' | confirmadoPago=' + s(m.confirmadoPago));
  }
  console.log('total: ' + ingrPend.length);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
