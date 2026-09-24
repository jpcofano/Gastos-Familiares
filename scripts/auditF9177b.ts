// F9.177 §0 y §5 — los movimientos que el dueño ve, y los pagos que no marcan nada.
// SOLO LECTURA: no escribe nada.
import { cargarTodo } from './auditF9177';
import { Timestamp } from 'firebase-admin/firestore';

const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : null);
const dia = (t: unknown) => {
  const n = ms(t);
  return n == null ? null : new Date(n - 3 * 3600_000).toISOString().slice(0, 10);
};
const h8 = (s: unknown) => (s ? String(s).slice(0, 8) : '-');
const mask = (v: unknown) => {
  const s = String(v ?? '').replace(/\D/g, '');
  return s ? `…${s.slice(-4)}` : '-';
};
const corto = (s: unknown, n = 28) => {
  const t = String(s ?? '').trim();
  return t ? (t.length > n ? t.slice(0, n) + '…' : t) : '-';
};
const money = (v: unknown) => (typeof v === 'number' ? v.toLocaleString('es-AR', { maximumFractionDigits: 0 }) : '-');
/** `fecha` de un movimiento: Timestamp en los nuevos, string ISO en los viejos. */
const fISO = (v: unknown) => (v instanceof Timestamp ? dia(v) : typeof v === 'string' ? v.slice(0, 10) : null);

async function main() {
  console.log('F9.177 §0 y §5 — SOLO LECTURA.\n');
  const E = await cargarTodo();
  const nombreItem = (id: unknown) => {
    if (!id) return '-';
    const i = E.items.get(String(id));
    return i ? `${i.categoria}›${i.subcategoria}` : `${String(id).slice(0, 8)}(?)`;
  };

  // ── Línea de tiempo: ¿cuándo dejaron de llegar archivos? ──────────────────
  console.log('══ Entrantes por día, últimos 45 días ══\n');
  const porDia = new Map<string, { n: number; origen: Set<string>; quien: Set<string> }>();
  for (const e of E.ent) {
    const x = e.data() as Record<string, unknown>;
    const d = dia(x.creadoEn);
    if (!d) continue;
    const r = porDia.get(d) ?? { n: 0, origen: new Set<string>(), quien: new Set<string>() };
    r.n++; r.origen.add(String(x.origen ?? '?')); r.quien.add(String(x.creadoPor ?? '?'));
    porDia.set(d, r);
  }
  const dias = [...porDia.keys()].sort().slice(-45);
  for (const d of dias) {
    const r = porDia.get(d)!;
    console.log(`  ${d}  ${String(r.n).padStart(3)}  ${'█'.repeat(Math.min(r.n, 40))}  ${[...r.origen].join(',')}  ${[...r.quien].join(',')}`);
  }
  const ultimo = dias[dias.length - 1];
  console.log(`\n  ÚLTIMO entrante: ${ultimo}  ·  hoy: ${new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10)}`);

  // Lo mismo para comprobantes (por si alguno entró sin pasar por entrantes).
  const compPorDia = new Map<string, number>();
  for (const c of E.compsAll) {
    const d = dia((c.data() as Record<string, unknown>).subidoEn);
    if (d) compPorDia.set(d, (compPorDia.get(d) ?? 0) + 1);
  }
  const ultimoComp = [...compPorDia.keys()].sort().pop();
  console.log(`  ÚLTIMO comprobante (subidoEn): ${ultimoComp}`);

  // ── §0 — los movimientos que el dueño ve hoy ──────────────────────────────
  console.log('\n══ §0 — movimientos de septiembre sin pagar ══\n');
  const sinPagar = E.movs
    .filter(m => {
      const f = fISO(m.x.fecha) ?? '';
      return f >= '2026-09-01' && f <= '2026-09-30' && m.x.pagado !== true && m.x.tipo !== 'Ingreso';
    })
    .sort((a, b) => String(fISO(a.x.fecha)).localeCompare(String(fISO(b.x.fecha))));

  console.log('mov      fecha       monto      cat›subcat                      item                           hashPdf  conf  origen           excl');
  console.log('-'.repeat(140));
  let total = 0;
  for (const m of sinPagar) {
    total += Number(m.x.monto ?? 0);
    console.log([
      h8(m.id),
      String(fISO(m.x.fecha) ?? '-').padEnd(10),
      money(m.x.monto).padStart(10),
      corto(`${m.x.categoria ?? '-'}›${m.x.subcategoria ?? '-'}`, 30).padEnd(30),
      corto(nombreItem(m.x.itemEsperadoId), 30).padEnd(30),
      h8(m.x.hashPdf).padEnd(8),
      String(m.x.confirmadoPago === true).padEnd(5),
      corto(m.x.origen, 16).padEnd(16),
      String(m.x.excluirDash === true),
    ].join(' '));
  }
  console.log(`\n  ${sinPagar.length} movimientos · total ${money(total)}`);

  // El banner cuenta "pendientes del mes": los mismos, pero quizá con otro filtro.
  const noExcl = sinPagar.filter(m => m.x.excluirDash !== true);
  console.log(`  sin excluirDash: ${noExcl.length} · total ${money(noExcl.reduce((a, m) => a + Number(m.x.monto ?? 0), 0))}`);

  // ── §5 — movimientos con comprobante vinculado que NO quedaron pagados ────
  console.log('\n══ §5 — movimientos con comprobante vinculado y pagado:false (desde 2026-09-01) ══\n');
  const conComp = E.movs.filter(m => {
    const f = fISO(m.x.fecha) ?? '';
    return f >= '2026-09-01' && m.x.pagado !== true && (m.x.hashPdf || m.x.refStoragePdf);
  });
  if (conComp.length === 0) console.log('  (ninguno)');
  for (const m of conComp) {
    const c = E.comps.get(String(m.x.hashPdf ?? ''));
    const d = (c?.data() as Record<string, unknown>)?.datosExtraidos as Record<string, unknown> | undefined;
    console.log(`  mov ${h8(m.id)} fecha=${fISO(m.x.fecha)} ${money(m.x.monto)} · tipoDoc=${d?.tipoDocumento ?? '?'} · venc0=${(d?.vencimientos as Array<{ fecha?: string }>)?.[0]?.fecha ?? '-'} · conf=${m.x.confirmadoPago} · creado=${dia(m.x.creadoEn)} por=${m.x.creadoPor} origen=${m.x.origen} · comp.subido=${dia((c?.data() as Record<string, unknown>)?.subidoEn)} hash=${h8(m.x.hashPdf)}`);
  }

  // ── AYSA y ARCA: los casos anclados del §0 ────────────────────────────────
  console.log('\n══ Los casos del §0, en detalle ══\n');
  const interes = E.movs.filter(m => {
    const f = fISO(m.x.fecha) ?? '';
    if (f < '2026-09-01' || f > '2026-10-05') return false;
    const t = `${m.x.categoria} ${m.x.subcategoria} ${m.x.notas} ${m.x.destinoNombre} ${m.x.etiqueta}`.toLowerCase();
    return t.includes('agua') || t.includes('aysa') || t.includes('monotributo') || t.includes('arca') || t.includes('afip');
  }).sort((a, b) => String(fISO(a.x.fecha)).localeCompare(String(fISO(b.x.fecha))));

  for (const m of interes) {
    console.log(`  ── mov ${h8(m.id)}  fecha=${fISO(m.x.fecha)}  ${money(m.x.monto)} ${m.x.moneda}`);
    console.log(`     categoría   : ${m.x.categoria} › ${m.x.subcategoria}   etiqueta=${m.x.etiqueta ?? '-'}`);
    console.log(`     item        : ${nombreItem(m.x.itemEsperadoId)}  (${h8(m.x.itemEsperadoId)})`);
    console.log(`     pagado=${m.x.pagado} confirmadoPago=${m.x.confirmadoPago} pagadoEn=${dia(m.x.pagadoEn) ?? '-'}`);
    console.log(`     origen=${m.x.origen} banco=${m.x.banco ?? '-'} creadoPor=${m.x.creadoPor} creadoEn=${dia(m.x.creadoEn)}`);
    console.log(`     hashPdf=${h8(m.x.hashPdf)}  destinoCbu=${mask(m.x.destinoCbu)} destinoCuit=${mask(m.x.destinoCuit)} destinoNombre=${corto(m.x.destinoNombre)}`);
    const v = m.x.vencimientos as Array<{ fecha?: string; monto?: number }> | undefined;
    if (v?.length) console.log(`     vencimientos: ${v.map(x => `${x.fecha}/${money(x.monto)}`).join(' · ')}`);
  }

  // ── Los ítems esperados de agua y monotributo ─────────────────────────────
  console.log('\n══ Ítems esperados relacionados ══\n');
  for (const [id, i] of E.items) {
    const t = `${i.categoria} ${i.subcategoria} ${i.notas}`.toLowerCase();
    if (!(t.includes('agua') || t.includes('monotributo') || t.includes('arca'))) continue;
    console.log(`  ${h8(id)}  ${i.categoria}›${i.subcategoria}  activo=${i.activo}  monto=${money(i.montoEsperado)}  claves=${JSON.stringify(i.clavesDesambiguacion ?? [])}  notas=${corto(i.notas, 40)}`);
  }

  // ── Destinos con desambiguación (F9.154/F9.168: CBU compartido) ───────────
  const destS = await (await import('firebase-admin/firestore')).getFirestore().collection('destinos').get();
  console.log('\n══ Destinos con rol o desambiguación ══\n');
  for (const d of destS.docs) {
    const x = d.data() as Record<string, unknown>;
    if (!x.rol && !x.desambiguacion) continue;
    const item = nombreItem(x.itemEsperadoId);
    console.log(`  ${h8(d.id)} tipo=${x.tipo} rol=${x.rol ?? '-'} item=${item} desamb=${x.desambiguacion ? JSON.stringify(Object.keys((x.desambiguacion as Record<string, unknown>).valores ?? {}).map(k => k.slice(-4))) : '-'}`);
  }
}

main().then(() => process.exit(0), e => { console.error(e); process.exit(1); });
