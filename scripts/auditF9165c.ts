// F9.165 §4 — `banco`, `persona` y `diaVencimiento` fosilizados en el ítem esperado.
// DIAGNÓSTICO Y LISTA. No escribe nada. La pregunta que decide el arreglo: ¿la variación es REAL
// (el mismo gasto se paga desde distintas cuentas) o HISTÓRICA (cambió y los viejos quedaron)?
// Se responde ordenando los movimientos por fecha.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const req = createRequire(process.cwd() + '/functions/package.json');
const esbuild = req('esbuild') as typeof import('esbuild');
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const aDate = (v: unknown) => v instanceof Timestamp ? v.toDate() : v instanceof Date ? v : new Date(0);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const tmp = path.join(os.tmpdir(), `f9165-${Date.now()}.cjs`);
esbuild.buildSync({ entryPoints: ['src/datos/checklist.ts'], bundle: true, platform: 'node', format: 'cjs', outfile: tmp, logLevel: 'silent' });
const chk = require(tmp) as { calcularChecklist: (i: any[], m: any[], mes: string) => any[] };

function docAItem(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id, tipo: d.tipo ?? 'Gasto', activo: d.activo !== false,
    categoria: d.categoria ?? null, subcategoria: d.subcategoria ?? null,
    etiqueta: d.etiqueta ?? null, persona: d.persona ?? null,
    moneda: d.moneda === 'USD' ? 'USD' : 'ARS', banco: d.banco ?? null,
    montoEsperado: d.montoEsperado ?? null, diaVencimiento: d.diaVencimiento ?? null,
    autoCalendario: d.autoCalendario ?? false, notas: d.notas ?? null,
    tarjetaCodigo: d.tarjetaCodigo ?? null, matchTexto: d.matchTexto ?? null,
    periodicidad: d.periodicidad ?? 'mensual', pagoAutomatico: d.pagoAutomatico ?? false,
    clavesDesambiguacion: d.clavesDesambiguacion ?? null, diaCorteImputacion: d.diaCorteImputacion ?? null,
  };
}
function docAMov(id: string, d: FirebaseFirestore.DocumentData) {
  return {
    id, mes: d.mes ?? '', fecha: aDate(d.fecha), descripcion: d.descripcion ?? '',
    monto: d.monto ?? 0, moneda: d.moneda === 'USD' ? 'USD' : 'ARS', tipo: d.tipo ?? 'Gasto',
    subtipo: d.subtipo ?? '', origen: d.origen ?? '', categoria: d.categoria ?? null,
    subcategoria: d.subcategoria ?? null, etiqueta: d.etiqueta ?? null, banco: d.banco ?? null,
    tarjetaCodigo: d.tarjetaCodigo ?? null, persona: d.persona || null,
    pagado: d.pagado ?? false, confirmadoPago: d.confirmadoPago ?? false,
    itemEsperadoId: d.itemEsperadoId ?? null, excluirDash: d.excluirDash ?? false,
    incluirResumenMes: d.incluirResumenMes ?? false, resumenTarjetaId: d.resumenTarjetaId ?? null,
    vencimientos: d.vencimientos ?? null, mesManual: d.mesManual ?? false,
  };
}
const mesesAtras = (n: number) => {
  const out: string[] = []; const d = new Date(); d.setDate(1);
  for (let i = 0; i < n; i++) { out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); d.setMonth(d.getMonth() - 1); }
  return out;
};

async function main() {
  console.log('F9.165 §4 — campos fosilizados del ítem esperado. SOLO LECTURA, no se escribe nada.\n');
  const items = (await db.collection('itemsEsperados').get()).docs.map(d => docAItem(d.id, d.data())).filter(i => i.activo);
  const cfg = (await db.collection('config').doc('familia').get()).data();
  const mediosVivos = ((cfg?.bancos ?? []) as any[]).map(b => s(b.nombre));
  console.log(`medios que existen HOY en config/familia.bancos: ${JSON.stringify(mediosVivos)}\n`);

  const meses = mesesAtras(6);
  const porItem = new Map<string, any[]>();
  for (const mes of meses) {
    const movs = (await db.collection('movimientos').where('mes', '==', mes).get()).docs.map(d => docAMov(d.id, d.data()));
    for (const ci of chk.calcularChecklist(items, movs, mes)) {
      const arr = porItem.get(ci.item.id) ?? [];
      arr.push(...ci.matches);
      porItem.set(ci.item.id, arr);
    }
  }

  for (const campo of ['banco', 'persona'] as const) {
    console.log('═'.repeat(126));
    console.log(`CAMPO: ${campo}`);
    console.log('═'.repeat(126));
    console.log('itemId   | categoria > subcategoria          | valor del ítem | observados en sus movimientos (conteo)          | ¿el más frec.? | ¿existe hoy?');
    let discrepan = 0, noEsMasFrecuente = 0;
    const cronologias: string[] = [];
    for (const i of items) {
      const movs = (porItem.get(i.id) ?? []).slice().sort((a, b) => a.fecha - b.fecha);
      const conteo = new Map<string, number>();
      for (const m of movs) {
        const v = s((m as any)[campo]);
        if (!v || v === 'null' || v === '(ausente)') continue;
        conteo.set(v, (conteo.get(v) ?? 0) + 1);
      }
      if (conteo.size <= 1) continue;
      discrepan++;
      const orden = [...conteo].sort((a, b) => b[1] - a[1]);
      const masFrec = orden[0][0];
      const propio = s((i as any)[campo]);
      const esMasFrec = propio === masFrec;
      if (!esMasFrec) noEsMasFrecuente++;
      const existe = campo === 'banco' ? (mediosVivos.includes(propio) ? 'sí' : '>>> NO') : '—';
      console.log(`${i.id.slice(0, 8)} | ${`${s(i.categoria)} > ${s(i.subcategoria)}`.padEnd(32).slice(0, 32)} | ${propio.padEnd(14).slice(0, 14)} | ${JSON.stringify(orden).padEnd(46).slice(0, 46)} | ${(esMasFrec ? 'sí' : '>>> NO').padEnd(14)} | ${existe}`);
      // cronología: ¿histórico o real?
      const linea = movs
        .filter(m => { const v = s((m as any)[campo]); return v && v !== 'null' && v !== '(ausente)'; })
        .map(m => `${iso(m.fecha)}:${s((m as any)[campo])}`).join('  ');
      cronologias.push(`  ${i.id.slice(0, 8)} ${`${s(i.categoria)}>${s(i.subcategoria)}`.slice(0, 26).padEnd(26)} ${linea}`);
    }
    console.log(`\n  ítems con más de un valor: ${discrepan}`);
    console.log(`  de ésos, donde el valor del ítem NO es el más frecuente: ${noEsMasFrecuente}`);
    console.log('\n  CRONOLOGÍA (¿histórico —un corte limpio— o real —alternancia—?):');
    for (const c of cronologias) console.log(c);
    console.log();
  }

  // diaVencimiento: el ítem tiene un día fijo; los movimientos traen la fecha real de vencimiento.
  console.log('═'.repeat(126));
  console.log('CAMPO: diaVencimiento');
  console.log('═'.repeat(126));
  console.log('itemId   | categoria > subcategoria          | día del ítem | días reales observados (cronológico)');
  let conVarios = 0;
  for (const i of items) {
    const movs = (porItem.get(i.id) ?? []).slice().sort((a, b) => a.fecha - b.fecha);
    const dias = movs.map(m => (m.vencimientos?.[0]?.fecha ? String(m.vencimientos[0].fecha) : null)).filter(Boolean) as string[];
    const distintos = new Set(dias.map(d => d.slice(8, 10)));
    if (distintos.size <= 1) continue;
    conVarios++;
    console.log(`${i.id.slice(0, 8)} | ${`${s(i.categoria)} > ${s(i.subcategoria)}`.padEnd(32).slice(0, 32)} | ${String(s(i.diaVencimiento)).padEnd(12)} | ${dias.join('  ')}`);
  }
  console.log(`\n  ítems cuyos vencimientos reales caen en más de un día: ${conVarios}`);
  console.log(`  ítems con diaVencimiento poblado: ${items.filter(i => i.diaVencimiento != null).length} de ${items.length}`);
  fs.rmSync(tmp, { force: true });
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
