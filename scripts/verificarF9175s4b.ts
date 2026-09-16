// F9.175 §4 — verificación de las causas propuestas para los casos que no son "destino nació después".
// SOLO LECTURA.
import { cargar, contexto, iso, ms } from './simMatchF9175';
import { evaluarMatchTexto, reconciliarPorPayee, type MatchTexto } from '../functions/src/matchLogica';

// evaluarMatchTexto ANTES de F9.111 (git show 583fff9^:functions/src/matchLogica.ts:122)
const evaluarViejo = (texto: string, mt: MatchTexto) => {
  const t = texto.toLowerCase();
  return mt.incluye.some(p => t.includes(p.trim().toLowerCase())) && !mt.excluye.some(p => t.includes(p.trim().toLowerCase()));
};

async function main() {
  const E = await cargar();
  const comp = (pref: string) => E.comps.find(c => c.id.startsWith(pref))!;

  console.log('── A) matchTexto: evaluación vieja (includes) vs actual (límite de palabra)');
  for (const pref of ['3a8d38d5', '3b089c12', '37c98cbf', '801705dd']) {
    const d = comp(pref).data().datosExtraidos;
    const texto = [d.comercioRazonSocial, d.destinoNombre].filter((t: unknown) => typeof t === 'string' && t.trim()).join(' ').toLowerCase();
    const viejos = E.items.filter(i => i.activo && i.moneda === d.moneda && i.matchTexto?.incluye.length && evaluarViejo(texto, i.matchTexto));
    const nuevos = E.items.filter(i => i.activo && i.moneda === d.moneda && i.matchTexto?.incluye.length && evaluarMatchTexto(texto, i.matchTexto!));
    console.log(`  ${pref} "${texto}"  guardado=${comp(pref).data().propuestaMatch.itemEsperadoId}`);
    console.log(`     viejo → [${viejos.map(i => `${i.id} ${i.categoria}›${i.subcategoria} incluye=${JSON.stringify(i.matchTexto!.incluye)}`).join(' | ')}]`);
    console.log(`     actual→ [${nuevos.map(i => `${i.id} ${i.categoria}›${i.subcategoria}`).join(' | ')}]`);
  }
  for (const id of ['94c07e7c61d119db6fb5', '1663f6a600ae1fc05e56']) {
    const i = E.items.find(x => x.id === id);
    console.log(`  ítem ${id}: ${i ? `${i.categoria}›${i.subcategoria} notas=${i.notas} matchTexto=${JSON.stringify(i.matchTexto)} claves=${JSON.stringify(i.clavesDesambiguacion)}` : '(no activo / no existe)'}`);
  }

  console.log('\n── B) payee de la obligación: ¿lo escribió la vinculación de ESTE comprobante?');
  for (const pref of ['059e7006', 'a07760b9', 'a9da4f68']) {
    const c = comp(pref);
    const ctx = contexto(E, c);
    const r = reconciliarPorPayee(ctx.datos, ctx.movs);
    for (const m of r) {
      const x = E.movsAll.find(y => y.id === m.id)!.x;
      const orig = x.origenComprobanteId ? E.comps.find(k => k.id === x.origenComprobanteId)?.data().datosExtraidos : null;
      console.log(`  ${pref} → mov ${m.id} hashPdf=${String(x.hashPdf).slice(0, 8)} (¿este? ${x.hashPdf === c.id}) creadoEn=${iso(ms(x.creadoEn))} origen=${String(x.origenComprobanteId).slice(0, 8)}`);
      console.log(`     mov hoy:     cuit=${x.destinoCuit} cbu=${x.destinoCbu} alias=${x.destinoAlias} nombre=${x.destinoNombre}`);
      console.log(`     pago:        cuit=${ctx.datos.destinoCuit} cbu=${ctx.datos.destinoCbu} alias=${ctx.datos.destinoAlias} contraparteCuit=${ctx.datos.contraparteCuit ?? '(ausente)'}`);
      console.log(`     comp origen: ${orig ? `cuit=${orig.destinoCuit} cbu=${orig.destinoCbu} alias=${orig.destinoAlias} nombre=${orig.destinoNombre}` : '(sin comprobante de origen)'}`);
    }
  }

  console.log('\n── C) fd015e17: el destino CUIT 30572975831 apuntaba a 90b30 (Internet) en T');
  {
    const c = comp('fd015e17');
    const ctx = contexto(E, c);
    const obl = ctx.movs.filter(m => m.itemEsperadoId === '90b30edcc0666376321d' && m.mes === '2026-08');
    console.log(`  T=${iso(ctx.T)} destinoCuit del pago=${ctx.datos.destinoCuit} nombre=${ctx.datos.destinoNombre}`);
    for (const m of obl) console.log(`  obligación 90b30/2026-08: ${m.id} ${m.descripcion} $${m.monto} conf=${m.confirmadoPago} origen=${m.origenComprobanteId}`);
    const usan = E.comps.filter(k => k.data().datosExtraidos?.destinoCuit === '30572975831' || k.data().datosExtraidos?.contraparteCuit === '30572975831');
    for (const k of usan) {
      const d = k.data().datosExtraidos;
      console.log(`  comp con CUIT 30572975831: ${k.id.slice(0, 8)} ${d.tipoDocumento} ${d.fecha} "${d.destinoNombre ?? d.comercioRazonSocial}" item=${k.data().propuestaMatch?.itemEsperadoId}`);
    }
  }
}
main().catch(e => { console.error(e); process.exit(1); });
