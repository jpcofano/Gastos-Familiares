// F9.175 §4 — ¿los ítems cambiaron su matchTexto después de T? SOLO LECTURA.
import { db, iso, ms } from './simMatchF9175';
(async () => {
  for (const id of ['90b30edcc0666376321d', '94c07e7c61d119db6fb5', '1663f6a600ae1fc05e56']) {
    const x = (await db.collection('itemsEsperados').doc(id).get()).data()!;
    console.log(id, x.categoria, '›', x.subcategoria, 'creadoEn=', iso(ms(x.creadoEn)), 'actualizadoEn=', iso(ms(x.actualizadoEn)), 'matchTexto=', JSON.stringify(x.matchTexto));
  }
})();
