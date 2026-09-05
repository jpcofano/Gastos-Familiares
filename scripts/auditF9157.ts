// F9.157 §1 — MEDICIÓN. Cuántas líneas de resumen quedaron clasificadas como ingreso, cuáles son
// plausibles, y si el descuadre y la mala clasificación son el mismo problema. SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);

// `tipoDeLinea` y `calcularCuadre` se extraen del CÓDIGO REAL, no se copian.
const src = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
function bloque(desde: string, hasta: string): string {
  const i = src.indexOf(desde);
  if (i < 0) throw new Error(`no encontré "${desde}"`);
  const j = src.indexOf(hasta, i);
  return src.slice(i, j + hasta.length);
}
const codigo = [
  bloque('function tipoDeLinea', '\n}'),
  bloque('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n');
const js = ts.transpileModule(codigo, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None },
}).outputText;
const motor = new Function(`${js}\nreturn { tipoDeLinea, calcularCuadre };`)() as {
  tipoDeLinea: (l: Record<string, unknown>) => 'Gasto' | 'Ingreso';
  calcularCuadre: (l: unknown[], a: number, u: number, aj?: unknown[]) => {
    sumaARS: number; sumaUSD: number; diffARS: number; diffUSD: number; balanceARS: boolean; balanceUSD: boolean;
  };
};

type Linea = {
  seq?: number; tipoLinea?: string; descripcionRaw?: string; monto?: number; moneda?: string;
  esBonificacion?: boolean; esReverso?: boolean; esImpuesto?: boolean;
  cuotaActual?: number; cuotaTotal?: number; incluir?: boolean; fechaConsumo?: string | null;
};

const TIPOS_INGRESO = ['reintegro_percepcion', 'bonificacion', 'reverso'];

async function main() {
  const resus = await db.collection('resumenesTarjeta').get();
  console.log(`resúmenes: ${resus.size}\n`);

  const ordenados = resus.docs.slice().sort((a, b) => s(a.data().periodo).localeCompare(s(b.data().periodo)));

  // ── §1 volcado ────────────────────────────────────────────────────────────
  console.log('=== §1 — TODAS las líneas con tipoLinea ∈ {reintegro_percepcion, bonificacion, reverso} ===\n');
  type Fila = { resumen: string; periodo: string; tarjeta: string; l: Linea };
  const filas: Fila[] = [];
  let totalLineas = 0;
  for (const d of ordenados) {
    const x = d.data();
    const lineas = (x.movimientosParseados ?? []) as Linea[];
    totalLineas += lineas.length;
    for (const l of lineas) {
      if (!TIPOS_INGRESO.includes(s(l.tipoLinea))) continue;
      filas.push({ resumen: d.id.slice(0, 8), periodo: s(x.periodo), tarjeta: `${s(x.banco)}/${s(x.tarjeta)}`, l });
    }
  }
  for (const f of filas) {
    const l = f.l;
    console.log(`${f.resumen} | ${f.periodo} | ${f.tarjeta.padEnd(30)} | ${s(l.tipoLinea).padEnd(21)} | ${s(l.descripcionRaw).slice(0, 40).padEnd(40)} | ${s(l.monto).padStart(11)} ${s(l.moneda)}`);
    console.log(`         esBonificacion=${s(l.esBonificacion).padEnd(5)} esReverso=${s(l.esReverso).padEnd(5)} esImpuesto=${s(l.esImpuesto).padEnd(5)} cuota=${s(l.cuotaActual)}/${s(l.cuotaTotal)} incluir=${s(l.incluir)}`);
  }
  console.log(`\n>>> total de líneas marcadas como ingreso: ${filas.length} sobre ${totalLineas} líneas en total`);

  // ── §1.1 — agrupadas por descripción, para separar lo plausible de lo dudoso ──
  console.log('\n=== §1.1 — agrupadas por descripción (normalizada) ===');
  const porDesc = new Map<string, Fila[]>();
  for (const f of filas) {
    const k = s(f.l.descripcionRaw).toUpperCase().replace(/\s+/g, ' ').trim();
    if (!porDesc.has(k)) porDesc.set(k, []);
    porDesc.get(k)!.push(f);
  }
  for (const [desc, fs2] of [...porDesc].sort((a, b) => b[1].length - a[1].length)) {
    const tipos = [...new Set(fs2.map(f => s(f.l.tipoLinea)))];
    console.log(`  ${String(fs2.length).padStart(2)}× "${desc.slice(0, 52).padEnd(52)}" | tipos=[${tipos.join(', ')}] | montos=[${fs2.map(f => s(f.l.monto)).slice(0, 5).join(', ')}${fs2.length > 5 ? ', …' : ''}]`);
  }

  // ── §1.2 — el seguro del auto ─────────────────────────────────────────────
  console.log('\n=== §1.2 — el seguro del auto: en cuántos resúmenes aparece y cómo quedó ===');
  // "CAJA SEG-PROMO" (La Caja Seguros) no matcheaba con "LA CAJA": en el resumen viene sin el "LA".
  // El patrón se amplía a "CAJA SEG" y a "SEG-" para no depender de cómo abrevie cada emisor.
  const RE_SEGURO = /SEGURO|CAJA SEG|SEG-|ZURICH|SANCOR|ALLIANZ|MAPFRE|FEDERACION PATRONAL|RIVADAVIA|MERCANTIL ANDINA|SURA|GALENO|ORBIS|SAN CRISTOBAL/i;
  const seguros: Array<{ resumen: string; periodo: string; tipoLinea: string; desc: string; monto: number; moneda: string }> = [];
  for (const d of ordenados) {
    const x = d.data();
    for (const l of (x.movimientosParseados ?? []) as Linea[]) {
      if (!RE_SEGURO.test(s(l.descripcionRaw))) continue;
      seguros.push({ resumen: d.id.slice(0, 8), periodo: s(x.periodo), tipoLinea: s(l.tipoLinea), desc: s(l.descripcionRaw), monto: Number(l.monto ?? 0), moneda: s(l.moneda) });
    }
  }
  if (seguros.length === 0) console.log('  (ninguna línea matchea el patrón de seguros)');
  for (const g of seguros) {
    const mal = TIPOS_INGRESO.includes(g.tipoLinea);
    console.log(`  ${mal ? '>>> INGRESO' : '    gasto  '} | ${g.resumen} | ${g.periodo} | ${g.tipoLinea.padEnd(21)} | ${g.desc.slice(0, 44).padEnd(44)} | ${String(g.monto).padStart(11)} ${g.moneda}`);
  }
  const resumSeguro = new Set(seguros.map(g => g.resumen));
  const resumSeguroMal = new Set(seguros.filter(g => TIPOS_INGRESO.includes(g.tipoLinea)).map(g => g.resumen));
  console.log(`\n  aparece en ${resumSeguro.size} resúmenes | quedó como ingreso en ${resumSeguroMal.size}`);
  const porDescSeguro = new Map<string, { bien: number; mal: number }>();
  for (const g of seguros) {
    const k = g.desc.toUpperCase().replace(/\s+/g, ' ').trim();
    const acc = porDescSeguro.get(k) ?? { bien: 0, mal: 0 };
    if (TIPOS_INGRESO.includes(g.tipoLinea)) acc.mal++; else acc.bien++;
    porDescSeguro.set(k, acc);
  }
  console.log('  --- por descripción: ¿sistemático o errático? ---');
  for (const [k, v] of porDescSeguro) {
    const veredicto = v.mal > 0 && v.bien > 0 ? 'ERRÁTICO' : v.mal > 0 ? 'siempre mal' : 'siempre bien';
    console.log(`      "${k.slice(0, 46).padEnd(46)}" bien=${v.bien} mal=${v.mal} → ${veredicto}`);
  }

  // ── §1.3 — ¿alguna descripción marcada como ingreso aparece TAMBIÉN como consumo? ──
  console.log('\n=== §1.3 — ¿la misma descripción aparece a veces como ingreso y a veces como consumo? ===');
  const todasPorDesc = new Map<string, Map<string, number>>();
  for (const d of ordenados) {
    for (const l of (d.data().movimientosParseados ?? []) as Linea[]) {
      const k = s(l.descripcionRaw).toUpperCase().replace(/\s+/g, ' ').trim();
      if (!todasPorDesc.has(k)) todasPorDesc.set(k, new Map());
      const m = todasPorDesc.get(k)!;
      m.set(s(l.tipoLinea), (m.get(s(l.tipoLinea)) ?? 0) + 1);
    }
  }
  let erraticas = 0;
  for (const [desc, tipos] of todasPorDesc) {
    const tieneIngreso = [...tipos.keys()].some(t => TIPOS_INGRESO.includes(t));
    const tieneGasto = [...tipos.keys()].some(t => !TIPOS_INGRESO.includes(t));
    if (!tieneIngreso || !tieneGasto) continue;
    erraticas++;
    console.log(`  >>> "${desc.slice(0, 50).padEnd(50)}" → ${JSON.stringify([...tipos])}`);
  }
  console.log(`  descripciones que aparecen con ambos signos: ${erraticas}`);

  // ── §1.4 — descuadre vs mala clasificación ────────────────────────────────
  console.log('\n=== §1.4 — resúmenes que descuadran, y si tienen líneas marcadas como ingreso ===');
  let descuadran = 0, descuadranConIngreso = 0;
  for (const d of ordenados) {
    const x = d.data();
    const lineas = (x.movimientosParseados ?? []) as Linea[];
    const c = motor.calcularCuadre(lineas, Number(x.totalARS ?? 0), Number(x.totalUSD ?? 0), (x.ajustesConsolidado ?? []) as unknown[]);
    const conIngreso = lineas.filter(l => TIPOS_INGRESO.includes(s(l.tipoLinea)) && l.incluir).length;
    if (c.balanceARS && c.balanceUSD) continue;
    descuadran++;
    if (conIngreso > 0) descuadranConIngreso++;
    console.log(`  ${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(x.banco)}/${s(x.tarjeta)}`);
    console.log(`      balanceARS=${c.balanceARS} diffARS=${c.diffARS.toFixed(2)} (suma=${c.sumaARS.toFixed(2)} total=${s(x.totalARS)})`);
    console.log(`      balanceUSD=${c.balanceUSD} diffUSD=${c.diffUSD.toFixed(2)} (suma=${c.sumaUSD.toFixed(2)} total=${s(x.totalUSD)})`);
    console.log(`      líneas marcadas como ingreso e incluidas: ${conIngreso}`);
  }
  console.log(`\n  descuadran: ${descuadran} de ${resus.size} | de esos, con alguna línea marcada como ingreso: ${descuadranConIngreso}`);

  // ── §1.5 — el error inverso: consumo con monto negativo ───────────────────
  console.log('\n=== §1.5 — el error inverso: tipoLinea=consumo (o cuota/impuesto) con monto <= 0 ===');
  let inversos = 0;
  for (const d of ordenados) {
    const x = d.data();
    for (const l of (x.movimientosParseados ?? []) as Linea[]) {
      if (TIPOS_INGRESO.includes(s(l.tipoLinea))) continue;
      if (Number(l.monto ?? 0) > 0) continue;
      inversos++;
      console.log(`  ${d.id.slice(0, 8)} | ${s(x.periodo)} | ${s(l.tipoLinea).padEnd(12)} | monto=${s(l.monto).padStart(11)} ${s(l.moneda)} | ${s(l.descripcionRaw).slice(0, 44)}`);
    }
  }
  console.log(`  líneas con tipo de gasto y monto <= 0: ${inversos}`);

  // Y el simétrico: líneas de ingreso con monto negativo (doble negación).
  let ingresoNegativo = 0;
  for (const f of filas) if (Number(f.l.monto ?? 0) <= 0) ingresoNegativo++;
  console.log(`  líneas marcadas como ingreso con monto <= 0 (doble negación): ${ingresoNegativo}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
