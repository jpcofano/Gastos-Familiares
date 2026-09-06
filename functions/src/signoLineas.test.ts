// F9.161 §2 — self-test del guard del signo. Sin framework (no hay jest/vitest en functions/,
// mismo criterio que `cafciHtml.test.ts`). Correr: npx tsx functions/src/signoLineas.test.ts
import { esSeccionDeConsumos, corregirSignoConsumos, LineaConSigno } from './signoLineas';

let ok = 0, fail = 0;
function t(rotulo: string, real: unknown, esperado: unknown) {
  const a = JSON.stringify(real), b = JSON.stringify(esperado);
  if (a === b) { ok++; console.log(`  OK   ${rotulo}`); }
  else { fail++; console.log(`  FAIL ${rotulo}\n       esperado ${b}\n       real     ${a}`); }
}

console.log('=== esSeccionDeConsumos ===');
t('BBVA "Consumos Maria Lascano"', esSeccionDeConsumos('Consumos Maria Lascano'), true);
t('Galicia "DETALLE DEL CONSUMO"', esSeccionDeConsumos('DETALLE DEL CONSUMO'), true);
t('acentos y mayúsculas', esSeccionDeConsumos('CONSUMOS DE MARÍA'), true);
t('"Sus pagos y ajustes realizados"', esSeccionDeConsumos('Sus pagos y ajustes realizados'), false);
t('"Impuestos, cargos e intereses"', esSeccionDeConsumos('Impuestos, cargos e intereses'), false);
t('la exclusión gana: "CONSOLIDADO DE CONSUMOS"', esSeccionDeConsumos('CONSOLIDADO DE CONSUMOS'), false);
t('null', esSeccionDeConsumos(null), false);
t('vacío', esSeccionDeConsumos(''), false);

console.log('\n=== corregirSignoConsumos — los dos casos de control de la spec ===');
// Los dos renglones reales del PDF de 08a697e0, en la MISMA sección.
const control: LineaConSigno[] = [
  { descripcionRaw: 'CAJA SEG-PROMO BB031082144 -0', tipoLinea: 'reintegro_percepcion',
    monto: 168542, montoFirmado: 168542, seccion: 'Consumos Maria Lascano' },
  { descripcionRaw: 'COTO DIGITAL SUC 056 CRED', tipoLinea: 'reverso',
    monto: 8870.44, montoFirmado: -8870.44, seccion: 'Consumos Maria Lascano', esReverso: true },
];
const r = corregirSignoConsumos(control);
t('CAJA SEG-PROMO (positivo) se corrige a consumo', r.lineas[0].tipoLinea, 'consumo');
t('COTO DIGITAL CRED (negativo) NO se toca', r.lineas[1].tipoLinea, 'reverso');
t('el crédito conserva esReverso', r.lineas[1].esReverso, true);
t('una sola corrección', r.correcciones.length, 1);
t('la corrección dice qué era antes', r.correcciones[0].tipoLineaAntes, 'reintegro_percepcion');

console.log('\n=== corregirSignoConsumos — no actúa donde no debe ===');
const casos: Array<[string, LineaConSigno]> = [
  ['montoFirmado ausente (línea vieja)',
    { tipoLinea: 'reintegro_percepcion', monto: 100, seccion: 'Consumos Juan' }],
  ['montoFirmado null',
    { tipoLinea: 'reintegro_percepcion', monto: 100, montoFirmado: null, seccion: 'Consumos Juan' }],
  ['seccion null',
    { tipoLinea: 'reintegro_percepcion', monto: 100, montoFirmado: 100, seccion: null }],
  ['sección de pagos y ajustes (CR.RG legítimo)',
    { tipoLinea: 'reintegro_percepcion', monto: 100, montoFirmado: 100,
      seccion: 'Sus pagos y ajustes realizados' }],
  ['ya es consumo',
    { tipoLinea: 'consumo', monto: 100, montoFirmado: 100, seccion: 'Consumos Juan' }],
  ['impuesto positivo en consumos (no es familia de ingresos)',
    { tipoLinea: 'impuesto', monto: 100, montoFirmado: 100, seccion: 'Consumos Juan' }],
];
for (const [rotulo, linea] of casos) {
  const res = corregirSignoConsumos([linea]);
  t(rotulo, { tipo: res.lineas[0].tipoLinea, n: res.correcciones.length },
             { tipo: linea.tipoLinea, n: 0 });
}

console.log('\n=== idempotencia y pureza ===');
const dosVueltas = corregirSignoConsumos(corregirSignoConsumos(control).lineas);
t('segunda pasada no corrige nada', dosVueltas.correcciones.length, 0);
t('no muta la entrada', control[0].tipoLinea, 'reintegro_percepcion');

console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
