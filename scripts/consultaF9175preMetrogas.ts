// F9.175-pre — CONSULTA, pasada 3. Solo lectura. Sin commitear. El otro caso que cambia de rama.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const plano = (v: unknown): unknown => {
  if (v instanceof Timestamp) return `TS(${v.toDate().toISOString()})`;
  if (Array.isArray(v)) return v.map(plano);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, plano(x)]));
  return v;
};
const pick = (o: FirebaseFirestore.DocumentData, ks: string[]) => Object.fromEntries(ks.map(k => [k, o[k]]));

async function main() {
  const comps = await db.collection('comprobantes').get();
  const c = comps.docs.find(d => d.id.startsWith('13c1b187'))!;
  const o = comps.docs.find(d => d.id.startsWith('a650c026'))!;
  const m = await db.collection('movimientos').doc('yR4NiHeWwX87trZMTVQw').get();
  const campos = ['tipoDocumento', 'fecha', 'montoTotal', 'moneda', 'destinoCuit', 'destinoCbu', 'destinoAlias', 'destinoNombre', 'contraparteCuit', 'contraparteCbu', 'numeroCliente', 'vencimientos'];
  console.log('pago 13c1b187', JSON.stringify(plano({ id: c.id, subidoEn: c.data().subidoEn, ...pick(c.data().datosExtraidos, campos), propuestaMatch: c.data().propuestaMatch }), null, 2));
  console.log('origen a650c026', JSON.stringify(plano({ id: o.id, subidoEn: o.data().subidoEn, ...pick(o.data().datosExtraidos, campos), propuestaMatch: o.data().propuestaMatch }), null, 2));
  console.log('obligación yR4N', JSON.stringify(plano(pick(m.data()!, ['descripcion', 'monto', 'mes', 'vencimientos', 'itemEsperadoId', 'origenComprobanteId', 'confirmadoPago', 'pagado', 'pagadoEn', 'hashPdf', 'destinoCuit', 'destinoCbu', 'destinoNombre', 'creadoEn'])), null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
