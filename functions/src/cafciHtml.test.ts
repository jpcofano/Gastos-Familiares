// F9.104 — self-test sin framework (mismo criterio que correrTests() del cliente en
// patrimonioOptimizacion.ts: no hay jest/vitest instalado en functions/, no se justifica
// sumarlo para 4 casos). Correr con: npx tsx functions/src/cafciHtml.test.ts
import { extraerItemsCartera, extraerFechaCartera, normalizarEspecie } from './cafciHtml';

let fallas = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    console.log(`OK   ${msg}`);
  } else {
    fallas++;
    console.error(`FALLO ${msg}`);
  }
}
function assertThrows(fn: () => void, contiene: string, msg: string) {
  try {
    fn();
    fallas++;
    console.error(`FALLO ${msg} (no lanzó)`);
  } catch (e) {
    const ok = e instanceof Error && e.message.toLowerCase().includes(contiene.toLowerCase());
    assert(ok, msg);
  }
}

// 1. HTML real con entidades escapadas (Galileo Acciones, fragmento verificado en producción)
const htmlOk =
  '<div id="cartera" class="divContent"><h2 id="title-composicion-cartera">Composición de Cartera</h2>' +
  '<div class="valores">Valores al 03/07/2026</div><div class="clear"></div>' +
  '<canvas data-pie-chart-items-value="[{&quot;nombre&quot;:&quot;YPF - D&quot;,&quot;porcentaje&quot;:13.4},' +
  '{&quot;nombre&quot;:&quot;Resto de Activos&quot;,&quot;porcentaje&quot;:2.4}]"></canvas></div>';
const items = extraerItemsCartera(htmlOk);
assert(items.length === 2, 'HTML con entidades escapadas: 2 items');
assert(items[0].nombre === 'YPF - D' && items[0].porcentaje === 13.4, 'HTML con entidades escapadas: decodifica &quot; y valores');
assert(extraerFechaCartera(htmlOk) === '2026-07-03', 'fecha de cartera dd/mm/yyyy → yyyy-mm-dd, acotada a #cartera');

// 2. Atributo ausente
assertThrows(() => extraerItemsCartera('<div id="cartera">sin canvas acá</div>'), 'data-pie-chart-items-value', 'atributo ausente: falla explícito');

// 3. JSON inválido dentro del atributo
assertThrows(() => extraerItemsCartera('<canvas data-pie-chart-items-value="esto no es json"></canvas>'), 'parsear', 'JSON inválido: falla explícito');

// 4. Array vacío
assertThrows(() => extraerItemsCartera('<canvas data-pie-chart-items-value="[]"></canvas>'), 'vacío', 'array vacío: falla explícito');

// Bonus: fecha ausente no explota, devuelve null (para que el caller decida fallar el fondo)
assert(extraerFechaCartera('<div id="cartera">sin fecha</div>') === null, 'fecha ausente: devuelve null sin explotar');

// Bonus: no confunde la fecha de VALORIZACIÓN del fondo (fuera de #cartera) con la de cartera
const htmlDosFechas =
  '<div id="cuotaparte"><h3>Valores al 27/07/2026</h3></div>' +
  '<div id="cartera"><div class="valores">Valores al 03/07/2026</div></div>';
assert(extraerFechaCartera(htmlDosFechas) === '2026-07-03', 'no confunde fecha de valorización con fecha de cartera');

// ── F9.122.1 §A — normalizarEspecie ────────────────────────────────────────────
// Los casos salen de la auditoría F9.122 §0 contra producción: son las 10 especies que quedaron
// sin resolver, más las que sí resolvían (que tienen que seguir resolviendo igual).
assert(normalizarEspecie('YPF - D') === 'ypf', 'sufijo de clase: "YPF - D" → "ypf"');
assert(normalizarEspecie('Grupo Fciero Galicia - B') === 'grupo fciero galicia', 'sufijo de clase con puntuación');
assert(normalizarEspecie('Ternium - A') === 'ternium', 'sufijo de clase "- A"');
assert(normalizarEspecie('Transp Gas del Norte C') === 'transp gas del norte', 'sufijo de clase sin guion');
assert(normalizarEspecie('Vista Oil & Gas') === 'vista oil gas', "'&' colapsa a espacio");
assert(normalizarEspecie('Cedear Vista Oil Gas'.replace(/^cedear\s*/i, '')) === 'vista oil gas', 'CEDEAR sin prefijo → subyacente');
assert(normalizarEspecie('Pampa Energía S.A.') === 'pampa energia', 'acentos + razón social');
assert(normalizarEspecie('Grupo Supervielle CB') === 'grupo supervielle cb', 'sufijo de DOS letras NO se toca');
assert(normalizarEspecie('Lecap S31G6') === 'lecap s31g6', 'código alfanumérico no es sufijo de clase');
assert(normalizarEspecie('Aluar') === 'aluar', 'nombre simple: sin cambios');
assert(normalizarEspecie('  BYMA  ') === 'byma', 'trim + minúsculas');
// Idempotencia: normalizar una clave ya normalizada tiene que devolverla igual, si no el seed
// escribe una clave y la relectura busca otra.
for (const s of ['YPF - D', 'Pampa Energía S.A.', 'Vista Oil & Gas', 'Grupo Supervielle CB']) {
  const una = normalizarEspecie(s);
  assert(normalizarEspecie(una) === una, `idempotente sobre "${s}" → "${una}"`);
}

if (fallas > 0) {
  console.error(`\n${fallas} test(s) fallaron.`);
  process.exit(1);
}
console.log('\nTodos los tests de cafciHtml pasaron.');
