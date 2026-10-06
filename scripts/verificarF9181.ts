// F9.181 §0 — medición del resumen que no entra en 32.000 tokens de salida. SOLO LECTURA.
//
//   npx tsx scripts/verificarF9181.ts
//
// 0.1 los resúmenes en error por stop_reason (+ páginas del PDF, con pdf-parse)
// 0.2 distribución de líneas por resumen y los anteriores de la misma tarjeta que falló
// 0.3 tokens por línea del formato actual (objeto indentado, 16 campos) vs el compacto de §1,
//     contados con messages.countTokens — no estimados por caracteres
//
// Privacidad: ids a 8 caracteres, descripciones recortadas.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const req = createRequire(process.cwd() + '/functions/package.json');
const Anthropic = req('@anthropic-ai/sdk').default ?? req('@anthropic-ai/sdk');
const pdfParse = req('pdf-parse') as (b: Buffer) => Promise<{ text: string; numpages: number }>;

process.env.TZ = 'America/Argentina/Buenos_Aires';
if (getApps().length === 0) initializeApp({
  credential: cert('./secrets/serviceAccountKey.json'),
  storageBucket: 'gastos-familiares-e6415.firebasestorage.app',
});
const db = getFirestore();
const MODELO = 'claude-sonnet-4-6';
const MAX_HOY = 32000;

const h8 = (v: unknown) => (v ? String(v).slice(0, 8) : '-');
const s = (v: unknown) => (v === null ? 'null' : v === undefined ? '(ausente)' : String(v));
const fechaAR = (v: unknown) => {
  const t = v as { toDate?: () => Date } | null | undefined;
  return t?.toDate ? t.toDate().toLocaleString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) : s(v);
};

function leerSecreto(): string | null {
  try {
    return execSync('npx firebase functions:secrets:access ANTHROPIC_API_KEY',
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || null;
  } catch { return null; }
}

type Linea = Record<string, unknown>;

/** El formato que pide hoy la plantilla del prompt: objeto indentado, 16 campos, en ese orden. */
function formatoActual(ls: Linea[]): string {
  const movs = ls.map(l => ({
    seq: l.seq, tipoLinea: l.tipoLinea, fechaConsumo: l.fechaConsumo ?? null,
    descripcionRaw: l.descripcionRaw ?? '', nroCupon: l.nroCupon ?? '',
    cuotaActual: l.cuotaActual ?? 1, cuotaTotal: l.cuotaTotal ?? 1,
    moneda: l.moneda, monto: l.monto, montoFirmado: l.montoFirmado ?? null,
    seccion: l.seccion ?? null, personaDetectada: l.personaDetectada ?? '',
    esBonificacion: l.tipoLinea === 'bonificacion', esReverso: l.tipoLinea === 'reverso',
    esImpuesto: l.tipoLinea === 'impuesto', esPagoAnterior: false,
  }));
  return JSON.stringify({ movimientos: movs }, null, 2);
}

/** §1: minificado, un movimiento por renglón, sin los espejos de tipoLinea ni los vacíos/por defecto. */
function formatoCompacto(ls: Linea[]): string {
  const movs = ls.map(l => {
    const o: Linea = { seq: l.seq, tipoLinea: l.tipoLinea, fechaConsumo: l.fechaConsumo ?? null,
      descripcionRaw: l.descripcionRaw ?? '' };
    if (l.nroCupon) o.nroCupon = l.nroCupon;
    if ((l.cuotaActual ?? 1) !== 1) o.cuotaActual = l.cuotaActual;
    if ((l.cuotaTotal ?? 1) !== 1) o.cuotaTotal = l.cuotaTotal;
    o.moneda = l.moneda; o.monto = l.monto; o.montoFirmado = l.montoFirmado ?? null;
    o.seccion = l.seccion ?? null;
    if (l.personaDetectada) o.personaDetectada = l.personaDetectada;
    return JSON.stringify(o);
  });
  return `{"movimientos":[\n${movs.join(',\n')}\n]}`;
}

const pdfDe = async (ref: unknown) => {
  const [buf] = await getStorage().bucket().file(s(ref)).download();
  return pdfParse(buf as Buffer);
};
// Renglones del detalle que empiezan con fecha: BBVA "01-Oct-26", Galicia "09-04-26" / "09/04/26".
const renglonesConFecha = (t: string) =>
  t.split('\n').filter(l => /^\s*\d{2}-[A-Za-z]{3}-\d{2}/.test(l) || /^\s*\d{2}[-/.]\d{2}[-/.]\d{2,4}/.test(l)).length;
function tarjetaDelPdf(t: string) {
  const banco = /BBVA/i.test(t) ? 'BBVA' : /Galicia/i.test(t) ? 'Galicia' : '?';
  const tipo = /Visa Signature/i.test(t) ? 'Visa Signature' : /Mastercard/i.test(t) ? 'Mastercard' : /Visa/i.test(t) ? 'Visa' : '?';
  const cierre = t.match(/CIERRE ACTUAL\s*\n?\s*(\d{2}-[A-Za-z]{3}-\d{2})/i)?.[1] ?? '?';
  return { banco, tipo, cierre };
}
const codigoDe = (banco: string, tipo: string) =>
  banco === 'BBVA' && tipo === 'Visa Signature' ? 'BBVA-VISA-SIG' : banco === 'BBVA' ? 'BBVA-MASTER-BLK'
    : banco === 'Galicia' && tipo === 'Visa' ? 'GAL-VISA' : banco === 'Galicia' ? 'GAL-MASTER-BLK' : null;

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY ?? leerSecreto();
  const resus = await db.collection('resumenesTarjeta').get();
  console.log(`F9.181 §0 — SOLO LECTURA. resumenesTarjeta: ${resus.size} docs\n`);

  // ── 0.1 ───────────────────────────────────────────────────────────────────
  console.log('── 0.1 resúmenes en error por stop_reason');
  const fallados = resus.docs.filter(d => d.data().estado === 'error' && String(d.data().errorExtraccion ?? '').includes('stop_reason'));
  if (!fallados.length) console.log('  (ninguno)');
  const infoFallado = new Map<string, { codigo: string | null; filas: number }>();
  for (const d of fallados) {
    const x = d.data();
    const p = await pdfDe(x.refStoragePdf);
    const tp = tarjetaDelPdf(p.text);
    const filas = renglonesConFecha(p.text);
    infoFallado.set(d.id, { codigo: codigoDe(tp.banco, tp.tipo), filas });
    console.log(`  ${h8(d.id)} | banco/tarjeta en el doc: "${s(x.banco)}"/"${s(x.tarjeta)}" | tarjetaCodigo=${s(x.tarjetaCodigo)} | subidoEn=${fechaAR(x.subidoEn ?? x.creadoEn)} | intentos=${s(x.intentos)}`);
    console.log(`    PDF: ${p.numpages} páginas | dice ${tp.banco} / ${tp.tipo}, cierre ${tp.cierre} | renglones que empiezan con fecha: ${filas}`);
    console.log(`    errorExtraccion: ${s(x.errorExtraccion)}`);
  }
  const otrosError = resus.docs.filter(d => d.data().estado === 'error' && !fallados.includes(d));
  for (const d of otrosError) console.log(`  (otro error, sin stop_reason) ${h8(d.id)} ${s(d.data().banco)}/${s(d.data().tarjeta)}: ${String(d.data().errorExtraccion ?? '').slice(0, 100)}`);

  // ── 0.2 ───────────────────────────────────────────────────────────────────
  console.log('\n── 0.2 líneas por resumen (los que tienen movimientosParseados)');
  const conLineas = resus.docs
    .map(d => ({ d, x: d.data(), n: ((d.data().movimientosParseados ?? []) as unknown[]).length }))
    .filter(r => r.n > 0)
    .sort((a, b) => a.n - b.n);
  const ns = conLineas.map(r => r.n);
  const q = (p: number) => ns[Math.min(ns.length - 1, Math.ceil(p * ns.length) - 1)];
  console.log(`  n=${ns.length} | mín=${ns[0]} | mediana=${q(0.5)} | p90=${q(0.9)} | máx=${ns[ns.length - 1]}`);
  for (const r of conLineas.slice(-5).reverse())
    console.log(`    ${h8(r.d.id)} ${s(r.x.banco)}/${s(r.x.tarjeta)} ${s(r.x.periodo)} [${s(r.x.estado)}] → ${r.n} líneas, ${s(r.x.tarjetaCodigo)}`);

  // consistencia de los espejos que §1 pasa a derivar (si alguno discrepa, derivarlos cambia datos)
  let discrepa = 0, total = 0;
  for (const r of conLineas) for (const l of (r.x.movimientosParseados ?? []) as Linea[]) {
    total++;
    if (Boolean(l.esBonificacion) !== (l.tipoLinea === 'bonificacion') || Boolean(l.esReverso) !== (l.tipoLinea === 'reverso')
      || Boolean(l.esImpuesto) !== (l.tipoLinea === 'impuesto')) {
      discrepa++;
      if (discrepa <= 10) console.log(`    espejo ≠ tipoLinea: ${h8(r.d.id)} seq=${s(l.seq)} tipoLinea=${s(l.tipoLinea)} bon=${s(l.esBonificacion)} rev=${s(l.esReverso)} imp=${s(l.esImpuesto)}`);
    }
  }
  console.log(`  espejos esBonificacion/esReverso/esImpuesto vs tipoLinea: ${discrepa} discrepancias en ${total} líneas guardadas`);

  // Misma tarjeta: el doc fallado no tiene tarjetaCodigo (nunca llegó a resolverse), así que sale del PDF.
  // Calibración: renglones con fecha del PDF vs líneas guardadas, en los de la misma tarjeta.
  for (const f of fallados) {
    const inf = infoFallado.get(f.id)!;
    const misma = conLineas.filter(r => r.d.id !== f.id && r.x.tarjetaCodigo === inf.codigo)
      .sort((a, b) => fechaAR(a.x.fechaCierre).localeCompare(fechaAR(b.x.fechaCierre)));
    console.log(`  misma tarjeta que ${h8(f.id)} (${s(inf.codigo)}, del PDF):`);
    const ratios: number[] = [];
    for (const r of misma) {
      if (!r.x.refStoragePdf) {
        console.log(`    ${h8(r.d.id)} cierre=${fechaAR(r.x.fechaCierre).slice(0, 10)} [${s(r.x.estado)}] sin PDF en Storage líneasGuardadas=${r.n}`);
        continue;
      }
      const p = await pdfDe(r.x.refStoragePdf);
      const filas = renglonesConFecha(p.text);
      if (filas > 0) ratios.push(r.n / filas);
      console.log(`    ${h8(r.d.id)} cierre=${fechaAR(r.x.fechaCierre).slice(0, 10)} [${s(r.x.estado)}] páginas=${p.numpages} renglonesConFecha=${filas} líneasGuardadas=${r.n}`);
    }
    if (ratios.length) {
      const mn = Math.min(...ratios), mx = Math.max(...ratios);
      console.log(`    líneas/renglón en esa tarjeta: ${mn.toFixed(2)}–${mx.toFixed(2)} → el que falló (${inf.filas} renglones) tendría ~${Math.round(inf.filas * mn)}–${Math.round(inf.filas * mx)} líneas`);
    }
  }

  // ── 0.3 ───────────────────────────────────────────────────────────────────
  console.log('\n── 0.3 tokens: formato actual vs compacto (messages.countTokens)');
  if (!apiKey) { console.log('  >>> SALTEADO: sin ANTHROPIC_API_KEY'); return; }
  const client = new Anthropic({ apiKey });
  const contar = async (t: string) =>
    (await client.messages.countTokens({ model: MODELO, messages: [{ role: 'user', content: t }] })).input_tokens as number;
  const base = await contar('x');
  // El más largo es una extracción vieja (sin seccion ni montoFirmado): se mide también el más largo
  // extraído con el prompt de hoy (seccion presente), que es lo que el modelo escribe de verdad.
  const masLargo = conLineas[conLineas.length - 1];
  const conSeccion = [...conLineas].reverse().find(r => ((r.x.movimientosParseados ?? []) as Linea[]).some(l => l.seccion));
  const medir = [masLargo, ...(conSeccion && conSeccion !== masLargo ? [conSeccion] : [])];
  for (const r of medir) {
    const ls = r.x.movimientosParseados as Linea[];
    const tA = (await contar(formatoActual(ls))) - base;
    const tC = (await contar(formatoCompacto(ls))) - base;
    const porA = tA / ls.length, porC = tC / ls.length;
    const conS = ls.filter(l => l.seccion).length;
    console.log(`  resumen ${h8(r.d.id)} ${s(r.x.tarjetaCodigo)} ${s(r.x.periodo)}: ${ls.length} líneas, ${conS} con seccion (base del mensaje=${base} tokens, restada)`);
    console.log(`    actual:   ${tA} tokens → ${porA.toFixed(1)} tok/línea → caben ~${Math.floor(MAX_HOY / porA)} líneas en ${MAX_HOY}`);
    console.log(`    compacto: ${tC} tokens → ${porC.toFixed(1)} tok/línea → caben ~${Math.floor(MAX_HOY / porC)} líneas en ${MAX_HOY}`);
    console.log(`    ahorro: ${(100 * (1 - tC / tA)).toFixed(1)}%`);
  }
  const muestra = ((conSeccion ?? masLargo).x.movimientosParseados as Linea[]).slice(0, 3)
    .map(l => ({ ...l, descripcionRaw: String(l.descripcionRaw ?? '').slice(0, 10) + '…' }));
  console.log('\n  muestra actual (1 línea):\n' + formatoActual(muestra.slice(0, 1)).split('\n').map(l => '    ' + l).join('\n'));
  console.log('  muestra compacto (3 líneas):\n' + formatoCompacto(muestra).split('\n').map(l => '    ' + l).join('\n'));
}

main().catch(e => { console.error(e); process.exit(1); });
