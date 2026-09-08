// F9.168 — MEDICIÓN, sin tocar nada. De los comprobantes que hoy resuelven por destino en rama 1
// o 2, ¿en cuántos `matchConEsperados` daría un ítem DISTINTO?
//
// `matchConEsperados` y `coincideToken` se BUNDLEAN del fuente (`functions/src/matchLogica.ts`,
// que no importa el SDK): es la función real, no una reimplementación. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const req = createRequire(process.cwd() + '/functions/package.json');
const esbuild = req('esbuild') as typeof import('esbuild');
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

const tmp = path.join(os.tmpdir(), `f9168-${Date.now()}.cjs`);
esbuild.buildSync({
  entryPoints: ['functions/src/matchLogica.ts'],
  bundle: true, platform: 'node', format: 'cjs', outfile: tmp, logLevel: 'silent',
});
const ml = require(tmp) as {
  matchConEsperados: (d: any, items: any[]) => any[];
};

async function main() {
  console.log('F9.168 — precedencia destino vs matchTexto. SOLO LECTURA, no se toca nada.\n');

  const comps = await db.collection('comprobantes').get();
  const itemsSnap = await db.collection('itemsEsperados').get();
  const items = itemsSnap.docs.filter(d => d.data().activo !== false).map(d => ({
    id: d.id,
    // `matchConEsperados` chequea `item.activo` (matchLogica.ts:266). Sin este campo la función
    // descarta TODO y el barrido devuelve 0 sin que 0 signifique nada. Pasó: la primera corrida
    // dio "0 distintos" por esto, no por los datos.
    activo: d.data().activo !== false,
    tipo: d.data().tipo ?? 'Gasto',
    categoria: d.data().categoria ?? null,
    subcategoria: d.data().subcategoria ?? null,
    etiqueta: d.data().etiqueta ?? null,
    persona: d.data().persona ?? null,
    moneda: d.data().moneda === 'USD' ? 'USD' : 'ARS',
    montoEsperado: d.data().montoEsperado ?? null,
    matchTexto: d.data().matchTexto ?? null,
    tarjetaCodigo: d.data().tarjetaCodigo ?? null,
    notas: d.data().notas ?? null,
    clavesDesambiguacion: d.data().clavesDesambiguacion ?? null,
    diaCorteImputacion: d.data().diaCorteImputacion ?? null,
  }));
  const nombre = (id: string) => {
    const i = items.find(x => x.id === id);
    return i ? `${s(i.categoria)} > ${s(i.subcategoria)}` : `(inactivo/borrado ${id.slice(0, 8)})`;
  };

  let porDestino = 0, sinTexto = 0, igual = 0, distinto = 0, variosTexto = 0;
  const filas: string[] = [];

  for (const d of comps.docs) {
    const dt = d.data().datosExtraidos;
    const pm = d.data().propuestaMatch;
    if (!dt || !pm) continue;
    // Los que HOY resuelven por destino en rama 1 o 2, que es donde el short-circuit decide.
    if (!pm.origenDestino) continue;
    if (pm.rama !== 1 && pm.rama !== 2) continue;
    porDestino++;

    const porTexto = ml.matchConEsperados(dt, items as any[]);
    const itemDestino = s(pm.itemEsperadoId);
    if (porTexto.length === 0) { sinTexto++; continue; }
    if (porTexto.length > 1) variosTexto++;
    const idsTexto = porTexto.map((i: any) => s(i.id));
    if (idsTexto.includes(itemDestino) && porTexto.length === 1) { igual++; continue; }
    if (idsTexto.length === 1 && idsTexto[0] === itemDestino) { igual++; continue; }
    distinto++;
    filas.push(
      `${d.id.slice(0, 12)} | ${String(s(dt.montoTotal)).padStart(11)} | ${s(dt.comercioRazonSocial).slice(0, 24).padEnd(24)} | rama ${s(pm.rama)} | ` +
      `destino → ${nombre(itemDestino).padEnd(26)} | texto → ${idsTexto.map(nombre).join(' , ')}`,
    );
  }

  console.log('=== comprobantes que hoy resuelven POR DESTINO en rama 1 o 2 ===');
  console.log('comprobante  |       monto | comercio                 | rama   | qué dice cada camino');
  for (const f of filas) console.log(f);
  if (filas.length === 0) console.log('  (ninguno difiere)');

  console.log(`\n  resuelven por destino en rama 1 o 2:        ${porDestino}`);
  console.log(`    matchConEsperados NO da ningún ítem:      ${sinTexto}   (el destino es lo único que hay)`);
  console.log(`    da EL MISMO ítem:                         ${igual}`);
  console.log(`    da un ítem DISTINTO:                      ${distinto}   ← el número de la pregunta`);
  console.log(`    (de los que dan algo, con MÁS DE UN ítem: ${variosTexto})`);
  fs.rmSync(tmp, { force: true });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
