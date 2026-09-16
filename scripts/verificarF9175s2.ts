// F9.175 §2 — tolerancia de truncamiento en `montoSalda`. SOLO LECTURA.
//
// Los pases REALES (reconciliarPorPayee / reconciliarPorNombre) ya corren con la tolerancia nueva.
// El "antes" se obtiene filtrando su salida con la tolerancia vieja (±0,01): es válido porque la nueva
// CONTIENE a la vieja por construcción — y eso mismo se verifica acá, comprobante por comprobante,
// recalculando la vieja desde cero sobre todas las candidatas.
import { cargar, contexto, destinosEnT, nombresEnT, simular, etiquetaGuardada } from './simMatchF9175';
import { reconciliarPorPayee, reconciliarPorNombre, tipoConciliable, type MovimientoMin, type DatosExtractosMin } from '../functions/src/matchLogica';

let ok = 0, fail = 0;
const chk = (r: string, c: boolean, d = '') => {
  if (c) { ok++; console.log(`  OK   ${r}${d ? ' — ' + d : ''}`); }
  else { fail++; console.log(`  FAIL ${r}${d ? ' — ' + d : ''}`); }
};

// montoSalda de ffc7309, textual.
const saldaViejo = (m: MovimientoMin, total: number) =>
  Math.abs(m.monto - total) < 0.01 ||
  (m.vencimientos ?? []).some(v => typeof v?.monto === 'number' && Math.abs(v.monto - total) < 0.01);

async function main() {
  const E = await cargar();
  const comp = (p: string) => E.comps.find(c => c.id.startsWith(p))!;
  const estado = (c: FirebaseFirestore.QueryDocumentSnapshot) => {
    const ctx = contexto(E, c, true);
    return { ...ctx, nombres: nombresEnT(E, ctx.T, { fina: true, destinoEnT: destinosEnT(E, c) }) };
  };

  console.log('=== 1. los dos pagos de expensas (0,43 de diferencia) ===');
  for (const [p, mov] of [['4c8a6dbe', '7HTNXS5cwTNCdf3scIF8'], ['d37f6034', 'C7ZY6a2iPhaxaGnCF9PG']] as const) {
    const c = comp(p); const s = estado(c);
    const r = reconciliarPorPayee(s.datos, s.movs);
    console.log(`  ${p} pago=${s.datos.montoTotal} → reconciliarPorPayee=[${r.map(m => `${m.id} $${m.monto}`).join(', ')}]`);
    chk(`${p} salda ${mov} por payee`, r.length === 1 && r[0].id === mov);
    const sim = simular(E, c, { guardAcotado: true, fina: true, destinoEnT: destinosEnT(E, c) });
    chk(`${p} ahora entra por rama 1 payee (antes del destino)`, sim.rama === '1 payee' && sim.mov === mov, sim.rama);
  }

  console.log('\n=== 2. ITPA: 1.484.000 contra 2.017.000 NO salda ===');
  {
    // El pago real de 1.484.000 (ebba8e89) contra la obligación real de 2.017.000 (KhYexvlI), mismo payee.
    const pago = comp('ebba8e89').data().datosExtraidos as DatosExtractosMin;
    const obl = E.movsAll.find(m => m.id === 'KhYexvlIEdaLZfvLMfZN')!;
    const mov: MovimientoMin = {
      id: obl.id, monto: obl.x.monto, moneda: obl.x.moneda, tipo: obl.x.tipo, fecha: new Date(), mes: obl.x.mes,
      descripcion: obl.x.descripcion, itemEsperadoId: obl.x.itemEsperadoId ?? null,
      destinoCuit: pago.destinoCuit ?? null, destinoCbu: pago.destinoCbu ?? null, destinoAlias: pago.destinoAlias ?? null,
      destinoNombre: pago.destinoNombre ?? null, vencimientos: obl.x.vencimientos ?? null, confirmadoPago: false,
      origenComprobanteId: obl.x.origenComprobanteId ?? null,
    };
    console.log(`  pago ${pago.montoTotal} vs obligación ${mov.monto} (mismo payee forzado)`);
    chk('ITPA 1.484.000 no salda la obligación de 2.017.000 por payee', reconciliarPorPayee(pago, [mov]).length === 0);
    chk('ni por nombre', reconciliarPorNombre(pago, [mov], null).length === 0);
    // Bordes de la banda, sobre la misma obligación.
    const conMonto = (n: number) => ({ ...pago, montoTotal: n });
    const o = mov.monto;
    chk('pago = obligación − 0,99 salda (truncamiento)', reconciliarPorPayee(conMonto(o - 0.99), [mov]).length === 1);
    chk('pago = obligación − 1,00 NO salda', reconciliarPorPayee(conMonto(o - 1), [mov]).length === 0);
    chk('pago = obligación + 0,005 salda (tolerancia de siempre)', reconciliarPorPayee(conMonto(o + 0.005), [mov]).length === 1);
    chk('pago = obligación + 0,02 NO salda (hacia arriba no hay banda)', reconciliarPorPayee(conMonto(o + 0.02), [mov]).length === 0);
    chk('en USD, pago = obligación − 0,43 NO salda (USD sin cambio)',
        reconciliarPorPayee({ ...conMonto(o - 0.43), moneda: 'USD' }, [{ ...mov, moneda: 'USD' }]).length === 0);
    chk('pago = obligación − 0,43 contra el VENCIMIENTO también salda',
        reconciliarPorPayee(conMonto(1000 - 0.43), [{ ...mov, monto: 5, vencimientos: [{ monto: 1000 }] }]).length === 1);
  }

  console.log('\n=== 3. ningún pago que hoy salda deja de saldar, y qué se suma ===');
  let n = 0, contiene = 0;
  const nuevos: string[] = [];
  for (const c of E.comps) {
    const dt = c.data().datosExtraidos;
    if (!dt || dt.montoTotal == null) continue;
    if (dt.tipoDocumento !== 'transferencia' && dt.tipoDocumento !== 'comprobante_pago') continue;
    n++;
    const s = estado(c);
    const tipoOk = tipoConciliable(s.datos);
    // Viejo desde cero: todas las candidatas que el pase real vería con CUALQUIER monto (se fuerza el
    // monto de cada una para que el filtro de importe pase), filtradas por la tolerancia vieja.
    const base = s.movs.filter(m => m.tipo === tipoOk && m.moneda === s.datos.moneda && !m.confirmadoPago);
    const pasaSinMonto = (f: (d: DatosExtractosMin, ms: MovimientoMin[]) => MovimientoMin[]) =>
      base.filter(m => f({ ...s.datos, montoTotal: m.monto }, [m]).length === 1);
    const viejoP = pasaSinMonto((d, ms) => reconciliarPorPayee(d, ms)).filter(m => saldaViejo(m, dt.montoTotal));
    const viejoN = pasaSinMonto((d, ms) => reconciliarPorNombre(d, ms, s.nombres)).filter(m => saldaViejo(m, dt.montoTotal));
    const nuevoP = reconciliarPorPayee(s.datos, s.movs);
    const nuevoN = reconciliarPorNombre(s.datos, s.movs, s.nombres);
    const ids = (a: MovimientoMin[]) => new Set(a.map(m => m.id));
    const incluido = (a: MovimientoMin[], b: MovimientoMin[]) => a.every(m => ids(b).has(m.id));
    if (incluido(viejoP, nuevoP) && incluido(viejoN, nuevoN)) contiene++;
    else console.log(`  PERDIDO ${c.id.slice(0, 8)} viejoP=[${[...ids(viejoP)]}] nuevoP=[${[...ids(nuevoP)]}] viejoN=[${[...ids(viejoN)]}] nuevoN=[${[...ids(nuevoN)]}]`);
    const sumaP = nuevoP.filter(m => !ids(viejoP).has(m.id));
    const sumaN = nuevoN.filter(m => !ids(viejoN).has(m.id));
    const fin = E.movsAll.find(m => m.x.hashPdf === c.id);
    for (const [pase, a] of [['payee', sumaP], ['débil', sumaN]] as const) {
      for (const m of a) nuevos.push(`  + ${c.id.slice(0, 8)} [${pase}] pago=${dt.montoTotal} → ${m.id} $${m.monto} "${m.descripcion}" suya=${fin?.id === m.id ? 'SÍ' : 'NO'}`);
    }
  }
  console.log(`  pagos=${n}; lo que saldaba antes sigue saldando en ${contiene}/${n}`);
  chk('ningún pago que hoy salda deja de hacerlo', contiene === n);
  console.log(`  candidatas que se suman con la banda nueva (${nuevos.length}):`);
  console.log(nuevos.join('\n') || '  (ninguna)');
  chk('toda candidata nueva es la obligación que el dueño eligió', nuevos.every(x => x.endsWith('suya=SÍ')));

  console.log('\n=== 4. pipeline completo (§1 + §2) contra lo guardado ===');
  let cambian = 0;
  for (const c of E.comps) {
    const pm = c.data().propuestaMatch;
    if (!c.data().datosExtraidos || !pm || pm.rama === 0) continue;
    const g = etiquetaGuardada(pm);
    const antes = simular(E, c, { guardAcotado: false, fina: true, destinoEnT: destinosEnT(E, c), montoViejo: true });
    const r = simular(E, c, { guardAcotado: true, fina: true, destinoEnT: destinosEnT(E, c) });
    // Se reporta sólo lo que difiere de la propuesta guardada en los pagos, que es donde actúa §2.
    const dt = c.data().datosExtraidos;
    if (dt.tipoDocumento !== 'transferencia' && dt.tipoDocumento !== 'comprobante_pago') continue;
    if (r.rama !== g || (r.mov ?? pm.movimientoId) !== pm.movimientoId) {
      cambian++;
      const fin = E.movsAll.find(m => m.x.hashPdf === c.id);
      console.log(`  ${c.id.slice(0, 8)} guardada=${g}${pm.movimientoId ? ' ' + pm.movimientoId : ''} | sim(ffc7309)=${antes.rama} | sim(§1+§2)=${r.rama}${r.mov ? ' ' + r.mov : ''} | dueño: ${fin ? fin.id : 'sin mov'}`);
    }
  }
  console.log(`  pagos cuya propuesta simulada difiere de la guardada: ${cambian}`);

  console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
}
main().catch(e => { console.error(e); process.exit(1); });
