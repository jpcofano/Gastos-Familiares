// F9.196.1 §5 — MEDICIÓN (solo lectura) antes de escribir el detector de splits de PPI.
// Uso: npx tsx scripts/medirSplitsPPI.ts
//
// Para las especies con costo sospechoso (costo a más de 5 veces del precio: PAMP, TGSU2, TRAN, YPFD)
// lista las filas `Split / <t>` de los 3 años (la especie sale del TEXTO: el campo `ticker` de esas
// filas viene equivocado, docs/patrimonio/ppi-api-exploracion.md), la tenencia antes y después de
// cada split (reconstruida hacia atrás desde la tenencia de hoy), el `ppc`, el precio de hoy y si
// algún factor explica el cociente precio/costo.
//
// - Credenciales: %OneDrive%\.secrets\gastos-familiares.env (parser de ./ppiCliente). Nunca se
//   imprimen valores, headers, tokens ni el número de cuenta.
// - Rutas: solo la lista blanca de ./ppiCliente (Account/*, MarketData/* de lectura).
// - Respuestas crudas → data/ppi-splits/ (fuera de git).
import * as fs from 'fs';
import * as path from 'path';
import { pedirPPI, leerEnv, sinTokens, BASE_PRODUCCION, BASE_SANDBOX } from './ppiCliente';

const REQUERIDAS = ['PPI_API_KEY', 'PPI_API_SECRET', 'PPI_AUTHORIZED_CLIENT', 'PPI_CLIENT_KEY', 'PPI_ACCOUNT_NUMBER', 'PPI_ENTORNO'];
const SALIDA = path.join(__dirname, '..', 'data', 'ppi-splits');
const ESPECIES = ['PAMP', 'TGSU2', 'TRAN', 'YPFD'];
const FACTOR = 5;
const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : typeof x === 'string' && x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : null);

async function main() {
  const rutaEnv = path.join(process.env.OneDrive ?? '', '.secrets', 'gastos-familiares.env');
  if (!process.env.OneDrive || !fs.existsSync(rutaEnv)) { console.error('[ppi] no encuentro %OneDrive%\\.secrets\\gastos-familiares.env'); process.exit(2); }
  const env = leerEnv(rutaEnv);
  const faltan = REQUERIDAS.filter(k => !env[k]);
  if (faltan.length) { console.error(`[ppi] faltan variables (sin valor o ausentes): ${faltan.join(', ')}`); process.exit(2); }
  const entorno = env.PPI_ENTORNO.toLowerCase();
  const base = /^(prod|produccion|producción|production)$/.test(entorno) ? BASE_PRODUCCION : /sandbox|sbx|test/.test(entorno) ? BASE_SANDBOX : null;
  if (!base) { console.error('[ppi] PPI_ENTORNO no es ni producción ni sandbox'); process.exit(2); }
  fs.mkdirSync(SALIDA, { recursive: true });
  const guardar = (nombre: string, x: unknown) => fs.writeFileSync(path.join(SALIDA, `${nombre}.json`), JSON.stringify(sinTokens(x), null, 2));

  const comunes = { AuthorizedClient: env.PPI_AUTHORIZED_CLIENT, ClientKey: env.PPI_CLIENT_KEY };
  const rl = await pedirPPI(base, 'POST', 'Account/LoginApi', { ...comunes, ApiKey: env.PPI_API_KEY, ApiSecret: env.PPI_API_SECRET });
  console.log(`[login] HTTP ${rl.status}`);
  if (rl.status !== 200) return;
  const tok = (Array.isArray(rl.body) ? rl.body[0] : rl.body) as Record<string, unknown>;
  const h = { ...comunes, Authorization: `Bearer ${String(tok.accessToken ?? '')}` };
  const q = `accountNumber=${encodeURIComponent(env.PPI_ACCOUNT_NUMBER)}`;

  const rbp = await pedirPPI(base, 'GET', `Account/BalancesAndPositions?${q}`, h);
  guardar('balances-positions', rbp.body);
  console.log(`[posiciones] HTTP ${rbp.status}`);
  const hoy = new Date();
  const desde = new Date(hoy.getTime() - 1095 * 86_400_000).toISOString().slice(0, 10);
  const rm = await pedirPPI(base, 'GET', `Account/Movements?${q}&dateFrom=${desde}&dateTo=${hoy.toISOString().slice(0, 10)}`, h);
  guardar('movements-1095d', rm.body);
  const movs = Array.isArray(rm.body) ? rm.body as Array<Record<string, unknown>> : [];
  console.log(`[movimientos] HTTP ${rm.status} · ${movs.length} filas desde ${desde}`);

  // Tenencia, ppc y precio de hoy de las especies.
  const grupos = ((rbp.body as { groupedInstruments?: Array<{ name?: string; instruments?: Array<Record<string, unknown>> }> } | null)?.groupedInstruments) ?? [];
  const instrumentos: Array<Record<string, unknown> & { grupo?: string }> = grupos.flatMap(g => (g.instruments ?? []).map(i => ({ ...i, grupo: g.name })));

  // Todas las filas de split (también de otras especies), por el texto.
  const splits = movs.filter(m => /^Split \//.test(String(m.description ?? '')));
  console.log(`\n=== filas "Split /" en 3 años: ${splits.length} ===`);
  for (const s of splits) {
    console.log(`  ${String(s.agreementDate ?? s.settlementDate ?? '').slice(0, 10)} · «${s.description}» · campo ticker ${s.ticker ?? '—'} · quantity ${s.quantity} · amount ${s.amount}`);
  }

  console.log('\n=== especies con costo sospechoso ===');
  const resumen: Record<string, unknown> = {};
  for (const t of ESPECIES) {
    const ins = instrumentos.find(i => String(i.ticker ?? '').toUpperCase() === t);
    const cantidad = num(ins?.quantity);
    const precio = num(ins?.price);
    const ppc = num((ins?.ppc as { ppcValue?: unknown } | undefined)?.ppcValue);
    const cociente = precio !== null && ppc ? precio / ppc : null;
    const deLaEspecie = movs.filter(m => String(m.ticker ?? '').toUpperCase() === t || new RegExp(`\\b${t}\\b`).test(String(m.description ?? '')));
    const splitsT = splits.filter(s => new RegExp(`^Split \\/\\s*${t}\\b`, 'i').test(String(s.description ?? '')));
    console.log(`\n${t} (${ins?.grupo ?? 'sin posición'}): tenencia hoy ${cantidad ?? '—'} · precio ${precio ?? '—'} · ppc ${ppc ?? '—'} · precio/ppc ${cociente?.toFixed(3) ?? '—'}`);
    console.log(`  ${deLaEspecie.length} movimientos con la especie en 3 años; ${splitsT.length} filas "Split / ${t}"`);
    for (const m of deLaEspecie.slice(0, 40)) {
      console.log(`    ${String(m.agreementDate ?? '').slice(0, 10)} · «${m.description}» · quantity ${m.quantity} · price ${m.price} · amount ${m.amount}`);
    }
    const factores: Array<{ fecha: string; antes: number | null; despues: number | null; factor: number | null }> = [];
    for (const s of splitsT) {
      const fecha = String(s.agreementDate ?? s.settlementDate ?? '').slice(0, 10);
      // Hacia atrás desde hoy: tenencia antes del split = hoy − (cantidades desde el split, incluido).
      const despuesDelSplit = deLaEspecie.filter(m => String(m.agreementDate ?? '').slice(0, 10) >= fecha && !/^Split \//.test(String(m.description ?? '')));
      const netoDespues = despuesDelSplit.reduce((a, m) => a + (num(m.quantity) ?? 0), 0);
      const qSplit = num(s.quantity) ?? 0;
      const despues = cantidad !== null ? cantidad - netoDespues : null;
      const antes = despues !== null ? despues - qSplit : null;
      const factor = antes && despues ? despues / antes : null;
      factores.push({ fecha, antes, despues, factor });
      console.log(`  split ${fecha}: quantity ${qSplit} · tenencia antes ≈ ${antes} · después ≈ ${despues} · factor ≈ ${factor?.toFixed(4) ?? '—'}`);
    }
    for (const f of factores) {
      if (!f.factor || !ppc || precio === null) continue;
      const div = precio / (ppc / f.factor), mul = precio / (ppc * f.factor);
      const ok = (r: number) => r >= 1 / FACTOR && r <= FACTOR;
      console.log(`  con factor ${f.factor.toFixed(4)}: precio/(ppc÷f) = ${div.toFixed(3)} ${ok(div) ? 'EXPLICA' : 'no'} · precio/(ppc×f) = ${mul.toFixed(3)} ${ok(mul) ? 'EXPLICA' : 'no'}`);
    }
    if (!splitsT.length) console.log('  sin split registrado en 3 años: no hay factor que medir');
    resumen[t] = { cantidad, precio, ppc, cociente, splits: factores };
  }
  guardar('resumen', resumen);
  console.log(`\n[ppi] fin · crudos en data/ppi-splits/`);
}

main().catch(e => { console.error('[ppi] error:', e instanceof Error ? e.message : String(e)); process.exit(1); });
