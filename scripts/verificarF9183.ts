// F9.183 §0 — agenda de pagos con dedup contra lo cargado. SOLO LECTURA.
//
//   npx tsx scripts/verificarF9183.ts
//
// §0 pide la captura de referencia (Descargas/agenda-2026-10-06.png) y PARA si no está. Esto deja
// constancia de eso y adelanta lo que se puede medir SIN la captura y sin escribir nada:
//   · el apareo de 2.0 (llave numeroCliente normalizado + 1er vencimiento, uno a uno por monto más
//     cercano, tope 3 %) contra los comprobantes REALES, con las 7 filas de la tabla de §0;
//   · la re-subida de la verificación 3 (misma agenda de nuevo / "un mes después"), sobre el estado
//     que dejaría la anterior, en memoria;
//   · el universo de 2.0 (qué estados existen, cómo se descarta).
// El apareo es un PROTOTIPO de lo que iría en functions/src: la llave usa la
// normalizarClaveDesambiguacion REAL (recortada de index.ts).
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

process.env.TZ = 'America/Argentina/Buenos_Aires';
if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const req = createRequire(process.cwd() + '/functions/package.json');
const ts = req('typescript') as typeof import('typescript');

const srcFn = fs.readFileSync('functions/src/index.ts', 'utf8').replace(/\r\n/g, '\n');
const bl = (d: string, h: string) => { const i = srcFn.indexOf(d); if (i < 0) throw new Error(d); return srcFn.slice(i, srcFn.indexOf(h, i) + h.length); };
const normalizarClaveDesambiguacion = new Function(`${ts.transpileModule(bl('function normalizarClaveDesambiguacion', '\n}'),
  { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText}\nreturn normalizarClaveDesambiguacion;`)() as (v: unknown) => string;

const h8 = (v: unknown) => (v ? String(v).slice(0, 8) : '-');
const fmt = (n: number) => n.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const TOPE = 0.03;

type Fila = { emisor: string; numeroCliente: string; monto: number; vencimiento: string };
type Existente = { id: string; numeroCliente: string; monto: number; vencimiento: string; emisor: string; subido: string };
type Resultado = { fila: Fila; yaCargada?: Existente; diff?: number };

/** 2.0 — apareo uno a uno dentro de cada grupo (numeroCliente normalizado + 1er vencimiento). */
function aparear(filas: Fila[], existentes: Existente[]): Resultado[] {
  const clave = (nc: string, v: string) => `${normalizarClaveDesambiguacion(nc)}|${v}`;
  const pares: Array<{ fi: number; ex: Existente; diff: number }> = [];
  filas.forEach((f, fi) => {
    for (const ex of existentes) {
      if (clave(ex.numeroCliente, ex.vencimiento) !== clave(f.numeroCliente, f.vencimiento)) continue;
      const diff = Math.abs(f.monto - ex.monto) / ex.monto;
      if (diff <= TOPE) pares.push({ fi, ex, diff });
    }
  });
  // Gana la menor diferencia; desempate determinístico por monto de la fila y por id del existente.
  pares.sort((a, b) => a.diff - b.diff || filas[a.fi].monto - filas[b.fi].monto || a.ex.id.localeCompare(b.ex.id));
  const usados = new Set<string>(); const res: Resultado[] = filas.map(fila => ({ fila }));
  for (const p of pares) {
    if (res[p.fi].yaCargada || usados.has(p.ex.id)) continue;
    res[p.fi].yaCargada = p.ex; res[p.fi].diff = p.diff; usados.add(p.ex.id);
  }
  return res;
}

/**
 * Alternativa al desempate del prompt: dentro de cada grupo, la asignación uno a uno que MAXIMIZA
 * los pares (todos dentro del tope) y, entre ésas, MINIMIZA la suma de diferencias. Los grupos son
 * chicos (las cuotas de un mismo vencimiento), así que se prueba por fuerza bruta.
 */
function aparearOptimo(filas: Fila[], existentes: Existente[]): Resultado[] {
  const clave = (nc: string, v: string) => `${normalizarClaveDesambiguacion(nc)}|${v}`;
  const res: Resultado[] = filas.map(fila => ({ fila }));
  const grupos = new Map<string, number[]>();
  filas.forEach((f, i) => { const k = clave(f.numeroCliente, f.vencimiento); grupos.set(k, [...(grupos.get(k) ?? []), i]); });
  for (const [k, idx] of grupos) {
    const exs = existentes.filter(e => clave(e.numeroCliente, e.vencimiento) === k);
    let mejor: { pares: number; costo: number; asign: Array<number | null> } = { pares: 0, costo: 0, asign: idx.map(() => null) };
    const asign: Array<number | null> = [];
    const usado = new Set<number>();
    const rec = (i: number, pares: number, costo: number) => {
      if (i === idx.length) {
        if (pares > mejor.pares || (pares === mejor.pares && costo < mejor.costo)) mejor = { pares, costo, asign: [...asign] };
        return;
      }
      asign.push(null); rec(i + 1, pares, costo); asign.pop();
      exs.forEach((ex, j) => {
        if (usado.has(j)) return;
        const diff = Math.abs(filas[idx[i]].monto - ex.monto) / ex.monto;
        if (diff > TOPE) return;
        usado.add(j); asign.push(j); rec(i + 1, pares + 1, costo + diff); asign.pop(); usado.delete(j);
      });
    };
    rec(0, 0, 0);
    mejor.asign.forEach((j, n) => { if (j != null) { res[idx[n]].yaCargada = exs[j]; res[idx[n]].diff = Math.abs(filas[idx[n]].monto - exs[j].monto) / exs[j].monto; } });
  }
  return res;
}

const AGIP = '0070031265481', EDENOR = '007497140070', METROGAS = '010372743000';
// Las 7 filas de la tabla de §0 (no salen de la captura: son el criterio de aceptación del prompt).
const AGENDA: Fila[] = [
  { emisor: 'Edenor',   numeroCliente: EDENOR,   monto: 137509.91, vencimiento: '2026-10-07' },
  { emisor: 'Metrogas', numeroCliente: METROGAS, monto: 5291.83,   vencimiento: '2026-10-08' },
  { emisor: 'AGIP',     numeroCliente: AGIP,     monto: 87084.97,  vencimiento: '2026-10-31' },
  { emisor: 'AGIP',     numeroCliente: AGIP,     monto: 76228.21,  vencimiento: '2026-10-07' },
  { emisor: 'AGIP',     numeroCliente: AGIP,     monto: 92479.04,  vencimiento: '2026-10-31' },
  { emisor: 'AGIP',     numeroCliente: AGIP,     monto: 89605.43,  vencimiento: '2026-10-31' },
  { emisor: 'AGIP',     numeroCliente: AGIP,     monto: 88081.49,  vencimiento: '2026-10-31' },
];
const ESPERADO: Record<string, string | null> = { // monto → id del recorte esperado (null = nueva)
  '137509.91': '2824a147', '5291.83': '1f5087af', '87084.97': 'e9089013',
  '76228.21': null, '92479.04': null, '89605.43': null, '88081.49': null,
};

function imprimir(titulo: string, res: Resultado[]) {
  console.log(`  ${titulo}`);
  for (const r of res) console.log(`    ${r.fila.emisor.padEnd(8)} ${fmt(r.fila.monto).padStart(11)} · vence ${r.fila.vencimiento} → ` +
    (r.yaCargada ? `ya cargada (${h8(r.yaCargada.id)} ${r.yaCargada.emisor} ${fmt(r.yaCargada.monto)} · subido ${r.yaCargada.subido}, Δ ${(100 * r.diff!).toFixed(2)} %)` : 'NUEVA'));
  console.log(`    → ${res.filter(r => !r.yaCargada).length} hijos, ${res.filter(r => r.yaCargada).length} ya cargadas`);
}

async function main() {
  console.log('F9.183 §0 — SOLO LECTURA.\n');

  // ── La captura ──
  const captura = path.join(os.homedir(), 'Downloads', 'agenda-2026-10-06.png');
  const hay = fs.existsSync(captura);
  console.log(`── la captura de referencia: ${captura} → ${hay ? 'ESTÁ' : 'NO ESTÁ'}`);
  if (!hay) console.log('   GATE §0: PARAR y pedirla. Sin captura no se puede escribir ni verificar §1 (extracción).');

  // ── Universo de 2.0 ──
  const comps = await db.collection('comprobantes').get();
  const estados: Record<string, number> = {};
  for (const d of comps.docs) estados[d.data().estado] = (estados[d.data().estado] ?? 0) + 1;
  const existentes: Existente[] = comps.docs
    .filter(d => String(d.data().datosExtraidos?.numeroCliente ?? '').trim() !== '')
    .map(d => {
      const x = d.data(); const de = x.datosExtraidos;
      return { id: d.id, numeroCliente: String(de.numeroCliente), monto: Number(de.montoTotal ?? de.vencimientos?.[0]?.monto ?? 0),
        vencimiento: String(de.vencimientos?.[0]?.fecha ?? ''), emisor: String(de.comercioRazonSocial ?? de.destinoNombre ?? '?'),
        subido: x.subidoEn?.toDate?.().toLocaleDateString('sv-SE', { timeZone: 'America/Argentina/Buenos_Aires' }) ?? '?' };
    })
    .filter(e => e.monto > 0 && e.vencimiento.length >= 10);
  console.log(`\n── universo de 2.0: ${comps.size} comprobantes, por estado ${JSON.stringify(estados)}`);
  console.log(`   con numeroCliente y 1er vencimiento: ${existentes.length}. No hay estado 'descartado': descartarEntrada BORRA el doc (index.ts:2100) y su blob (:2120-2123).`);

  // ── Verificación 2: dedup contra producción con las filas de la tabla ──
  console.log('\n── dedup contra producción (verificación 2), filas de la tabla de §0');
  const res = aparear(AGENDA, existentes);
  imprimir('agenda 2026-10-06:', res);
  let iguales = 0;
  for (const r of res) {
    const esp = ESPERADO[String(r.fila.monto)];
    const got = r.yaCargada ? r.yaCargada.id.slice(0, 8) : null;
    if (esp === got) iguales++; else console.log(`    ✗ ${r.fila.emisor} ${fmt(r.fila.monto)}: esperado ${esp ?? 'nueva'}, salió ${got ?? 'nueva'}`);
  }
  console.log(`    coincide con la tabla de §0: ${iguales}/7 ${iguales === 7 ? 'OK' : '✗ PARAR'}`);

  // Los competidores: cuánto distaba cada cuota del 31/10 del recorte e9089013.
  const e9 = existentes.find(e => e.id.startsWith('e9089013'));
  if (e9) for (const f of AGENDA.filter(f => f.vencimiento === '2026-10-31'))
    console.log(`    candidato de e9089013 (${fmt(e9.monto)}): ${fmt(f.monto)} a ${(100 * Math.abs(f.monto - e9.monto) / e9.monto).toFixed(2)} %`);

  // ── Verificación 3: re-subida, sobre el estado que dejaría la 2 (los 4 hijos en memoria) ──
  console.log('\n── re-subida (verificación 3), en memoria sobre el estado que deja la 2');
  const hijos: Existente[] = res.filter(r => !r.yaCargada).map((r, i) => ({
    id: `SIM-hijo-${i + 1}`, numeroCliente: r.fila.numeroCliente, monto: r.fila.monto, vencimiento: r.fila.vencimiento, emisor: r.fila.emisor, subido: '2026-10-06',
  }));
  const despues = [...existentes, ...hijos];
  imprimir('misma agenda de nuevo:', aparear(AGENDA, despues));
  const masUnMes = (f: Fila): Fila => ({ ...f, monto: Math.round(f.monto * 1.012 * 100) / 100 });
  const cuotas = AGENDA.filter(f => f.emisor === 'AGIP' && f.vencimiento === '2026-10-31');
  const edenorNov: Fila = { emisor: 'Edenor', numeroCliente: EDENOR, monto: 121345.67, vencimiento: '2026-11-07' };
  imprimir('"un mes después", las 4 cuotas atrasadas +1,2 % con el MISMO vencimiento 31/10 + Edenor 07/11 — desempate del PROMPT (menor diferencia gana):',
    aparear([...cuotas.map(masUnMes), edenorNov], despues));
  imprimir('lo mismo con la ALTERNATIVA (asignación de costo total mínimo dentro del grupo):',
    aparearOptimo([...cuotas.map(masUnMes), edenorNov], despues));
  // La alternativa no puede romper lo que ya daba bien.
  const r2 = aparearOptimo(AGENDA, existentes);
  const ok2 = r2.every(r => (ESPERADO[String(r.fila.monto)] ?? null) === (r.yaCargada ? r.yaCargada.id.slice(0, 8) : null));
  const ok3 = aparearOptimo(AGENDA, despues).every(r => r.yaCargada);
  console.log(`    la alternativa sobre la verificación 2: ${ok2 ? '7/7 OK' : '✗'} · sobre "misma agenda de nuevo": ${ok3 ? '0 hijos OK' : '✗'}`);
  // Riesgo que la tabla no cubre: si la app de pagos le cambia el vencimiento a la cuota atrasada.
  imprimir('variante: las mismas 4 cuotas +1,2 % pero con vencimiento CORRIDO a 30/11 (no medido en la app real):',
    aparear([...cuotas.map(f => ({ ...masUnMes(f), vencimiento: '2026-11-30' })), edenorNov], despues));
}

main().catch(e => { console.error(e); process.exit(1); });
