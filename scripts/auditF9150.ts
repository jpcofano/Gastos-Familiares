// F9.150 — auditoría previa. SOLO LEE.
//
// §1 — ¿qué métrica banda REALMENTE el motor para cada clave de `semaforos`, y de qué fila la
//      cuelga la ficha? El desajuste se detecta comparando las dos cosas, no leyendo el código.
// §2 — los dos drawdowns, con datos reales, en las posiciones donde difieren.
// §3 — cantidad y valuación REALES de las posiciones manuales, para corregir el seed.
import * as fs from 'node:fs';
import { getDb } from './seed/utils/firestore';
import * as PP from '../functions/src/patrimonioPrecios';

const pct = (x: number | null | undefined, d = 1) => x == null ? '   n/d' : ((x * 100).toFixed(d) + '%').padStart(7);

/**
 * De qué campo de `Indicadores` sale cada semáforo, leído del CÓDIGO REAL del motor, no de una
 * lista escrita a mano: se extrae el cuerpo de `calcSemaforos` y se mira qué `ind.<campo>` usa
 * cada clave. Si mañana el motor cambia de métrica, esto lo ve; una tabla copiada no.
 */
function metricasDelMotor(): Record<string, string> {
  const src = fs.readFileSync('functions/src/patrimonioPrecios.ts', 'utf8');
  const i = src.indexOf('export function calcSemaforos(');
  const cuerpo = src.slice(i, src.indexOf('\n}', i));
  const out: Record<string, string> = {};
  // `clave: banda(ind.campo, …)` o `clave: bandaCaidaCalibrada(ind)`
  for (const m of cuerpo.matchAll(/(\w+):\s*banda\(ind\.(\w+)/g)) out[m[1]] = m[2];
  for (const m of cuerpo.matchAll(/(\w+):\s*bandaCaidaCalibrada\(/g)) {
    // esa función banda `distanciaMax52sPct`; se lee de su cuerpo, no se asume
    const j = src.indexOf('export function bandaCaidaCalibrada(');
    const c2 = src.slice(j, src.indexOf('\n}', j));
    const campo = c2.match(/const v = ind\.(\w+);/);
    out[m[1]] = campo ? campo[1] : '(?)';
  }
  for (const m of cuerpo.matchAll(/(\w+):\s*banda\((pesoEnCartera)/g)) out[m[1]] = '(argumento) ' + m[2];
  return out;
}

/** De qué fila cuelga la ficha cada semáforo, leído de la tabla GRUPOS real. */
function filasDeLaFicha(): Array<{ clave: string; label: string; semaforo: string }> {
  const src = fs.readFileSync('src/vistas/FichaPosicion.tsx', 'utf8');
  const out: Array<{ clave: string; label: string; semaforo: string }> = [];
  for (const m of src.matchAll(/\{ clave: '(\w+)', label: '([^']+)'[^}]*?semaforo: '(\w+)'/g)) {
    out.push({ clave: m[1], label: m[2], semaforo: m[3] });
  }
  return out;
}

async function main() {
  const db = getDb('production');

  // ── §1
  console.log('=== §1 — semaforos: metrica del motor vs fila de la ficha ===\n');
  const motor = metricasDelMotor();
  const ficha = filasDeLaFicha();
  console.log('clave          motor calcula sobre        ficha lo cuelga de        label mostrado          ¿coincide?');
  const desajustes: string[] = [];
  for (const [clave, campoMotor] of Object.entries(motor)) {
    const f = ficha.find(x => x.semaforo === clave);
    const campoFicha = f?.clave ?? '(ninguna fila)';
    const ok = campoMotor.startsWith('(argumento)') ? true : campoFicha === campoMotor;
    if (!ok) desajustes.push(`${clave}: motor=${campoMotor} ficha=${campoFicha}`);
    console.log(`${clave.padEnd(14)} ${campoMotor.padEnd(26)} ${campoFicha.padEnd(25)} ${(f?.label ?? '-').padEnd(23)} ${ok ? 'si' : '*** NO ***'}`);
  }
  console.log(`\ndesajustes: ${desajustes.length}${desajustes.length ? ' -> ' + desajustes.join(' | ') : ''}`);
  const huerfanas = ficha.filter(f => !(f.semaforo in motor));
  console.log(`filas con semaforo que el motor ya no emite: ${huerfanas.length}${huerfanas.length ? ' -> ' + huerfanas.map(h => `${h.clave}/${h.semaforo}`).join(' ') : ''}`);

  // ── §1 y §2 con datos reales
  const ind = await db.collection('indicadoresPosicion').get();
  const conDatos = ind.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(x => x.motivo === null).sort((a, b) => a.id.localeCompare(b.id));

  console.log('\n\n=== §1 — el caso medido: volatilidad 30d vs 90d y la banda que corresponde ===\n');
  console.log('ticker              clase          vol30d   vol90d   semaforo   banda que le tocaria al 30d');
  for (const x of conDatos) {
    const clase = PP.claseUmbral(x.tipo, x.paisRiesgo === 'global' ? 'global' : 'AR');
    const u = PP.UMBRALES.volatilidad[clase];
    const b = (v: number | null) => v == null ? 'sin_datos'
      : Math.abs(v) < u.verde ? 'verde' : Math.abs(v) <= u.amarillo ? 'amarillo' : 'rojo';
    const sem = x.semaforos?.volatilidad ?? '-';
    const b30 = b(x.volAnualizada30d);
    const marca = b30 !== sem ? '  <-- la fila miente' : '';
    console.log(`${x.id.padEnd(19)} ${clase.padEnd(13)} ${pct(x.volAnualizada30d)} ${pct(x.volAnualizada90d)}  ${sem.padEnd(10)} ${b30}${marca}`);
  }

  console.log('\n\n=== §2 — los dos drawdowns ===\n');
  console.log('ticker              distanciaMax52s   drawdownDesdeMax   difieren?');
  let difieren = 0;
  for (const x of conDatos) {
    const a = x.distanciaMax52sPct, b = x.drawdownDesdeMaxPct;
    const dif = a != null && b != null && Math.abs(a - b) > 0.005;
    if (dif) difieren++;
    console.log(`${x.id.padEnd(19)} ${pct(a)}          ${pct(b)}       ${dif ? `SI (${((Math.abs(b! - a!)) * 100).toFixed(1)} pp)` : ''}`);
  }
  console.log(`\ndifieren en ${difieren} de ${conDatos.length}: en el resto se ven redundantes, y ahi esta el problema`);

  // ¿está F9.149 desplegado?
  const conCalib = conDatos.filter(x => x.ddMediana != null).length;
  console.log(`\nindicadoresPosicion con calibracion de F9.149 (ddMediana): ${conCalib}/${conDatos.length}`);
  const conUlcer = conDatos.filter(x => x.ulcerIndex126 != null).length;
  console.log(`con ulcerIndex126: ${conUlcer}/${conDatos.length}`);

  // ── §3
  console.log('\n\n=== §3 — posicionesManuales REALES en produccion ===\n');
  const man = await db.collection('posicionesManuales').get();
  console.log(`${man.size} documentos`);
  for (const d of man.docs) {
    const x = d.data() as any;
    console.log(`  ${d.id.padEnd(8)} ${String(x.ticker).padEnd(6)} cantidad=${String(x.cantidad).padStart(6)}  valorUsd=${String(x.valorUsd).padStart(8)}  fechaValuacion=${x.fechaValuacion}  cuenta="${x.cuenta}"  notas="${x.notas ?? ''}"`);
  }

  console.log('\n--- lo que dice el seed hoy ---');
  const src = fs.readFileSync('src/datos/patrimonio.ts', 'utf8');
  const ini = src.indexOf('const MANUALES_SEED');
  console.log(src.slice(ini, src.indexOf('];', ini) + 2));

  // La pregunta que decide qué hacer con cada entrada del seed no es "¿está actualizada?" sino
  // "¿esto todavía tiene que existir acá?". Si la posición ya llega por la corrida, resembrarla
  // no la desactualiza: la DUPLICA.
  console.log('\n--- ¿dónde vive cada una hoy? ---');
  const port = await db.collection('snapshotsPortafolio').orderBy('fechaCorrida', 'desc').limit(1).get();
  const fc = (port.docs[0].data() as any).fechaCorrida;
  const pos = await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', fc).get();
  console.log(`corrida vigente: ${fc}`);
  for (const t of ['ACN', 'GLOB']) {
    const enCorrida = pos.docs.map(d => d.data() as any).filter(x => x.ticker === t);
    const enManuales = man.docs.some(d => (d.data() as any).ticker === t);
    console.log(`  ${t.padEnd(5)} posicionesManuales=${enManuales ? 'si' : 'NO'}  corrida=${enCorrida.length} filas`);
    for (const x of enCorrida) {
      console.log(`        tipo=${String(x.tipo).padEnd(7)} cantidad=${String(x.cantidad).padStart(5)} valorUsd=${String(Math.round(x.valorUsd)).padStart(6)} cuenta="${x.cuenta}"`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
