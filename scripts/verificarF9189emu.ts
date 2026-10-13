// F9.189 — verificación 1, 2 y 3 contra el EMULADOR de Firestore, con el código real de src/.
//
//   firebase emulators:start --only firestore --project demo-f9189
//   npx tsx scripts/verificarF9189emu.ts
//
// `confirmarIngesta` y `exportarCorridaTxt` se cargan con scripts/simConfirmarResumen.ts: lee del
// Firestore que se le pase (acá el emulador) y anota los batches sin escribir. Este script aplica
// cada batch anotado al emulador en una sola escritura atómica del Admin SDK, así el estado que
// queda es el que dejaría el teléfono.
// `validarCorrida` y `enriquecerPosiciones` viven sin exportar en PatrimonioIngesta.tsx (JSX): se
// extrae su texto del archivo y se evalúa tal cual. El mapeo de las filas marcadas OK
// (handleConfirmar) se replica en una línea, marcado abajo.
process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
import * as fs from 'node:fs';
import { createRequire } from 'node:module';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { crearSim, esServerTimestamp } from './simConfirmarResumen';
import type { Posicion, PosicionRaw, CorraidaJSON, MetaCorrida } from '../src/types/patrimonio';

if (getApps().length === 0) initializeApp({ projectId: 'demo-f9189' });
const db = getFirestore();
const sim = crearSim(db);
type PatMod = {
  confirmarIngesta: (p: Posicion[], m: MetaCorrida, fijos: number, manuales: number, met: Record<string, unknown>) => Promise<void>;
  exportarCorridaTxt: (f?: string) => Promise<{ nombre: string; contenido: string } | null>;
};
const PAT = sim.cargar<PatMod>('src/datos/patrimonio.ts');

// ── funciones sin exportar de PatrimonioIngesta.tsx, evaluadas desde el archivo ──
const ts = createRequire(process.cwd() + '/package.json')('typescript') as typeof import('typescript');
const fuente = fs.readFileSync('src/vistas/PatrimonioIngesta.tsx', 'utf8').replace(/\r\n/g, '\n');
const tramo = (desde: string, hasta: string) => fuente.slice(fuente.indexOf(desde), fuente.indexOf(hasta));
const codigo = tramo('const TIPOS_VALIDOS', 'function fmtUsd') + tramo('function enriquecerPosiciones', '// ── Diff');
const js = ts.transpileModule(codigo + '\nreturn { validarCorrida, enriquecerPosiciones };', { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const ING = new Function(js)() as {
  validarCorrida: (raw: unknown) => string[];
  enriquecerPosiciones: (p: PosicionRaw[], f: string, tc: number) => Posicion[];
};

type Caso = { name: string; ok: boolean; detail: string };
const casos: Caso[] = [];
const chequear = (name: string, ok: boolean, detail: string) => casos.push({ name, ok, detail });

const FECHA = '2026-10-13';
const TC = 1450;
const fila = (ticker: string, over: Partial<PosicionRaw> = {}): PosicionRaw => ({
  cuenta: 'Balanz 402665', titular: null, ticker, tipo: 'accion', sector: 'energia', pais_riesgo: 'AR',
  moneda_origen: 'USD', valor_origen: 1000, cantidad: 10, fuente: 'test.pdf', revisar: false, ...over,
});
const corrida = (posiciones: PosicionRaw[]): CorraidaJSON => ({
  meta: { fecha_corrida: FECHA, entidad: 'familia', fuentes: ['test.pdf'], total_declarado_usd: 1 },
  posiciones,
});

async function aplicarUltimoBatch() {
  const ops = sim.batches[sim.batches.length - 1];
  const b = db.batch();
  for (const o of ops) {
    const ref = db.doc(o.ref.path);
    if (o.op === 'delete') b.delete(ref);
    else {
      const data = Object.fromEntries(Object.entries(o.data!).map(([k, v]) => [k, esServerTimestamp(v) ? FieldValue.serverTimestamp() : v]));
      if (o.op === 'set') b.set(ref, data); else b.update(ref, data);
    }
  }
  await b.commit();
  return ops;
}

async function confirmar(c: CorraidaJSON, revisadas: Set<number> = new Set()) {
  const errs = ING.validarCorrida(c);
  if (errs.length) throw new Error(`validarCorrida: ${errs.join(' | ')}`);
  const enr = ING.enriquecerPosiciones(c.posiciones, c.meta.fecha_corrida, TC);
  // Réplica de handleConfirmar (PatrimonioIngesta.tsx, F9.189 §3.2):
  const aGuardar = enr.map((p, i) => (revisadas.has(i) ? { ...p, revisar: false, revisadoEnIngesta: true } : p));
  await PAT.confirmarIngesta(aGuardar, c.meta, 0, 0, {});
  return aplicarUltimoBatch();
}

const posDeFecha = async () => (await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', FECHA).get()).docs.map(d => d.data() as Posicion);
const snapDeFecha = async () => (await db.doc(`snapshotsPortafolio/${FECHA}`).get()).data()!;

async function main() {
  // Emulador limpio.
  for (const col of ['posicionesPatrimonio', 'snapshotsPortafolio']) {
    const s = await db.collection(col).get();
    await Promise.all(s.docs.map(d => d.ref.delete()));
  }

  // ── V1 re-ingesta ──
  // Incluye dos filas legítimas con la misma cuenta+ticker (cash en dos monedas): no colisionan.
  const base = [
    fila('TRAN'), fila('GGAL', { valor_origen: 2000 }),
    fila('ARS', { tipo: 'cash', sector: 'cash', moneda_origen: 'ARS', valor_origen: 1450000, cantidad: null }),
    fila('ARS', { tipo: 'cash', sector: 'cash', moneda_origen: 'USD', valor_origen: 300, cantidad: null }),
    fila('BCMMUSDA', { tipo: 'fci', sector: 'money_market_usd', valor_origen: 412 }),
  ];
  const N = base.length;
  const totalEsperado = 1000 + 2000 + 1000 + 300 + 412;

  await confirmar(corrida(base));
  let pos = await posDeFecha();
  chequear('V1a primera ingesta', pos.length === N, `${pos.length} posiciones (esperado ${N})`);

  const ops2 = await confirmar(corrida(base));
  pos = await posDeFecha();
  let snap = await snapDeFecha();
  const suma = pos.reduce((s, p) => s + p.valorUsd, 0);
  chequear('V1b misma corrida otra vez → N, no 2N', pos.length === N, `${pos.length} posiciones; batch: ${ops2.filter(o => o.op === 'delete').length} delete + ${ops2.filter(o => o.op === 'set').length} set`);
  chequear('V1c snapshot cuadra', snap.cantidadPosiciones === N && Math.abs(snap.totalCorridaUsd - totalEsperado) < 0.01 && Math.abs(suma - totalEsperado) < 0.01,
    `cantidadPosiciones ${snap.cantidadPosiciones} · totalCorridaUsd ${snap.totalCorridaUsd} · suma posiciones ${suma}`);

  await confirmar(corrida(base.slice(0, -1)));
  pos = await posDeFecha();
  snap = await snapDeFecha();
  chequear('V1d versión con una fila menos → N−1', pos.length === N - 1 && snap.cantidadPosiciones === N - 1, `${pos.length} posiciones, snapshot ${snap.cantidadPosiciones}`);

  // Otra fecha no se toca.
  const otra = { ...corrida([fila('YPFD')]), meta: { ...corrida([]).meta, fecha_corrida: '2026-09-03' } };
  await confirmar(otra);
  await confirmar(corrida(base));
  const otras = (await db.collection('posicionesPatrimonio').where('fechaCorrida', '==', '2026-09-03').get()).size;
  chequear('V1e re-ingestar una fecha no toca otra', otras === 1, `2026-09-03: ${otras} posición`);

  // Guard de tamaño: 300 previas + 300 nuevas + 1 > 450 → error explícito, nada escrito.
  const grande = Array.from({ length: 300 }, (_, i) => fila(`T${i}`));
  // Sin sim.reset(): reinicia el contador de IDs automáticos y colisionaría con docs de otra fecha.
  await confirmar(corrida(grande));   // 5 previas + 300 + 1 = 306: entra
  const nAntes = (await posDeFecha()).length;
  const batchesAntes = sim.batches.length;
  let msg = '';
  try { await PAT.confirmarIngesta(ING.enriquecerPosiciones(grande, FECHA, TC), corrida(grande).meta, 0, 0, {}); } catch (e) { msg = (e as Error).message; }
  chequear('V1f guard >450 lanza con los números', /300 posiciones a borrar \+ 300 a escribir \+ 1 snapshot = 601/.test(msg) && sim.batches.length === batchesAntes && (await posDeFecha()).length === nAntes,
    msg || '(no lanzó)');

  // ── V2 Paso 3: 3 para revisar (2 con motivo, 1 sin), 2 marcadas OK ──
  const conRevisar = [
    fila('TRAN'),
    fila('BCMMUSDA', { tipo: 'fci', sector: 'money_market_usd', revisar: true, motivo_revisar: 'ticker nuevo, clasificado como fci/money_market_usd' }),
    fila('GD30', { tipo: 'bono', sector: 'soberano_usd', revisar: true, motivo_revisar: 'encabezado Bonos USD 15.708 vs detalle 15.487' }),
    fila('ARS', { tipo: 'cash', sector: 'cash', revisar: true, cantidad: null }),
  ];
  await confirmar(corrida(conRevisar), new Set([1, 3]));
  pos = await posDeFecha();
  const por = (t: string) => pos.find(p => p.ticker === t)!;
  chequear('V2a marcadas OK → revisar:false + revisadoEnIngesta:true',
    por('BCMMUSDA').revisar === false && por('BCMMUSDA').revisadoEnIngesta === true && por('ARS').revisar === false && por('ARS').revisadoEnIngesta === true,
    `BCMMUSDA ${por('BCMMUSDA').revisar}/${por('BCMMUSDA').revisadoEnIngesta} · ARS ${por('ARS').revisar}/${por('ARS').revisadoEnIngesta}`);
  chequear('V2b no marcada → revisar:true, sin revisadoEnIngesta, conserva motivo',
    por('GD30').revisar === true && por('GD30').revisadoEnIngesta === undefined && por('GD30').motivo_revisar === 'encabezado Bonos USD 15.708 vs detalle 15.487',
    JSON.stringify({ revisar: por('GD30').revisar, revisadoEnIngesta: por('GD30').revisadoEnIngesta, motivo: por('GD30').motivo_revisar }));
  chequear('V2c fila sin motivo → sin campo (la UI dice "sin motivo indicado")', !('motivo_revisar' in por('ARS')), JSON.stringify(por('ARS')));
  chequear('V2d Tenencias: REVISAR solo en una', pos.filter(p => p.revisar).map(p => p.ticker).join() === 'GD30', pos.filter(p => p.revisar).map(p => p.ticker).join());

  // ── V3 compatibilidad ──
  const vieja = corrida([fila('TRAN'), fila('PAMP', { revisar: true })]);   // sin motivo_revisar en ninguna fila
  chequear('V3a .txt viejo sin motivo_revisar valida', ING.validarCorrida(vieja).length === 0, ING.validarCorrida(vieja).join(' | ') || 'sin errores');
  chequear('V3b motivo_revisar no-string se rechaza', ING.validarCorrida(corrida([fila('TRAN', { motivo_revisar: 3 as unknown as string })])).length === 1,
    ING.validarCorrida(corrida([fila('TRAN', { motivo_revisar: 3 as unknown as string })])).join(' | '));
  chequear('V3c motivo_revisar null valida', ING.validarCorrida(corrida([fila('TRAN', { motivo_revisar: null })])).length === 0, 'ok');
  await confirmar(vieja);
  chequear('V3d .txt viejo se guarda', (await posDeFecha()).length === 2, `${(await posDeFecha()).length} posiciones`);

  // Export F9.115 → re-import: mismo valorUsd y conserva motivo_revisar; no exporta revisadoEnIngesta.
  const mixta = [
    ...conRevisar,
    fila('YPFD', { moneda_origen: 'ARS', valor_origen: 2_900_000 }),
  ];
  await confirmar(corrida(mixta), new Set([1]));
  const antes = await posDeFecha();
  const exp = await PAT.exportarCorridaTxt(FECHA);
  const reimp = JSON.parse(exp!.contenido) as CorraidaJSON;
  const enr = ING.enriquecerPosiciones(reimp.posiciones, FECHA, TC);
  const clave = (p: Posicion) => `${p.cuenta}|${p.ticker}|${p.moneda_origen}`;
  const mapaAntes = new Map(antes.map(p => [clave(p), p]));
  const igualesUsd = enr.every(p => Math.abs(p.valorUsd - mapaAntes.get(clave(p))!.valorUsd) < 1e-9);
  const motivos = reimp.posiciones.filter(p => p.motivo_revisar).map(p => `${p.ticker}:${p.motivo_revisar}`);
  chequear('V3e export→re-import: mismo valorUsd', igualesUsd && ING.validarCorrida(reimp).length === 0, `${enr.length} filas, validación ${ING.validarCorrida(reimp).length} errores`);
  chequear('V3f export conserva motivo_revisar', motivos.length === 2, motivos.join(' · '));
  chequear('V3g export NO incluye revisadoEnIngesta', !exp!.contenido.includes('revisadoEnIngesta'), 'ok');

  // ── V5 prompt ──
  const PR = sim.cargar<{ promptExtraccionPosiciones: (f: string) => string }>('src/datos/patrimonioPromptExtraccion.ts');
  const prompt = PR.promptExtraccionPosiciones(FECHA);
  const tituRevisar = /titular[^\n]*null[^\n]*→[^\n]*revisar: true/.test(prompt);
  chequear('V5 prompt sin "titular null → revisar"', !tituRevisar && /Eso\s+solo no es motivo/.test(prompt) && prompt.includes('motivo_revisar') && prompt.includes('| BCMMUSDA | fci | money_market_usd | AR |'),
    tituRevisar ? 'queda la regla vieja' : 'ok');

  let fallas = 0;
  for (const c of casos) {
    console.log(`${c.ok ? 'OK  ' : 'FAIL'} ${c.name} — ${c.detail}`);
    if (!c.ok) fallas++;
  }
  console.log(`\n${casos.length - fallas}/${casos.length} OK`);
  process.exit(fallas ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
