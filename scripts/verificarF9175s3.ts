// F9.175 §3 — medición de la tolerancia de `montoSalda`. SOLO LECTURA. Bloquea a §2.
//
// Para cada comprobante de PAGO (transferencia / comprobante_pago) se arma, con el estado de T
// reconstruido como en §4, el conjunto de obligaciones que cada pase de reconciliación consideraría
// SI NO MIRARA EL MONTO:
//   · payee: mismo tipo conciliable, moneda, impaga, y CUIT/CBU/alias coincidente (reconciliarPorPayee);
//   · débil: lo mismo pero por nombre o por ítem aprendido (reconciliarPorNombre).
// Los criterios de payee/nombre están replicados de matchLogica.ts (el real filtra por monto antes y
// no deja ver la diferencia). La diferencia se mide igual que `montoSalda`: contra el monto y contra
// cada vencimiento, y se toma la más chica.
//
// "Suya" = la obligación a la que el dueño terminó vinculando ese pago (hoy lleva su hashPdf).
import { cargar, contexto, destinosEnT, nombresEnT, iso } from './simMatchF9175';
import { tipoConciliable, type MovimientoMin } from '../functions/src/matchLogica';

const dig = (s: string | null | undefined) => (s ? s.replace(/\D/g, '') : '');
const nrm = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase().replace(/\s+/g, ' ');

type Cand = { m: MovimientoMin; diff: number; signo: number; contra: string; suya: boolean };

async function main() {
  const E = await cargar();
  const filas: { comp: string; pase: string; pago: number; moneda: string; cands: Cand[]; desenlace: string; fecha: string; nombre: string }[] = [];

  for (const c of E.comps) {
    const dt = c.data().datosExtraidos;
    const pm = c.data().propuestaMatch;
    if (!dt || !pm) continue;
    if (dt.tipoDocumento !== 'transferencia' && dt.tipoDocumento !== 'comprobante_pago') continue;
    if (dt.montoTotal == null) continue;
    const ctx = contexto(E, c, true);
    const nombres = nombresEnT(E, ctx.T, { fina: true, destinoEnT: destinosEnT(E, c) });
    const fin = E.movsAll.find(m => m.x.hashPdf === c.id);
    const desenlace = pm.rama === 0 ? 'rama 0 (dedup)'
      : !fin ? 'sin movimiento vinculado'
      : fin.x.origenComprobanteId === c.id ? `mov NUEVO ${fin.id}` : `vinculado a ${fin.id}`;

    const tipoOk = tipoConciliable(dt);
    const base = ctx.movs.filter(m => m.tipo === tipoOk && m.moneda === dt.moneda && !m.confirmadoPago);

    const pCuit = dig(dt.contraparteCuit) || dig(dt.destinoCuit);
    const pCbu = dig(dt.contraparteCbu) || dig(dt.destinoCbu);
    const pAlias = dt.destinoAlias?.trim().toLowerCase() ?? '';
    const payee = (pCuit || pCbu || pAlias) ? base.filter(m =>
      (!!pCuit && dig(m.destinoCuit) === pCuit) || (!!pCbu && dig(m.destinoCbu) === pCbu) ||
      (!!pAlias && (m.destinoAlias?.trim().toLowerCase() ?? '') === pAlias)) : [];

    const pNombre = nrm(dt.contraparteNombre) || nrm(dt.destinoNombre) || nrm(dt.comercioRazonSocial);
    const itemAprendido = pNombre ? nombres.get(pNombre) ?? null : null;
    const debil = pNombre ? base.filter(m => {
      const mN = nrm(m.destinoNombre);
      const nombreOk = !!mN && (mN === pNombre || mN.includes(pNombre) || pNombre.includes(mN));
      return nombreOk || (!!itemAprendido && m.itemEsperadoId === itemAprendido);
    }) : [];

    const medir = (ms: MovimientoMin[]): Cand[] => ms.map(m => {
      const montos: [number, string][] = [[m.monto, 'monto']];
      for (const v of m.vencimientos ?? []) if (typeof v?.monto === 'number') montos.push([v.monto, 'venc']);
      let best = montos[0];
      for (const x of montos) if (Math.abs(x[0] - dt.montoTotal) < Math.abs(best[0] - dt.montoTotal)) best = x;
      return { m, diff: Math.abs(best[0] - dt.montoTotal), signo: dt.montoTotal - best[0], contra: `${best[1]} ${best[0]}`, suya: fin?.id === m.id };
    }).sort((a, b) => a.diff - b.diff);

    const comun = { comp: c.id.slice(0, 8), pago: dt.montoTotal, moneda: dt.moneda, desenlace, fecha: dt.fecha, nombre: dt.destinoNombre ?? dt.comercioRazonSocial };
    if (payee.length) filas.push({ ...comun, pase: 'payee', cands: medir(payee) });
    // El débil sólo corre si el fuerte no encontró nada; con monto, "nada" depende de la tolerancia,
    // así que se miden los dos conjuntos y se reportan por separado.
    if (debil.length) filas.push({ ...comun, pase: 'débil', cands: medir(debil) });
  }

  const fmt = (n: number) => n.toFixed(2);
  console.log('F9.175 §3 — tolerancia de montoSalda. SOLO LECTURA.\n');
  console.log('── 1) Distribución: la candidata MÁS CERCANA de cada pago, por pase (|pago − obligación|)');
  for (const pase of ['payee', 'débil']) {
    const fs = filas.filter(f => f.pase === pase).sort((a, b) => a.cands[0].diff - b.cands[0].diff);
    console.log(`\n  pase ${pase}: ${fs.length} pagos con al menos una candidata`);
    for (const f of fs) {
      const k = f.cands[0];
      console.log(`   ${fmt(k.diff).padStart(12)}  signo=${k.signo < 0 ? 'pago<obl' : k.signo > 0 ? 'pago>obl' : 'exacto  '}  ${f.comp} ${f.fecha} pago=${f.pago} ${f.moneda} vs ${k.contra} (${k.m.id.slice(0, 8)} "${k.m.descripcion}") suya=${k.suya ? 'SÍ' : 'no'} cands=${f.cands.length} | ${f.desenlace}`);
    }
  }

  // Todas las diferencias (no sólo la más cercana), para el hueco y el signo.
  const todas = filas.flatMap(f => f.cands.map(k => ({ ...k, f })));
  const bajo1 = todas.filter(k => k.diff < 1);
  console.log(`\n  pares pago↔candidata: ${todas.length}. Con |dif| < 1: ${bajo1.length}. Con |dif| < 0,01: ${todas.filter(k => k.diff < 0.01).length}.`);
  const orden = [...new Set(todas.map(k => +k.diff.toFixed(2)))].sort((a, b) => a - b);
  console.log(`  diferencias distintas, ordenadas (primeras 25): ${orden.slice(0, 25).join(' | ')}`);
  const primeraSobre1 = orden.find(x => x >= 1);
  const ultimaBajo1 = [...orden].reverse().find(x => x < 1);
  console.log(`  HUECO: la mayor diferencia < 1 es ${ultimaBajo1}; la menor ≥ 1 es ${primeraSobre1}.`);

  console.log('\n── 2) Signo de las diferencias chicas (0 < |dif| < 1)');
  for (const k of todas.filter(k => k.diff > 0.005 && k.diff < 1)) {
    console.log(`   ${k.f.comp} [${k.f.pase}] pago=${k.f.pago} vs ${k.contra} dif=${fmt(k.signo)} → ${k.signo < 0 ? 'pago MENOR (truncamiento hacia abajo)' : 'pago MAYOR'}  centavos obl=${(+k.contra.split(' ')[1] % 1).toFixed(2)} centavos pago=${(k.f.pago % 1).toFixed(2)} suya=${k.suya ? 'SÍ' : 'no'}`);
  }

  console.log('\n── 3) Falsos positivos por tolerancia');
  const tolerancias: { nombre: string; ok: (s: number) => boolean }[] = [
    { nombre: 'actual ±0,01', ok: s => Math.abs(s) < 0.01 },
    { nombre: '±0,50', ok: s => Math.abs(s) < 0.5 },
    { nombre: '±1', ok: s => Math.abs(s) < 1 },
    { nombre: 'asim. [−1, +0,01)', ok: s => s > -1 && s < 0.01 },
    { nombre: 'truncamiento: pago = floor(obl)', ok: s => s <= 0 && s > -1 },
  ];
  for (const t of tolerancias) {
    let saldan = 0, bien = 0, fp = 0, ambiguo = 0;
    const det: string[] = [];
    for (const f of filas) {
      const dentro = f.cands.filter(k => t.ok(k.signo));
      if (!dentro.length) continue;
      saldan++;
      if (dentro.length > 1) { ambiguo++; det.push(`     AMBIGUO ${f.comp} [${f.pase}] ${dentro.length} en banda: ${dentro.map(k => `${k.m.id.slice(0, 8)}${k.suya ? '*' : ''}`).join(',')}`); continue; }
      if (dentro[0].suya) bien++;
      else { fp++; det.push(`     FP ${f.comp} [${f.pase}] pago=${f.pago} → ${dentro[0].m.id.slice(0, 8)} "${dentro[0].m.descripcion}" (${dentro[0].contra}) | ${f.desenlace}`); }
    }
    console.log(`  ${t.nombre.padEnd(34)} pagos con match=${saldan}  suya=${bien}  una sola candidata AJENA=${fp}  ambiguos=${ambiguo}`);
    for (const d of det) console.log(d);
  }

  console.log('\n── 4) Obligaciones del mismo payee y mes cuyos montos difieren < 1 entre sí');
  const obls = E.movsAll.filter(({ x }) => x.tipo === 'Gasto' && (x.destinoCuit || x.destinoCbu || x.destinoAlias));
  const grupos = new Map<string, typeof obls>();
  for (const o of obls) {
    const k = `${dig(o.x.destinoCuit) || dig(o.x.destinoCbu) || o.x.destinoAlias}|${o.x.mes}|${o.x.moneda}`;
    grupos.set(k, [...(grupos.get(k) ?? []), o]);
  }
  let pares = 0;
  for (const [k, g] of grupos) {
    for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
      const d = Math.abs(g[i].x.monto - g[j].x.monto);
      if (d < 1) {
        pares++;
        console.log(`   ${k} ${g[i].id.slice(0, 8)} $${g[i].x.monto} (${g[i].x.descripcion}, conf=${g[i].x.confirmadoPago}) vs ${g[j].id.slice(0, 8)} $${g[j].x.monto} (${g[j].x.descripcion}, conf=${g[j].x.confirmadoPago}) dif=${d.toFixed(2)}`);
      }
    }
  }
  console.log(`  pares: ${pares} (grupos payee+mes+moneda con más de una obligación: ${[...grupos.values()].filter(g => g.length > 1).length})`);
  // Y el mismo control con el nombre (lo que ve el pase débil).
  const porNombre = new Map<string, typeof obls>();
  for (const o of E.movsAll.filter(({ x }) => x.tipo === 'Gasto' && x.destinoNombre)) {
    const k = `${nrm(o.x.destinoNombre)}|${o.x.mes}|${o.x.moneda}`;
    porNombre.set(k, [...(porNombre.get(k) ?? []), o]);
  }
  let paresN = 0;
  for (const [k, g] of porNombre) for (let i = 0; i < g.length; i++) for (let j = i + 1; j < g.length; j++) {
    const d = Math.abs(g[i].x.monto - g[j].x.monto);
    if (d < 1) { paresN++; console.log(`   [nombre] ${k} ${g[i].id.slice(0, 8)} $${g[i].x.monto} vs ${g[j].id.slice(0, 8)} $${g[j].x.monto} dif=${d.toFixed(2)}`); }
  }
  console.log(`  pares por nombre: ${paresN}`);
  // 5) La verdad decidida por el dueño, sin depender de ningún pase: todo pago que terminó vinculado a
  // una obligación PREEXISTENTE, y su diferencia contra ella. Es la muestra más amplia de cómo pagan.
  console.log('\n── 5) Pagos vinculados por el dueño a una obligación preexistente (cualquier camino)');
  const dist: number[] = [];
  for (const c of E.comps) {
    const dt = c.data().datosExtraidos;
    if (!dt || dt.montoTotal == null) continue;
    if (dt.tipoDocumento !== 'transferencia' && dt.tipoDocumento !== 'comprobante_pago') continue;
    const fin = E.movsAll.find(m => m.x.hashPdf === c.id);
    if (!fin || fin.x.origenComprobanteId === c.id) continue;
    // El monto del movimiento puede haberlo pisado la vinculación: se toma el del comprobante de
    // origen cuando existe (lo que había ANTES del pago), y si no, el del movimiento.
    const orig = fin.x.origenComprobanteId ? E.comps.find(k => k.id === fin.x.origenComprobanteId)?.data().datosExtraidos : null;
    const montos: number[] = [orig?.montoTotal ?? fin.x.monto, ...((orig?.vencimientos ?? fin.x.vencimientos ?? []) as { monto?: number }[]).map(v => v?.monto).filter((v): v is number => typeof v === 'number')];
    let best = montos[0];
    for (const x of montos) if (Math.abs(x - dt.montoTotal) < Math.abs(best - dt.montoTotal)) best = x;
    const s = dt.montoTotal - best;
    dist.push(s);
    console.log(`   dif=${s.toFixed(2).padStart(12)}  ${c.id.slice(0, 8)} ${dt.tipoDocumento.padEnd(16)} pago=${dt.montoTotal} vs ${best} (${fin.id.slice(0, 8)} "${fin.x.descripcion}") rama=${c.data().propuestaMatch?.rama}${c.data().propuestaMatch?.origenDestino ? ' destino' : ''}`);
  }
  const abs = dist.map(Math.abs);
  console.log(`  total=${dist.length}  exactos=${abs.filter(a => a < 0.01).length}  0,01≤|d|<1=${abs.filter(a => a >= 0.01 && a < 1).length} (todos pago<obl: ${dist.filter(s => Math.abs(s) >= 0.01 && Math.abs(s) < 1).every(s => s < 0)})  |d|≥1=${abs.filter(a => a >= 1).length}`);

  const dup = E.comps.find(c => c.id.startsWith('02a2f764'))!.data();
  console.log(`\n  02a2f764 (el "FP" de 3): estado=${dup.estado} pm=${JSON.stringify({ ...dup.propuestaMatch, calculadoEn: undefined })} archivo=${dup.nombreArchivo} subidoEn=${iso(dup.subidoEn?.toMillis?.() ?? null)} numeroOperacion=${dup.datosExtraidos?.numeroOperacion}`);
  const gem = E.comps.find(c => c.id.startsWith('680852ca'))!.data();
  console.log(`  680852ca (su gemelo):   estado=${gem.estado} archivo=${gem.nombreArchivo} subidoEn=${iso(gem.subidoEn?.toMillis?.() ?? null)} numeroOperacion=${gem.datosExtraidos?.numeroOperacion}`);

  console.log(`\n(T de referencia de cada pago: propuestaMatch.calculadoEn; generado ${iso(Date.now())})`);
}
main().catch(e => { console.error(e); process.exit(1); });
