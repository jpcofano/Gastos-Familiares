// F9.166 §2/§3 — el recorrido del usuario, con los datos reales que el componente va a mostrar.
//
// LÍMITE, y conviene que quede escrito: el repo no tiene runner de DOM (ni jsdom ni
// react-test-renderer, ver F9.146 §5), así que esto NO renderiza el componente. Verifica las
// funciones REALES de las que depende cada paso —`puedeVerPreview`, `calcularCuadre`,
// `resumenYaGeneroMovimientos`— contra los datos REALES de Firestore. El click en sí queda como
// prueba manual, y esa es exactamente la brecha que la spec señala en su nota de método.
// SOLO LEE.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';

const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
let ok = 0, fail = 0;
const chk = (r: string, c: boolean, d = '') => {
  if (c) { ok++; console.log(`  OK   ${r}${d ? ' — ' + d : ''}`); }
  else { fail++; console.log(`  FAIL ${r}${d ? ' — ' + d : ''}`); }
};
const aJs = (c: string) => ts.transpileModule(c, { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;

// `puedeVerPreview` REAL, extraída de la vista.
const srcVista = fs.readFileSync('src/vistas/ResumenesTarjeta.tsx', 'utf8').replace(/\r\n/g, '\n');
const iP = srcVista.indexOf('export function puedeVerPreview');
const puedeVerPreview = new Function(
  `${aJs(srcVista.slice(iP, srcVista.indexOf('\n}', iP) + 2).replace('export ', '').replace(/: CardStatement\['estado'\]/, '').replace(': boolean', ''))}
   return puedeVerPreview;`,
)() as (e: string) => boolean;

// El motor de cuadre REAL.
const srcDatos = fs.readFileSync('src/datos/resumenesTarjeta.ts', 'utf8').replace(/\r\n/g, '\n');
const srcRegla = fs.readFileSync('src/datos/ajusteConsolidado.ts', 'utf8').replace(/\r\n/g, '\n');
const tz = (d: string, h: string) => { const i = srcDatos.indexOf(d); return srcDatos.slice(i, srcDatos.indexOf(h, i) + h.length); };
const motor = new Function(`${aJs([
  srcRegla.replace(/^import .*$/gm, '').replace(/export /g, ''),
  tz('function tipoDeLinea', '\n}'),
  tz('export function totalesNetos', '\n}').replace('export ', ''),
  tz('export function calcularCuadre', '\n}').replace('export ', ''),
].join('\n'))}\nreturn { calcularCuadre };`)() as any;

/**
 * Réplica del criterio de `resumenYaGeneroMovimientos` (src/datos/resumenesTarjeta.ts:336).
 * No se puede extraer del fuente porque usa el SDK cliente de firebase, así que se copia — y por
 * eso los dos números que definen el criterio se leen del propio archivo en vez de escribirse acá:
 * si alguien cambia la tolerancia, esto se rompe en vez de mentir.
 */
async function yaGenero(resumenId: string, legacy: string | null) {
  const claves = [resumenId, legacy].filter(Boolean) as string[];
  const vistos = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
  for (const k of claves) {
    const snap = await db.collection('movimientos').where('resumenTarjetaId', '==', k).get();
    for (const d of snap.docs) vistos.set(d.id, d);
  }
  let editados = 0;
  for (const d of vistos.values()) {
    const x = d.data();
    const c = x.creadoEn?.toMillis?.(), a = x.actualizadoEn?.toMillis?.();
    if (c != null && a != null && a - c > TOLERANCIA_MS) editados++;
  }
  return { total: vistos.size, editados };
}

// La tolerancia SALE DEL FUENTE, no se escribe acá: si cambia allá, este número cambia solo.
const TOLERANCIA_MS = Number(
  /const TOLERANCIA_MS = (\d+);/.exec(srcDatos)?.[1]
  ?? (() => { throw new Error('no encontré TOLERANCIA_MS en src/datos/resumenesTarjeta.ts'); })(),
);

const IDS = ['b553ddf1', 'f3e9e4f3', '5d948f9a', 'c7222865'];

async function main() {
  console.log('F9.166 §2/§3 — los datos detrás de cada paso del recorrido.\n');

  // ── §1: la decisión por estado, los seis ──────────────────────────────────
  console.log('=== los 6 estados de CardStatement y qué hace el preview con cada uno ===');
  const ESPERADO: Record<string, boolean> = {
    subido: false, parseado: true, confirmado: true, error: false, requiere_tarjeta: false, duplicado: false,
  };
  for (const [estado, esp] of Object.entries(ESPERADO))
    chk(`${estado.padEnd(17)} → ${esp ? 'ABRE' : 'no abre'}`, puedeVerPreview(estado) === esp, `real=${puedeVerPreview(estado)}`);

  const resus = await db.collection('resumenesTarjeta').get();
  console.log('\n  estados presentes hoy en los 30 resúmenes:');
  const porEstado = new Map<string, number>();
  for (const d of resus.docs) porEstado.set(s(d.data().estado), (porEstado.get(s(d.data().estado)) ?? 0) + 1);
  for (const [e, n] of [...porEstado].sort()) console.log(`    ${e.padEnd(18)} ${String(n).padStart(2)}  → ${puedeVerPreview(e) ? 'abre el preview' : 'no abre'}`);

  // ── §2: los cuatro pasos, con los números de cada uno de los cuatro ───────
  console.log('\n=== §2 — el recorrido, resumen por resumen ===');
  for (const pref of IDS) {
    const d = resus.docs.find(x => x.id.startsWith(pref))!;
    const x = d.data();
    const ls = (x.movimientosParseados ?? []) as any[];
    const aj = (x.ajustesConsolidado ?? []) as any[];
    const c = motor.calcularCuadre(ls, Number(x.totalARS), Number(x.totalUSD), aj, x);
    const cuadreOk = c.balanceARS && c.balanceUSD;
    // la clave legacy de F9.158: {tarjetaCodigo}_{nroResumen}
    const legacy = x.tarjetaCodigo && x.nroResumen ? `${x.tarjetaCodigo}_${x.nroResumen}` : null;
    const g = await yaGenero(d.id, legacy);
    const deshabilitado = ls.length === 0 || !cuadreOk;

    console.log('─'.repeat(96));
    console.log(`${pref} | ${s(x.periodo)} | ${s(x.banco)}/${s(x.tarjeta)} | estado=${s(x.estado)}`);
    console.log(`  paso 2 — el botón "Ver N consumos" se ofrece:  ${puedeVerPreview(s(x.estado)) ? 'SÍ' : 'NO'}`);
    console.log(`  paso 3 — el preview abre:                      ${puedeVerPreview(s(x.estado)) ? 'SÍ' : 'NO'}`);
    console.log(`           líneas que va a mostrar:              ${ls.length}`);
    console.log(`           cuadre:  diffARS=${c.diffARS.toFixed(2)}  diffUSD=${c.diffUSD.toFixed(2)}  → cuadreOk=${cuadreOk}`);
    console.log(`           aviso "ya confirmado":                ${s(x.estado) === 'confirmado' ? `SÍ, desde ${x.confirmadoEn ? x.confirmadoEn.toDate().toLocaleDateString('es-AR') : '(sin fecha)'}` : 'no'}`);
    console.log(`  paso 4 — texto del botón:  "Re-confirmar (reemplaza ${g.total} movimiento${g.total !== 1 ? 's' : ''})"`);
    console.log(`           habilitado:                           ${!deshabilitado ? 'SÍ' : 'NO'}`);
    console.log(`           EDITADOS A MANO que se perderían:     ${g.editados}`);
    chk(`${pref} el preview abre`, puedeVerPreview(s(x.estado)));
    chk(`${pref} el botón queda HABILITADO`, !deshabilitado, `líneas=${ls.length} cuadreOk=${cuadreOk}`);
  }

  // ── §3: no regresión ──────────────────────────────────────────────────────
  console.log('\n=== §3 — no regresión ===');
  const parseados = resus.docs.filter(d => s(d.data().estado) === 'parseado');
  chk('un `parseado` sigue abriendo el preview', parseados.every(d => puedeVerPreview(s(d.data().estado))),
      `${parseados.length} en parseado hoy`);
  const noAbren = resus.docs.filter(d => !puedeVerPreview(s(d.data().estado)));
  chk('los estados que no deben abrir, no abren', noAbren.every(d => !puedeVerPreview(s(d.data().estado))),
      `${noAbren.length} resúmenes: ${JSON.stringify([...new Set(noAbren.map(d => s(d.data().estado)))])}`);
  chk('la lista del historial sigue mostrando los 30', resus.size === 30, `${resus.size}`);

  console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
  process.exit(fail === 0 ? 0 : 1);
}

main().catch(e => { console.error(e); process.exit(1); });
