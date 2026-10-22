// F9.196.1 §0.6 — SOLO LEE. Lista las `cuentasVivas/balanz_*` cuya suma de `valor_origen` supera
// 50 veces la de la corrida vigente de esa comitente: un "Mis Instrumentos" en la vista en pesos
// guardado como dólares antes de §0. No corrige nada: después del deploy se vuelve a subir el
// archivo (en la vista que sea) y queda bien.
//
// Uso (con la service account de los scripts de auditoría):
//   npx tsx scripts/listarBalanzInflados.ts
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldPath } from 'firebase-admin/firestore';
import { cuentasBalanzInfladas, type CuentaVivaBalanz } from '../src/datos/patrimonioBalanzArchivo';
import type { PosicionRaw } from '../src/types/patrimonio';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();

async function main() {
  const cuentas = (await db.collection('cuentasVivas').get()).docs
    .filter(d => d.id.startsWith('balanz_'))
    .map(d => d.data() as CuentaVivaBalanz)
    .filter(c => Array.isArray(c.posiciones) && c.posiciones.length > 0);
  // La corrida vigente: la fecha más nueva de `posicionesPatrimonio`.
  const ultima = await db.collection('posicionesPatrimonio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fecha = ultima.docs[0]?.get('fechaCorrida') as string | undefined;
  if (!fecha) { console.log('No hay corrida: no hay contra qué comparar.'); return; }
  const corrida = (await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fecha).get()).docs.map(d => d.data() as PosicionRaw);
  const tcSnap = await db.collection('tcDiario').orderBy(FieldPath.documentId(), 'desc').limit(1).get();
  const tc = (tcSnap.docs[0]?.get('tcUsdArs') as number | undefined) ?? null;

  console.log(`Corrida del ${fecha} · ${cuentas.length} cuentas vivas de Balanz · TC ${tc ?? 'sin dato'}`);
  for (const c of cuentas) console.log(`  ${c.comitente}: archivo del ${c.exportadoEn} · vista ${c.vista ?? '(sin vista: de antes de §0)'}`);
  const infladas = cuentasBalanzInfladas(cuentas, corrida, tc);
  if (!infladas.length) { console.log('\nOK — ninguna cuenta viva de Balanz está inflada.'); return; }
  console.log('\nINFLADAS (volver a subir el archivo después del deploy):');
  for (const x of infladas) {
    console.log(`  balanz_${x.comitente}: ${Math.round(x.sumaCuentaViva).toLocaleString('es-AR')} contra ${Math.round(x.sumaCorrida).toLocaleString('es-AR')} USD de la corrida (×${Math.round(x.factor)}) · archivo del ${x.exportadoEn}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
