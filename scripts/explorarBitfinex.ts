// F9.196 H1b en vivo — exploración de la API autenticada de Bitfinex, solo lectura
// (docs/prompts/F9.196-h1b-bitfinex-en-vivo.md). Uso: npx tsx scripts/explorarBitfinex.ts [corrida.txt]
//
// - Credenciales: %OneDrive%\.secrets\gastos-familiares.env (BITFINEX_API_KEY, BITFINEX_API_SECRET),
//   con el parser de ./envSecretos. Nunca se imprimen valores, headers, firmas ni nonces.
// - Rutas: solo `auth/r/*` (./bitfinexCliente). Lo primero es `auth/r/permissions`: si algún scope
//   tiene WRITE = 1, el script se detiene.
// - Ritmo: a lo sumo 1 llamada por segundo. NO se mide el límite (bloquea la IP 60 s).
// - Respuestas crudas → data/bitfinex-exploracion/ (gitignored por `data/*`). Por consola sale la
//   forma y montos redondeados; nunca IDs de transacción ni direcciones.
// - Cuadre: billeteras × precio público de Bitfinex contra la corrida de Bitfinex (el .txt local
//   que se pase). No lee Firestore.
import * as fs from 'fs';
import * as path from 'path';
import { exigirEnv } from './envSecretos';
import { pedirBitfinex, crearNonce, crearRitmo, esErrorBitfinex, type Respuesta } from './bitfinexCliente';
import { urlBitfinex, parseBitfinex } from '../functions/src/criptoPrecios';
import type { CorraidaJSON } from '../src/types/patrimonio';

const SALIDA = path.join(__dirname, '..', 'data', 'bitfinex-exploracion');
const ahoraArt = () => new Date(Date.now() - 3 * 3600_000).toISOString().replace('T', ' ').slice(0, 19);
const red = (x: unknown) => (typeof x === 'number' ? Math.round(x * 10000) / 10000 : x);
const enmascarar = (s: string) => s.replace(/\b[0-9a-fA-F]{16,}\b/g, '<hex>').replace(/\b\d{6,}\b/g, '#');
const tipoDe = (x: unknown) => (x === null ? 'null' : Array.isArray(x) ? 'array' : typeof x);

let n = 0;
function guardar(nombre: string, r: unknown) {
  n++;
  fs.writeFileSync(path.join(SALIDA, `${String(n).padStart(2, '0')}-${nombre}.json`), JSON.stringify({ guardadoArt: ahoraArt(), ...(r as object) }, null, 2));
}

async function main() {
  const env = exigirEnv(['BITFINEX_API_KEY', 'BITFINEX_API_SECRET']);
  const cred = { key: env.BITFINEX_API_KEY, secret: env.BITFINEX_API_SECRET };
  fs.mkdirSync(SALIDA, { recursive: true });
  const nonce = crearNonce();          // milisegundos, creciente — decisión fija
  const ritmo = crearRitmo(1100);      // ≤ 1 por segundo
  let conBody = true;
  const pedir = async (endpoint: string, nombre: string, body: Record<string, unknown> = {}): Promise<Respuesta> => {
    await ritmo();
    const r = await pedirBitfinex(cred, nonce, endpoint, body, { conBody });
    guardar(nombre, r);
    return r;
  };
  const corto = (b: unknown) => (typeof b === 'string' ? b : JSON.stringify(b)).slice(0, 200);
  console.log(`[bfx] ${ahoraArt()} ART · nonce en ms · body {} firmado`);

  // ── 1. Permisos (primero) + firma ───────────────────────────────────────────
  let rp = await pedir('auth/r/permissions', 'permissions');
  if (rp.status !== 200 || esErrorBitfinex(rp.body)) {
    console.log(`[1] permissions con body {} → HTTP ${rp.status} · ${corto(rp.body)} · pruebo UNA vez sin body`);
    conBody = false;
    rp = await pedir('auth/r/permissions', 'permissions-sin-body');
    console.log(`    sin body → HTTP ${rp.status}${rp.status !== 200 ? ` · ${corto(rp.body)}` : ''}`);
    if (rp.status !== 200 || esErrorBitfinex(rp.body)) { console.log('[bfx] sin permisos no sigo.'); return; }
  }
  const permisos = rp.body as Array<[string, number, number]>;
  console.log(`[1] permissions → HTTP ${rp.status} · firma con ${conBody ? 'body {}' : 'SIN body'} · ${permisos.length} scopes`);
  for (const [scope, r, w] of permisos) console.log(`    ${scope.padEnd(12)} read ${r} write ${w}`);
  const conWrite = permisos.filter(p => p[2] === 1).map(p => p[0]);
  if (conWrite.length) { console.log(`[bfx] ⛔ la key tiene WRITE en: ${conWrite.join(', ')}. Me detengo.`); return; }
  console.log('    ✓ ningún scope con WRITE = 1: key de solo lectura');

  // ── 2. Billeteras ───────────────────────────────────────────────────────────
  const rw = await pedir('auth/r/wallets', 'wallets');
  const wallets = Array.isArray(rw.body) && !esErrorBitfinex(rw.body) ? rw.body as unknown[][] : [];
  console.log(`[2] wallets → HTTP ${rw.status} · ${wallets.length} billeteras · largo de fila ${[...new Set(wallets.map(w => w.length))].join('/')}`);
  for (const w of wallets) {
    console.log(`    ${String(w[0]).padEnd(9)} ${String(w[1]).padEnd(6)} balance ${red(w[2])} (${tipoDe(w[2])}) · unsettled ${red(w[3])} · available ${red(w[4])} (${tipoDe(w[4])}) · lastChange ${tipoDe(w[5])} · meta ${tipoDe(w[6])}`);
  }

  // ── 3. Funding ──────────────────────────────────────────────────────────────
  const resumenFunding = (nombre: string, r: Respuesta, campos: Record<string, number>) => {
    const filas = Array.isArray(r.body) && !esErrorBitfinex(r.body) ? r.body as unknown[][] : [];
    console.log(`[3] ${nombre} → HTTP ${r.status} · ${filas.length} filas${filas.length ? ` · largo ${[...new Set(filas.map(f => f.length))].join('/')}` : ''}${esErrorBitfinex(r.body) ? ` · ${corto(r.body)}` : ''}`);
    for (const f of filas.slice(0, 8)) {
      console.log('     ', Object.entries(campos).map(([k, i]) => `${k}=${red(f[i])}${k === 'AMOUNT' || k === 'RATE' ? `(${tipoDe(f[i])})` : ''}`).join(' '));
    }
    return filas;
  };
  const camposCredito = { SYMBOL: 1, SIDE: 2, AMOUNT: 5, STATUS: 7, RATE_TYPE: 8, RATE: 11, PERIOD: 12, MTS_OPENING: 13 };
  const creditos = resumenFunding('funding/credits', await pedir('auth/r/funding/credits', 'funding-credits'), camposCredito);
  resumenFunding('funding/credits/fUSD', await pedir('auth/r/funding/credits/fUSD', 'funding-credits-fUSD'), camposCredito);
  resumenFunding('funding/credits/fUST', await pedir('auth/r/funding/credits/fUST', 'funding-credits-fUST'), camposCredito);
  resumenFunding('funding/offers', await pedir('auth/r/funding/offers', 'funding-offers'),
    { SYMBOL: 1, AMOUNT: 4, AMOUNT_ORIG: 5, TYPE: 6, STATUS: 10, RATE: 14, PERIOD: 15 });
  const prestamos = resumenFunding('funding/loans', await pedir('auth/r/funding/loans', 'funding-loans'), camposCredito);

  // ── 4. Ledgers, 90 días ─────────────────────────────────────────────────────
  const fin = Date.now(), inicio = fin - 90 * 86_400_000;
  const rl = await pedir('auth/r/ledgers/hist', 'ledgers-90d', { start: inicio, end: fin, limit: 2500 });
  let ledgers = Array.isArray(rl.body) && !esErrorBitfinex(rl.body) ? rl.body as unknown[][] : [];
  console.log(`[4] ledgers/hist 90 días → HTTP ${rl.status} · ${ledgers.length} asientos${esErrorBitfinex(rl.body) ? ` · ${corto(rl.body)}` : ''}`);
  if (!ledgers.length) {
    // Sin actividad en la ventana: lo más reciente, sin ventana, para ver la forma real de las filas.
    const r2 = await pedir('auth/r/ledgers/hist', 'ledgers-sin-ventana');
    ledgers = Array.isArray(r2.body) && !esErrorBitfinex(r2.body) ? r2.body as unknown[][] : [];
    const fs2 = ledgers.map(l => (typeof l[3] === 'number' ? new Date(l[3] as number).toISOString().slice(0, 10) : '?')).sort();
    console.log(`    sin ventana → HTTP ${r2.status} · ${ledgers.length} asientos · largo ${[...new Set(ledgers.map(f => f.length))].join('/')} · ${fs2[0] ?? '—'} .. ${fs2[fs2.length - 1] ?? '—'}`);
  }
  const porTexto = new Map<string, { n: number; ej: unknown[] }>();
  for (const l of ledgers) {
    const k = enmascarar(String(l[8] ?? '')).replace(/[\d.,]+/g, 'N').replace(/\s+/g, ' ').slice(0, 60);
    const e = porTexto.get(k) ?? { n: 0, ej: l };
    e.n++; porTexto.set(k, e);
  }
  for (const [k, v] of [...porTexto].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${String(v.n).padStart(4)} «${k}» · ej: ${v.ej[1]} ${v.ej[2]} amount ${red(v.ej[5])}`);
  }
  const monedas = [...new Set(wallets.map(w => String(w[1])))];
  if (monedas.length) {
    const m = monedas.includes('USD') ? 'USD' : monedas[0];
    const rc = await pedir(`auth/r/ledgers/${m}/hist`, `ledgers-${m}-90d`, { start: inicio, end: fin, limit: 2500 });
    console.log(`    ledgers/${m}/hist → HTTP ${rc.status} · ${Array.isArray(rc.body) ? rc.body.length : corto(rc.body)} asientos`);
  }
  // Por categoría, SIN ventana (lo más reciente): con 90 días sin actividad, la ventana no muestra nada.
  for (const cat of [5, 28, 51, 101, 104, 201]) {
    const rc = await pedir('auth/r/ledgers/hist', `ledgers-cat${cat}`, { category: cat });
    const xs = Array.isArray(rc.body) && !esErrorBitfinex(rc.body) ? rc.body as unknown[][] : [];
    const textos = [...new Set(xs.map(l => enmascarar(String(l[8] ?? '')).replace(/[\d.,]+/g, 'N').slice(0, 50)))];
    console.log(`    category ${cat} → HTTP ${rc.status} · ${xs.length} asientos · textos: ${textos.slice(0, 4).map(t => `«${t}»`).join(', ') || '—'}`);
  }

  // ── 5. Movimientos (depósitos y retiros), 90 días ───────────────────────────
  let rm = await pedir('auth/r/movements/hist', 'movements-90d', { start: inicio, end: fin, limit: 2500 });
  console.log(`[5] movements/hist 90 días, limit 2500 → HTTP ${rm.status}${esErrorBitfinex(rm.body) ? ` · ${corto(rm.body)}` : ''}`);
  if (esErrorBitfinex(rm.body)) {
    rm = await pedir('auth/r/movements/hist', 'movements-90d-sin-limit', { start: inicio, end: fin });
    console.log(`    sin limit → HTTP ${rm.status}${esErrorBitfinex(rm.body) ? ` · ${corto(rm.body)}` : ''}`);
  }
  let movs = Array.isArray(rm.body) && !esErrorBitfinex(rm.body) ? rm.body as unknown[][] : [];
  console.log(`    ${movs.length} movimientos en 90 días`);
  if (!movs.length) {
    const r2 = await pedir('auth/r/movements/hist', 'movements-sin-ventana');
    movs = Array.isArray(r2.body) && !esErrorBitfinex(r2.body) ? r2.body as unknown[][] : [];
    console.log(`    sin ventana → HTTP ${r2.status} · ${movs.length} movimientos${movs.length ? ` · largo ${[...new Set(movs.map(f => f.length))].join('/')}` : ''}${esErrorBitfinex(r2.body) ? ` · ${corto(r2.body)}` : ''}`);
  }
  for (const m of movs) {
    const fecha = typeof m[5] === 'number' ? new Date(m[5] as number).toISOString().slice(0, 10) : '?';
    console.log(`    ${fecha} ${m[1]} (${m[2]}) status ${m[9]} · amount ${m[12]} (${tipoDe(m[12])}) · fees ${m[13]} (${tipoDe(m[13])}) · dirección ${m[16] ? 'sí' : 'no'} · txid ${m[20] ? 'sí' : 'no'} · índices no nulos: ${m.map((x, i) => (x !== null && x !== undefined ? i : null)).filter(i => i !== null).join(',')}`);
  }

  // ── 6. Trades, 90 días ──────────────────────────────────────────────────────
  const rt = await pedir('auth/r/trades/hist', 'trades-90d', { start: inicio, end: fin, limit: 2500 });
  let trades = Array.isArray(rt.body) && !esErrorBitfinex(rt.body) ? rt.body as unknown[][] : [];
  console.log(`[6] trades/hist 90 días → HTTP ${rt.status} · ${trades.length} trades${esErrorBitfinex(rt.body) ? ` · ${corto(rt.body)}` : ''}`);
  if (!trades.length) {
    const r2 = await pedir('auth/r/trades/hist', 'trades-sin-ventana');
    trades = Array.isArray(r2.body) && !esErrorBitfinex(r2.body) ? r2.body as unknown[][] : [];
    console.log(`    sin ventana → HTTP ${r2.status} · ${trades.length} trades${trades.length ? ` · largo ${[...new Set(trades.map(f => f.length))].join('/')}` : ''}`);
  }
  for (const t of trades.slice(0, 10)) {
    const fecha = typeof t[2] === 'number' ? new Date(t[2] as number).toISOString().slice(0, 10) : '?';
    console.log(`    ${fecha} ${t[1]} exec ${red(t[4])} @ ${red(t[5])} · ${t[6]} · maker ${t[8]} · fee ${red(t[9])} ${t[10]}`);
  }

  // ── Cuadre ──────────────────────────────────────────────────────────────────
  const estables = new Set(['USD', 'UST', 'USDT', 'USDC', 'UDC']);
  const nombreApp = (c: string) => (c === 'UST' ? 'USDT' : c === 'UDC' ? 'USDC' : c);
  const cripto = [...new Set(wallets.map(w => String(w[1])).filter(c => !estables.has(c)))];
  await ritmo();
  const rpub = await fetch(urlBitfinex(cripto.map(nombreApp)));
  const precios = parseBitfinex({ status: rpub.status, body: await rpub.json().catch(() => null) }, cripto.map(nombreApp)).precios;
  guardar('precios-publicos', { status: rpub.status, precios });
  const porActivo = new Map<string, { cantidad: number; usd: number | null }>();
  for (const w of wallets) {
    const c = nombreApp(String(w[1]));
    const q = Number(w[2]) || 0;
    const px = estables.has(String(w[1])) ? 1 : precios[c] ?? null;
    const e = porActivo.get(c) ?? { cantidad: 0, usd: 0 };
    e.cantidad += q;
    e.usd = px === null || e.usd === null ? null : e.usd + q * px;
    porActivo.set(c, e);
  }
  const prestadoUsd = [...creditos, ...prestamos].reduce((a, f) => {
    const c = nombreApp(String(f[1]).replace(/^f/, ''));
    const px = estables.has(String(f[1]).replace(/^f/, '')) ? 1 : precios[c] ?? 0;
    return a + (Number(f[5]) || 0) * px;
  }, 0);
  console.log(`\n[cuadre] precios públicos de Bitfinex (HTTP ${rpub.status}): ${JSON.stringify(precios)}`);
  const corridaPath = process.argv[2];
  const corrida = corridaPath ? (JSON.parse(fs.readFileSync(corridaPath, 'utf8')) as CorraidaJSON) : null;
  const deCorrida = new Map<string, { cantidad: number | null; usd: number }>();
  for (const p of corrida?.posiciones.filter(p => p.cuenta === 'Bitfinex') ?? []) {
    deCorrida.set(p.ticker, { cantidad: p.cantidad, usd: p.valor_origen });
  }
  let totalApi = 0, totalCorrida = 0;
  for (const t of new Set([...porActivo.keys(), ...deCorrida.keys()])) {
    const a = porActivo.get(t), c = deCorrida.get(t);
    totalApi += a?.usd ?? 0; totalCorrida += c?.usd ?? 0;
    console.log(`    ${t.padEnd(5)} API ${a ? `${red(a.cantidad)} = U$S ${a.usd === null ? '?' : Math.round(a.usd)}` : '—'} · corrida ${corrida?.meta.fecha_corrida ?? '?'} ${c ? `${red(c.cantidad)} = U$S ${Math.round(c.usd)}` : '—'}`);
  }
  console.log(`    total billeteras API U$S ${Math.round(totalApi)} · corrida U$S ${Math.round(totalCorrida)} · diferencia ${totalCorrida ? ((totalApi / totalCorrida - 1) * 100).toFixed(1) : '?'}% · prestado en funding (credits + loans) ≈ U$S ${Math.round(prestadoUsd)}`);
  console.log(`[bfx] fin ${ahoraArt()} ART · ${n} archivos en data/bitfinex-exploracion/`);
}

main().catch(e => { console.error('[bfx] error:', e instanceof Error ? e.message : String(e)); process.exit(1); });
