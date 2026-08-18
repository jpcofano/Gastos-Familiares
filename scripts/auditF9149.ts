// F9.149 — auditoría previa. SOLO LEE.
//
// Tres preguntas, en orden:
//   A. ¿Cuál es la distribución de bandas HOY? (el spec dice 11/16, pero eso es anterior a F9.148)
//   B. ¿Contra qué distribución se compara el valor de hoy? §1 la construye con el máximo
//      corrido y §4 fija el valor medido en `distanciaMax52sPct`: son objetos distintos.
//   C. ¿Cuántas observaciones hacen falta para que mediana y CDaR(0,8) sean estables?
import { getDb } from './seed/utils/firestore';
import * as PP from '../functions/src/patrimonioPrecios';

const RUEDAS_52S = 252;

/** Curva de drawdown contra el máximo corrido desde el inicio: dd_t = p_t / max(p_0..p_t) − 1. */
function ddCorrido(cierres: number[]): number[] {
  const out: number[] = [];
  let max = -Infinity;
  for (const c of cierres) { if (c > max) max = c; out.push(c / max - 1); }
  return out;
}

/** Curva de drawdown contra el máximo de las últimas 252 ruedas. Necesita 252 de historia. */
function ddVentana52(cierres: number[]): number[] {
  const out: number[] = [];
  for (let i = RUEDAS_52S - 1; i < cierres.length; i++) {
    let max = -Infinity;
    for (let k = i - RUEDAS_52S + 1; k <= i; k++) if (cierres[k] > max) max = cierres[k];
    out.push(cierres[i] / max - 1);
  }
  return out;
}

const mediana = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** CDaR(β): media del peor (1−β)·100% de las observaciones. Se trabaja en magnitud. */
function cdar(magnitudes: number[], beta = 0.8): number | null {
  if (!magnitudes.length) return null;
  const s = [...magnitudes].sort((a, b) => b - a);      // peor primero
  const n = Math.max(1, Math.ceil(s.length * (1 - beta)));
  return s.slice(0, n).reduce((a, b) => a + b, 0) / n;
}

const pct = (x: number | null | undefined, d = 1) => x == null ? '   n/d' : ((x * 100).toFixed(d) + '%').padStart(7);

function banda(v: number | null, med: number | null, c80: number | null): PP.Semaforo {
  if (v == null || med == null || c80 == null) return 'sin_datos';
  const a = Math.abs(v);
  if (a < med) return 'verde';
  if (a <= c80) return 'amarillo';
  return 'rojo';
}

async function main() {
  const db = getDb('production');
  const pd = await db.collection('preciosDiarios').get();
  const docs = pd.docs.map(d => ({ id: d.id, ...(d.data() as any) }))
    .filter(x => x.cobertura === 'con_serie' && (x.serie ?? []).length)
    .sort((a, b) => a.id.localeCompare(b.id));

  type Caso = {
    id: string; tipo: string; pais: string; clase: PP.ClaseUmbral;
    cierres: number[]; ind: PP.Indicadores;
    ddCorr: number[]; dd52: number[];
  };
  const casos: Caso[] = [];
  for (const d of docs) {
    const cruda: PP.PuntoSerie[] = (d.serie as any[]).map(p =>
      ({ f: p.f, o: p.o ?? null, h: p.h ?? null, l: p.l ?? null, c: p.c, v: p.v ?? null }));
    const marcada = PP.marcarPuntosMalos(cruda, PP.simboloDePanel(d.ticker));
    const { util } = PP.recortarPorEstado(marcada, PP.detectarSaltos(marcada), false);
    const buenos = PP.soloBuenos(util);
    const cierres = buenos.map(p => p.c);
    casos.push({
      id: d.id, tipo: d.tipo, pais: d.paisRiesgo,
      clase: PP.claseUmbral(d.tipo, d.paisRiesgo === 'global' ? 'global' : 'AR'),
      cierres, ind: PP.calcIndicadores(util),
      ddCorr: ddCorrido(cierres), dd52: ddVentana52(cierres),
    });
  }

  // ── A) el punto de partida real
  console.log('=== A) distribucion de bandas HOY (umbrales fijos de F9.141 §5) ===\n');
  const cnt = (f: (c: Caso) => PP.Semaforo) => {
    const o: Record<string, number> = { verde: 0, amarillo: 0, rojo: 0, sin_datos: 0 };
    for (const c of casos) o[f(c)]++;
    return o;
  };
  const fijo = (v: number | null, c: Caso): PP.Semaforo => {
    if (v == null) return 'sin_datos';
    const u = PP.UMBRALES.caidaFija[c.clase];
    const a = Math.abs(v);
    return a < u.verde ? 'verde' : a <= u.amarillo ? 'amarillo' : 'rojo';
  };
  const f = (o: Record<string, number>) => `verde=${o.verde} amarillo=${o.amarillo} rojo=${o.rojo} sin_datos=${o.sin_datos} -> cargados=${o.amarillo + o.rojo}/${casos.length}`;
  console.log(`  umbral fijo sobre drawdownDesdeMaxPct (pre-F9.148): ${f(cnt(c => fijo(c.ind.drawdownDesdeMaxPct, c)))}`);
  console.log(`  umbral fijo sobre distanciaMax52sPct  (post-F9.148, lo que hay HOY en el codigo): ${f(cnt(c => fijo(c.ind.distanciaMax52sPct, c)))}`);

  // ── B) las tres combinaciones distribución × estadístico
  console.log('\n\n=== B) contra que distribucion se compara el valor de hoy ===\n');
  console.log('  (a) dd corrido    vs drawdownDesdeMaxPct  -> coherente, pero cambia QUE se mide (viola §4)');
  console.log('  (b) dd 52 semanas vs distanciaMax52sPct   -> coherente Y respeta §4');
  console.log('  (c) dd corrido    vs distanciaMax52sPct   -> lectura literal del spec: objetos distintos\n');
  console.log('ticker     obs.corr obs.52  medCorr  c80Corr  med52    c80_52   |hoyDD|  |hoy52|   (a)       (b)       (c)');
  const bandas: Record<string, PP.Semaforo[]> = { a: [], b: [], c: [] };
  for (const cs of casos) {
    const magCorr = cs.ddCorr.map(Math.abs), mag52 = cs.dd52.map(Math.abs);
    const medCorr = mediana(magCorr), c80Corr = cdar(magCorr);
    const med52 = cs.dd52.length ? mediana(mag52) : null, c8052 = cs.dd52.length ? cdar(mag52) : null;
    const ba = banda(cs.ind.drawdownDesdeMaxPct, medCorr, c80Corr);
    const bb = banda(cs.ind.distanciaMax52sPct, med52, c8052);
    const bc = banda(cs.ind.distanciaMax52sPct, medCorr, c80Corr);
    bandas.a.push(ba); bandas.b.push(bb); bandas.c.push(bc);
    console.log(`${cs.id.padEnd(10)} ${String(cs.ddCorr.length).padStart(5)} ${String(cs.dd52.length).padStart(6)}  ${pct(medCorr)} ${pct(c80Corr)} ${pct(med52)} ${pct(c8052)} ${pct(cs.ind.drawdownDesdeMaxPct)} ${pct(cs.ind.distanciaMax52sPct)}  ${ba.padEnd(9)} ${bb.padEnd(9)} ${bc}`);
  }
  for (const k of ['a', 'b', 'c'] as const) {
    const o: Record<string, number> = { verde: 0, amarillo: 0, rojo: 0, sin_datos: 0 };
    for (const s of bandas[k]) o[s]++;
    console.log(`  (${k}): ${f(o)}   rojos=${o.rojo}/${casos.length} (${(o.rojo / casos.length * 100).toFixed(0)}%)`);
  }

  // ── C) estabilidad: ¿cuántas observaciones hacen falta?
  console.log('\n\n=== C) estabilidad de mediana y CDaR(0,8) por tamano de muestra ===');
  console.log('Ventanas deslizantes de largo N sobre la curva de dd de cada serie larga; para cada N');
  console.log('se mide la dispersion del estimador entre ventanas, relativa al valor de la serie entera.\n');
  for (const [nombre, sel] of [['dd corrido', (c: Caso) => c.ddCorr], ['dd 52 semanas', (c: Caso) => c.dd52]] as const) {
    const largas = casos.filter(c => sel(c).length >= 400);
    console.log(`--- ${nombre} (${largas.length} series con >=400 observaciones) ---`);
    console.log('    N     disp.mediana   disp.CDaR80     (p90-p10)/valor_total, promedio entre series');
    for (const N of [30, 60, 90, 120, 150, 200, 250, 300, 400]) {
      const dispMed: number[] = [], dispC80: number[] = [];
      for (const cs of largas) {
        const v = sel(cs).map(Math.abs);
        if (v.length < N + 20) continue;
        const medTot = mediana(v)!, c80Tot = cdar(v)!;
        const meds: number[] = [], c80s: number[] = [];
        for (let i = 0; i + N <= v.length; i += 10) {
          const w = v.slice(i, i + N);
          meds.push(mediana(w)!); c80s.push(cdar(w)!);
        }
        const q = (xs: number[], p: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))]; };
        if (meds.length >= 5 && medTot > 0) dispMed.push((q(meds, 0.9) - q(meds, 0.1)) / medTot);
        if (c80s.length >= 5 && c80Tot > 0) dispC80.push((q(c80s, 0.9) - q(c80s, 0.1)) / c80Tot);
      }
      const prom = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
      console.log(`  ${String(N).padStart(4)}   ${pct(prom(dispMed), 0)}        ${pct(prom(dispC80), 0)}        n=${dispMed.length}`);
    }
    console.log('');
  }

  // ── D) Ulcer Index 126
  console.log('\n=== D) Ulcer Index sobre 126 ruedas ===');
  console.log('ticker     puntos  ulcer126   drawdown hoy   vol90d');
  for (const cs of casos) {
    const n = cs.cierres.length;
    let ui: number | null = null;
    if (n >= 126) {
      const tramo = cs.cierres.slice(-126);
      const dd = ddCorrido(tramo);
      ui = Math.sqrt(dd.reduce((a, b) => a + b * b, 0) / dd.length);
    }
    console.log(`${cs.id.padEnd(10)} ${String(n).padStart(5)}  ${pct(ui)}    ${pct(cs.ind.distanciaMax52sPct)}       ${pct(cs.ind.volAnualizada90d)}`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
