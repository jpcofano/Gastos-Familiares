// F9.175 §4 — la brecha de fidelidad. SOLO LECTURA.
//
// Tres medidas:
//   · estricta:        simulación cruda (estado de destinos/payees de HOY) == etiqueta guardada
//   · fina:            con la reconstrucción de §4 (destinos nacidos después de T fuera; destino* del
//                      movimiento vinculado restaurados a los de su comprobante de origen)
//   · comportamiento:  fina, comparando lo que ve el usuario — rama, ítem, movimiento y esAdicional —
//                      y no el camino interno (texto vs destino dan la misma rama 2 al mismo ítem).
//
// Cada discrepancia de la estricta se imprime con su causa, verificada en verificarF9175s4b/s4c.
import { cargar, simular, contexto, etiquetaGuardada, iso, destinosEnT, type Resultado } from './simMatchF9175';

const CAUSAS: Record<string, string> = {
  d37f6034: 'CÓDIGO: procesado 14/8, antes del guard de F9.168 (0cbcf0d, 7/9)',
  fd015e17: 'DESTINO REAPUNTADO (CUIT 30572975831 → Internet en T; a Gas el 15/9) + CÓDIGO: procesado 6/8, antes del guard de F9.168',
  '02a163ac': 'DESTINO OSCILANTE "aysa" (F9.154): en T apuntaba a Casa›Agua, hoy a Auto›Agua',
  a2c31b98: 'DESTINO OSCILANTE "aysa" (F9.154): en T apuntaba a Casa›Agua, hoy a Auto›Agua',
  '115564b3': 'DESTINO OSCILANTE "aysa" (F9.154): hoy coincide con el guardado por casualidad del último vaivén',
  '97e781db': 'DESTINO OSCILANTE "aysa" (F9.154)',
  '13c1b187': 'DESTINO REAPUNTADO: CUIT 30572975831 → Internet hasta el 15/9 19:54:40',
  '249624a1': 'DESTINO OSCILANTE + CREADO A MANO: "aysa" (callable, sin rastro en movimientos) → Casa›Agua; el pase débil casaba por ítem aprendido',
  c82eb6ab: 'DESTINO OSCILANTE "aysa" → Casa›Agua en T; el pase débil casaba por ítem aprendido',
  '059e7006': 'PAYEE ESCRITO POR SU PROPIA VINCULACIÓN: el origen (ee4f3d3a) no trae ese CUIT',
  a07760b9: 'PAYEE ESCRITO POR SU PROPIA VINCULACIÓN: el origen (8f059f3c) no trae CUIT',
  a9da4f68: 'PAYEE ESCRITO POR SU PROPIA VINCULACIÓN: el origen (436090c0) no trae CUIT',
  '3a8d38d5': 'ÍTEM EDITADO: Internet recibió excluye "diego armando vega valdez" el 31/7 00:24:48 (T 31/7 00:16)',
  '3b089c12': 'ÍTEM EDITADO: Internet recibió excluye "bodegon el globito srl" el 31/7 00:24:48 (T 30/7 20:11)',
  '37c98cbf': 'ÍTEM EDITADO (Casa›Agua, 30/7) + DESTINO NACIDO DESPUÉS DE T',
  '801705dd': 'ÍTEM EDITADO (los dos Agua, 30/7: hoy matchean ambos) + "aysa" todavía no existía (T 3/7 04:39)',
};
const causaPorDefecto = 'DESTINO NACIDO DESPUÉS DE T: la propuesta guardada no tiene origenDestino (el destino no aportó) y el destino se actualizó después de T';

const comportamiento = (r: Resultado) => {
  const n = r.rama.split(' ')[0];
  return `${n.replace(/\(.*/, '')}|${r.item ?? ''}|${r.mov ?? ''}`;
};
const comportamientoGuardado = (pm: FirebaseFirestore.DocumentData) => {
  const n = pm.rama === 2 && pm.esAdicional ? '2+adic' : String(pm.rama);
  const item = pm.rama === 3 || (pm.rama === 1 && !pm.movimientoId) ? '' : (pm.itemEsperadoId ?? '');
  const mov = pm.rama === 1 && pm.movimientoId ? pm.movimientoId : '';
  return `${n}|${item}|${mov}`;
};

async function main() {
  const E = await cargar();
  let n = 0, ok = 0, okF = 0, okC = 0, okR = 0;
  const restoR: string[] = [];
  const difs: string[] = [];
  const restoC: string[] = [];
  for (const c of E.comps) {
    const pm = c.data().propuestaMatch;
    if (!c.data().datosExtraidos || !pm || pm.rama === 0) continue;
    n++;
    const g = etiquetaGuardada(pm);
    const a = simular(E, c, { guardAcotado: false });
    const f = simular(E, c, { guardAcotado: false, fina: true });
    if (a.rama === g) ok++;
    if (f.rama === g) okF++;
    // Para rama 1 payee/débil sin movimientoId (candidatos), el comportamiento es la etiqueta.
    const cg = comportamientoGuardado(pm), cf = comportamiento(f);
    const igualC = cg === cf || (pm.rama === 1 && !pm.movimientoId && f.rama === g);
    const r = simular(E, c, { guardAcotado: false, fina: true, destinoEnT: destinosEnT(E, c) });
    const cr = comportamiento(r);
    if (cr === cg || (pm.rama === 1 && !pm.movimientoId && r.rama === g)) okR++;
    else restoR.push([
      `  ${c.id.slice(0, 8)} guardado=${cg} sim=${cr}  → ${CAUSAS[c.id.slice(0, 8)] ?? causaPorDefecto}`,
      ...r.traza.map(t => '       ' + t),
    ].join('\n'));
    if (igualC) okC++;
    else restoC.push([
      `  ${c.id.slice(0, 8)} ${c.data().datosExtraidos.tipoDocumento} "${c.data().datosExtraidos.destinoNombre ?? c.data().datosExtraidos.comercioRazonSocial}" guardado=${cg} fina=${cf}  T=${iso(contexto(E, c).T)}`,
      `     causa: ${CAUSAS[c.id.slice(0, 8)] ?? causaPorDefecto}`,
      `     pm=${JSON.stringify({ ...pm, calculadoEn: undefined })}`,
      ...f.traza.map(t => '       ' + t),
    ].join('\n'));
    if (a.rama === g) continue;
    const { datos, T } = contexto(E, c);
    const k = c.id.slice(0, 8);
    difs.push([
      `■ ${k} ${datos.tipoDocumento} fecha=${datos.fecha} $${datos.montoTotal} "${datos.destinoNombre ?? datos.comercioRazonSocial}"  T=${iso(T)}`,
      `  guardada=${g} | cruda=${a.rama} | fina=${f.rama}`,
      `  causa: ${CAUSAS[k] ?? causaPorDefecto}`,
      ...f.traza.map(t => '    ' + t),
    ].join('\n'));
  }
  console.log(`F9.175 §4 — evaluados=${n}`);
  console.log(`  fidelidad estricta        ${ok}/${n}`);
  console.log(`  fidelidad fina            ${okF}/${n}`);
  console.log(`  fidelidad comportamiento  ${okC}/${n}`);
  console.log(`  comportamiento + destinos reapuntados en su estado de T  ${okR}/${n}\n`);
  console.log(`Lo que queda con TODA la reconstrucción (${restoR.length}):`);
  console.log(restoR.join('\n') || '  (nada)');
  console.log('');
  console.log(`Diferencias de COMPORTAMIENTO que quedan con la reconstrucción fina (${restoC.length}):`);
  console.log(restoC.join('\n') || '  (ninguna)');
  console.log(`\nLas ${n - ok} discrepancias estrictas, con causa:\n`);
  console.log(difs.join('\n\n'));
}
main().catch(e => { console.error(e); process.exit(1); });
