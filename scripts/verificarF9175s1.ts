// F9.175 §1 — el guard de F9.168 acotado a documentos de obligación. SOLO LECTURA.
//
// Corre con la reconstrucción completa de §4 (fina + destinos en su estado de T). "antes" es el guard
// de F9.168 como estaba en ffc7309; "después" son `obligacionSaldable`/`esCargoAdicional` REALES.
import { cargar, simular, contexto, etiquetaGuardada, destinosEnT, iso } from './simMatchF9175';
import { obligacionSaldable, esCargoAdicional } from '../functions/src/matchLogica';
import { Timestamp } from 'firebase-admin/firestore';

let ok = 0, fail = 0;
const chk = (r: string, c: boolean, d = '') => {
  if (c) { ok++; console.log(`  OK   ${r}${d ? ' — ' + d : ''}`); }
  else { fail++; console.log(`  FAIL ${r}${d ? ' — ' + d : ''}`); }
};

async function main() {
  const E = await cargar();
  const comp = (p: string) => E.comps.find(c => c.id.startsWith(p))!;
  const sim = (c: FirebaseFirestore.QueryDocumentSnapshot, acotado: boolean, refISO?: string) =>
    simular(E, c, { guardAcotado: acotado, fina: true, destinoEnT: destinosEnT(E, c), refISO });

  console.log('=== 1. los casos nombrados ===');
  for (const [p, mov] of [['4c8a6dbe', '7HTNXS5cwTNCdf3scIF8'], ['d37f6034', 'C7ZY6a2iPhaxaGnCF9PG']] as const) {
    const c = comp(p);
    const a = sim(c, false), d = sim(c, true);
    console.log(`  ${p} ${c.data().datosExtraidos.tipoDocumento}: guardada=${etiquetaGuardada(c.data().propuestaMatch)} | antes=${a.rama} | después=${d.rama} ${d.mov ?? ''}`);
    chk(`${p} pasa a rama 1 contra ${mov}`, d.rama === '1 destino' && d.mov === mov);
  }

  console.log('\n  segunda factura de agua — con los datos reales de las dos boletas de septiembre');
  // Las dos boletas (97e781db $23.301,99 y a2c31b98 $51.672,34) hoy las frena §2.5 por ser futuras.
  // Para probar el guard de F9.168 hay que sacarlas de §2.5: se simulan como si ya estuvieran
  // VENCIDAS (referencia 2026-12-31), que es el caso que el guard sigue cubriendo.
  for (const p of ['97e781db', 'a2c31b98']) {
    const c = comp(p);
    const d0 = sim(c, true);
    const a = sim(c, false, '2026-12-31'), d = sim(c, true, '2026-12-31');
    console.log(`  ${p} ${c.data().datosExtraidos.tipoDocumento} $${c.data().datosExtraidos.montoTotal}: real=${d0.rama} | vencida antes=${a.rama} | vencida después=${d.rama}`);
    for (const t of d.traza.filter(x => x.includes('obligaciones'))) console.log('     ' + t.trim());
    chk(`${p} sigue igual que antes con el guard acotado`, a.rama === d.rama && a.mov === d.mov);
  }
  // El escenario EXACTO de F9.168 con datos reales: la boleta de $23.301,99 entra contra Casa›Agua
  // cuando ya existe la obligación de $51.672,34 (dIPI…, nacida de a2c31b98). Se simula DESPUÉS de
  // que exista esa obligación y con las dos boletas vencidas, para que §2.5 no la ataje antes.
  {
    const c = comp('97e781db');
    const Tdipi = E.movsAll.find(m => m.id === 'dIPI1qQGvAhZUM8d8qef')!.x.creadoEn.toMillis();
    // Mismo comprobante, con el momento del trigger corrido a un instante después de que dIPI existe.
    const fijo = { ...c.data(), propuestaMatch: { ...c.data().propuestaMatch, calculadoEn: Timestamp.fromMillis(Tdipi + 1) } };
    const c2 = { id: c.id, data: () => fijo } as unknown as FirebaseFirestore.QueryDocumentSnapshot;
    const ov = { aysa: { itemEsperadoId: '94c07e7c61d119db6fb5', existia: true } };
    const a = simular(E, c2, { guardAcotado: false, fina: true, destinoEnT: ov, refISO: '2026-12-31' });
    const d = simular(E, c2, { guardAcotado: true, fina: true, destinoEnT: ov, refISO: '2026-12-31' });
    console.log(`  F9.168 real: boleta 97e781db ($23.301,99) contra Casa›Agua con dIPI ($51.672,34) viva: antes=${a.rama} | después=${d.rama}`);
    for (const t of d.traza.filter(x => x.includes('obligaciones'))) console.log('     ' + t.trim());
    chk('la segunda boleta de agua NO da por pagada la obligación de la primera (bug F9.168)', d.rama === '2+adic destino' && !d.mov);
    chk('y es exactamente lo que hacía antes', a.rama === d.rama);
  }
  // El caso exacto que abrió F9.168: la impaga nació de la PRIMERA boleta y entra la SEGUNDA.
  const oblF9168 = [{ id: 'obligacion-boleta-1', confirmadoPago: false, origenComprobanteId: 'boleta-1' }];
  chk('segunda boleta (recibo_servicio) NO salda la obligación de la primera',
      obligacionSaldable(oblF9168, 'recibo_servicio') === undefined);
  chk('segunda boleta (recibo_servicio) es cargo adicional', esCargoAdicional(oblF9168, undefined, 'recibo_servicio') === true);
  for (const t of ['factura_a', 'factura_b', 'factura_c']) {
    chk(`segunda ${t} NO salda la obligación de la primera`, obligacionSaldable(oblF9168, t) === undefined);
  }
  chk('una transferencia SÍ salda la obligación nacida de una factura',
      obligacionSaldable(oblF9168, 'transferencia')?.id === 'obligacion-boleta-1');
  chk('un comprobante_pago SÍ la salda', obligacionSaldable(oblF9168, 'comprobante_pago')?.id === 'obligacion-boleta-1');
  chk('y para el pago no es cargo adicional', esCargoAdicional(oblF9168, undefined, 'transferencia') === false);
  const pagada = [{ id: 'x', confirmadoPago: true, origenComprobanteId: 'boleta-1' }];
  chk('una obligación YA pagada no la salda nadie (pago)', obligacionSaldable(pagada, 'transferencia') === undefined);
  chk('con todo pago, un pago es cargo adicional (sin cambio)', esCargoAdicional(pagada, undefined, 'transferencia') === true);
  const sinOrigen = [{ id: 'y', confirmadoPago: false, origenComprobanteId: null }];
  chk('impaga sin origen: la salda una factura (sin cambio)', obligacionSaldable(sinOrigen, 'recibo_servicio')?.id === 'y');
  chk('impaga sin origen: la salda un pago (sin cambio)', obligacionSaldable(sinOrigen, 'transferencia')?.id === 'y');

  console.log('\n=== 2. diff de ramas sobre producción, con la reconstrucción de §4 ===');
  let n = 0, cambian = 0, malABien = 0, bienAMal = 0, dudosos = 0;
  const filas: string[] = [];
  for (const c of E.comps) {
    const pm = c.data().propuestaMatch;
    if (!c.data().datosExtraidos || !pm || pm.rama === 0) continue;
    n++;
    const a = sim(c, false), d = sim(c, true);
    if (a.rama === d.rama && a.mov === d.mov) continue;
    cambian++;
    // Desenlace real: el movimiento que hoy lleva el hashPdf del comprobante.
    const fin = E.movsAll.find(m => m.x.hashPdf === c.id);
    const desenlace = !fin ? 'sin movimiento vinculado'
      : fin.x.origenComprobanteId === c.id ? `mov NUEVO ${fin.id} (el dueño aceptó el cargo aparte)`
      : `mov PREEXISTENTE ${fin.id}`;
    const veredicto = !fin ? 'DUDOSO'
      : d.mov && fin.id === d.mov ? 'MAL→BIEN'
      : a.mov && fin.id === a.mov ? 'BIEN→MAL'
      : fin.x.origenComprobanteId === c.id && a.rama.startsWith('2') ? 'BIEN→MAL'
      : 'DUDOSO';
    if (veredicto === 'MAL→BIEN') malABien++; else if (veredicto === 'BIEN→MAL') bienAMal++; else dudosos++;
    const dt = c.data().datosExtraidos;
    filas.push(`  ${c.id.slice(0, 8)} ${dt.tipoDocumento} ${dt.fecha} $${dt.montoTotal} "${dt.destinoNombre ?? dt.comercioRazonSocial}" T=${iso(contexto(E, c).T)}\n`
      + `     guardada=${etiquetaGuardada(pm)} | antes=${a.rama}${a.mov ? ' ' + a.mov : ''} | después=${d.rama}${d.mov ? ' ' + d.mov : ''}\n`
      + `     desenlace: ${desenlace}  → ${veredicto}`);
  }
  console.log(`  evaluados=${n} cambian=${cambian}  MAL→BIEN=${malABien}  BIEN→MAL=${bienAMal}  DUDOSOS=${dudosos}`);
  console.log(filas.join('\n') || '  (ninguno)');
  chk('ningún comprobante que hoy está bien pasa a estar mal', bienAMal === 0);
  chk('ningún cambio sin veredicto', dudosos === 0);
  // Todo cambio tiene que ser de un documento que NO es obligación: el guard sólo se relajó para ellos.
  chk('ningún documento de obligación cambia de rama', filas.every(f => !/ (recibo_servicio|factura_[abc]) /.test(f.split('\n')[0])));

  console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
}
main().catch(e => { console.error(e); process.exit(1); });
