// F9.153-pre — volcado crudo de las acreditaciones de haberes. SOLO LEE.
// Sale por stdout y a un archivo local (tiene CUIT y montos reales).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import * as fs from 'node:fs';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();

const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

const lineas: string[] = [];
function out(l = '') { lineas.push(l); console.log(l); }

async function main() {
  const comps = await db.collection('comprobantes').get();
  const movs  = await db.collection('movimientos').get();

  // Selección amplia a propósito: cualquier cosa que mencione ACCENTURE en cualquiera de los
  // campos de texto, más los comprobantes que originaron un movimiento de tipo Ingreso (por si
  // alguna acreditación no trae el nombre en ningún lado).
  const idsIngreso = new Set(
    movs.docs.filter(d => d.data().tipo === 'Ingreso' && d.data().origenComprobanteId)
             .map(d => d.data().origenComprobanteId as string),
  );

  type Fila = { id: string; dx: Record<string, unknown>; mov?: FirebaseFirestore.DocumentData };
  const filas: Fila[] = [];
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    const texto = [dx.comercioRazonSocial, dx.destinoNombre, dx.destinoAlias, d.data().nombreArchivo]
      .map(v => String(v ?? '')).join(' ').toUpperCase();
    const esAccenture = texto.includes('ACCENTURE');
    if (!esAccenture && !idsIngreso.has(d.id)) continue;
    const mov = movs.docs.find(m => m.data().origenComprobanteId === d.id)?.data();
    filas.push({ id: d.id, dx, mov });
  }

  filas.sort((a, b) => String(a.dx.fecha ?? '').localeCompare(String(b.dx.fecha ?? '')));

  out(`=== §1 — volcado crudo: ${filas.length} comprobantes (ACCENTURE en algún campo, o con movimiento de tipo Ingreso) ===`);
  out();
  for (const f of filas) {
    const dx = f.dx;
    out(`${f.id.slice(0, 8)} | ${s(dx.fecha).padEnd(10)} | ${s(dx.moneda).padEnd(3)} | ${s(dx.montoTotal).padStart(12)} | ${s(dx.tipoDocumento)}`);
    out(`  cuit                = ${s(dx.cuit)}`);
    out(`  destinoCuit         = ${s(dx.destinoCuit)}`);
    out(`  destinoCbu          = ${s(dx.destinoCbu)}`);
    out(`  destinoAlias        = ${s(dx.destinoAlias)}`);
    out(`  destinoNombre       = ${s(dx.destinoNombre)}`);
    out(`  comercioRazonSocial = ${s(dx.comercioRazonSocial)}`);
    out(`  [mov] tipo=${s(f.mov?.tipo)} mes=${s(f.mov?.mes)} item=${s(f.mov?.itemEsperadoId)} desc=${s(f.mov?.descripcion)}`);
    out();
  }

  // ── Los docs de `destinos` que apuntan a ítems de Ingreso ──────────────────
  const items = await db.collection('itemsEsperados').get();
  const itemsIngreso = new Map(items.docs.filter(d => d.data().tipo === 'Ingreso').map(d => [d.id, d.data()]));
  const dests = await db.collection('destinos').get();

  out('=== destinos que apuntan a un ítem esperado de tipo Ingreso ===');
  out('(doc id = sha256(norm).slice(0,24); un solo itemEsperadoId por doc)');
  out();
  for (const d of dests.docs) {
    const x = d.data();
    const itemId = x.itemEsperadoId as string | undefined;
    if (!itemId || !itemsIngreso.has(itemId)) continue;
    const it = itemsIngreso.get(itemId)!;
    out(`docId=${d.id}`);
    out(`  tipo=${s(x.tipo)} | confianza=${s(x.confianza)} | itemEsperadoId=${s(itemId)}`);
    out(`  destinoNorm=${s(x.destinoNorm)}`);
    out(`  item: ${s(it.categoria)} > ${s(it.subcategoria)} | moneda=${s(it.moneda)} | matchTexto=${JSON.stringify(it.matchTexto ?? null)}`);
    out(`  campos crudos del doc: ${JSON.stringify(x)}`);
    out();
  }

  // Todos los itemsEsperados de Ingreso, para ver qué existe hoy
  out('=== itemsEsperados tipo=Ingreso ===');
  for (const d of items.docs) {
    const x = d.data();
    if (x.tipo !== 'Ingreso') continue;
    out(`${d.id} | activo=${s(x.activo)} | moneda=${s(x.moneda)} | ${s(x.categoria)} > ${s(x.subcategoria)} | persona=${s(x.persona)} | matchTexto=${JSON.stringify(x.matchTexto ?? null)}`);
  }
  out();

  fs.writeFileSync('docs/F9.153-pre-volcado-cuit.txt', lineas.join('\n'), 'utf8');
  console.log('\n(escrito también en docs/F9.153-pre-volcado-cuit.txt)');
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
