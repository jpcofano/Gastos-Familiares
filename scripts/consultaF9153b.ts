// F9.153-pre — contexto del volcado: ¿el null del CUIT es específico de las acreditaciones o
// global? ¿dónde están los recibo*.png? SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

async function main() {
  const comps = await db.collection('comprobantes').get();
  const ents  = await db.collection('entrantes').get();
  const movs  = await db.collection('movimientos').get();

  // ── ¿Qué tan poblado está `cuit` en TODA la colección, por tipoDocumento? ───
  console.log('=== cobertura de los campos de identificación, por tipoDocumento (125 comprobantes) ===');
  const tabla: Record<string, { n: number; cuit: number; destinoCuit: number; destinoCbu: number; destinoAlias: number; destinoNombre: number }> = {};
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    const t = s(dx.tipoDocumento);
    tabla[t] ??= { n: 0, cuit: 0, destinoCuit: 0, destinoCbu: 0, destinoAlias: 0, destinoNombre: 0 };
    const f = tabla[t];
    f.n++;
    if (dx.cuit) f.cuit++;
    if (dx.destinoCuit) f.destinoCuit++;
    if (dx.destinoCbu) f.destinoCbu++;
    if (dx.destinoAlias) f.destinoAlias++;
    if (dx.destinoNombre) f.destinoNombre++;
  }
  console.log('tipoDocumento      |   n | cuit | dCuit | dCbu | dAlias | dNombre');
  for (const [t, f] of Object.entries(tabla).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`${t.padEnd(18)} | ${String(f.n).padStart(3)} | ${String(f.cuit).padStart(4)} | ${String(f.destinoCuit).padStart(5)} | ${String(f.destinoCbu).padStart(4)} | ${String(f.destinoAlias).padStart(6)} | ${String(f.destinoNombre).padStart(7)}`);
  }

  // ── Los 9 ingresos: ¿cómo se llaman los archivos? ──────────────────────────
  const idsIngreso = new Set(
    movs.docs.filter(d => d.data().tipo === 'Ingreso' && d.data().origenComprobanteId)
             .map(d => d.data().origenComprobanteId as string),
  );
  console.log('\n=== nombre de archivo + contentType de los 9 comprobantes de acreditación ===');
  for (const d of comps.docs) {
    if (!idsIngreso.has(d.id)) continue;
    const x = d.data();
    const dx = (x.datosExtraidos ?? {}) as Record<string, unknown>;
    console.log(`${d.id.slice(0, 8)} | ${s(dx.fecha)} | ${s(dx.moneda).padEnd(3)} | ${s(x.contentType).padEnd(16)} | ${s(x.nombreArchivo)}`);
  }

  // ── ¿Existe algún archivo llamado recibo*? ─────────────────────────────────
  console.log('\n=== archivos cuyo nombre empieza con "recibo" (entrantes y comprobantes) ===');
  let hits = 0;
  for (const d of ents.docs) {
    const n = String(d.data().nombreArchivo ?? '');
    if (!/^recibo/i.test(n)) continue;
    hits++;
    console.log(`[entrante]    ${d.id.slice(0, 8)} | ${s(d.data().estado)} | ${s(d.data().mimeType)} | ${n}`);
  }
  for (const d of comps.docs) {
    const n = String(d.data().nombreArchivo ?? '');
    if (!/^recibo/i.test(n)) continue;
    hits++;
    console.log(`[comprobante] ${d.id.slice(0, 8)} | ${s(d.data().estado)} | ${s(d.data().contentType)} | ${n}`);
  }
  if (hits === 0) console.log('(ninguno)');

  // ── ¿Y los que sí tienen cuit, cómo se ven? (control de que el extractor puede) ──
  console.log('\n=== control: comprobantes CON cuit poblado, para ver que el extractor sí lo saca ===');
  let n = 0;
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    if (!dx.cuit) continue;
    if (n++ >= 8) break;
    console.log(`${d.id.slice(0, 8)} | ${s(dx.tipoDocumento).padEnd(16)} | cuit=${s(dx.cuit).padEnd(15)} | destinoCuit=${s(dx.destinoCuit).padEnd(12)} | ${s(dx.comercioRazonSocial)}`);
  }
  const conCuit = comps.docs.filter(d => ((d.data().datosExtraidos ?? {}) as Record<string, unknown>).cuit).length;
  console.log(`total con cuit poblado: ${conCuit} de ${comps.size}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
