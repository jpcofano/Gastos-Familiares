// F9.116 §6 — verificación del módulo de riesgo. Corre con:
//   npx tsx scripts/verificarRiesgo.ts
// No hay runner de tests en el repo y esta feature no agrega uno (ver el spec). Mismo patrón
// de salida que scripts/seed/validators/runValidations.ts: una línea OK/FAIL por caso y exit
// code 1 si algo falla.
import {
  calcEscenarios, calcMixObjetivo, violacionesBandas,
  BETA_DEFAULT, RIESGO_DEFAULTS, ESCENARIOS,
} from '../src/datos/patrimonioRiesgo';
import type { Posicion, PosicionTipo, PaisRiesgo } from '../src/types/patrimonio';

type Caso = { name: string; ok: boolean; detail: string };
const casos: Caso[] = [];
function chequear(name: string, ok: boolean, detail: string) { casos.push({ name, ok, detail }); }
const cerca = (a: number, b: number, tol = 0.0001) => Math.abs(a - b) <= tol;

function pos(over: Partial<Posicion> & { ticker: string; tipo: PosicionTipo; valorUsd: number }): Posicion {
  return {
    cuenta: 'test', titular: null, sector: 'global', pais_riesgo: 'global' as PaisRiesgo,
    moneda_origen: 'USD', valor_origen: over.valorUsd, cantidad: null, fuente: 'test',
    revisar: false, tcUsado: null, fechaCorrida: '2026-01-01',
    ...over,
  };
}

// ── 1. Cartera 100% cash → pérdida 0 en todos los escenarios ──────────────────
{
  const cartera = [pos({ ticker: 'USD', tipo: 'cash', sector: 'cash', valorUsd: 100000 })];
  const res = calcEscenarios(cartera, []);
  const todosCero = res.every(r => cerca(r.perdidaUsd, 0));
  const noCero = res.filter(r => !cerca(r.perdidaUsd, 0)).map(r => `${r.id}=${r.perdidaUsd}`);
  chequear('cash-sin-perdida', todosCero,
    todosCero ? `${res.length} escenarios, todos en 0` : `escenarios con pérdida: ${noCero.join(', ')}`);
}

// ── 2. 100% acciones AR, global20 → pérdida = 20% × beta 1,30 = 26% ───────────
{
  const cartera = [pos({ ticker: 'YPF', tipo: 'accion', sector: 'energia', pais_riesgo: 'AR', valorUsd: 100000 })];
  const r = calcEscenarios(cartera, []).find(x => x.id === 'global20')!;
  const esperado = -0.20 * BETA_DEFAULT.accionesAr;
  chequear('global20-beta-ar', cerca(r.perdidaPct, esperado),
    `perdidaPct=${r.perdidaPct.toFixed(4)} esperado=${esperado.toFixed(4)} (−20% × ${BETA_DEFAULT.accionesAr})`);
}

// ── 3. Mix objetivo con tolerancia = pérdida actual → venta necesaria 0 ───────
{
  const cartera = [
    pos({ ticker: 'YPF',  tipo: 'accion', sector: 'energia', pais_riesgo: 'AR', valorUsd: 60000 }),
    pos({ ticker: 'SPY',  tipo: 'cedear', sector: 'global',  valorUsd: 40000 }),
  ];
  const r = calcEscenarios(cartera, []).find(x => x.id === 'global20')!;
  const mix = calcMixObjetivo(cartera, [], Math.abs(r.perdidaPct), 'global20')!;
  chequear('mix-sin-venta-si-cumple', cerca(mix.ventaNecesariaUsd, 0),
    `tolerancia=${Math.abs(r.perdidaPct).toFixed(4)} venta=${mix.ventaNecesariaUsd.toFixed(2)}`);
}

// ── 4. Posición al 12% con tope 8% → una violación con exceso = 4% del total ──
{
  const cartera = [
    pos({ ticker: 'BIG', tipo: 'accion', valorUsd: 12000 }),
    // 88 posiciones chicas de 1.000 c/u: ninguna llega al tope por sí sola.
    ...Array.from({ length: 88 }, (_, i) => pos({ ticker: `P${i}`, tipo: 'accion', valorUsd: 1000 })),
  ];
  const total = 100000;
  const v = violacionesBandas(cartera, [], { ...RIESGO_DEFAULTS, topeDriverPct: 1, pisoCajaPct: 0 });
  const soloUna = v.length === 1 && v[0].tipo === 'posicion' && v[0].nombre === 'BIG';
  const excesoOk = soloUna && cerca(v[0].excesoUsd, 0.04 * total, 0.01);
  chequear('banda-posicion-exceso', soloUna && excesoOk,
    soloUna ? `BIG actual=${(v[0].actual * 100).toFixed(1)}% tope=8% exceso=${v[0].excesoUsd.toFixed(0)} (esperado 4000)`
            : `violaciones=${v.length}: ${v.map(x => `${x.tipo}:${x.nombre}`).join(', ')}`);
}

// ── 5. Suma de contribucion[] = perdidaUsd total, en todos los escenarios ─────
{
  const cartera = [
    pos({ ticker: 'YPF',  tipo: 'accion', sector: 'energia', pais_riesgo: 'AR', valorUsd: 30000 }),
    pos({ ticker: 'SPY',  tipo: 'cedear', sector: 'global',  valorUsd: 25000 }),
    pos({ ticker: 'BTC',  tipo: 'cripto', sector: 'cripto',  valorUsd: 15000 }),
    pos({ ticker: 'USDT', tipo: 'cripto', sector: 'cripto',  valorUsd: 5000 }),
    pos({ ticker: 'AL30', tipo: 'bono',   sector: 'deuda_soberana_usd', pais_riesgo: 'AR', valorUsd: 15000 }),
    pos({ ticker: 'FCI',  tipo: 'fci',    sector: 'cer_pesos', pais_riesgo: 'AR', moneda_origen: 'ARS', valorUsd: 10000 }),
  ];
  const res = calcEscenarios(cartera, []);
  const malos = res.filter(r => !cerca(r.contribucion.reduce((s, c) => s + c.perdidaUsd, 0), r.perdidaUsd, 0.01));
  chequear('contribucion-suma-total', malos.length === 0,
    malos.length === 0 ? `${res.length} escenarios cuadran (tolerancia 0,01)`
                       : `no cuadran: ${malos.map(m => m.id).join(', ')}`);
}

// ── 6. Mix objetivo cuando NO cumple: recorta hasta dar exactamente la tolerancia ──
// (extra sobre los 5 del spec: sin este caso, el caso 3 pasaría aunque calcMixObjetivo
// nunca recortara nada.)
{
  const cartera = [pos({ ticker: 'YPF', tipo: 'accion', sector: 'energia', pais_riesgo: 'AR', valorUsd: 100000 })];
  // Pérdida actual 26%; tolerancia 13% → hay que sacar la mitad de la cartera a cash.
  const mix = calcMixObjetivo(cartera, [], 0.13, 'global20')!;
  const ventaOk = cerca(mix.ventaNecesariaUsd, 50000, 0.01);
  const pesosOk = cerca(mix.pesosObjetivo.accionesAr, 0.5) && cerca(mix.pesosObjetivo.cash, 0.5);
  // El rally sube acciones AR +20%×1,30 = +26%; resignar la mitad cuesta 13% del total.
  const upsideOk = cerca(mix.upsideResignadoPct, 0.13);
  chequear('mix-recorta-hasta-tolerancia', ventaOk && pesosOk && upsideOk,
    `venta=${mix.ventaNecesariaUsd.toFixed(0)} (esp. 50000) · accionesAr=${(mix.pesosObjetivo.accionesAr * 100).toFixed(1)}% · upside resignado=${(mix.upsideResignadoPct * 100).toFixed(1)}% (esp. 13,0%)`);
}

// ── 7. Fail-soft: un escenario que tira no arrastra a las bandas ──────────────
// La card envuelve cada bloque en intentar(); esto verifica la mitad que se puede verificar
// sin navegador: que violacionesBandas no comparte estado con calcEscenarios y sigue
// devolviendo resultados aunque el motor de escenarios explote.
{
  const cartera = [
    pos({ ticker: 'BIG', tipo: 'accion', valorUsd: 50000 }),
    pos({ ticker: 'USD', tipo: 'cash', sector: 'cash', valorUsd: 50000 }),
  ];
  const bomba = [{
    id: 'bomba', nombre: 'Escenario roto', descripcion: '', familia: 'sistemico' as const,
    shock: () => { throw new Error('shock roto a propósito'); },
  }];
  let tiro = false;
  try { calcEscenarios(cartera, [], bomba); } catch { tiro = true; }
  const bandas = violacionesBandas(cartera, [], RIESGO_DEFAULTS);
  chequear('fail-soft-bandas-independientes', tiro && bandas.length > 0,
    `calcEscenarios tiró=${tiro} · violacionesBandas devolvió ${bandas.length} (BIG al 50% con tope 8%)`);
}

let pass = 0, fail = 0;
for (const c of casos) {
  console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name} - ${c.detail}`);
  c.ok ? pass++ : fail++;
}
console.log(`\n${pass} OK / ${fail} FAIL  ·  ${ESCENARIOS.length} escenarios en el registro`);
process.exit(fail === 0 ? 0 : 1);
