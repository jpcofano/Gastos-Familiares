// F9.196.1 §6.3 — ¿data912 publica bonos y ONs por 100 VN o por 1 VN?
// Solo lectura, sin credenciales: baja los paneles públicos /live/arg_bonds y /live/arg_corp (dos
// pedidos, timeout de 15 s cada uno, sin reintentos) y compara el precio `c` (el que usa el cron de
// precios, patrimonioPreciosCron.ts:150-154) con el de Balanz por 1 VN en pesos del 21/10 17:00.
// Uso: npx tsx scripts/verificarEscalaData912.ts

const BASE = 'https://data912.com/live';
const PANELES = ['arg_bonds', 'arg_corp'] as const;
type Panel = typeof PANELES[number];

// Balanz, ARS por 1 VN, 21-oct-2026 17:00-17:02.
const BALANZ: Array<{ especie: string; tipo: 'bono' | 'letra' | 'on'; precio: number }> = [
  { especie: 'GD30', tipo: 'bono', precio: 877.7 },
  { especie: 'GD35', tipo: 'bono', precio: 1145.1 },
  { especie: 'DICP', tipo: 'bono', precio: 495 },
  { especie: 'TX26', tipo: 'bono', precio: 7.6 },
  { especie: 'TZXM7', tipo: 'letra', precio: 2.3315 },
  { especie: 'BPOC7', tipo: 'bono', precio: 1626 },
  { especie: 'TLCPO', tipo: 'on', precio: 1735.2 },
];

type Fila = { symbol?: unknown; c?: unknown; px_bid?: unknown; px_ask?: unknown; [k: string]: unknown };

async function bajar(panel: Panel): Promise<Fila[] | string> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 15_000);
  try {
    const r = await fetch(`${BASE}/${panel}`, { signal: ctl.signal, headers: { accept: 'application/json' } });
    if (!r.ok) return `HTTP ${r.status}`;
    const body: unknown = await r.json();
    return Array.isArray(body) ? (body as Fila[]) : `respuesta no es un array: ${JSON.stringify(body).slice(0, 120)}`;
  } catch (e) {
    return `error: ${(e as Error).message}`;
  } finally {
    clearTimeout(t);
  }
}

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : null;
};

const factor = (q: number): string => (q >= 50 && q <= 200 ? '100' : q >= 0.5 && q <= 2 ? '1' : 'raro');
const fmt = (n: number | null, d = 4): string => (n === null ? '—' : n.toLocaleString('es-AR', { maximumFractionDigits: d }));

async function main() {
  console.log(`Medición: ${new Date().toISOString()} (UTC) · ${new Date().toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false })} (ART)\n`);
  const datos: Partial<Record<Panel, Fila[]>> = {};
  for (const p of PANELES) {
    const r = await bajar(p);
    if (typeof r === 'string') console.log(`${p}: FALLÓ (${r})`);
    else { datos[p] = r; console.log(`${p}: ${r.length} símbolos`); }
  }
  console.log('');
  console.log('especie | tipo | panel | campo | data912 | Balanz 1 VN | cociente | factor | (px_bid / px_ask)');
  for (const b of BALANZ) {
    let encontrada = false;
    for (const p of PANELES) {
      const fila = datos[p]?.find(f => f.symbol === b.especie);
      if (!fila) continue;
      encontrada = true;
      const c = num(fila.c);
      const bid = num(fila.px_bid), ask = num(fila.px_ask);
      // Campo usado: `c` (último), como el cron. Si `c` viene vacío, el punto medio de las puntas.
      const [campo, precio] = c !== null ? ['c', c] as const
        : bid !== null && ask !== null ? ['mid(px_bid,px_ask)', (bid + ask) / 2] as const
        : bid !== null ? ['px_bid', bid] as const : ask !== null ? ['px_ask', ask] as const : ['—', null] as const;
      const q = precio === null ? null : precio / b.precio;
      console.log([b.especie, b.tipo, p, campo, fmt(precio), fmt(b.precio), fmt(q, 2), q === null ? 'sin precio' : factor(q),
        `(${fmt(bid)} / ${fmt(ask)})`].join(' | '));
    }
    if (!encontrada) console.log(`${b.especie} | ${b.tipo} | — | — | NO APARECE en ${PANELES.join(' ni ')} | ${fmt(b.precio)} | — | — |`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
