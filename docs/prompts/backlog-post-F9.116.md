# Backlog — pendientes post F9.116

> Auditado sobre `origin/main` en `82e2233`. Números propuestos: F9.117 a F9.120.
> Nada de esto está especificado todavía; es la triage con la causa raíz ya localizada.

---

## F9.117 — El aviso de TC aparece mientras todavía está cargando

**Síntoma:** el mensaje "no se pudo leer el de hoy" aparece siempre al entrar, aunque el TC exista y termine apareciendo un segundo después.

**Causa raíz (auditada):** `tcEfectivoDe(tcHoy: number | null)` en `src/datos/tcDiario.ts:106` tiene solo dos estados. `null` significa a la vez "todavía no cargó" y "no hay TC", y en ambos casos devuelve un aviso:

```ts
if (tcHoy) return { tc: tcHoy, aviso: null };
const cache = leerTcCache();
if (cache) return { tc: cache.tc, aviso: `TC del ${cache.fecha} — no se pudo leer el de hoy.` };
```

Como `Resumen.tsx:1004` y `Dashboard.tsx:741` llaman a esa función en cada render y el fetch es asincrónico, durante la ventana de carga el banner afirma algo falso. Peor: `Resumen.tsx:1000-1001` setea `null` tanto cuando la consulta resuelve vacía como cuando tira error, así que el mensaje tampoco distingue esos dos casos.

**Alcance:** tercer estado (`cargando`), aviso suprimido mientras carga, y mensajes distintos para "resolvió vacío" y "falló la consulta" — con el error real logueado, no un texto hardcodeado.

**Tamaño:** chico. Un módulo puro y dos vistas.

---

## F9.118 — Mes de imputación editable, para gastos e ingresos

**Síntomas (dos, misma causa):**
- Ingresos cargados con fecha de julio se imputaron a julio, cuando corresponden a agosto.
- Al editar un gasto no se puede cambiar si entra o no en el resumen del mes, ni mandarlo al mes siguiente. Los pagos de agosto entran el 29/30 y necesitan caer en el mes que corresponde.

**Causa raíz (auditada):** F9.106 resolvió exactamente este problema, pero **solo para obligaciones**. En `functions/src/index.ts:307`:

```ts
const mesComp = esObligacionDoc(datos.tipoDocumento) ? mesDePago(datos) : (datos.fecha ? datos.fecha.slice(0, 7) : '');
```

Todo lo que no es `factura*`/`recibo_servicio` —ingresos incluidos— cae en la rama `else` y se imputa por **fecha de emisión**. Es el mismo bug que F9.106, en el conjunto que F9.106 dejó afuera.

Del lado de la edición, `EditarMovimiento.tsx` permite cambiar tipo (`:167`) pero no tiene ningún control de mes de imputación.

**Alcance:** campo de override explícito en el movimiento (por ejemplo `mesImputacion`), respetado por los agregados por encima del derivado de la fecha; control en `EditarMovimiento`; y extender la regla de mes de pago a ingresos. Ojo con la constante `MES_CORTE_SEMANTICA_PAGOS` — cualquier regla nueva va hacia adelante, no reescribe el pasado.

**Tamaño:** mediano. Toca functions, agregados y dos vistas. Es el más importante de los cuatro: hoy los números del mes pueden estar mal.

---

## F9.119 — Ingresos esperados

**Pedido:** que los ingresos aparezcan junto a los gastos esperados para poder asignarlos y que el sistema aprenda.

**Hallazgo que achica el trabajo:** el modelo **ya lo soporta**. `ExpectedItem.tipo` es `'Gasto' | 'Ingreso'` (`src/types/index.ts:118`) y `docAItemEsperado` (`src/datos/itemsEsperados.ts:8`) lo lee sin discriminar. Lo que falta es la UI en Perfil para crear un esperado de tipo Ingreso, y que el pipeline de matcheo los considere al asignar.

No hay que migrar datos ni cambiar tipos: es UI y matcheo.

**Tamaño:** chico-mediano. Depende de F9.118 para que la imputación del ingreso asignado caiga en el mes correcto.

---

## F9.120 — Modo privacidad: solo porcentajes

**Pedido:** un toggle al lado del de ARS/USD que tape los valores absolutos y muestre solo porcentajes, en la vista y también en el informe.

**Decisiones de diseño a tomar antes de especificar:**

1. **Base del porcentaje.** No es una sola: en Resumen lo natural es % del ingreso del mes; en Patrimonio, % de la cartera. Conviene definir la base por pantalla y mostrarla en el encabezado, para que un 43% no quede huérfano.
2. **Qué pasa con los conteos.** "15 sin pagar · $2.365.058" — el monto se porcentualiza, el 15 se mantiene.
3. **Persistencia.** Si el modo sobrevive al refresh (localStorage) o arranca apagado siempre. Para un modo pensado para mostrarle la pantalla a alguien, arrancar apagado y no persistir es más seguro.
4. **Informe PDF.** Si el toggle genera una variante del informe o si es una opción al generarlo. Como el PDF queda archivado en Storage, conviene que sea una opción explícita en la generación y que el archivo diga cuál es.

**Tamaño:** mediano, y es el único de los cuatro puramente cosmético — va último salvo que lo necesites para mostrar la app.

---

## Duda de auditoría, sin resolver

En la captura de Agosto 2026, **PESOS DISPONIBLES ($3.055.650) es exactamente igual a INGRESOS**, con gastos del mes por $2.319.992 y un neto de $735.658. Si "disponibles" pretende ser el remanente, debería acercarse al neto; si es otra cosa (por ejemplo, saldo en cuentas en pesos), está bien y el nombre confunde. No lo pude resolver desde el código sin saber cuál de las dos es la intención.

---

## Resultado de la ejecución (2026-08-03)

Baseline `tsc --noEmit`: **41** pre-existentes al arrancar y **41** al cerrar. `npm run build` y
`npm --prefix functions run build`: OK.

### F9.117 — hecha

`tcEfectivoDe` pasa a recibir un `EstadoTcHoy` explícito (`cargando` | `ok` | `vacio` | `error`)
en vez de `number | null`, que significaba dos cosas a la vez. Mientras carga no se afirma nada:
se usa el mejor valor disponible (cache → `TC_FALLBACK`) y el aviso queda en `null`. "Resolvió
vacío" y "falló la consulta" ahora dicen cosas distintas, y el error real se loguea con
`console.error` en la vista. Tres call sites migrados (`Resumen`, `Dashboard`, `Patrimonio`).

### F9.118 — hecha, con una corrección al diagnóstico

**El diagnóstico del backlog apunta al lugar equivocado.** `mesComp` (`functions/src/index.ts:307`)
alimenta `mesesAConsultar`, que es la **ventana de reconciliación** del matcheo — no el `mes` que
se persiste en el movimiento. Cambiar esa línea no habría corregido ninguno de los dos síntomas.

El `mes` de un movimiento se fija en tres lugares, y ninguno es esa rama `else`:
`AltaMovimiento.tsx:237` (`mes = fecha.slice(0,7)`), `crearMovimiento` en `src/datos/movimientos.ts`
y la callable `cargarMovimientoDesdeComprobante`, que lo toma del payload del cliente.

Tampoco hay un "mes de pago" derivable para un ingreso: `mesDePago` sale de
`vencimientos[0].fecha` y un recibo de sueldo no trae vencimientos. No hay dato del cual inferirlo,
así que la respuesta correcta es el **override explícito**, no una regla automática inventada.

Implementado:

- **`mes` sigue siendo el mes de imputación y el único campo consultable.** El override se escribe
  en `mes` mismo — un campo paralelo (`mesImputacion`) habría quedado fuera de todos los
  `where('mes','==',…)`, que es como consultan todas las vistas, y el movimiento no aparecería en
  el mes al que fue movido.
- **`mesManual: boolean`** marca que lo fijó una persona. Con el pin puesto, editar la fecha ya
  **no** recalcula el mes (antes lo pisaba siempre). Se suelta mandando `mes: null`.
- **`editarMovimiento`** (callable) acepta `mes` (YYYY-MM o null) e `incluirResumenMes`, ambos
  validados server-side.
- **UI**: control "Mes en el que cuenta" en `EditarMovimiento` y en `AltaMovimiento` (donde nace
  el problema de los ingresos), que sigue a la fecha hasta que alguien lo toca, con "Volver a
  seguir la fecha". Toggle "Entra en el resumen del mes" en la edición — existía al crear pero no
  había forma de cambiarlo después.
- Va **hacia adelante**: `mesManual` sólo se marca al crear o editar. No hay backfill, no se
  reescribe nada del pasado, no se toca `MES_CORTE_SEMANTICA_PAGOS`.

### F9.119 — hecha, y era más chica de lo que decía el backlog

La UI de Perfil **ya existía**: `ConfigEsperados.tsx` tiene solapas Gasto/Ingreso (`:455`, `:483`,
`:509`, `:543`) y crea ítems de cualquiera de los dos tipos. El matcheo **también**:
`matchScore`/`puntajeReclamo` (`checklist.ts:37`, `:53-54`) discriminan por tipo y hasta exigen
persona en los ingresos, y `calcularChecklist` no filtra por tipo, así que un cobro esperado ya
entraba al checklist y a la agenda.

El único punto que los dejaba afuera era el flujo de comprobantes:

- `candidatosDeGrupo` (`Comprobantes.tsx:169`) filtraba el picker a `tipo === 'Gasto'`, así que un
  cobro esperado nunca aparecía como candidato.
- `preloadBase.tipo` estaba hardcodeado en `'Gasto'`, así que aun eligiéndolo se habría creado un
  gasto.

Ambos corregidos: el picker ofrece los dos y el tipo del movimiento lo manda el ítem elegido.

### F9.120 — hecha, con las decisiones tomadas por el dueño

1. **Base por pantalla, declarada en el encabezado.** Resumen: % del ingreso del mes.
   Dashboard: % del gasto del período. Ambas solapas de Resumen usan el MISMO denominador
   (`baseIngresoMes`, calculado con el mismo `tcDeMov` que los KPIs) para que no aparezcan dos
   bases distintas en la misma pantalla.
2. **Conteos intactos.** Sólo se porcentualizan montos: "15 sin pagar · 12%" mantiene el 15.
3. **No persiste, arranca apagado siempre.** Vive en `PrivacidadContext` (memoria, no
   `localStorage`). El estado sí es compartido entre vistas: si se prende en Resumen y se
   navega a Dashboard, sigue tapado — un toggle por pantalla haría que navegar destape.
4. **PDF: opción explícita al generar.** Checkbox "Sin montos" junto al botón, independiente
   del toggle de pantalla. El archivo lo declara en el título de portada, en una nota y en el
   nombre (`patrimonio-<fecha>-sin-montos.pdf`, y el mismo sufijo en el `storagePath`), porque
   queda archivado en Storage y meses después nadie distinguiría un informe sin montos de uno
   incompleto. Base del PDF: % de la cartera financiera. Implementado sombreando `fmtUsd`
   dentro de `generarYArchivarInforme`, para que ninguna sección se escape mostrando el número
   real.

También se ocultan los montos de las tarjetas del checklist y de los sueltos, incluido el campo
editable de monto: un input con el número real adentro haría inútil el modo.

**Fuera de lo hecho:** la solapa Patrimonio no está cubierta. No tiene toggle ARS/USD al lado
del cual poner el de privacidad, y su pasada de privacidad es un trabajo aparte sobre un archivo
de ~4.100 líneas. El informe PDF de Patrimonio sí quedó cubierto por la opción al generar.

### Duda de auditoría — resuelta

**"Pesos disponibles" son los ingresos en ARS del mes, no un remanente.** `Resumen.tsx:143`:
`pesosDisp: ingArs`, donde `ingArs` acumula el monto de los movimientos de tipo Ingreso en ARS.
Por eso coincide exactamente con INGRESOS cuando todos los ingresos del mes son en pesos, que es
el caso de agosto 2026. No es un saldo de cuentas — la app no trackea saldos.

El número no está mal; la etiqueta induce a leerlo como remanente. Se usa además como
denominador de "Cobertura del mes" (`faltanteArs = gasArsEq − pesosDisp`, `:191`), donde el
sentido correcto **es** "pesos que entraron", no "pesos que quedan". Renombrarlo (por ejemplo
"Ingresos en pesos") es cambio de copy y queda a decisión del dueño.
