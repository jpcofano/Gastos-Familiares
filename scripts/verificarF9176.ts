// F9.176 — verificación del rol del destino. SOLO LECTURA: los roles se simulan, no se escriben.
//
// Usa las funciones REALES de functions/src/matchLogica.ts (destinoResuelve, destinoSeAprende,
// elegirLlaveAprendible) y de src/datos/destinos.ts (clasificacionParaRol), y el simulador de
// F9.175 con la reconstrucción de §4, que ahora respeta el rol igual que matchPorDestino.
import * as fs from 'node:fs';
import { cargar, simular, destinosEnT, contexto, idDest } from './simMatchF9175';
import { destinoResuelve, destinoSeAprende, elegirLlaveAprendible, normalizarDestino, ROLES_DESTINO, rolSinClasificacion as SERVIDOR_rolSinClasificacion } from '../functions/src/matchLogica';
import * as CLIENTE from '../src/datos/destinoRol';

let ok = 0, fail = 0;
const chk = (r: string, c: boolean, d = '') => {
  if (c) { ok++; console.log(`  OK   ${r}${d ? ' — ' + d : ''}`); }
  else { fail++; console.log(`  FAIL ${r}${d ? ' — ' + d : ''}`); }
};
const PERSONAL_PAY = '30572975831';

async function main() {
  const E = await cargar();
  const comp = (p: string) => E.comps.find(c => c.id.startsWith(p))!;
  const nombreItem = (id?: string) => {
    const i = id ? E.items.find(x => x.id === id) : undefined;
    return i ? `${i.categoria}›${i.subcategoria}` : (id ?? '-');
  };
  const base = (c: FirebaseFirestore.QueryDocumentSnapshot) => ({ guardAcotado: true, fina: true, destinoEnT: destinosEnT(E, c) });
  // Superpone roles al estado de T de cada comprobante.
  const conRoles = (c: FirebaseFirestore.QueryDocumentSnapshot, roles: Record<string, string>) => {
    const ov = { ...destinosEnT(E, c) } as Record<string, { rol?: string; itemEsperadoId?: string; existia?: boolean; noExistia?: boolean }>;
    for (const [norm, rol] of Object.entries(roles)) ov[norm] = { ...(ov[norm] ?? {}), rol };
    return { ...base(c), destinoEnT: ov };
  };

  console.log('=== 1. sin roles, todo resuelve igual que hoy ===');
  const conRol = [...E.destinos.values()].filter(d => d.rol !== undefined);
  console.log(`  destinos en producción con rol: ${conRol.length} de ${E.destinos.size}`);
  chk('ningún destino de producción tiene rol todavía', conRol.length === 0);
  for (const dir of [undefined, null, 'entrante', 'saliente']) {
    chk(`sin rol resuelve (dir=${String(dir)})`, destinoResuelve(undefined, dir) === true);
    chk(`rol 'comercio' resuelve (dir=${String(dir)})`, destinoResuelve('comercio', dir) === true);
  }
  for (const t of [undefined, null, 'Gasto', 'Ingreso']) chk(`sin rol se aprende (mov=${String(t)})`, destinoSeAprende(undefined, t) === true);
  chk('un rol desconocido se comporta como sin rol', destinoResuelve('otra-cosa', 'saliente') && destinoSeAprende('otra-cosa', 'Gasto'));

  // Simulación: código actual (respeta rol) vs el mismo con TODOS los destinos marcados 'comercio'.
  let n = 0, iguales = 0;
  for (const c of E.comps) {
    const pm = c.data().propuestaMatch;
    if (!c.data().datosExtraidos || !pm || pm.rama === 0) continue;
    n++;
    const a = simular(E, c, base(c));
    const todos: Record<string, string> = {};
    for (const d of E.destinos.values()) todos[d.destinoNorm] = 'comercio';
    const b = simular(E, c, conRoles(c, todos));
    if (a.rama === b.rama && a.mov === b.mov && a.item === b.item) iguales++;
    else console.log(`  CAMBIA ${c.id.slice(0, 8)} ${a.rama}/${a.item} → ${b.rama}/${b.item}`);
  }
  chk(`sin roles (o todo 'comercio') cero comprobantes cambian de rama, ítem o movimiento`, iguales === n, `${iguales}/${n}`);
  // Y contra lo que F9.175 dejó verificado: la salida commiteada de §1 tiene que seguir igual.
  const s1 = fs.readFileSync('docs/F9.175-s1-verificacion.txt', 'utf8');
  chk('la verificación commiteada de F9.175 §1 sigue en 21/0', s1.includes('TODO OK — 21 ok, 0 fail'));

  // aprenderDestino: sin roles, la llave elegida es exactamente `cbu ?? cuit ?? alias ?? nombre`.
  let movs = 0, igualesLlave = 0;
  for (const { x } of E.movsAll) {
    const llaves = [x.destinoCbu, x.destinoCuit, x.destinoAlias, x.destinoNombre];
    if (llaves.every(l => l == null)) continue;
    movs++;
    const raw = x.destinoCbu ?? x.destinoCuit ?? x.destinoAlias ?? x.destinoNombre;
    const viejo = raw ? normalizarDestino(raw) : null;
    const nuevo = elegirLlaveAprendible(llaves, norm => E.destinos.get(idDest(norm))?.rol, x.tipo);
    if (JSON.stringify(viejo) === JSON.stringify(nuevo)) igualesLlave++;
    else console.log(`  LLAVE DISTINTA ${JSON.stringify(llaves)} viejo=${JSON.stringify(viejo)} nuevo=${JSON.stringify(nuevo)}`);
  }
  chk('aprenderDestino elige la misma llave que antes en todos los movimientos con payee', igualesLlave === movs, `${igualesLlave}/${movs}`);
  chk('llave vacía primero sigue cortando', elegirLlaveAprendible(['', '30572975831'], () => undefined, 'Gasto') === null);

  console.log('\n=== 2 y 3. Personal Pay como medio_pago ===');
  const PP = { [PERSONAL_PAY]: 'medio_pago' };
  for (const p of ['13c1b187', '059e7006', 'a07760b9', 'fd015e17']) {
    const c = comp(p);
    const a = simular(E, c, base(c));
    const b = simular(E, c, conRoles(c, PP));
    const d = contexto(E, c).datos;
    console.log(`  ${p} "${d.destinoNombre}" numeroCliente=${d.numeroCliente}: sin rol=${a.rama} ${nombreItem(a.item)} | medio_pago=${b.rama} ${nombreItem(b.item)}`);
    for (const t of b.traza.filter(x => /destino|rol=|obligaciones/.test(x))) console.log('       ' + t.trim());
  }
  const m0 = simular(E, comp('13c1b187'), base(comp('13c1b187')));
  const m1 = simular(E, comp('13c1b187'), conRoles(comp('13c1b187'), PP));
  chk('sin rol, el pago de Metrogas resuelve a Casa›Internet (el bug)', nombreItem(m0.item) === 'Casa›Internet');
  chk('con medio_pago deja de resolver a Casa›Internet', nombreItem(m1.item) !== 'Casa›Internet');
  chk('y encuentra Metrogas (Casa›Gas) por la siguiente llave', nombreItem(m1.item) === 'Casa›Gas', m1.rama);
  chk('lo encontró por destinoNombre, no por el CUIT', m1.traza.some(t => /destino "Metrogas"/.test(t)) && m1.traza.some(t => /rol=medio_pago no resuelve/.test(t)));
  for (const p of ['059e7006', 'a07760b9']) {
    const c = comp(p);
    const a = simular(E, c, base(c)), b = simular(E, c, conRoles(c, PP));
    chk(`${p} (Personal) resuelve igual con Personal Pay como medio_pago`, a.rama === b.rama && a.mov === b.mov && a.item === b.item, `${b.rama} ${nombreItem(b.item)}`);
  }
  // fd015e17 (6/8) corrió cuando el alias "personal" todavía NO existía (nació el 3/9): con el CUIT
  // como medio_pago no le quedaba ninguna llave y caía a texto. Con el alias como está hoy, resuelve
  // igual. Es el costo real del rol: un medio de pago sólo se puede declarar cuando la contraparte
  // ya tiene otra llave aprendida.
  {
    const c = comp('fd015e17');
    const a = simular(E, c, base(c));
    const enT = simular(E, c, conRoles(c, PP));
    const ov = { ...conRoles(c, PP).destinoEnT, personal: { existia: true } };
    const hoy = simular(E, c, { ...base(c), destinoEnT: ov });
    console.log(`  fd015e17: sin rol=${a.rama} ${a.mov ?? ''} | medio_pago con los destinos de T=${enT.rama} | medio_pago con el alias "personal" de hoy=${hoy.rama} ${hoy.mov ?? ''}`);
    chk('fd015e17 con medio_pago y el alias "personal" existente salda la misma obligación', hoy.rama === a.rama && hoy.mov === a.mov);
    chk('fd015e17 con medio_pago y SIN el alias pierde la reconciliación (costo del rol, documentado)', enT.rama !== a.rama);
  }
  console.log('  alcance (volcado de §2 en docs/F9.176-auditoria.txt): 4 comprobantes con ese CUIT, los 4 con numeroCliente y destinoNombre útiles, 0 sin contraparte.');

  // Qué cambia en los 166 con ese único rol puesto, en dos escenarios:
  //   · destinos de T:   cada comprobante contra los destinos que existían cuando se procesó;
  //   · destinos de hoy: los mismos comprobantes, con los movimientos de T pero TODOS los destinos
  //                      como están hoy — es lo que pasaría si esos pagos llegaran mañana.
  const hoy: Record<string, { existia: true }> = {};
  for (const d of E.destinos.values()) hoy[d.destinoNorm] = { existia: true };
  for (const modo of ['destinos de T', 'destinos de hoy'] as const) {
    let cambios = 0, haciaElDueno = 0;
    const lejos: string[] = [];
    for (const c of E.comps) {
      const pm = c.data().propuestaMatch;
      if (!c.data().datosExtraidos || !pm || pm.rama === 0) continue;
      const opA = modo === 'destinos de T' ? base(c) : { guardAcotado: true, fina: true, destinoEnT: hoy };
      const opB = modo === 'destinos de T'
        ? conRoles(c, PP)
        : { guardAcotado: true, fina: true, destinoEnT: { ...hoy, [PERSONAL_PAY]: { existia: true as const, rol: 'medio_pago' } } };
      const a = simular(E, c, opA), b = simular(E, c, opB);
      if (a.rama === b.rama && a.mov === b.mov && a.item === b.item) continue;
      cambios++;
      const fin = E.movsAll.find(m => m.x.hashPdf === c.id);
      const itemDueno = fin?.x.itemEsperadoId as string | undefined;
      const movDueno = fin && fin.x.origenComprobanteId !== c.id ? fin.id : undefined;
      // "hacia el dueño": el ítem nuevo es el que eligió, y si él saldó una obligación, la salda.
      const mejora = b.item === itemDueno && (!movDueno || b.mov === movDueno);
      if (mejora) haciaElDueno++; else lejos.push(c.id.slice(0, 8));
      console.log(`  [${modo}] cambia ${c.id.slice(0, 8)}: ${a.rama} ${nombreItem(a.item)} ${a.mov ?? ''} → ${b.rama} ${nombreItem(b.item)} ${b.mov ?? ''} | dueño: ${nombreItem(itemDueno)} ${movDueno ?? ''} → ${mejora ? 'MEJORA' : 'EMPEORA'}`);
    }
    console.log(`  [${modo}] cambian ${cambios}: mejoran ${haciaElDueno}, empeoran ${lejos.length} [${lejos.join(', ')}]`);
    if (modo === 'destinos de hoy') chk('con los destinos de hoy, todo cambio va hacia lo que decidió el dueño', lejos.length === 0);
    else chk('con los destinos de T, lo único que empeora es fd015e17 (el alias "personal" no existía)', JSON.stringify(lejos) === JSON.stringify(['fd015e17']), `[${lejos.join(', ')}]`);
  }

  // aprenderDestino con el rol: el movimiento de Metrogas enseña "metrogas", no el CUIT.
  const llavesMetrogas = [null, PERSONAL_PAY, null, 'Metrogas'];
  const elegida = elegirLlaveAprendible(llavesMetrogas, norm => (norm === PERSONAL_PAY ? 'medio_pago' : undefined), 'Gasto');
  chk('aprenderDestino saltea el CUIT de Personal Pay y aprende "metrogas"', elegida?.norm === 'metrogas', JSON.stringify(elegida));
  chk('si todas las llaves son medio_pago/propio no aprende nada',
      elegirLlaveAprendible([null, PERSONAL_PAY, null, null], () => 'medio_pago', 'Gasto') === null);

  console.log('\n=== resto de los roles ===');
  chk("'propio' nunca resuelve", !destinoResuelve('propio', 'entrante') && !destinoResuelve('propio', null));
  chk("'propio' nunca se aprende", !destinoSeAprende('propio', 'Ingreso') && !destinoSeAprende('propio', 'Gasto'));
  chk("'pagador' no resuelve un documento saliente", !destinoResuelve('pagador', 'saliente'));
  chk("'pagador' resuelve entrante y sin dirección (Accenture)", destinoResuelve('pagador', 'entrante') && destinoResuelve('pagador', null) && destinoResuelve('pagador', undefined));
  chk("'pagador' se aprende de un Ingreso y no de un Gasto", destinoSeAprende('pagador', 'Ingreso') && !destinoSeAprende('pagador', 'Gasto'));
  // Accenture con 'pagador': sus 3 comprobantes sin dirección no cambian.
  const accenture = normalizarDestino('ACCENTURE SRL')!.norm;
  for (const p of ['28cab4a0', '32acfa99', '8acd1c73']) {
    const c = comp(p);
    const a = simular(E, c, base(c)), b = simular(E, c, conRoles(c, { [accenture]: 'pagador' }));
    chk(`${p} (Accenture, sin dirección) igual con 'pagador'`, a.rama === b.rama && a.item === b.item, `${b.rama} ${nombreItem(b.item)}`);
  }
  chk('los roles del cliente y del servidor son los mismos',
      JSON.stringify([...ROLES_DESTINO]) === JSON.stringify(CLIENTE.ROLES_DESTINO.map(r => r.valor)));

  console.log('\n=== 4. el formulario (src/datos/destinoRol.ts, lo que usa Destinos.tsx) ===');
  const cargado = { item: '90b30edcc0666376321d', categoria: 'Casa', subcategoria: 'Internet', etiqueta: 'x' };
  for (const rol of ['medio_pago', 'propio'] as const) {
    const f = CLIENTE.clasificacionParaRol(rol, cargado);
    chk(`con '${rol}' ítem, categoría, subcategoría y etiqueta quedan vacíos`, !f.item && !f.categoria && !f.subcategoria && !f.etiqueta, JSON.stringify(f));
    chk(`con '${rol}' los campos se deshabilitan`, CLIENTE.rolSinClasificacion(rol));
  }
  for (const rol of ['', 'comercio', 'pagador'] as const) {
    chk(`con '${rol || 'sin rol'}' la clasificación queda como estaba y los campos habilitados`,
        JSON.stringify(CLIENTE.clasificacionParaRol(rol, cargado)) === JSON.stringify(cargado) && !CLIENTE.rolSinClasificacion(rol));
  }
  // Los dos lados coinciden en qué roles no llevan clasificación.
  for (const rol of ROLES_DESTINO) chk(`rolSinClasificacion gemela para '${rol}'`, CLIENTE.rolSinClasificacion(rol) === SERVIDOR_rolSinClasificacion(rol));
  // Y el formulario usa exactamente esto: lo verifica el fuente.
  const vista = fs.readFileSync('src/vistas/perfil/Destinos.tsx', 'utf8');
  chk('Destinos.tsx limpia con clasificacionParaRol al cambiar el rol y al guardar', (vista.match(/clasificacionParaRol\(/g) ?? []).length >= 2);
  chk('Destinos.tsx deshabilita ítem, categoría, subcategoría y etiqueta', (vista.match(/disabled=\{sinClasificacion/g) ?? []).length === 4);

  console.log(`\n${fail === 0 ? 'TODO OK' : 'HAY FALLAS'} — ${ok} ok, ${fail} fail`);
}
main().catch(e => { console.error(e); process.exit(1); });
