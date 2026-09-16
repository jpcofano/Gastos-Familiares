// F9.175-pre — CONSULTA, pasada 2. Solo lectura, no escribe nada. Sin commitear.
//
// §3.2: reconciliarPorPayee campo por campo sobre el caso.
// §3.4: re-simula el pipeline de matchComprobante sobre TODOS los comprobantes, con el guard de
// F9.168 tal cual (ANTES) y acotado a esObligacionDoc(entrante) (DESPUÉS).
//
// Reconstrucción del estado al momento del trigger (T = propuestaMatch.calculadoEn):
//   · existe el movimiento si creadoEn <= T (sin creadoEn: se asume que existía);
//   · estaba pagado si confirmadoPago && pagadoEn <= T (sin pagadoEn: se toma el valor actual);
//   · un movimiento con hashPdf === este comprobante estaba IMPAGO en T (lo pagó este documento).
// Destinos, ítems y nombres aprendidos se leen en su estado ACTUAL (no hay historia): es la fuente
// de deriva conocida. Por eso se compara primero ANTES simulado contra lo guardado.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import {
  normalizarDestino, reconciliarPorPayee, reconciliarPorNombre, esObligacionDoc, esObligacionFutura,
  mesImputado, calcularPropuesta,
  type DatosExtractosMin, type MovimientoMin, type ItemEsperadoMin,
} from '../functions/src/matchLogica';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();
const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : null);
const idDest = (n: string) => createHash('sha256').update(n).digest('hex').slice(0, 24);
const norm = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/^0+(?=.)/, '');

type Rama = string;

async function main() {
  const [compsS, movsS, itemsS, destS] = await Promise.all([
    db.collection('comprobantes').get(),
    db.collection('movimientos').get(),
    db.collection('itemsEsperados').where('activo', '==', true).get(),
    db.collection('destinos').get(),
  ]);
  const destinos = new Map(destS.docs.map(d => [d.id, d.data()]));
  const nombres = new Map<string, string>();
  for (const d of destS.docs) {
    const x = d.data();
    if (x.tipo === 'nombre' && (x.confianza ?? 0) >= 0.7 && x.destinoNorm && x.itemEsperadoId) nombres.set(x.destinoNorm, x.itemEsperadoId);
  }
  const items: ItemEsperadoMin[] = itemsS.docs.map(d => {
    const x = d.data(); const mt = x.matchTexto;
    return {
      id: d.id, tipo: x.tipo, moneda: x.moneda, activo: x.activo ?? false,
      matchTexto: mt ? { incluye: mt.incluye ?? [], excluye: mt.excluye ?? [] } : null,
      categoria: x.categoria ?? null, subcategoria: x.subcategoria ?? null, notas: x.notas ?? null,
      montoEsperado: x.montoEsperado ?? null,
      clavesDesambiguacion: Array.isArray(x.clavesDesambiguacion) ? x.clavesDesambiguacion : null,
      diaCorteImputacion: x.diaCorteImputacion ?? null,
    };
  });
  const movsAll = movsS.docs.map(d => ({ id: d.id, x: d.data() }));

  const resolverItem = (d: FirebaseFirestore.DocumentData, datos: DatosExtractosMin): string | undefined => {
    const des = d.desambiguacion;
    if (des && (des.campo === 'numeroCliente' || des.campo === 'moneda') && des.valores) {
      const v = norm(des.campo === 'moneda' ? datos.moneda : datos.numeroCliente);
      if (v) for (const [k, it] of Object.entries(des.valores)) if (norm(k) === v) return it as string;
    }
    const n = norm(datos.numeroCliente);
    if (n) {
      const r = items.filter(i => (i.clavesDesambiguacion ?? []).some(c => norm(c) === n));
      if (r.length === 1) return r[0].id;
    }
    return d.itemEsperadoId;
  };

  // Réplica de matchPorDestino (index.ts:674). `acotado` = guard solo si el entrante es obligación.
  const porDestino = (datos: DatosExtractosMin, movs: MovimientoMin[], mesComp: string, refISO: string, acotado: boolean) => {
    const raws = [datos.destinoCbu, datos.destinoCuit, datos.destinoAlias, datos.destinoNombre]
      .filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
    for (const raw of raws) {
      const p = normalizarDestino(raw); if (!p) continue;
      const d = destinos.get(idDest(p.norm)); if (!d) continue;
      if ((d.confianza ?? 0) < 0.7) continue;
      const itemId = resolverItem(d, datos);
      if (itemId) {
        const it = items.find(i => i.id === itemId);
        const mesEf = mesImputado(datos.fecha, it?.diaCorteImputacion) ?? mesComp;
        const obl = movs.filter(m => m.itemEsperadoId === itemId && m.mes === mesEf);
        if (esObligacionFutura(datos, refISO)) return { rama: '2', item: itemId, via: raw };
        const aplicaGuard = !acotado || esObligacionDoc(datos.tipoDocumento);
        const impaga = obl.find(m => !m.confirmadoPago && (!aplicaGuard || !m.origenComprobanteId));
        if (impaga) return { rama: '1', item: itemId, mov: impaga.id, via: raw };
        if (obl.length === 0) return { rama: '2', item: itemId, via: raw };
        // esCargoAdicional usa la condición con guard: se reproduce tal cual está en producción.
        return { rama: !obl.some(m => !m.confirmadoPago && !m.origenComprobanteId) ? '2+adic' : '2', item: itemId, via: raw };
      } else if (d.categoria) return { rama: '3', via: raw };
    }
    return null;
  };

  const pipeline = (datos: DatosExtractosMin, movs: MovimientoMin[], mesComp: string, refISO: string, acotado: boolean): { rama: Rama; mov?: string } => {
    const esPago = datos.tipoDocumento === 'transferencia' || datos.tipoDocumento === 'comprobante_pago';
    if (esPago) {
      const r = reconciliarPorPayee(datos, movs);
      if (r.length === 1) return { rama: '1 payee', mov: r[0].id };
      if (r.length > 1) return { rama: `1 payee cands(${r.length})` };
      const w = reconciliarPorNombre(datos, movs, nombres);
      if (w.length > 0) return { rama: `1 débil(${w.length})` };
    }
    const pd = porDestino(datos, movs, mesComp, refISO, acotado);
    if (pd && (pd.rama.startsWith('2') || pd.rama === '1')) return { rama: `${pd.rama} destino`, mov: pd.mov };
    return { rama: String(calcularPropuesta(datos, [], items, mesComp).rama) };
  };

  const guardada = (pm: FirebaseFirestore.DocumentData): Rama => {
    if (pm.rama === 0) return '0';
    if (pm.rama === 1) {
      if (pm.reconciliacionDebil) return `1 débil(${pm.candidatos?.length ?? '?'})`;
      if (pm.origenDestino) return '1 destino';
      if (pm.candidatos) return `1 payee cands(${pm.candidatos.length})`;
      return '1 payee';
    }
    if (pm.rama === 2) return pm.origenDestino ? `${pm.esAdicional ? '2+adic' : '2'} destino` : '2';
    return String(pm.rama);
  };

  let evaluados = 0, coinciden = 0, cambian = 0;
  const difAntes: string[] = [];
  const cambios: string[] = [];
  let caso = '';

  for (const c of compsS.docs) {
    const cx = c.data();
    const datos = cx.datosExtraidos as DatosExtractosMin | undefined;
    const pm = cx.propuestaMatch;
    if (!datos || !pm || pm.rama === 0) continue;
    const T = ms(pm.calculadoEn) ?? ms(cx.subidoEn) ?? Date.now();
    const refISO = new Date(ms(cx.subidoEn) ?? Date.now()).toISOString().slice(0, 10);
    const mesComp = esObligacionDoc(datos.tipoDocumento)
      ? (datos.vencimientos?.[0]?.fecha?.slice(0, 7) ?? datos.fecha?.slice(0, 7) ?? '')
      : (datos.fecha ? datos.fecha.slice(0, 7) : '');
    const meses: string[] = [];
    if (mesComp) {
      const [y, m] = mesComp.split('-').map(Number);
      for (let k = -1; k <= 3; k++) { const d = new Date(y, m - 1 + k); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
    }
    const movs: MovimientoMin[] = movsAll
      .filter(({ x }) => meses.includes(x.mes))
      .filter(({ x }) => { const cr = ms(x.creadoEn); return cr == null || cr <= T; })
      .map(({ id, x }) => {
        const pe = ms(x.pagadoEn);
        let conf = (x.confirmadoPago as boolean) ?? false;
        if (conf && pe != null && pe > T) conf = false;
        if (x.hashPdf === c.id) conf = false;
        return {
          id, monto: x.monto, moneda: x.moneda, tipo: x.tipo,
          fecha: (x.fecha as Timestamp | null)?.toDate() ?? new Date(0), mes: x.mes,
          descripcion: x.descripcion ?? '', itemEsperadoId: x.itemEsperadoId ?? null,
          destinoCuit: x.destinoCuit ?? null, destinoCbu: x.destinoCbu ?? null,
          destinoAlias: x.destinoAlias ?? null, destinoNombre: x.destinoNombre ?? null,
          vencimientos: x.vencimientos ?? null, confirmadoPago: conf,
          origenComprobanteId: x.origenComprobanteId ?? null,
        };
      });

    evaluados++;
    const g = guardada(pm);
    const antes = pipeline(datos, movs, mesComp, refISO, false);
    const despues = pipeline(datos, movs, mesComp, refISO, true);
    if (antes.rama === g) coinciden++;
    else difAntes.push(`  ${c.id.slice(0, 8)} ${datos.tipoDocumento.padEnd(17)} guardada=${g.padEnd(18)} simulada=${antes.rama}`);

    // Qué terminó haciendo el dueño: el movimiento que hoy lleva este hashPdf.
    const final = movsAll.find(m => m.x.hashPdf === c.id);
    const destinoFinal = !final ? 'sin mov vinculado'
      : final.x.origenComprobanteId === c.id ? `mov NUEVO ${final.id} (creado por este comp)`
      : `mov PREEXISTENTE ${final.id} (origen=${String(final.x.origenComprobanteId ?? 'null').slice(0, 8)})`;

    if (antes.rama !== despues.rama || antes.mov !== despues.mov) {
      cambian++;
      cambios.push(`  ${c.id.slice(0, 8)} ${datos.tipoDocumento} ${datos.fecha} $${datos.montoTotal} "${datos.destinoNombre ?? datos.comercioRazonSocial}"\n`
        + `      guardada=${g} | antes=${antes.rama}${antes.mov ? ' mov=' + antes.mov : ''} | después=${despues.rama}${despues.mov ? ' mov=' + despues.mov : ''}\n`
        + `      desenlace real: ${destinoFinal}`);
    }

    if (c.id.startsWith('4c8a6dbe')) {
      const payee = (m: MovimientoMin) => m.itemEsperadoId === '7407642c379cc0c9cab7' && m.mes === '2026-09';
      caso = `caso 4c8a6dbe: T=${new Date(T).toISOString()} mesComp=${mesComp} meses=${meses.join(',')}\n`
        + movs.filter(payee).map(m => `  obligación en T: ${m.id} monto=${m.monto} venc=${JSON.stringify(m.vencimientos)} confirmadoPago=${m.confirmadoPago} origen=${m.origenComprobanteId}`).join('\n')
        + `\n  reconciliarPorPayee → ${reconciliarPorPayee(datos, movs).length} | reconciliarPorNombre → ${reconciliarPorNombre(datos, movs, nombres).length}`
        + `\n  antes=${antes.rama} | después=${despues.rama} ${despues.mov ?? ''} | guardada=${g}`;
    }
  }

  console.log('F9.175-pre pasada 2 — SOLO LECTURA\n');
  console.log(caso, '\n');

  // §3.2 campo por campo
  const pago = compsS.docs.find(d => d.id.startsWith('4c8a6dbe'))!.data().datosExtraidos;
  const obl = movsAll.find(m => m.id === '7HTNXS5cwTNCdf3scIF8')!.x;
  const dig = (s: unknown) => (s ? String(s).replace(/\D/g, '') : '');
  console.log('§3.2 reconciliarPorPayee, campo por campo (pago vs obligación 7HTNXS5c):');
  console.log(`  tipo:   pago→${pago.direccion === 'entrante' ? 'Ingreso' : 'Gasto'}  obl=${obl.tipo}`);
  console.log(`  moneda: ${pago.moneda} vs ${obl.moneda}`);
  console.log(`  cuit:   contraparte="${dig(pago.contraparteCuit)}" destino="${dig(pago.destinoCuit)}" vs "${dig(obl.destinoCuit)}" → ${(dig(pago.contraparteCuit) || dig(pago.destinoCuit)) === dig(obl.destinoCuit)}`);
  console.log(`  cbu:    contraparte="${dig(pago.contraparteCbu)}" destino="${dig(pago.destinoCbu)}" vs "${dig(obl.destinoCbu)}" → ${(dig(pago.contraparteCbu) || dig(pago.destinoCbu)) === dig(obl.destinoCbu)}`);
  console.log(`  alias:  "${pago.destinoAlias}" vs "${obl.destinoAlias}" (vacío en ambos, no participa)`);
  console.log(`  montoSalda: |${obl.monto} - ${pago.montoTotal}| = ${Math.abs(obl.monto - pago.montoTotal).toFixed(4)} (tol 0.01) → ${Math.abs(obl.monto - pago.montoTotal) < 0.01}`);
  for (const v of obl.vencimientos ?? []) console.log(`  montoSalda venc ${v.fecha}: |${v.monto} - ${pago.montoTotal}| = ${Math.abs(v.monto - pago.montoTotal).toFixed(4)} → ${Math.abs(v.monto - pago.montoTotal) < 0.01}`);

  console.log(`\n§3.4 evaluados=${evaluados} (con propuestaMatch, sin rama 0)`);
  console.log(`  fidelidad: ANTES simulado == guardado en ${coinciden}/${evaluados}`);
  console.log(`  cambian de rama con el guard acotado: ${cambian}`);
  console.log(cambios.join('\n') || '  (ninguno)');
  console.log(`\n  discrepancias ANTES simulado vs guardado (${difAntes.length}):`);
  console.log(difAntes.join('\n') || '  (ninguna)');
}
main().catch(e => { console.error(e); process.exit(1); });
