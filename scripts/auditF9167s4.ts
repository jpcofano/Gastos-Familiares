// F9.167 §4 — MEDICIÓN de `montoSalda`. NO cambia la tolerancia ni toca nada. SOLO LEE.
//
// La pregunta: de los comprobantes de PAGO que no reconciliaron, ¿cuántos tenían una obligación
// candidata cerca, y a qué distancia de monto? Si las diferencias son un continuo, no hay
// tolerancia segura y aflojar el umbral solo crea falsos positivos — y un falso positivo acá
// significa dar por pagada una obligación que no se pagó.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const s = (v: unknown) => v === null ? 'null' : v === undefined ? '(ausente)' : String(v);
const aDate = (v: unknown) => v instanceof Timestamp ? v.toDate() : null;

/** Normalización de payee, igual que `reconciliarPorPayee` (matchLogica.ts). */
const soloDigitos = (v: string) => v.replace(/\D/g, '');
const lower = (v: string) => v.trim().toLowerCase();
function llavesPayee(o: Record<string, unknown>): string[] {
  const out: string[] = [];
  const cuit = s(o.destinoCuit ?? o.contraparteCuit); if (cuit && cuit !== '(ausente)' && cuit !== 'null') out.push('cuit:' + soloDigitos(cuit));
  const cbu  = s(o.destinoCbu  ?? o.contraparteCbu);  if (cbu  && cbu  !== '(ausente)' && cbu  !== 'null') out.push('cbu:'  + soloDigitos(cbu));
  const ali  = s(o.destinoAlias);                     if (ali  && ali  !== '(ausente)' && ali  !== 'null') out.push('alias:' + lower(ali));
  const nom  = s(o.destinoNombre ?? o.contraparteNombre); if (nom && nom !== '(ausente)' && nom !== 'null') out.push('nombre:' + lower(nom));
  return out;
}
/** `montoSalda` real: cabecera o CUALQUIER vencimiento, tolerancia de un centavo. */
function montoSalda(mov: any, montoTotal: number): boolean {
  if (Math.abs(Number(mov.monto ?? 0) - montoTotal) < 0.01) return true;
  return ((mov.vencimientos ?? []) as any[]).some(
    v => typeof v?.monto === 'number' && Math.abs(v.monto - montoTotal) < 0.01);
}
const mesDe = (iso: string | null) => iso ? iso.slice(0, 7) : null;
function ventana(mes: string): string[] {
  const [a, m] = mes.split('-').map(Number);
  const out: string[] = [];
  for (let k = -1; k <= 3; k++) {
    const d = new Date(a, m - 1 + k, 1);
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

async function main() {
  console.log('F9.167 §4 — medición de montoSalda. SOLO LECTURA, la tolerancia NO se toca.\n');

  const comps = await db.collection('comprobantes').get();
  const movsSnap = await db.collection('movimientos').get();
  const movs = movsSnap.docs.map(d => ({ id: d.id, ...d.data() })) as any[];

  const ES_PAGO = new Set(['transferencia', 'comprobante_pago']);
  const pagos = comps.docs.filter(d => {
    const dt = d.data().datosExtraidos;
    return dt && ES_PAGO.has(s(dt.tipoDocumento));
  });
  console.log(`comprobantes en total: ${comps.size} | de PAGO: ${pagos.length}\n`);

  type Fila = { comp: string; payee: string; montoPago: number; moneda: string;
                oblig: string; montoOblig: number; desc: string; difAbs: number; difPct: number;
                dir: string; nVenc: number };
  const sinReconciliar: Fila[] = [];
  let conciliados = 0, sinCandidato = 0, sinPayee = 0;

  for (const d of pagos) {
    const x = d.data();
    const dt = x.datosExtraidos as Record<string, unknown>;
    const monto = Number(dt.montoTotal ?? 0);
    const moneda = s(dt.moneda) === 'USD' ? 'USD' : 'ARS';
    if (!monto) continue;
    const llaves = llavesPayee(dt);
    if (llaves.length === 0) { sinPayee++; continue; }
    const mes = mesDe(s(dt.fecha) === '(ausente)' ? null : s(dt.fecha));
    const meses = mes ? ventana(mes) : null;

    // Obligaciones abiertas del mismo payee, misma moneda, dentro de la ventana.
    const cands = movs.filter(m => {
      if (m.tipo !== 'Gasto' || m.confirmadoPago === true) return false;
      if ((m.moneda === 'USD' ? 'USD' : 'ARS') !== moneda) return false;
      if (meses && !meses.includes(s(m.mes))) return false;
      const lm = llavesPayee(m);
      return lm.some(k => llaves.includes(k));
    });
    if (cands.length === 0) { sinCandidato++; continue; }
    if (cands.some(m => montoSalda(m, monto))) { conciliados++; continue; }

    // No reconcilió: la obligación más cercana en monto.
    const mejor = cands.reduce((a, b) =>
      Math.abs(Number(b.monto) - monto) < Math.abs(Number(a.monto) - monto) ? b : a);
    const difAbs = Math.abs(Number(mejor.monto) - monto);
    sinReconciliar.push({
      comp: d.id.slice(0, 10), payee: llaves[0].slice(0, 34), montoPago: monto, moneda,
      oblig: String(mejor.id).slice(0, 10), montoOblig: Number(mejor.monto),
      desc: s(mejor.descripcion).slice(0, 26),
      difAbs, difPct: monto ? (difAbs / monto) * 100 : 0,
      dir: Number(mejor.monto) > monto ? 'pago MENOR que la obligación' : 'pago MAYOR que la obligación',
      nVenc: ((mejor.vencimientos ?? []) as any[]).filter(v => typeof v?.monto === 'number').length,
    });
  }

  console.log('=== 1. pagos SIN reconciliar que tenían una obligación candidata cerca ===');
  if (sinReconciliar.length === 0) console.log('  (ninguno)');
  console.log('comprobante |   monto pago |  monto oblig |      dif abs |  dif %  | vencs | dirección                     | obligación');
  for (const f of sinReconciliar.sort((a, b) => a.difPct - b.difPct))
    console.log(`${f.comp.padEnd(11)} | ${f.montoPago.toFixed(2).padStart(12)} | ${f.montoOblig.toFixed(2).padStart(12)} | ${f.difAbs.toFixed(2).padStart(12)} | ${f.difPct.toFixed(2).padStart(6)}% | ${String(f.nVenc).padStart(5)} | ${f.dir.padEnd(29)} | ${f.desc}`);
  console.log(`\n  pagos de producción analizados:            ${pagos.length}`);
  console.log(`  sin payee extraíble (no entran):           ${sinPayee}`);
  // OJO: este 0 es un ARTEFACTO del método, no un hallazgo. Se mide sobre el estado ACTUAL, y una
  // obligación que reconcilió ya quedó `confirmadoPago: true`, así que sale del conjunto de
  // candidatas. Lo que sí mide cuántas veces reconcilió de verdad es el conteo de abajo.
  console.log(`  reconciliaron AHORA (artefacto, ver nota):  ${conciliados}`);
  const reconciliados = movs.filter(m => m.origenReconciliacion === true || (m.confirmadoPago === true && m.origenComprobanteId));
  console.log(`  movimientos que YA reconciliaron alguna vez: ${movs.filter(m => m.origenReconciliacion === true).length} con origenReconciliacion`);
  void reconciliados;
  console.log(`  sin ninguna obligación candidata:          ${sinCandidato}`);
  console.log(`  CON candidata pero SIN reconciliar:        ${sinReconciliar.length}   ← el grupo de la pregunta`);

  console.log('\n=== 2. distribución de las diferencias ===');
  const pct = sinReconciliar.map(f => f.difPct).sort((a, b) => a - b);
  if (pct.length === 0) console.log('  (no hay diferencias que distribuir)');
  else {
    const BINS: Array<[string, (v: number) => boolean]> = [
      ['0 – 1%',   v => v <= 1], ['1 – 3%', v => v > 1 && v <= 3], ['3 – 5%', v => v > 3 && v <= 5],
      ['5 – 10%',  v => v > 5 && v <= 10], ['10 – 50%', v => v > 10 && v <= 50], ['> 50%', v => v > 50],
    ];
    for (const [rot, test] of BINS) console.log(`  ${rot.padEnd(10)} ${String(pct.filter(test).length).padStart(3)}`);
    console.log(`  min=${pct[0].toFixed(2)}%  mediana=${pct[Math.floor(pct.length / 2)].toFixed(2)}%  max=${pct[pct.length - 1].toFixed(2)}%`);
  }

  console.log('\n=== 4. falsos positivos con tolerancias del 1%, 3% y 5% ===');
  console.log('  (un pago que SALDARÍA una obligación que no es la suya: más de una candidata entra en la banda)');
  for (const tol of [1, 3, 5]) {
    let ganan = 0, ambiguos = 0;
    for (const d of pagos) {
      const x = d.data(); const dt = x.datosExtraidos as Record<string, unknown>;
      const monto = Number(dt.montoTotal ?? 0); if (!monto) continue;
      const moneda = s(dt.moneda) === 'USD' ? 'USD' : 'ARS';
      const llaves = llavesPayee(dt); if (!llaves.length) continue;
      const mes = mesDe(s(dt.fecha) === '(ausente)' ? null : s(dt.fecha));
      const meses = mes ? ventana(mes) : null;
      const cands = movs.filter(m => {
        if (m.tipo !== 'Gasto' || m.confirmadoPago === true) return false;
        if ((m.moneda === 'USD' ? 'USD' : 'ARS') !== moneda) return false;
        if (meses && !meses.includes(s(m.mes))) return false;
        return llavesPayee(m).some(k => llaves.includes(k));
      });
      if (cands.some(m => montoSalda(m, monto))) continue;      // ya reconciliaba, no es nuevo
      const enBanda = cands.filter(m => Math.abs(Number(m.monto) - monto) / monto * 100 <= tol);
      if (enBanda.length >= 1) ganan++;
      if (enBanda.length > 1) ambiguos++;
    }
    console.log(`  tolerancia ${String(tol).padStart(2)}%  →  ${ganan} pagos pasarían a reconciliar, de los cuales ${ambiguos} con MÁS DE UNA candidata en la banda (ambiguos = falso positivo garantizado)`);
  }
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
