// F9.176 §4 — ¿qué pasa con los pagos de Monotributo si el CUIL del dueño se marca 'propio'? SOLO LECTURA.
import { cargar, simular, destinosEnT, idDest } from './simMatchF9175';
(async () => {
  const E = await cargar();
  for (const n of ['arca', 'afip - monotributo']) console.log(`destino "${n}":`, JSON.stringify(E.destinos.get(idDest(n)) ?? null, (k, v) => (k === 'actualizadoEn' ? undefined : v)));
  const hoy: Record<string, { existia: true; rol?: string }> = {};
  for (const d of E.destinos.values()) hoy[d.destinoNorm] = { existia: true };
  for (const p of ['a9da4f68', '4b9601b9']) {
    const c = E.comps.find(k => k.id.startsWith(p))!;
    const d = c.data().datosExtraidos;
    const a = simular(E, c, { guardAcotado: true, fina: true, destinoEnT: hoy });
    const b = simular(E, c, { guardAcotado: true, fina: true, destinoEnT: { ...hoy, '20243359679': { existia: true, rol: 'propio' } } });
    console.log(`${p} nombre="${d.destinoNombre}" razon="${d.comercioRazonSocial}": sin rol=${a.rama} ${a.item ?? ''} ${a.mov ?? ''} | propio=${b.rama} ${b.item ?? ''} ${b.mov ?? ''}`);
    for (const t of b.traza) console.log('    ' + t);
  }
})();
