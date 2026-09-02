// F9.151 §H6/H7/H8 — dirección de los movimientos nacidos de comprobante, ingresos esperados
// y material para la tabla de decisión de mes. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) {
  initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
}
const db = getFirestore();
const s = (v: unknown) => String(v);

async function main() {
  const movs = await db.collection('movimientos').get();
  const comps = await db.collection('comprobantes').get();
  const compById = new Map(comps.docs.map(d => [d.id, d.data()]));

  console.log('=== H6 — los 9 Ingresos con origenComprobanteId: ¿cómo llegaron a ser Ingreso? ===');
  for (const d of movs.docs) {
    const m = d.data();
    if (m.tipo !== 'Ingreso' || !m.origenComprobanteId) continue;
    const c = compById.get(m.origenComprobanteId as string);
    const dx = (c?.datosExtraidos ?? {}) as Record<string, unknown>;
    const pm = (c?.propuestaMatch ?? {}) as Record<string, unknown>;
    console.log(s(m.mes) + ' | ' + s(m.monto).padStart(11) + ' ' + s(m.moneda) + ' | ' + s(m.descripcion).slice(0, 30).padEnd(30) +
      ' | item=' + s(m.itemEsperadoId ?? '(ninguno)') + ' | rama=' + s(pm.rama) + ' origenDestino=' + s(pm.origenDestino) +
      ' | doc=' + s(dx.tipoDocumento) + ' | destino=' + s(dx.destinoNombre));
  }

  console.log('\n=== H7 — campos de datosExtraidos presentes en los 125 comprobantes (¿alguno indica dirección?) ===');
  const claves: Record<string, number> = {};
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    for (const k of Object.keys(dx)) claves[k] = (claves[k] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(claves).sort((a, b) => b[1] - a[1])) console.log('  ' + String(v).padStart(4) + '  ' + k);

  console.log('\n=== H7b — tipoDocumento de los 125 comprobantes ===');
  const tipos: Record<string, number> = {};
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    tipos[s(dx.tipoDocumento)] = (tipos[s(dx.tipoDocumento)] ?? 0) + 1;
  }
  console.log(JSON.stringify(tipos, null, 2));

  console.log('\n=== H8 — distribución de propuestaMatch.rama en los 125 comprobantes ===');
  const ramas: Record<string, number> = {};
  for (const d of comps.docs) {
    const pm = (d.data().propuestaMatch ?? {}) as Record<string, unknown>;
    const k = 'rama' + s(pm.rama) +
      (pm.origenDestino ? ' origenDestino' : '') +
      (pm.origenReconciliacion ? ' origenReconciliacion' : '') +
      (pm.esAdicional ? ' esAdicional' : '') +
      (pm.requiereConfirmacion === false ? ' AUTO(>=0.9)' : pm.requiereConfirmacion === true ? ' CONFIRMA(0.7-0.9)' : '');
    ramas[k] = (ramas[k] ?? 0) + 1;
  }
  for (const [k, v] of Object.entries(ramas).sort((a, b) => b[1] - a[1])) console.log('  ' + String(v).padStart(4) + '  ' + k);

  console.log('\n=== H8b — los comprobantes que pasaron por alta silenciosa (requiereConfirmacion === false) ===');
  for (const d of comps.docs) {
    const c = d.data();
    const pm = (c.propuestaMatch ?? {}) as Record<string, unknown>;
    if (pm.requiereConfirmacion !== false) continue;
    const dx = (c.datosExtraidos ?? {}) as Record<string, unknown>;
    const venc = (dx.vencimientos as Array<{ fecha?: string }> | null)?.[0]?.fecha ?? null;
    const mov = movs.docs.find(m => m.data().origenComprobanteId === d.id)?.data();
    console.log(d.id.slice(0, 8) + ' | doc=' + s(dx.tipoDocumento).padEnd(16) + ' | emision=' + s(dx.fecha) + ' | venc[0]=' + s(venc) +
      ' | mesDePago=' + s((venc ?? (dx.fecha as string) ?? '').slice(0, 7)) + ' | mes del movimiento=' + s(mov?.mes) +
      ' | conf=' + s(pm.confianza) + ' | ' + s(dx.comercioRazonSocial));
  }

  console.log('\n=== H8c — comprobantes de obligación donde mesDePago != mes de emisión (el salto de mes) ===');
  for (const d of comps.docs) {
    const c = d.data();
    const dx = (c.datosExtraidos ?? {}) as Record<string, unknown>;
    const tipo = s(dx.tipoDocumento);
    const esObl = tipo === 'recibo_servicio' || tipo === 'factura_a' || tipo === 'factura_b' || tipo === 'factura_c';
    if (!esObl) continue;
    const venc = (dx.vencimientos as Array<{ fecha?: string }> | null)?.[0]?.fecha ?? null;
    const mesPago = (venc ?? (dx.fecha as string) ?? '').slice(0, 7);
    const mesEmision = s(dx.fecha ?? '').slice(0, 7);
    if (mesPago === mesEmision) continue;
    const mov = movs.docs.find(m => m.data().origenComprobanteId === d.id)?.data();
    console.log(d.id.slice(0, 8) + ' | emision=' + mesEmision + ' venc=' + mesPago + ' | mes guardado=' + s(mov?.mes) + ' | ' + s(dx.comercioRazonSocial));
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
