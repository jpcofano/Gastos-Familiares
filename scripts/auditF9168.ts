// F9.168 §1+§2 (gate) — qué captura el extractor de las pantallas del banco, y por qué la
// reasignación no guarda. SOLO LEE, sin API. Va ANTES de escribir código.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const aDate = (v: unknown) => v instanceof Timestamp ? v.toDate() : null;
const iso = (d: Date | null) => d ? d.toISOString().slice(0, 16).replace('T', ' ') : '—';

/** ¿Este comprobante es una de las dos boletas de agua de septiembre? Por monto, que es el ancla. */
const MONTOS = [51672.34, 23301.99];

async function main() {
  console.log('F9.168 §1+§2 (gate) — SOLO LECTURA, antes de escribir código.\n');

  // ── §1 — los datosExtraidos crudos de los dos comprobantes de agua ─────────
  console.log('═'.repeat(110));
  console.log('§1 — LOS DOS COMPROBANTES DE AGUA: datosExtraidos COMPLETOS');
  console.log('═'.repeat(110));
  const comps = await db.collection('comprobantes').get();
  const agua = comps.docs.filter(d => {
    const dt = d.data().datosExtraidos;
    if (!dt) return false;
    const m = Number(dt.montoTotal ?? 0);
    return MONTOS.some(x => Math.abs(m - x) < 0.01);
  });
  console.log(`comprobantes en total: ${comps.size} | que matchean los dos montos: ${agua.length}\n`);

  for (const d of agua) {
    const x = d.data();
    console.log('─'.repeat(110));
    console.log(`comprobante ${d.id}`);
    console.log(`  estado=${s(x.estado)}  subidoEn=${iso(aDate(x.subidoEn))}`);
    console.log('  datosExtraidos:');
    console.log(JSON.stringify(x.datosExtraidos, null, 4).split('\n').map(l => '    ' + l).join('\n'));
    console.log('  propuestaMatch:');
    console.log(JSON.stringify(x.propuestaMatch, null, 4).split('\n').map(l => '    ' + l).join('\n'));
    // §2 — cuántos movimientos creó
    const movs = await db.collection('movimientos').where('origenComprobanteId', '==', d.id).get();
    console.log(`  movimientos con origenComprobanteId == este hash: ${movs.size}`);
    for (const m of movs.docs) {
      const y = m.data();
      console.log(`      ${m.id.slice(0, 20)} | ${s(y.descripcion).slice(0, 30).padEnd(30)} | ${s(y.monto)} ${s(y.moneda)} | mes=${s(y.mes)} | item=${s(y.itemEsperadoId)}`);
    }
  }
  if (agua.length === 0) console.log('  >>> no se encontró ninguno por monto. Se busca por texto abajo.');

  // Red de seguridad: buscar por texto en cualquier campo, por si el monto difiere.
  console.log('\n─ búsqueda por texto "del signo" en datosExtraidos de TODOS los comprobantes ─');
  for (const d of comps.docs) {
    const dt = d.data().datosExtraidos;
    if (!dt) continue;
    const json = JSON.stringify(dt).toLowerCase();
    if (!json.includes('del signo') && !json.includes('aysa') && !json.includes('agua')) continue;
    console.log(`  ${d.id.slice(0, 14)} | monto=${String(s(dt.montoTotal)).padStart(12)} | tipoDoc=${s(dt.tipoDocumento).padEnd(18)} | comercio="${s(dt.comercioRazonSocial)}" | destinoNombre="${s(dt.destinoNombre)}" | numeroCliente=${s(dt.numeroCliente)}`);
  }

  // ── los ítems de agua y sus clavesDesambiguacion ──────────────────────────
  console.log('\n' + '═'.repeat(110));
  console.log('LOS ÍTEMS DE AGUA Y SUS clavesDesambiguacion');
  console.log('═'.repeat(110));
  const items = await db.collection('itemsEsperados').get();
  for (const d of items.docs) {
    const x = d.data();
    if (!/agua/i.test(s(x.subcategoria)) && !/agua/i.test(s(x.categoria))) continue;
    console.log(`  ${d.id.slice(0, 10)} | ${s(x.categoria)} > ${s(x.subcategoria)} | activo=${s(x.activo)} | monto=${s(x.montoEsperado)}`);
    console.log(`      clavesDesambiguacion: ${JSON.stringify(x.clavesDesambiguacion)}`);
    console.log(`      matchTexto: ${JSON.stringify(x.matchTexto)}`);
  }

  // ── los destinos con desambiguacion ───────────────────────────────────────
  console.log('\n' + '═'.repeat(110));
  console.log('DESTINOS CON `desambiguacion` (qué campo usan hoy)');
  console.log('═'.repeat(110));
  const dests = await db.collection('destinos').get();
  let conDes = 0;
  for (const d of dests.docs) {
    const x = d.data();
    if (!x.desambiguacion) continue;
    conDes++;
    console.log(`  ${d.id.slice(0, 14)} | tipo=${s(x.tipo).padEnd(7)} | norm="${s(x.destinoNorm).slice(0, 34)}" | itemEsperadoId=${s(x.itemEsperadoId)}`);
    console.log(`      desambiguacion: ${JSON.stringify(x.desambiguacion)}`);
  }
  console.log(`\n  destinos en total: ${dests.size} | con desambiguacion: ${conDes}`);
  // ¿alguno apunta a los ítems de agua?
  console.log('\n  destinos que apuntan a un ítem de agua (con o sin desambiguacion):');
  const idsAgua = items.docs.filter(d => /agua/i.test(s(d.data().subcategoria))).map(d => d.id);
  for (const d of dests.docs) {
    const x = d.data();
    const apunta = idsAgua.includes(s(x.itemEsperadoId))
      || Object.values((x.desambiguacion?.valores ?? {}) as Record<string, string>).some(v => idsAgua.includes(v));
    if (!apunta) continue;
    console.log(`    ${d.id.slice(0, 14)} | tipo=${s(x.tipo)} | norm="${s(x.destinoNorm).slice(0, 40)}" | item=${s(x.itemEsperadoId)} | desamb=${JSON.stringify(x.desambiguacion)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
