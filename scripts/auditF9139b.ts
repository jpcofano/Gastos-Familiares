// F9.139 §0 — MEDICIÓN PREVIA. SOLO LEE, no escribe una línea.
//
// Bloquea el resto del spec: la tabla de alias de §3 se arma con lo que aparezca acá, no con lo
// que se suponga. Si sale algún nombre además de "BBVA Argentina", se consulta antes de tocar.
//
// Reporta:
//   1. movimientos con banco === 'Efectivo', por mes y por origen.
//   2. TODOS los valores distintos de movimientos.banco, con conteo, marcando los que NO están
//      en config/familia.bancos por nombre exacto.
//   3. Lo mismo para movimientos.subcategoria restringido a categoria === 'Tarjetas'.
//   4. Valores distintos de resumenesTarjeta.banco, con conteo (+ estado de tarjetaCodigo, que
//      §3 necesita para saber si la fuente autoritativa existe).
//   5. config/familia.bancos completo, tal como está en prod.
//
// Uso: npx tsx scripts/auditF9139b.ts --target=production

import { getDb } from './seed/utils/firestore';

const target = process.argv.includes('--target=production') ? 'production' : 'emulator';

function conteo<T>(vals: T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}
const orden = <T,>(m: Map<T, number>) => [...m.entries()].sort((a, b) => b[1] - a[1]);
const muestra = (v: any) => v === null ? '(null)' : v === undefined ? '(undefined)' : v === '' ? '(cadena vacía)' : String(v);

async function main() {
  const db = getDb(target as 'emulator' | 'production');
  console.log(`target ${target}\n`);

  // ── 5 primero: la config es el patrón contra el que se mide todo lo demás.
  const cfgSnap = await db.collection('config').doc('familia').get();
  const cfg = cfgSnap.data() as any;
  const bancosCfg: any[] = Array.isArray(cfg?.bancos) ? cfg.bancos : [];
  console.log('=== 5 — config/familia.bancos (prod, tal cual) ===');
  console.log(`  ${bancosCfg.length} medios\n`);
  console.log(JSON.stringify(bancosCfg, null, 2));
  const nombresCfg = new Set(bancosCfg.map(b => b.nombre));
  const conDefecto = bancosCfg.filter(b => b.porDefecto === true);
  console.log(`\n  con porDefecto:true → ${conDefecto.length} ${conDefecto.length ? `(${conDefecto.map(b => b.nombre).join(', ')})` : '— el campo todavía no existe'}`);
  console.log(`  ocultos → ${bancosCfg.filter(b => b.oculto).map(b => b.nombre).join(', ') || '(ninguno)'}`);
  console.log(`  con aliasDe → ${bancosCfg.filter(b => b.aliasDe).map(b => `${b.nombre}→${b.aliasDe}`).join(', ') || '(ninguno)'}`);

  // Todos los movimientos: el volumen del proyecto lo permite y hace falta el universo entero,
  // no una ventana de meses, para no declarar "único alias" sobre una muestra parcial.
  const movSnap = await db.collection('movimientos').get();
  const movs = movSnap.docs.map(d => d.data() as any);
  console.log(`\n\n=== movimientos leídos: ${movs.length} ===`);

  // ── 1. Efectivo
  console.log('\n=== 1 — movimientos con banco === "Efectivo" ===');
  const efectivo = movs.filter(m => m.banco === 'Efectivo');
  console.log(`  total: ${efectivo.length}`);
  if (efectivo.length > 0) {
    console.log('\n  por mes:');
    for (const [k, n] of orden(conteo(efectivo.map(m => String(m.mes)))).sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
      console.log(`    ${String(k).padEnd(10)} ${n}`);
    }
    console.log('\n  por origen:');
    for (const [k, n] of orden(conteo(efectivo.map(m => muestra(m.origen))))) {
      console.log(`    ${String(k).padEnd(18)} ${n}`);
    }
  }

  // ── 2. Todos los valores de movimientos.banco
  console.log('\n=== 2 — valores distintos de movimientos.banco ===');
  console.log('  conteo  en config?  valor');
  const porBanco = orden(conteo(movs.map(m => muestra(m.banco))));
  const fueraDeConfig: string[] = [];
  for (const [val, n] of porBanco) {
    const real = String(val);
    const esNulo = real.startsWith('(');
    const enCfg = esNulo ? '—' : (nombresCfg.has(real) ? 'sí' : 'NO ←');
    if (enCfg === 'NO ←') fueraDeConfig.push(real);
    console.log(`  ${String(n).padStart(6)}  ${enCfg.padEnd(10)} ${real}`);
  }
  console.log(`\n  → BANCOS INVENTADOS (no están en config por nombre exacto): ${fueraDeConfig.length}`);
  for (const b of fueraDeConfig) console.log(`      "${b}"`);

  // ── 3. subcategoria dentro de categoria === 'Tarjetas'
  console.log('\n=== 3 — movimientos.subcategoria con categoria === "Tarjetas" ===');
  const tarj = movs.filter(m => m.categoria === 'Tarjetas');
  console.log(`  movimientos con categoria "Tarjetas": ${tarj.length}`);
  console.log('  conteo  en config?  valor');
  const fueraSub: string[] = [];
  for (const [val, n] of orden(conteo(tarj.map(m => muestra(m.subcategoria))))) {
    const real = String(val);
    const esNulo = real.startsWith('(');
    const enCfg = esNulo ? '—' : (nombresCfg.has(real) ? 'sí' : 'NO ←');
    if (enCfg === 'NO ←') fueraSub.push(real);
    console.log(`  ${String(n).padStart(6)}  ${enCfg.padEnd(10)} ${real}`);
  }
  console.log(`\n  → subcategorías que son un banco no configurado: ${fueraSub.length}`);
  for (const b of fueraSub) console.log(`      "${b}"`);

  // ── 4. resumenesTarjeta.banco (+ tarjetaCodigo, que §3 necesita)
  console.log('\n=== 4 — resumenesTarjeta ===');
  const resSnap = await db.collection('resumenesTarjeta').get();
  const res = resSnap.docs.map(d => d.data() as any);
  console.log(`  documentos: ${res.length}`);
  console.log('\n  banco (texto libre del PDF):');
  console.log('  conteo  en config?  valor');
  for (const [val, n] of orden(conteo(res.map(r => muestra(r.banco))))) {
    const real = String(val);
    const esNulo = real.startsWith('(');
    const enCfg = esNulo ? '—' : (nombresCfg.has(real) ? 'sí' : 'NO ←');
    console.log(`  ${String(n).padStart(6)}  ${enCfg.padEnd(10)} ${real}`);
  }
  // §3 depende de esto: si tarjetaCodigo viene null, el paso 1 de la precedencia no existe.
  const sinCodigo = res.filter(r => !r.tarjetaCodigo);
  console.log(`\n  tarjetaCodigo resuelto: ${res.length - sinCodigo.length}/${res.length}`);
  if (sinCodigo.length > 0) {
    console.log('  SIN tarjetaCodigo (el paso 1 de la precedencia de §3 no aplica):');
    for (const r of sinCodigo) console.log(`      periodo=${muestra(r.periodo)} banco=${muestra(r.banco)} estado=${muestra(r.estado)}`);
  }
  console.log('\n  códigos presentes:');
  for (const [val, n] of orden(conteo(res.map(r => muestra(r.tarjetaCodigo))))) {
    console.log(`  ${String(n).padStart(6)}  ${val}`);
  }

  // config.tarjetas: la fuente autoritativa del paso 1.
  const tarjetasCfg: any[] = Array.isArray(cfg?.tarjetas) ? cfg.tarjetas : [];
  console.log(`\n  config/familia.tarjetas: ${tarjetasCfg.length}`);
  for (const t of tarjetasCfg) console.log(`      codigo=${muestra(t.codigo)} banco=${muestra(t.banco)} nombre=${muestra(t.nombre)}`);
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
