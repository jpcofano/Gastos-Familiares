# Investigación — indicadores en dólares, y el artefacto del 3/8/2023

**Solo lectura. No escribir en Firestore, no cambiar código de producción.**
Esto es lo que hay que medir antes de escribir el spec. Dos de los tres puntos pueden cambiar el
diseño entero, y el tercero puede hacer desaparecer un problema que creíamos tener.

## El problema

Las series de `preciosDiarios` para instrumentos argentinos vienen de data912 **en pesos
nominales**. Con inflación y tipo de cambio en movimiento, el nivel de precios sube por su cuenta,
y eso rompe cada indicador de ventana larga de forma distinta:

- **SMA200** cubre ~10 meses. En pesos, el precio de hoy supera casi siempre ese promedio aunque
  el papel no se haya movido. "Está sobre su media de 200" pasa a ser cierto por default.
- **Máximo de 52 semanas**: el máximo nominal es casi siempre reciente, así que la distancia al
  máximo se ve chica y subestima las caídas reales.
- **Drawdown**: subestima. Una caída del 20% en dólares puede verse como 0% en pesos.
- **Volatilidad**: mezcla movimiento del papel con movimiento del peso.
- **Performance 1M/3M/6M/1A**: +30% anual en pesos con inflación de tres dígitos es una pérdida.

Y hay una incoherencia interna: **toda la app valúa en dólares** —`valorUsd`,
`totalPatrimonioUsd`, la regla de conversión de F9.114, el benchmark—. Los indicadores de F9.141
son la única parte del sistema que no respeta esa decisión.

**Lo que NO está afectado, y no hay que tocar:** `calcBenchmark` trabaja con fracciones de cartera,
y una proporción es invariante a la moneda; F9.142 y F9.143 se sostienen enteros. `ruedasParaSalir`
y `ratioVolumen` son cocientes entre montos de la misma moneda. El alcance es tendencia, rango,
riesgo y performance.

---

## §1 — El artefacto del 3/8/2023 (empezar por acá)

De los 21 saltos pendientes, 19 se clasificaron como "macro: devaluación post-PASO". **Esa
clasificación es sospechosa** y conviene resolverla antes de diseñar nada, porque si es un
artefacto de datos, 10 de las 16 series dejan de estar `sospechosa` y recuperan ventana completa.

Cuentas de ida y vuelta sobre los dos días:

| ticker | 2023-08-03 | 2023-08-04 | neto |
|---|---|---|---|
| PAMP | −47,11% | +89,32% | **+0,13%** |
| YPFD | −43,40% | +80,40% | **+2,11%** |
| GGAL | −44,68% | +89,73% | **+4,96%** |
| GD30 | −40,64% | +72,43% | **+2,35%** |
| TXAR | −43,73% | +72,71% | **−2,82%** |

Siete instrumentos —acciones **y bonos soberanos**— caen ~43% un día y vuelven al mismo lugar al
siguiente. Los mercados no hacen eso: ni una devaluación ni un resultado electoral producen un ida
y vuelta perfecto en todo el panel simultáneamente.

Dos cosas más que no cierran:

- **Las PASO de 2023 fueron el 13 de agosto, no el 3.** La etiqueta que se le puso al salto es
  incorrecta.
- **DICP, TRAN y TX26 muestran solo la pata de rebote** del 04/08, sin la caída del 03/08.

Medir:

1. El cierre de PAMP, YPFD y GD30 entre el 2023-07-28 y el 2023-08-10 **contra Yahoo Finance**
   (`.BA`, que ya sabemos que responde y cubre BYMA). Si Yahoo no muestra la caída del 03/08, es
   artefacto de data912 y queda probado.
2. Cuántos instrumentos del segmento tienen `|dr|` grande ese mismo día. Si son todos los del
   panel, es un problema de la fuente, no del mercado.
3. Si data912 sirve hoy un valor distinto para esa fecha que el que quedó guardado — o sea, si el
   dato se corrigió después.

**Si se confirma el artefacto**, reportarlo sin arreglarlo: la corrección va al spec, y hay que
decidir si se sacan esos puntos de la serie o se marcan como dato malo. No es lo mismo.

## §2 — Cobertura de `tcDiario`

La conversión a dólares necesita una serie diaria con la misma cobertura que la de precios.
`tcDiario` ya existe (id del documento = fecha, campo `tcUsdArs`), pero nadie midió hasta dónde
llega.

Medir y reportar:

- Fecha del primer y último documento, y **cuántos documentos hay en total**.
- Cuántos días hábiles faltan dentro de ese rango — la lista de huecos, no solo el conteo.
- Si cubre los 750 días de retención de `preciosDiarios`. Si no llega, cuánto falta.
- Qué tipo de cambio es exactamente. `actualizarTCDiario` (`functions/src/index.ts:1840`) toma
  `dolarapi.com/v1/dolares/bolsa`, o sea **MEP, no CCL**. Para papeles locales el estándar del
  mercado es CCL. Reportar la diferencia típica entre ambos en el período y si importa.
- **La convención de fecha**: el cron corre a las 09:00 ART, antes del cierre, así que el valor
  guardado bajo la fecha `D` es en realidad el cierre de `D−1`. Está documentado y hay que
  respetarlo al convertir, o toda la serie queda corrida un día. **Confirmar que sigue siendo
  así.**

Si hay que backfillear, ArgentinaDatos ya está integrado (`index.ts:2039`) y tiene histórico.
Medir hasta dónde llega su serie.

Este número condiciona el alcance: **la serie en dólares no puede ser más larga que la de tipo de
cambio.**

## §3 — ADRs: la vía limpia, si existe

Seis de tus ocho acciones argentinas cotizan en Nueva York en dólares: **YPF, PAM, TGS, BMA, GGAL,
CEPU**. Una serie de ADR es dólares nativos, sin convertir nada y sin elegir tipo de cambio — no
arrastra el error de medición del TC ni la diferencia MEP/CCL.

data912 tiene `/live/usa_adrs` pero **no hay endpoint histórico para ADRs** (el `openapi.json` solo
declara `stocks`, `cedears`, `bonds`). Medir:

- Si Yahoo Finance tiene esos seis tickers con historia suficiente (≥750 ruedas).
- El mapeo local → ADR y su **ratio de conversión**, que no es 1:1 y varía por papel. Sin el ratio
  correcto, los niveles no son comparables aunque las variaciones sí.
- Si conviene usar ADR para los seis y conversión por TC para el resto, o conversión para todo.
  **Mezclar dos métodos en la misma cartera hace que las posiciones no sean comparables entre sí**,
  que es justo lo que este trabajo viene a arreglar. Reportar el trade-off; no elegir.

TRAN y TXAR no tienen ADR líquido: esos van por conversión sí o sí.

## §4 — Qué hacer con CEDEARs y bonos

Caso aparte y a favor: **ya son activos en dólares cotizando en pesos.** Convertirlos no les agrega
ruido, se lo saca. El precio en pesos de GD30 es en buena medida tipo de cambio; en dólares aparece
la paridad, que es el número que se mira para decidir.

Medir sobre una serie convertida de prueba —GD30 y un CEDEAR— cuánto baja la volatilidad
anualizada al pasar a dólares. Si baja mucho, es la medida de cuánto ruido de moneda había adentro,
y es el argumento cuantitativo de todo esto.

## §5 — Impacto simulado, sin escribir nada

Sobre las 16 series con datos, calcular los indicadores **en pesos y en dólares** y comparar:

- `vsSma200Pct`: en cuántas cambia de signo. Es el test más directo del sesgo.
- `drawdownDesdeMaxPct` y `distanciaMax52sPct`: cuánto se agrandan.
- `volAnualizada90d`: cuánto baja.
- `perf1a`: cuántas cambian de signo.
- **Cómo quedan los semáforos.** Hoy drawdown marca 10 de 16 en amarillo o rojo, que es demasiado
  para señalar algo. Si en dólares la distribución se abre, el umbral no hay que tocarlo. Si sigue
  igual de cargada, el problema es el umbral y no la moneda.

Ese último punto es el que decide si el arreglo de umbrales sigue siendo necesario o se resuelve
solo.

---

## Cierre

- [ ] §1 resuelto: el salto del 3/8/2023 es artefacto de data912 o es real, con evidencia de una
      segunda fuente. Si es artefacto, cuántas series dejan de ser `sospechosa`.
- [ ] §2: cobertura real de `tcDiario`, huecos, MEP vs CCL, y confirmación de la convención de
      fecha `D` = cierre de `D−1`.
- [ ] §3: si Yahoo cubre los seis ADRs con ≥750 ruedas, y el ratio de conversión de cada uno.
- [ ] §4: cuánto baja la volatilidad de GD30 y de un CEDEAR al convertir.
- [ ] §5: la tabla comparativa pesos vs dólares de las 16, y cómo quedan los semáforos.
- [ ] Cero escrituras en Firestore. Cero cambios en producción. Scripts temporales borrados.

No propongas ni ejecutes ningún fix. Con estas salidas se escribe el spec — o se descubre que hay
que escribir otro.
