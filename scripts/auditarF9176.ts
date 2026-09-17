// F9.176 — auditorías previas al código (§2 y §4). SOLO LECTURA: no escribe nada.
//
// §2: los comprobantes cuyo payee es el CUIT de Personal Pay (30572975831), y qué otro identificador
//     traen para llegar a la contraparte real.
// §4: destinos candidatos a un rol distinto de `comercio`, por patrón.
import { cargar, idDest, iso, ms } from './simMatchF9175';
import { normalizarDestino, evaluarMatchTexto } from '../functions/src/matchLogica';

const PERSONAL_PAY = '30572975831';
const CUIL_DUENO = '20243359679';
const normClave = (v: unknown) => String(v ?? '').trim().toUpperCase().replace(/^0+(?=.)/, '');

async function main() {
  const E = await cargar();
  const nombreItem = (id?: string | null) => {
    if (!id) return '-';
    const i = E.items.find(x => x.id === id);
    return i ? `${i.categoria}›${i.subcategoria}` : `${id.slice(0, 8)}(inactivo)`;
  };
  // Ítem FINAL de un comprobante: el del movimiento que lleva su hashPdf (lo que decidió el dueño),
  // si no el de la propuesta.
  const itemFinal = (c: FirebaseFirestore.QueryDocumentSnapshot) => {
    const fin = E.movsAll.find(m => m.x.hashPdf === c.id);
    return (fin?.x.itemEsperadoId as string | undefined) ?? c.data().propuestaMatch?.itemEsperadoId ?? null;
  };

  console.log('F9.176 — auditorías. SOLO LECTURA.\n');
  console.log(`══ §2 — comprobantes con payee ${PERSONAL_PAY} (destinoCuit o contraparteCuit) ══`);
  const pp = E.comps.filter(c => {
    const d = c.data().datosExtraidos ?? {};
    return [d.destinoCuit, d.contraparteCuit].some(v => String(v ?? '').replace(/\D/g, '') === PERSONAL_PAY);
  });
  const recibos = E.comps.filter(c => ['recibo_servicio', 'factura_a', 'factura_b', 'factura_c'].includes(c.data().datosExtraidos?.tipoDocumento));
  let conNumero = 0, conNombre = 0, conAlguno = 0;
  for (const c of pp) {
    const d = c.data().datosExtraidos;
    const n = normClave(d.numeroCliente);
    // ¿numeroCliente utilizable? = lo trae OTRO documento de obligación (el recibo del servicio) o un
    // ítem lo reclama como clave de desambiguación.
    const recibosMismoNumero = n ? recibos.filter(r => normClave(r.data().datosExtraidos?.numeroCliente) === n) : [];
    const itemsQueReclaman = n ? E.items.filter(i => (i.clavesDesambiguacion ?? []).some(k => normClave(k) === n)) : [];
    const numeroUtil = recibosMismoNumero.length > 0 || itemsQueReclaman.length > 0;
    // ¿destinoNombre utilizable? = existe un destino de nombre con ítem, o matchea el matchTexto de un ítem.
    const pn = d.destinoNombre ? normalizarDestino(d.destinoNombre) : null;
    const destNombre = pn ? E.destinos.get(idDest(pn.norm)) : undefined;
    const texto = [d.comercioRazonSocial, d.destinoNombre].filter(Boolean).join(' ').toLowerCase();
    const porTexto = E.items.filter(i => i.activo && i.moneda === d.moneda && i.matchTexto?.incluye.length && evaluarMatchTexto(texto, i.matchTexto!));
    const nombreUtil = !!(destNombre?.itemEsperadoId) || porTexto.length === 1;
    if (numeroUtil) conNumero++;
    if (nombreUtil) conNombre++;
    if (numeroUtil || nombreUtil) conAlguno++;
    console.log(`\n  ${c.id.slice(0, 8)} ${d.tipoDocumento} ${d.fecha} $${d.montoTotal} dir=${d.direccion ?? '-'} subido=${iso(ms(c.data().subidoEn))}`);
    console.log(`     destinoNombre="${d.destinoNombre}" razon="${d.comercioRazonSocial}" alias=${d.destinoAlias} cbu=${d.destinoCbu} numeroCliente=${d.numeroCliente}`);
    console.log(`     propuesta: rama=${c.data().propuestaMatch?.rama} item=${nombreItem(c.data().propuestaMatch?.itemEsperadoId)} | final (dueño): ${nombreItem(itemFinal(c))}`);
    console.log(`     numeroCliente → recibos con el mismo número: [${recibosMismoNumero.map(r => `${r.id.slice(0, 8)} ${nombreItem(itemFinal(r))}`).join(', ')}]  ítems que lo reclaman: [${itemsQueReclaman.map(i => nombreItem(i.id)).join(', ')}]  → ${numeroUtil ? 'ÚTIL' : 'no'}`);
    console.log(`     destinoNombre → destino ${pn ? `${pn.tipo}:"${pn.norm}"` : '-'} ${destNombre ? `item=${nombreItem(destNombre.itemEsperadoId)} conf=${destNombre.confianza}` : '(no existe)'} | matchTexto: [${porTexto.map(i => nombreItem(i.id)).join(', ')}]  → ${nombreUtil ? 'ÚTIL' : 'no'}`);
  }
  console.log(`\n  total=${pp.length}  con numeroCliente útil=${conNumero}  con destinoNombre útil=${conNombre}  con alguno=${conAlguno}  sin nada=${pp.length - conAlguno}`);
  const dPP = E.destinos.get(idDest(PERSONAL_PAY));
  console.log(`  destino ${PERSONAL_PAY} hoy: ${JSON.stringify({ ...dPP, actualizadoEn: iso(ms(dPP?.actualizadoEn)) })}`);

  console.log('\n══ §4 — destinos candidatos a un rol distinto de `comercio` ══');
  // Índice: para cada destinoNorm, los comprobantes que lo traen en cualquier campo de payee y el
  // ítem final de cada uno.
  type Uso = { comp: string; campo: string; item: string | null; dir: string; tipo: string; fecha: string };
  const usos = new Map<string, Uso[]>();
  for (const c of E.comps) {
    const d = c.data().datosExtraidos;
    if (!d) continue;
    for (const campo of ['destinoCbu', 'destinoCuit', 'destinoAlias', 'destinoNombre', 'contraparteCuit', 'contraparteCbu', 'contraparteNombre']) {
      const raw = d[campo];
      if (typeof raw !== 'string' || !raw.trim()) continue;
      const p = normalizarDestino(raw);
      if (!p) continue;
      const arr = usos.get(p.norm) ?? [];
      if (!arr.some(u => u.comp === c.id.slice(0, 8))) arr.push({ comp: c.id.slice(0, 8), campo, item: itemFinal(c), dir: d.direccion ?? '-', tipo: d.tipoDocumento, fecha: d.fecha });
      usos.set(p.norm, arr);
    }
  }

  const candidatos = new Map<string, string[]>();
  const marcar = (norm: string, motivo: string) => candidatos.set(norm, [...(candidatos.get(norm) ?? []), motivo]);

  // (a) conocidos
  marcar(PERSONAL_PAY, 'CONOCIDO: CUIT de Personal Pay (procesador de pagos) → medio_pago');
  marcar(CUIL_DUENO, 'CONOCIDO: CUIL del dueño (a9da4f68) → propio');
  // CBU de AySA: el/los CBU que traen los comprobantes de AySA.
  for (const [norm, us] of usos) {
    const comps = us.map(u => E.comps.find(c => c.id.startsWith(u.comp))!.data().datosExtraidos);
    if (comps.some(d => /aysa|agua y saneamientos/i.test(`${d.destinoNombre} ${d.comercioRazonSocial}`)) && /^\d+$/.test(norm)) {
      marcar(norm, `CONOCIDO: identificador numérico de AySA (${us[0].campo})`);
    }
    if (comps.some(d => /accenture/i.test(`${d.destinoNombre} ${d.contraparteNombre} ${d.comercioRazonSocial}`))) {
      marcar(norm, `CONOCIDO: aparece en comprobantes de Accenture (${[...new Set(us.map(u => u.campo))].join(',')})`);
    }
  }
  // (b) mismo destinoNorm en comprobantes que terminaron en ítems distintos
  for (const [norm, us] of usos) {
    const items = [...new Set(us.map(u => u.item).filter(Boolean))];
    if (items.length > 1) marcar(norm, `PATRÓN: en comprobantes de ${items.length} ítems distintos (${items.map(nombreItem).join(' / ')})`);
  }
  // (c) el destino apunta hoy a un ítem distinto del que usaron propuestas guardadas con origenDestino
  for (const c of E.comps) {
    const d = c.data().datosExtraidos, pm = c.data().propuestaMatch;
    if (!d || !pm?.origenDestino || !pm.itemEsperadoId) continue;
    for (const raw of [d.destinoCbu, d.destinoCuit, d.destinoAlias, d.destinoNombre]) {
      const p = raw ? normalizarDestino(raw) : null;
      const x = p ? E.destinos.get(idDest(p.norm)) : undefined;
      if (!p || !x) continue;
      if (x.itemEsperadoId && x.itemEsperadoId !== pm.itemEsperadoId && !pm.reasignadoAMano) {
        marcar(p.norm, `PATRÓN: cambió de ítem (propuesta ${c.id.slice(0, 8)} usó ${nombreItem(pm.itemEsperadoId)}, hoy ${nombreItem(x.itemEsperadoId)})`);
      }
      break;
    }
  }
  // (d) mismo norm usado como destino de un GASTO y como contraparte de un INGRESO
  for (const [norm, us] of usos) {
    if (us.some(u => u.dir === 'entrante') && us.some(u => u.dir !== 'entrante')) marcar(norm, 'PATRÓN: aparece en comprobantes entrantes y salientes');
    else if (us.length && us.every(u => u.dir === 'entrante')) marcar(norm, 'PATRÓN: solo en comprobantes ENTRANTES → posible pagador');
  }
  // (e) payee = persona con el apellido de la familia (posible propio)
  for (const [norm, us] of usos) {
    const nombres = us.map(u => E.comps.find(c => c.id.startsWith(u.comp))!.data().datosExtraidos)
      .map(d => `${d.destinoNombre ?? ''} ${d.contraparteNombre ?? ''}`);
    if (nombres.some(n => /cofano/i.test(n))) marcar(norm, 'PATRÓN: payee con apellido Cofano (¿familia?)');
  }

  const filas = [...candidatos.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [norm, motivos] of filas) {
    const x = E.destinos.get(idDest(norm));
    const us = usos.get(norm) ?? [];
    console.log(`\n  ▸ ${norm}  ${x ? `[destino ${x.tipo}, hoy → ${x.itemEsperadoId ? nombreItem(x.itemEsperadoId) : `${x.categoria ?? '-'}›${x.subcategoria ?? '-'}`}, conf=${x.confianza}, rol=${x.rol ?? '(sin rol)'}]` : '[no existe como destino]'}`);
    for (const m of [...new Set(motivos)]) console.log(`      · ${m}`);
    for (const u of us.slice(0, 8)) console.log(`        ${u.comp} ${u.tipo} ${u.fecha} ${u.campo} dir=${u.dir} → ${nombreItem(u.item)}`);
    if (us.length > 8) console.log(`        … y ${us.length - 8} más`);
  }
  console.log(`\n  candidatos: ${filas.length} (existentes como destino: ${filas.filter(([n]) => E.destinos.has(idDest(n))).length})`);
}
main().catch(e => { console.error(e); process.exit(1); });
