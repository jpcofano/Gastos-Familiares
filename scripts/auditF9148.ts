// F9.148 §1 — ¿el artefacto del 2023-08-03 es del panel entero o de algunos instrumentos?
// Decide entre comodín ('*') y lista explícita en PUNTOS_MALOS. SOLO LEE.
//
// Criterio de "fila podrida", independiente de Yahoo (los bonos no tienen contraparte):
// el cierre del 03/08 se desvía >20% del vecino previo Y del siguiente, y esos dos vecinos
// están a menos de 15% entre sí. Es la firma del ida y vuelta: un pozo de un día.
import { getDb } from './seed/utils/firestore';

const BASE = 'https://data912.com';
const FECHA = '2023-08-03';

type Fila = { date: string; o: number; h: number; l: number; c: number; v: number };

async function hist(panel: string, ticker: string): Promise<Fila[] | null> {
  try {
    const res = await fetch(`${BASE}/historical/${panel}/${encodeURIComponent(ticker)}`, { signal: AbortSignal.timeout(45_000) });
    if (!res.ok) return null;
    const j = await res.json();
    return Array.isArray(j) ? j as Fila[] : null;
  } catch { return null; }
}

async function live(panel: string): Promise<string[]> {
  const res = await fetch(`${BASE}/live/${panel}`, { signal: AbortSignal.timeout(45_000) });
  const j = await res.json() as Array<Record<string, unknown>>;
  return j.map(x => String(x.symbol ?? x.ticker ?? '')).filter(Boolean);
}

type Veredicto = 'podrida' | 'sana' | 'sin_fila' | 'sin_vecinos';

function juzgar(filas: Fila[]): { v: Veredicto; ret?: number; desvio?: number; vecinos?: number } {
  const orden = [...filas].filter(f => typeof f.date === 'string' && Number.isFinite(f.c) && f.c > 0)
    .sort((a, b) => a.date.localeCompare(b.date));
  const i = orden.findIndex(f => f.date.slice(0, 10) === FECHA);
  if (i < 0) return { v: 'sin_fila' };
  if (i === 0 || i === orden.length - 1) return { v: 'sin_vecinos' };
  const prev = orden[i - 1].c, act = orden[i].c, sig = orden[i + 1].c;
  const vecinos = Math.abs(sig / prev - 1);
  const dPrev = act / prev - 1, dSig = act / sig - 1;
  const podrida = vecinos < 0.15 && Math.abs(dPrev) > 0.20 && Math.abs(dSig) > 0.20
    && Math.sign(dPrev) === Math.sign(dSig);
  return { v: podrida ? 'podrida' : 'sana', ret: dPrev, desvio: dSig, vecinos };
}

async function main() {
  const db = getDb('production');

  // ── A) el universo propio: lo que hay en preciosDiarios
  const pd = await db.collection('preciosDiarios').get();
  const propios: Array<{ id: string; ticker: string; tipo: string; pais: string; panel: string | null; cobertura: string }> = [];
  const PANEL: Record<string, string | null> = { accion: 'stocks', cedear: 'cedears', bono: 'bonds', on: null, fci: null, cripto: null, cash: null };
  for (const d of pd.docs) {
    const x = d.data() as any;
    const panel = x.paisRiesgo === 'global' && x.tipo === 'accion' ? 'usa_stocks' : PANEL[x.tipo] ?? null;
    propios.push({ id: d.id, ticker: x.ticker, tipo: x.tipo, pais: x.paisRiesgo, panel, cobertura: x.cobertura });
  }
  const conSerie = propios.filter(p => p.cobertura === 'con_serie');
  console.log(`=== A) universo propio: ${pd.size} docs, ${conSerie.length} con_serie ===\n`);
  console.log('ticker     tipo     panel        veredicto      ret vs D-1   ret vs D+1   |D+1/D-1-1|');
  const cnt: Record<string, number> = {};
  for (const p of conSerie) {
    if (!p.panel || p.panel === 'usa_stocks') { console.log(`${p.id.padEnd(10)} ${p.tipo.padEnd(8)} ${String(p.panel).padEnd(12)} (no es panel AR)`); continue; }
    const f = await hist(p.panel, p.ticker);
    if (!f) { console.log(`${p.id.padEnd(10)} ${p.tipo.padEnd(8)} ${p.panel.padEnd(12)} sin respuesta`); continue; }
    const j = juzgar(f);
    cnt[j.v] = (cnt[j.v] ?? 0) + 1;
    const n = (x?: number) => x == null ? '      -' : ((x * 100).toFixed(1) + '%').padStart(7);
    console.log(`${p.id.padEnd(10)} ${p.tipo.padEnd(8)} ${p.panel.padEnd(12)} ${j.v.padEnd(13)}  ${n(j.ret)}      ${n(j.desvio)}      ${n(j.vecinos)}`);
    await new Promise(r => setTimeout(r, 250));
  }
  console.log(`\nresumen propio: ${JSON.stringify(cnt)}`);

  // ── B) ¿es del panel entero? muestra amplia de stocks y bonds
  console.log('\n\n=== B) muestra del panel completo (¿comodin o lista explicita?) ===\n');
  for (const panel of ['stocks', 'bonds'] as const) {
    const livePanel = panel === 'stocks' ? 'arg_stocks' : 'arg_bonds';
    let simbolos: string[] = [];
    try { simbolos = await live(livePanel); } catch (e) { console.log(`${livePanel}: ${e}`); continue; }
    const muestra = simbolos.slice(0, 40);
    const res: Record<string, string[]> = { podrida: [], sana: [], sin_fila: [], sin_vecinos: [] };
    for (const s of muestra) {
      const f = await hist(panel, s);
      if (!f) { continue; }
      const j = juzgar(f);
      res[j.v].push(s);
      await new Promise(r => setTimeout(r, 200));
    }
    console.log(`--- ${panel} (${simbolos.length} simbolos vivos, muestra de ${muestra.length}) ---`);
    for (const k of ['podrida', 'sana', 'sin_fila', 'sin_vecinos'] as const) {
      console.log(`  ${k.padEnd(12)} ${String(res[k].length).padStart(3)}  ${res[k].join(' ')}`);
    }
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
