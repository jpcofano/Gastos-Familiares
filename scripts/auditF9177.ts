// F9.177 §1 — inventario: dónde se frenó cada archivo. SOLO LECTURA: no escribe nada.
//
// Una fila por archivo desde 2026-09-15, uniendo por hash:
//   entrantes/{hash} → comprobantes/{hash} | resumenesTarjeta/{...} → movimiento vinculado
//
// Privacidad: hashes a 8 caracteres, CBU/CUIT enmascarados salvo los últimos 4, nombres de
// terceros recortados.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

if (getApps().length === 0) initializeApp({ credential: cert('./secrets/serviceAccountKey.json') });
const db = getFirestore();

const DESDE = '2026-09-15';
const CORTE = '2026-09-17';          // F9.176: antes / desde

const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : null);
/** Fecha local (AR) YYYY-MM-DD de un timestamp. */
const dia = (t: unknown) => {
  const n = ms(t);
  if (n == null) return null;
  return new Date(n - 3 * 3600_000).toISOString().slice(0, 10);
};
const h8 = (s: string | null | undefined) => (s ? String(s).slice(0, 8) : '-');
const mask = (v: unknown) => {
  const s = String(v ?? '').replace(/\D/g, '');
  return s ? `…${s.slice(-4)}` : '-';
};
const corto = (s: unknown, n = 22) => {
  const t = String(s ?? '').trim();
  return t ? (t.length > n ? t.slice(0, n) + '…' : t) : '-';
};
const money = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '-');

export type Parada = 'P0' | 'P1' | 'P2' | 'P3' | 'P4' | 'P5' | 'P6' | 'P7' | 'P8';

const QUE_ES: Record<Parada, string> = {
  P0: 'sin entrantes — el archivo nunca llegó al servidor',
  P1: "entrantes.estado='pendiente' — routearEntrante no corrió",
  P2: "entrantes.estado='error' | 'ambiguo'",
  P3: "comprobantes.estado='subido' — extraerComprobante no corrió",
  P4: "comprobantes.estado='error'",
  P5: "'extraido' SIN propuestaMatch — matchComprobante no corrió o falló",
  P6: "'extraido' CON propuesta — esperando confirmación del usuario",
  P7: "'vinculado' con movimiento, pero pagado:false",
  P8: "'vinculado' y pagado:true — sano",
};

export interface Fila {
  hash: string;
  parada: Parada;
  creadoEn: string | null;
  creadoPor: string;
  origen: string;
  mime: string;
  tamKb: number | null;
  entEstado: string;
  tipoDetectado: string;
  motivoDeteccion: string;
  coleccion: string;
  compEstado: string;
  tipoDocumento: string;
  fecha: string;
  venc0: string;
  montoTotal: number | null;
  rama: string;
  origenRec: string;
  debil: string;
  nCand: number | null;
  errorExtraccion: string;
  movId: string;
  movPagado: string;
  movConfirmado: string;
  movCat: string;
  movItem: string;
}

export async function cargarTodo() {
  const [entS, compS, resS, movS, itemsS] = await Promise.all([
    db.collection('entrantes').get(),
    db.collection('comprobantes').get(),
    db.collection('resumenesTarjeta').get(),
    db.collection('movimientos').get(),
    db.collection('itemsEsperados').get(),
  ]);
  return {
    ent: entS.docs,
    comps: new Map(compS.docs.map(d => [d.id, d])),
    compsAll: compS.docs,
    res: resS.docs,
    movs: movS.docs.map(d => ({ id: d.id, x: d.data() as Record<string, unknown> })),
    items: new Map(itemsS.docs.map(d => [d.id, d.data() as Record<string, unknown>])),
  };
}

export function construirFilas(E: Awaited<ReturnType<typeof cargarTodo>>): Fila[] {
  const nombreItem = (id: unknown) => {
    if (!id) return '-';
    const i = E.items.get(String(id));
    return i ? `${i.categoria}›${i.subcategoria}` : `${String(id).slice(0, 8)}(?)`;
  };
  // Movimiento vinculado a un hash: por hashPdf, o por refStoragePdf que lo contenga.
  const movDe = (hash: string) =>
    E.movs.find(m => m.x.hashPdf === hash) ??
    E.movs.find(m => String(m.x.refStoragePdf ?? '').includes(hash));

  const filas: Fila[] = [];
  const vistos = new Set<string>();

  const push = (hash: string, ent: Record<string, unknown> | null, entDia: string | null) => {
    vistos.add(hash);
    const comp = E.comps.get(hash);
    const c = comp?.data() as Record<string, unknown> | undefined;
    const d = (c?.datosExtraidos ?? {}) as Record<string, unknown>;
    const p = (c?.propuestaMatch ?? null) as Record<string, unknown> | null;
    const esRes = String((ent?.destino as Record<string, unknown>)?.coleccion ?? '') === 'resumenesTarjeta';
    const mov = movDe(hash);

    let parada: Parada;
    if (!ent) parada = 'P0';
    else if (ent.estado === 'pendiente') parada = 'P1';
    else if (ent.estado === 'error' || ent.estado === 'ambiguo') parada = 'P2';
    else if (!c) parada = esRes ? 'P8' : 'P0';          // ruteado a resumen, o comprobante ausente
    else if (c.estado === 'subido') parada = 'P3';
    else if (c.estado === 'error') parada = 'P4';
    else if (c.estado === 'extraido') parada = p ? 'P6' : 'P5';
    else parada = mov && mov.x.pagado === true ? 'P8' : 'P7';

    const venc = (d.vencimientos as Array<{ fecha?: string }> | undefined)?.[0]?.fecha ?? null;
    filas.push({
      hash: h8(hash),
      parada,
      creadoEn: entDia ?? dia(c?.subidoEn),
      creadoPor: String(ent?.creadoPor ?? c?.subidoPor ?? '') || '(VACÍO)',
      origen: String(ent?.origen ?? '-'),
      mime: String(ent?.mimeType ?? c?.contentType ?? '-'),
      tamKb: typeof (ent?.tamano ?? c?.tamano) === 'number' ? Math.round(Number(ent?.tamano ?? c?.tamano) / 1024) : null,
      entEstado: String(ent?.estado ?? '(sin entrantes)'),
      tipoDetectado: String(ent?.tipoDetectado ?? '-'),
      motivoDeteccion: corto(ent?.motivoDeteccion, 40),
      coleccion: esRes ? 'resumenesTarjeta' : (c ? 'comprobantes' : '-'),
      compEstado: String(c?.estado ?? '-'),
      tipoDocumento: String(d.tipoDocumento ?? '-'),
      fecha: String(d.fecha ?? '-'),
      venc0: String(venc ?? '-'),
      montoTotal: typeof d.montoTotal === 'number' ? d.montoTotal : null,
      rama: p ? String(p.rama) : '-',
      origenRec: p?.origenReconciliacion ? 'sí' : '-',
      debil: p?.reconciliacionDebil ? 'sí' : '-',
      nCand: Array.isArray(p?.candidatos) ? (p!.candidatos as unknown[]).length : null,
      errorExtraccion: corto(c?.errorExtraccion, 60),
      movId: mov ? h8(mov.id) : '-',
      movPagado: mov ? String(mov.x.pagado === true) : '-',
      movConfirmado: mov ? String(mov.x.confirmadoPago === true) : '-',
      movCat: mov ? `${mov.x.categoria ?? '-'}›${mov.x.subcategoria ?? '-'}` : '-',
      movItem: mov ? nombreItem(mov.x.itemEsperadoId) : '-',
    });
  };

  // 1) Todo `entrantes` desde DESDE.
  for (const e of E.ent) {
    const x = e.data() as Record<string, unknown>;
    const d0 = dia(x.creadoEn);
    if (!d0 || d0 < DESDE) continue;
    push(e.id, x, d0);
  }
  // 2) Comprobantes desde DESDE que NO tienen entrantes (P0 del lado servidor: entró por otra vía).
  for (const c of E.compsAll) {
    if (vistos.has(c.id)) continue;
    const x = c.data() as Record<string, unknown>;
    const d0 = dia(x.subidoEn);
    if (!d0 || d0 < DESDE) continue;
    push(c.id, null, d0);
  }
  return filas.sort((a, b) => String(a.creadoEn).localeCompare(String(b.creadoEn)) || a.hash.localeCompare(b.hash));
}

function tabla(filas: Fila[]) {
  const cols: Array<[string, (f: Fila) => string]> = [
    ['hash', f => f.hash],
    ['par', f => f.parada],
    ['creado', f => f.creadoEn ?? '-'],
    ['por', f => corto(f.creadoPor, 10)],
    ['origen', f => f.origen],
    ['mime', f => f.mime.replace('application/', '').replace('image/', 'img/')],
    ['kb', f => (f.tamKb == null ? '-' : String(f.tamKb))],
    ['entrante', f => f.entEstado],
    ['detect', f => f.tipoDetectado],
    ['col', f => f.coleccion.replace('comprobantes', 'comp').replace('resumenesTarjeta', 'resum')],
    ['comp', f => f.compEstado],
    ['tipoDoc', f => corto(f.tipoDocumento, 18)],
    ['fecha', f => f.fecha],
    ['venc', f => f.venc0],
    ['monto', f => money(f.montoTotal)],
    ['rama', f => f.rama],
    ['rec', f => f.origenRec],
    ['déb', f => f.debil],
    ['cand', f => (f.nCand == null ? '-' : String(f.nCand))],
    ['mov', f => f.movId],
    ['pag', f => f.movPagado],
    ['conf', f => f.movConfirmado],
    ['categoría', f => corto(f.movCat, 22)],
  ];
  const w = cols.map(([t, get]) => Math.max(t.length, ...filas.map(f => get(f).length)));
  const linea = (celdas: string[]) => celdas.map((c, i) => c.padEnd(w[i])).join(' ');
  console.log(linea(cols.map(c => c[0])));
  console.log(w.map(n => '-'.repeat(n)).join(' '));
  for (const f of filas) console.log(linea(cols.map(([, get]) => get(f))));
}

async function main() {
  console.log('F9.177 §1 — inventario de archivos desde ' + DESDE + '. SOLO LECTURA.\n');
  const E = await cargarTodo();
  console.log(`colecciones: entrantes ${E.ent.length} · comprobantes ${E.compsAll.length} · resumenesTarjeta ${E.res.length} · movimientos ${E.movs.length}\n`);

  const filas = construirFilas(E);
  console.log(`══ Filas desde ${DESDE}: ${filas.length} ══\n`);
  tabla(filas);

  // ── Conteos por parada, antes y desde el corte ────────────────────────────
  console.log(`\n══ Conteos por parada (corte ${CORTE}, F9.176) ══\n`);
  const paradas: Parada[] = ['P0', 'P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8'];
  const antes = filas.filter(f => (f.creadoEn ?? '') < CORTE);
  const desde = filas.filter(f => (f.creadoEn ?? '') >= CORTE);
  console.log('par  antes  desde  total  qué significa');
  console.log('---  -----  -----  -----  ' + '-'.repeat(60));
  for (const p of paradas) {
    const a = antes.filter(f => f.parada === p).length;
    const d = desde.filter(f => f.parada === p).length;
    if (a + d === 0) continue;
    console.log(`${p}   ${String(a).padStart(5)}  ${String(d).padStart(5)}  ${String(a + d).padStart(5)}  ${QUE_ES[p]}`);
  }
  console.log(`tot  ${String(antes.length).padStart(5)}  ${String(desde.length).padStart(5)}  ${String(filas.length).padStart(5)}`);

  // ── Señales sueltas que §2 pide mirar ─────────────────────────────────────
  console.log('\n══ Señales del lado cliente (§2) ══\n');
  const sinCreador = E.ent.filter(e => !String((e.data() as Record<string, unknown>).creadoPor ?? '').trim());
  console.log(`entrantes con creadoPor vacío (cualquier fecha): ${sinCreador.length}`);
  for (const e of sinCreador.slice(0, 10)) console.log(`   ${h8(e.id)}  ${dia((e.data() as Record<string, unknown>).creadoEn)}  origen=${(e.data() as Record<string, unknown>).origen}`);

  const porOrigen = new Map<string, number>();
  for (const f of filas) porOrigen.set(f.origen, (porOrigen.get(f.origen) ?? 0) + 1);
  console.log(`\npor origen (desde ${DESDE}): ${JSON.stringify(Object.fromEntries(porOrigen))}`);

  const mimes = new Map<string, number>();
  for (const e of E.ent) {
    const m = String((e.data() as Record<string, unknown>).mimeType ?? '(vacío)');
    mimes.set(m, (mimes.get(m) ?? 0) + 1);
  }
  console.log(`mimeType en TODO entrantes: ${JSON.stringify(Object.fromEntries([...mimes].sort((a, b) => b[1] - a[1])))}`);

  const grandes = E.ent.filter(e => Number((e.data() as Record<string, unknown>).tamano ?? 0) > 10 * 1024 * 1024);
  console.log(`entrantes > 10 MB: ${grandes.length}`);
}

if (process.argv[1]?.includes('auditF9177.ts')) {
  main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
}
