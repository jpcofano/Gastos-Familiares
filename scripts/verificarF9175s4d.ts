// F9.175 §4 — las boletas de AySA que se guardaron en Auto›Agua sin destino. SOLO LECTURA.
import { cargar, contexto, iso, ms, idDest } from './simMatchF9175';
(async () => {
  const E = await cargar();
  for (const n of ['aysa']) console.log('destino', n, JSON.stringify(E.destinos.get(idDest(n)), (k, v) => (v && v._seconds != null ? iso(v._seconds * 1000) : v)));
  for (const pref of ['115564b3', '97e781db', '02a163ac', 'a2c31b98', '801705dd', '249624a1', 'c82eb6ab']) {
    const c = E.comps.find(k => k.id.startsWith(pref))!;
    const d = c.data().datosExtraidos;
    const pm = c.data().propuestaMatch;
    console.log(`${pref} T=${iso(contexto(E, c).T)} ${d.tipoDocumento} nombre="${d.destinoNombre}" razon="${d.comercioRazonSocial}" cuit=${d.destinoCuit} numeroCliente=${d.numeroCliente} venc=${JSON.stringify(d.vencimientos)} pm.item=${pm.itemEsperadoId} origenDestino=${pm.origenDestino ?? '-'} reasignadoAMano=${pm.reasignadoAMano ?? '-'} cand=${pm.candidatos?.length ?? 0}`);
  }
})();
