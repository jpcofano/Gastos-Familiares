// F9.175 — simulador de `matchComprobante` sobre producción. SOLO LECTURA.
//
// Usa las funciones puras reales de functions/src/matchLogica.ts. Lo único replicado es
// `matchPorDestino` (vive en index.ts y lee Firestore) y `resolverItemDeDestino`.
//
// Reconstrucción del estado al momento del trigger (T = propuestaMatch.calculadoEn):
//   · movimiento existe si creadoEn <= T (sin creadoEn: se asume que existía);
//   · estaba pagado si confirmadoPago && pagadoEn <= T;
//   · el movimiento que hoy lleva el hashPdf del comprobante estaba IMPAGO en T.
// Destinos, ítems y nombres aprendidos NO tienen historia: se leen como están hoy. Para los destinos
// se estima el nacimiento con el primer movimiento que pudo enseñarlo (`aprenderDestino` corre al
// crear un movimiento), ver `nacimientoDestino`.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import * as ML from '../functions/src/matchLogica';
import type { DatosExtractosMin, MovimientoMin, ItemEsperadoMin } from '../functions/src/matchLogica';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
export const db = getFirestore();

export const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : null);
export const iso = (t: number | null) => (t == null ? 'null' : new Date(t).toISOString());
export const idDest = (n: string) => createHash('sha256').update(n).digest('hex').slice(0, 24);
const normClave = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/^0+(?=.)/, '');

export type Opciones = {
  // true = guard de F9.175 §1 (código real); false = guard de F9.168 como estaba en ffc7309.
  guardAcotado: boolean;
  // true = reconstrucción fina de §4 (payees restaurados, destinos nacidos después de T fuera)
  fina?: boolean;
  // Estado de un destino EN T cuando se sabe que después fue reapuntado (clave: destinoNorm).
  // `existia` fuerza que exista aunque la estimación de nacimiento diga lo contrario (destinos creados
  // por el callable de asignación no dejan rastro en movimientos).
  destinoEnT?: Record<string, { itemEsperadoId?: string; existia?: boolean; noExistia?: boolean; rol?: string }>;
  // Fecha de referencia de `esObligacionFutura` (default: día de subida). Sirve para probar una
  // boleta real como si ya estuviera vencida.
  refISO?: string;
  // true = los pases de reconciliación con la tolerancia de monto de ffc7309 (±0,01). Se obtiene
  // filtrando la salida real, válido porque la tolerancia de F9.175 §2 la contiene
  // (verificado en verificarF9175s2.ts §3). Sirve para aislar §1 de §2.
  montoViejo?: boolean;
};

const saldaViejo = (m: MovimientoMin, total: number | null) =>
  total != null && (Math.abs(m.monto - total) < 0.01 ||
  (m.vencimientos ?? []).some(v => typeof v?.monto === 'number' && Math.abs(v.monto - total) < 0.01));

export type Resultado = { rama: string; mov?: string; item?: string; traza: string[] };

export async function cargar() {
  const [compsS, movsS, itemsS, destS] = await Promise.all([
    db.collection('comprobantes').get(),
    db.collection('movimientos').get(),
    db.collection('itemsEsperados').where('activo', '==', true).get(),
    db.collection('destinos').get(),
  ]);
  const destinos = new Map(destS.docs.map(d => [d.id, d.data()]));
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

  // Nacimiento estimado de cada destino: primer movimiento cuya llave principal
  // (cbu ?? cuit ?? alias ?? nombre) o cuyo destinoNombre (alias de nombre, F9.82) normaliza a él.
  //
  // Un movimiento vinculado enseña DOS veces: al crearse, con los destino* de su comprobante de origen,
  // y al vincularse (pagadoEn), con los destino* que le copió la vinculación. Tomar solo los de hoy a
  // la fecha de creación adelantaba nacimientos (§4: el CUIT de Personal "nacía" el 1/7).
  const nacimiento = new Map<string, number>();
  const comps = new Map(compsS.docs.map(d => [d.id, d.data()]));
  const ensenar = (f: FirebaseFirestore.DocumentData, cuando: number | null) => {
    if (cuando == null) return;
    const raw = f.destinoCbu ?? f.destinoCuit ?? f.destinoAlias ?? f.destinoNombre;
    const claves: string[] = [];
    const p = raw ? ML.normalizarDestino(String(raw)) : null;
    if (p) claves.push(idDest(p.norm));
    if (p && p.tipo !== 'nombre' && f.destinoNombre) {
      const pn = ML.normalizarDestino(String(f.destinoNombre));
      if (pn?.tipo === 'nombre') claves.push(idDest(pn.norm));
    }
    for (const k of claves) if (!nacimiento.has(k) || cuando < nacimiento.get(k)!) nacimiento.set(k, cuando);
  };
  for (const { x } of movsAll) {
    const origen = x.origenComprobanteId ? comps.get(x.origenComprobanteId)?.datosExtraidos : null;
    if (x.hashPdf && origen) {
      ensenar(origen, ms(x.creadoEn));
      ensenar(x, ms(x.pagadoEn) ?? ms(x.actualizadoEn));
    } else {
      ensenar(x, ms(x.creadoEn));
    }
  }

  return { comps: compsS.docs, movsAll, items, destinos, nacimiento };
}
export type Estado = Awaited<ReturnType<typeof cargar>>;

// `fina` = reconstrucción corregida con lo aprendido en §4: la vinculación (src/datos/comprobantes.ts,
// confirmarRama1) copia destino* del comprobante al movimiento, así que en el movimiento que hoy lleva
// el hashPdf de ESTE comprobante los destino* de T son los de su comprobante de origen.
export function contexto(E: Estado, c: FirebaseFirestore.QueryDocumentSnapshot, fina = false) {
  const cx = c.data();
  const datos = cx.datosExtraidos as DatosExtractosMin;
  const pm = cx.propuestaMatch;
  const T = ms(pm?.calculadoEn) ?? ms(cx.subidoEn) ?? Date.now();
  const refISO = new Date(ms(cx.subidoEn) ?? Date.now()).toISOString().slice(0, 10);
  const mesComp = ML.esObligacionDoc(datos.tipoDocumento)
    ? (datos.vencimientos?.[0]?.fecha?.slice(0, 7) ?? datos.fecha?.slice(0, 7) ?? '')
    : (datos.fecha ? datos.fecha.slice(0, 7) : '');
  const meses: string[] = [];
  if (mesComp) {
    const [y, m] = mesComp.split('-').map(Number);
    for (let k = -1; k <= 3; k++) { const d = new Date(y, m - 1 + k); meses.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); }
  }
  const movs: (MovimientoMin & { creadoEn: number | null })[] = E.movsAll
    .filter(({ x }) => meses.includes(x.mes))
    .filter(({ x }) => { const cr = ms(x.creadoEn); return cr == null || cr <= T; })
    .map(({ id, x }) => {
      const pe = ms(x.pagadoEn);
      let conf = (x.confirmadoPago as boolean) ?? false;
      if (conf && pe != null && pe > T) conf = false;
      if (x.hashPdf === c.id) conf = false;
      let dest = { destinoCuit: x.destinoCuit ?? null, destinoCbu: x.destinoCbu ?? null, destinoAlias: x.destinoAlias ?? null, destinoNombre: x.destinoNombre ?? null };
      if (fina && x.hashPdf === c.id && x.origenComprobanteId) {
        const o = E.comps.find(k => k.id === x.origenComprobanteId)?.data().datosExtraidos;
        if (o) dest = { destinoCuit: o.destinoCuit ?? null, destinoCbu: o.destinoCbu ?? null, destinoAlias: o.destinoAlias ?? null, destinoNombre: o.destinoNombre ?? null };
      }
      return {
        id, monto: x.monto, moneda: x.moneda, tipo: x.tipo,
        fecha: (x.fecha as Timestamp | null)?.toDate() ?? new Date(0), mes: x.mes,
        descripcion: x.descripcion ?? '', itemEsperadoId: x.itemEsperadoId ?? null,
        ...dest,
        vencimientos: x.vencimientos ?? null, confirmadoPago: conf,
        origenComprobanteId: x.origenComprobanteId ?? null,
        creadoEn: ms(x.creadoEn),
      };
    });
  return { cx, datos, pm, T, refISO, mesComp, meses, movs };
}

// El guard de rama 1.
//   · guardAcotado=true  → `obligacionSaldable` REAL (F9.175 §1, lo que corre desde este commit);
//   · guardAcotado=false → réplica del guard de F9.168 tal como estaba en ffc7309 (para el diff).
function impagaSaldable(obl: MovimientoMin[], tipoDoc: string, acotado: boolean): MovimientoMin | undefined {
  if (acotado) return ML.obligacionSaldable(obl, tipoDoc);
  return obl.find(m => !m.confirmadoPago && !m.origenComprobanteId);
}
function cargoAdicional(obl: MovimientoMin[], tipoDoc: string, acotado: boolean): boolean {
  if (acotado) return ML.esCargoAdicional(obl, undefined, tipoDoc);
  return !obl.some(m => !m.confirmadoPago && !m.origenComprobanteId);
}

/** Réplica de `cargarNombresDestinoAprendidos` con el estado de destinos en T. */
export function nombresEnT(E: Estado, T: number, o: Pick<Opciones, 'fina' | 'destinoEnT'>, direccion?: string | null): Map<string, string> {
  const nombres = new Map<string, string>();
  for (const [id, x0] of E.destinos) {
    const ov = o.destinoEnT?.[x0.destinoNorm];
    const x = ov ? { ...x0, ...ov } : x0;
    if (ov?.noExistia) continue;
    if (o.fina && !ov?.existia && (E.nacimiento.get(id) ?? -Infinity) > T) continue;
    if (!ML.destinoResuelve(x.rol, direccion)) continue;  // F9.176, como cargarNombresDestinoAprendidos
    if (x.tipo === 'nombre' && (x.confianza ?? 0) >= 0.7 && x.destinoNorm && x.itemEsperadoId) nombres.set(x.destinoNorm, x.itemEsperadoId);
  }
  return nombres;
}

export function simular(E: Estado, c: FirebaseFirestore.QueryDocumentSnapshot, o: Opciones): Resultado {
  const ctx = contexto(E, c, !!o.fina);
  const { datos, T, mesComp, movs } = ctx;
  const refISO = o.refISO ?? ctx.refISO;
  const traza: string[] = [];
  const nombres = nombresEnT(E, T, o, datos.direccion);

  const esPago = datos.tipoDocumento === 'transferencia' || datos.tipoDocumento === 'comprobante_pago';
  if (esPago) {
    const r = ML.reconciliarPorPayee(datos, movs).filter(m => !o.montoViejo || saldaViejo(m, datos.montoTotal));
    traza.push(`payee → [${r.map(m => m.id).join(',')}]`);
    if (r.length === 1) return { rama: '1 payee', mov: r[0].id, traza };
    if (r.length > 1) return { rama: `1 payee cands(${r.length})`, traza };
    const w = ML.reconciliarPorNombre(datos, movs, nombres).filter(m => !o.montoViejo || saldaViejo(m, datos.montoTotal));
    traza.push(`débil → [${w.map(m => m.id).join(',')}]`);
    if (w.length > 0) return { rama: `1 débil(${w.length})`, traza };
  }

  const raws = [datos.destinoCbu, datos.destinoCuit, datos.destinoAlias, datos.destinoNombre]
    .filter((r): r is string => typeof r === 'string' && r.trim().length > 0);
  for (const raw of raws) {
    const p = ML.normalizarDestino(raw); if (!p) continue;
    const id = idDest(p.norm);
    const d0 = E.destinos.get(id);
    const ov = o.destinoEnT?.[p.norm];
    const d = d0 && ov ? { ...d0, ...ov } : d0;
    if (!d) { traza.push(`destino "${raw}" no existe`); continue; }
    const nac = E.nacimiento.get(id) ?? null;
    traza.push(`destino "${raw}" ${p.tipo} conf=${d.confianza} item=${d.itemEsperadoId ?? '-'} act=${iso(ms(d.actualizadoEn))} nac≈${iso(nac)}${nac != null && nac > T ? ' (NACIÓ DESPUÉS DE T)' : ''}`);
    if (ov) traza.push(`  (en T: ${JSON.stringify(ov)})`);
    if (ov?.noExistia) continue;
    if (o.fina && !ov?.existia && nac != null && nac > T) continue;
    if (!ML.destinoResuelve(d.rol, datos.direccion)) { traza.push(`  rol=${d.rol} no resuelve (dir=${datos.direccion ?? '-'}) → sigue`); continue; }  // F9.176
    if ((d.confianza ?? 0) < 0.7) continue;

    let itemId: string | undefined = d.itemEsperadoId;
    const des = d.desambiguacion;
    if (des && des.valores) {
      const v = normClave(des.campo === 'moneda' ? datos.moneda : datos.numeroCliente);
      for (const [k, it] of Object.entries(des.valores)) if (v && normClave(k) === v) itemId = it as string;
    } else {
      const n = normClave(datos.numeroCliente);
      const rec = n ? E.items.filter(i => (i.clavesDesambiguacion ?? []).some(k => normClave(k) === n)) : [];
      if (rec.length === 1) itemId = rec[0].id;
    }
    if (itemId) {
      const it = E.items.find(i => i.id === itemId);
      const mesEf = ML.mesImputado(datos.fecha, it?.diaCorteImputacion) ?? mesComp;
      const obl = movs.filter(m => m.itemEsperadoId === itemId && m.mes === mesEf);
      traza.push(`  obligaciones ${itemId}/${mesEf}: ${obl.map(m => `${m.id}(conf=${m.confirmadoPago},orig=${m.origenComprobanteId ? m.origenComprobanteId.slice(0, 8) : '-'})`).join(' ') || '(ninguna)'}`);
      if (ML.esObligacionFutura(datos, refISO)) return { rama: '2 destino', item: itemId, traza };
      const imp = impagaSaldable(obl, datos.tipoDocumento, o.guardAcotado);
      if (imp) return { rama: '1 destino', mov: imp.id, item: itemId, traza };
      if (obl.length === 0) return { rama: '2 destino', item: itemId, traza };
      const adic = cargoAdicional(obl, datos.tipoDocumento, o.guardAcotado);
      return { rama: adic ? '2+adic destino' : '2 destino', item: itemId, traza };
    } else if (d.categoria) {
      traza.push('  destino sin ítem → rama 3 con prefill (fallthrough a texto)');
      break;
    }
  }
  const prop = ML.calcularPropuesta(datos, [], E.items, mesComp);
  traza.push(`texto → rama ${prop.rama} item=${prop.itemEsperadoId ?? '-'}`);
  return { rama: String(prop.rama), item: prop.itemEsperadoId, traza };
}

// Estado de los destinos EN T. No tienen historia, pero hay dos fuentes firmes:
//   1) Una propuesta guardada con `origenDestino` (y sin reasignación a mano) dice a qué ítem apuntaba
//      en T el primer destino del comprobante que existe hoy. Es la única forma honesta con "aysa": lo
//      comparten los dos suministros de AySA y OSCILA entre Casa›Agua y Auto›Agua con cada alta
//      (el problema que describe F9.154), así que no tiene un único reapunte fechable.
//   2) "aysa" NO existía antes del 3/7 16:56:06: 801705dd (T 04:39) salió por texto, y 249624a1
//      (T 16:56:06) ya casó por ítem aprendido. Lo creó el callable de asignación (F9.81-F9.83), que no
//      deja rastro en movimientos.
//      Y el CUIT 30572975831 apuntó a Internet hasta el 15/9 19:54:40 (13c1b187, fd015e17).
const AYSA_DESDE = Date.parse('2026-07-03T16:56:06.762Z');
const REAPUNTES = [
  { norm: '30572975831', hasta: Date.parse('2026-09-15T19:54:40.897Z'), antes: { itemEsperadoId: '90b30edcc0666376321d' } },
];
export function destinosEnT(E: Estado, c: FirebaseFirestore.QueryDocumentSnapshot) {
  const { datos, pm, T } = contexto(E, c);
  const out: Record<string, { itemEsperadoId?: string; existia?: boolean; noExistia?: boolean }> = {};
  for (const r of REAPUNTES) if (T < r.hasta) out[r.norm] = r.antes;
  if (T < AYSA_DESDE) out['aysa'] = { noExistia: true };
  else out['aysa'] = { existia: true, itemEsperadoId: '94c07e7c61d119db6fb5' };
  if (pm.origenDestino && !pm.reasignadoAMano && pm.itemEsperadoId) {
    for (const raw of [datos.destinoCbu, datos.destinoCuit, datos.destinoAlias, datos.destinoNombre]) {
      const p = raw ? ML.normalizarDestino(raw) : null;
      if (p && E.destinos.has(idDest(p.norm))) { out[p.norm] = { itemEsperadoId: pm.itemEsperadoId, existia: true }; break; }
    }
  }
  return out;
}

export function etiquetaGuardada(pm: FirebaseFirestore.DocumentData): string {
  if (pm.rama === 0) return '0';
  if (pm.rama === 1) {
    if (pm.reconciliacionDebil) return `1 débil(${pm.candidatos?.length ?? '?'})`;
    if (pm.origenDestino) return '1 destino';
    if (pm.candidatos) return `1 payee cands(${pm.candidatos.length})`;
    return '1 payee';
  }
  if (pm.rama === 2) return pm.origenDestino ? `${pm.esAdicional ? '2+adic destino' : '2 destino'}` : '2';
  return String(pm.rama);
}
