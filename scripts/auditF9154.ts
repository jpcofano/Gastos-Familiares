// F9.154 — auditorías previas obligatorias. SOLO LEE.
//   §1.b — distribución de distancias vencimiento ↔ subida, para fijar el umbral del guard.
//   §2   — ¿los comprobantes de AySA/ABL traen numeroCliente poblado y distinto por suministro?
//   §3   — ¿mesesAConsultar cubre el mes anterior si el corte corre la imputación hacia atrás?
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const DIA = 24 * 60 * 60 * 1000;

async function main() {
  const comps = await db.collection('comprobantes').get();
  const items = await db.collection('itemsEsperados').get();
  const dests = await db.collection('destinos').get();

  // ── §1.b — distancia entre cada vencimiento y la fecha de subida ──────────
  console.log('=== §1.b — distancia |vencimientos[i].fecha - subidoEn| sobre los ' + comps.size + ' comprobantes ===\n');
  type Row = { dias: number; linea: string };
  const rows: Row[] = [];
  let sinVenc = 0;
  for (const d of comps.docs) {
    const c = d.data();
    const dx = (c.datosExtraidos ?? {}) as Record<string, unknown>;
    const subido = (c.subidoEn as FirebaseFirestore.Timestamp | undefined)?.toDate();
    const vs = (dx.vencimientos as Array<{ fecha?: string | null }> | null) ?? [];
    if (!subido || vs.length === 0) { sinVenc++; continue; }
    vs.forEach((v, i) => {
      if (!v?.fecha) return;
      const dias = Math.round((new Date(v.fecha + 'T12:00:00Z').getTime() - subido.getTime()) / DIA);
      rows.push({
        dias,
        linea: `${String(dias).padStart(5)} d | venc[${i}]=${v.fecha} | subido=${subido.toISOString().slice(0, 10)} | ${s(dx.tipoDocumento).padEnd(16)} | ${s(dx.comercioRazonSocial).slice(0, 34)}`,
      });
    });
  }
  rows.sort((a, b) => a.dias - b.dias);
  console.log(`comprobantes sin vencimientos o sin subidoEn: ${sinVenc}`);
  console.log(`vencimientos medidos: ${rows.length}\n`);

  const bins: Array<[string, (n: number) => boolean]> = [
    ['< -365 d (más de un año atrás)', n => n < -365],
    ['-365..-181 d',                   n => n >= -365 && n <= -181],
    ['-180..-91 d',                    n => n >= -180 && n <= -91],
    ['-90..-31 d',                     n => n >= -90 && n <= -31],
    ['-30..-1 d',                      n => n >= -30 && n <= -1],
    ['0..30 d',                        n => n >= 0 && n <= 30],
    ['31..90 d',                       n => n >= 31 && n <= 90],
    ['91..180 d',                      n => n >= 91 && n <= 180],
    ['> 180 d',                        n => n > 180],
  ];
  for (const [etiqueta, test] of bins) {
    const n = rows.filter(r => test(r.dias)).length;
    console.log(`  ${etiqueta.padEnd(32)} : ${String(n).padStart(3)} ${'#'.repeat(Math.min(n, 60))}`);
  }

  console.log('\n--- los 10 más lejanos hacia atrás ---');
  for (const r of rows.slice(0, 10)) console.log('  ' + r.linea);
  console.log('--- los 10 más lejanos hacia adelante ---');
  for (const r of rows.slice(-10)) console.log('  ' + r.linea);

  const fuera183 = rows.filter(r => Math.abs(r.dias) > 183);
  console.log(`\n>>> vencimientos a MÁS de 6 meses (183 d) de la subida, en cualquier dirección: ${fuera183.length}`);
  for (const r of fuera183) console.log('  ' + r.linea);
  const fuera120 = rows.filter(r => Math.abs(r.dias) > 120);
  console.log(`>>> a más de 120 d: ${fuera120.length}`);
  for (const r of fuera120) console.log('  ' + r.linea);
  const fuera90 = rows.filter(r => Math.abs(r.dias) > 90);
  console.log(`>>> a más de 90 d: ${fuera90.length}`);
  for (const r of fuera90) console.log('  ' + r.linea);

  // ── §2 — AySA / ABL: ¿numeroCliente poblado y distinto? ───────────────────
  console.log('\n\n=== §2 — comprobantes de AySA / ABL / agua / ABL, con numeroCliente ===\n');
  const agua = comps.docs.filter(d => {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    const t = [dx.comercioRazonSocial, dx.destinoNombre, d.data().nombreArchivo].map(v => String(v ?? '')).join(' ').toUpperCase();
    return /AYSA|AGUA Y SANEAMIENTO|AGIP|ABL|INMOBILIARIO/.test(t);
  });
  agua.sort((a, b) => {
    const fa = String(((a.data().datosExtraidos ?? {}) as Record<string, unknown>).fecha ?? '');
    const fb = String(((b.data().datosExtraidos ?? {}) as Record<string, unknown>).fecha ?? '');
    return fa.localeCompare(fb);
  });
  for (const d of agua) {
    const c = d.data();
    const dx = (c.datosExtraidos ?? {}) as Record<string, unknown>;
    const venc = (dx.vencimientos as Array<{ fecha?: string }> | null)?.[0]?.fecha ?? null;
    const pm = (c.propuestaMatch ?? {}) as Record<string, unknown>;
    console.log(`${d.id.slice(0, 8)} | ${s(dx.fecha).padEnd(10)} | venc=${s(venc).padEnd(10)} | ${s(dx.montoTotal).padStart(11)} | numeroCliente=${s(dx.numeroCliente).padEnd(18)} | item=${s(pm.itemEsperadoId)}`);
    console.log(`         emisor="${s(dx.comercioRazonSocial)}" | destinoNombre="${s(dx.destinoNombre)}" | destinoCuit=${s(dx.destinoCuit)} | archivo=${s(c.nombreArchivo).slice(0, 44)}`);
  }
  console.log(`\ncon numeroCliente poblado: ${agua.filter(d => ((d.data().datosExtraidos ?? {}) as Record<string, unknown>).numeroCliente).length} de ${agua.length}`);
  const nums = new Set(agua.map(d => String(((d.data().datosExtraidos ?? {}) as Record<string, unknown>).numeroCliente ?? '')).filter(Boolean));
  console.log(`valores distintos de numeroCliente: ${JSON.stringify([...nums])}`);

  // Cobertura global de numeroCliente por tipoDocumento
  console.log('\n--- cobertura de numeroCliente por tipoDocumento (todos) ---');
  const cob: Record<string, { n: number; con: number }> = {};
  for (const d of comps.docs) {
    const dx = (d.data().datosExtraidos ?? {}) as Record<string, unknown>;
    const t = s(dx.tipoDocumento);
    cob[t] ??= { n: 0, con: 0 };
    cob[t].n++;
    if (dx.numeroCliente) cob[t].con++;
  }
  for (const [t, v] of Object.entries(cob).sort((a, b) => b[1].n - a[1].n)) {
    console.log(`  ${t.padEnd(18)} : ${String(v.con).padStart(3)} / ${String(v.n).padStart(3)} con numeroCliente`);
  }

  // ── §2 bis — destinos compartidos por más de un ítem (la colisión real) ───
  console.log('\n=== §2 bis — ítems esperados que comparten un mismo destino aprendido ===');
  const porNorm = new Map<string, Array<{ id: string; item: string }>>();
  for (const d of dests.docs) {
    const x = d.data();
    if (!x.itemEsperadoId) continue;
    const k = String(x.destinoNorm);
    if (!porNorm.has(k)) porNorm.set(k, []);
    porNorm.get(k)!.push({ id: d.id, item: String(x.itemEsperadoId) });
  }
  // Cada norm es un doc único; la colisión real es "dos ítems distintos que deberían compartir norm".
  // Se ve mirando qué ítems tienen destinos y cuáles no.
  const itemsConDestino = new Set(dests.docs.filter(d => d.data().itemEsperadoId).map(d => String(d.data().itemEsperadoId)));
  console.log(`ítems esperados: ${items.size} | con al menos un destino aprendido: ${itemsConDestino.size}`);
  for (const d of items.docs) {
    const x = d.data();
    const misDest = dests.docs.filter(t => String(t.data().itemEsperadoId) === d.id);
    console.log(`  ${d.id} | ${s(x.categoria)} > ${s(x.subcategoria)} | tipo=${s(x.tipo)} | moneda=${s(x.moneda)} | activo=${s(x.activo)} | destinos=${misDest.length} [${misDest.map(t => '"' + s(t.data().destinoNorm) + '"').join(', ')}]`);
  }

  // ── §3 — mesesAConsultar ─────────────────────────────────────────────────
  console.log('\n=== §3 — ventana mesesAConsultar del código actual ===');
  const src = require('node:fs').readFileSync('functions/src/index.ts', 'utf8') as string;
  const m = src.match(/for \(let delta = (-?\d+); delta <= (-?\d+); delta\+\+\)/);
  console.log(`  ventana leída del fuente: delta de ${m?.[1]} a ${m?.[2]} respecto de mesComp`);
  console.log('  → con corte que corre la imputación al MES ANTERIOR, ese mes es delta=-1: ' +
    (m && Number(m[1]) <= -1 ? 'YA ESTÁ INCLUIDO' : 'FALTA, hay que agregarlo'));

  console.log('\n=== §3 bis — ingresos de Accenture: día del mes en que entraron ===');
  const movs = await db.collection('movimientos').get();
  const itemsIngreso = items.docs.filter(d => d.data().tipo === 'Ingreso').map(d => d.id);
  const ing = movs.docs.filter(d => itemsIngreso.includes(String(d.data().itemEsperadoId)));
  ing.sort((a, b) => {
    const fa = (a.data().fecha as FirebaseFirestore.Timestamp | null)?.toDate()?.getTime() ?? 0;
    const fb = (b.data().fecha as FirebaseFirestore.Timestamp | null)?.toDate()?.getTime() ?? 0;
    return fa - fb;
  });
  for (const d of ing) {
    const y = d.data();
    const f = (y.fecha as FirebaseFirestore.Timestamp | null)?.toDate();
    const it = items.docs.find(i => i.id === y.itemEsperadoId)?.data();
    console.log(`  fecha=${f ? f.toISOString().slice(0, 10) : 'null'} (día ${f ? f.getUTCDate() : '?'}) | mes=${s(y.mes)} | ${s(y.monto).padStart(12)} ${s(y.moneda)} | ${s(it?.moneda)} | ${s(y.descripcion).slice(0, 26)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
