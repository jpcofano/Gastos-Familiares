# Resultados — indicadores en dólares y el artefacto del 3/8/2023

Medido el **2026-08-17**. Spec: `docs/prompts/investigacion-indicadores-en-dolares.md`.
Datos crudos: `docs/patrimonio/indicadores-usd-20260817.json`.

**Cero escrituras en Firestore. Cero cambios en producción.** Todo se calculó en memoria
importando las funciones reales de `functions/src/patrimonioPrecios.ts` (no copias). Los scripts
de la investigación se borraron.

---

## Resumen para el que escribe el spec

Tres de los cinco puntos salieron **al revés de lo que suponía el spec**:

1. **§1 confirmado y con un margen que no deja dudas.** El 3/8/2023 es un artefacto de data912,
   probado contra Yahoo. Es **un solo punto malo en 750 ruedas** y **data912 lo sigue sirviendo
   hoy**: no se corrigió. Sacarlo devuelve 7 de las 10 series `sospechosa` a `limpia`.
2. **§4 es falso hoy.** Dolarizar **no** baja la volatilidad: la **sube** en 13 de 15 posiciones
   (mediana +18,9% en 2025). El argumento cuantitativo que el spec esperaba encontrar no existe
   en el régimen actual — existía en 2023 y se dio vuelta. La causa está medida en §4.
3. **§5: los semáforos casi no se mueven.** Drawdown pasa de 11/16 a 11/16 en amarillo-o-rojo.
   **El problema de umbrales sigue en pie y hay que arreglarlo aparte** — la moneda no lo resuelve.

Lo que sí sostiene el trabajo es la **performance**, no el riesgo: `perf1a` cambia de signo en 3
de 12 posiciones hoy, y a lo largo de la ventana ARS y USD discrepan en el **15,0% de los días**.

Y aparece un problema nuevo que el spec no anticipaba: **la conversión hace que movimientos reales
crucen `UMBRAL_SALTO` (35%) y el detector de splits marque la serie como `sospechosa`**, tirando
555 de 750 puntos. Está en §5.4 y es bloqueante para cualquier diseño.

---

## §1 — Es artefacto de data912. Probado, y no está corregido.

### La evidencia

Yahoo Finance (`.BA`) y data912 coinciden **al centavo** en todas las ruedas de la ventana
2023-07-26 .. 2023-08-11 **salvo el 03/08**:

| fecha | PAMP data912 | PAMP Yahoo | GGAL data912 | GGAL Yahoo | TXAR data912 | TXAR Yahoo |
|---|---|---|---|---|---|---|
| 2023-08-02 | 942,60 | 942,60 | 898,80 | 898,80 | 426,50 | 426,50 |
| **2023-08-03** | **498,50** | **923,40** | **497,25** | **906,45** | **240,00** | **408,50** |
| 2023-08-04 | 943,75 | 943,75 | 943,45 | 943,45 | 414,50 | 414,50 |

El 02/08 y el 04/08 son idénticos entre fuentes. El 03/08 difiere ~45%. La caída no existió: el
retorno real de PAMP ese día fue **−2,0%**, no −47,1%.

**Las PASO fueron el 13/08/2023.** La etiqueta "macro: devaluación post-PASO" es incorrecta por
partida doble: ni la fecha ni el fenómeno. La devaluación post-PASO sí está en el dato y se ve
donde corresponde — el MEP saltó +15,0% el **2023-08-14**.

### Es toda la fila, no solo el cierre

data912 sirve OHLCV completo y equivocado, con **volumen propio** distinto del real:

```
PAMP 2023-08-03
  data912  {"o":497.5,  "h":503.95, "l":490,    "c":498.5,  "v":206521, "dr":-0.4711}
  yahoo    {"o":941.80, "h":960.00, "l":921.00, "c":923.40, "v":737132}
```

No es un cierre mal capturado ni un mínimo intradiario: es una fila entera inventada. El cociente
malo/bueno **no es constante** entre papeles (PAMP 0,540 · YPFD 0,568 · GGAL 0,549 · TXAR 0,588 ·
TGSU2 0,614 · TRAN 0,687), así que tampoco es una conversión de moneda ni un split mal aplicado.

### Sigue sin corregirse

Se volvió a pedir la serie a data912 **hoy** (`/historical/stocks/PAMP`, 4.766 filas): devuelve el
mismo 498,5. **La fuente no corrigió el dato en tres años.** Cualquier decisión del spec tiene que
asumir que el punto malo vuelve en cada corrida.

### Alcance: exactamente un punto, en toda la ventana

Se compararon los **retornos diarios** de data912 contra Yahoo en las 750 ruedas completas de las 8
acciones AR (retornos, no niveles, para ser inmune a splits y unidades):

| ticker | ruedas comparadas | días con \|Δretorno\| > 5 pp |
|---|---|---|
| PAMP, YPFD, GGAL, TXAR, TGSU2, TRAN | 747–749 | **2** (03/08 y 04/08 — el punto malo y su rebote) |
| BMA | 748 | 1 (2023-07-25: −1,8% vs +3,2%; menor, sin relación) |
| CEPU | 747 | **0** |

Fuera del 03/08/2023, **data912 es fiel a Yahoo**. La fuente es buena; tiene un punto podrido.

### Cuántos instrumentos caen ese día

12 de las 16 series tienen dato el 03/08. **10 muestran la caída, 2 no** (BMA −0,5% y CEPU −0,9%,
que coinciden con Yahoo). Que el fallo agarre acciones y bonos soberanos a la vez pero se saltee
dos papeles del mismo panel confirma que es de la fuente, no del mercado.

| día | PAMP | YPFD | GGAL | TXAR | TGSU2 | TRAN | GD30 | GD35 | DICP | TX26 | BMA | CEPU |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 03/08 | −47,1 | −43,4 | −44,7 | −43,7 | −37,7 | −33,4 | −40,6 | −41,9 | −33,4 | −33,4 | −0,5 | −0,9 |
| 04/08 | +89,3 | +80,4 | +89,7 | +72,7 | +66,4 | +48,8 | +72,4 | +75,8 | +52,4 | +52,2 | +4,6 | +2,2 |

**Corrección al spec:** DICP, TRAN y TX26 **sí tienen** la pata de caída (−33,4%). No aparecían en
`saltosDetectados` porque `UMBRAL_SALTO` es 0,35 y −33,4% no llega. El dato malo está en las 10.

### Cuántas series dejan de ser `sospechosa`

Sacando el punto del 03/08 y volviendo a correr `detectarSaltos` real:

| serie | saltos antes | después | queda |
|---|---|---|---|
| DICP, GD30, GD35, GGAL, PAMP, TGSU2, TXAR | 1–2 | **0** | **`limpia`, 749 puntos** |
| TRAN | 2 | 1 | 2023-11-21 +39,9% |
| YPFD | 3 | 1 | 2023-11-21 +38,6% |
| TX26 | 3 | 2 | 2025-11-07 −35,2% · 2026-05-08 −49,8% |

**7 de 10 quedan limpias y recuperan la ventana completa** (de 739 a 749 puntos utilizables).

Los residuales de TRAN e YPFD del **2023-11-21 son reales**: Yahoo los confirma (el ballotage fue
el 19/11/2023). Son un falso positivo del detector de splits, no un dato malo — mismo problema de
umbral que §5.4, no de moneda.

Los dos de TX26 son bonos sin contraparte en Yahoo y quedan sin verificar. TX26 hoy corre con **68
puntos utilizables de 750**, lo que explica su `volAnualizada90d` de 114,7%: no es riesgo, es
ventana rota. Vale la pena mirarlos (huelen a amortización de un CER), pero es otro tema.

### Qué hacer con el punto — sin arreglarlo, como pide el spec

Las dos opciones no son equivalentes:

- **Sacarlo de la serie**: la ventana queda con 749 puntos y las medias móviles saltean una rueda.
  Es lo que se simuló acá. Tiene el riesgo de que "borrar puntos que no me gustan" se vuelva
  costumbre.
- **Marcarlo como dato malo y dejarlo**: hay que agregarle a `PuntoSerie` una marca de calidad que
  hoy no existe, y que cada indicador la respete. Más caro y más honesto.

Hay una tercera vía que el dato habilita y el spec no contemplaba: **reemplazarlo por el valor de
Yahoo**, que es el correcto y está disponible. Cambia el problema de "qué hacemos con un agujero"
a "qué precedencia tiene cada fuente", que es una decisión de arquitectura que conviene tomar a
propósito y no de rebote.

---

## §2 — `tcDiario` está sano, pero cubre menos de la mitad de la ventana

### Cobertura

| medición | valor |
|---|---|
| documentos | **778** |
| rango | **2024-07-01 .. 2026-08-17** |
| huecos de calendario dentro del rango | **0** |
| huecos en días hábiles | **0** |
| granularidad | día calendario completo (fin de semana con forward-fill de la fuente) |
| origen | `argentinadatos-bolsa-backfill` 551 · sin campo `origen` 177 · `dolarapi-bolsa` 50 |

La serie **no tiene un solo agujero**. Ese punto del spec queda cerrado sin deuda.

### Pero no llega: falta un tercio de la ventana

`preciosDiarios` arranca el **2023-07-20**; `tcDiario`, el **2024-07-01**.

- **347 días calendario** (247 hábiles) sin tipo de cambio.
- **229 de las 750 ruedas de cada serie AR — el 31% — no tienen TC.**

Sin backfill, dolarizar recorta cada serie a ~521 ruedas: **se pierde la SMA200 con margen y toda
la ventana de 52 semanas queda al filo**. Es exactamente el techo que anticipaba el spec.

### El backfill existe y alcanza de sobra

ArgentinaDatos, ya integrado en `index.ts:2039`:

| serie | n | desde | hasta | cubre los 347 días faltantes |
|---|---|---|---|---|
| `bolsa` (MEP) | 2.850 | 2018-10-29 | 2026-08-17 | **347/347** |
| `contadoconliqui` (CCL) | 4.976 | 2013-01-02 | 2026-08-17 | **347/347** |

Cobertura total para las dos, con años de margen sobre la retención de 750 días.

### Qué tipo de cambio es: MEP, confirmado

`actualizarTCDiario` toma `dolarapi.com/v1/dolares/bolsa` → **MEP**. El backfill de F9.103 usa
`argentinadatos/dolares/bolsa`, el mismo upstream. Toda la serie es MEP; no hay mezcla.

### La convención de fecha `D` = cierre de `D−1`: **sigue vigente**

Medido contra ArgentinaDatos (que rotula con fecha real de mercado):

| lote | comparables | coincide con `api[D−1]` | con `api[D]` | con ninguno |
|---|---|---|---|---|
| todo `tcDiario` | 778 | **775** | **0** | 3 |
| solo lo escrito por el cron (`dolarapi-bolsa`, 2026-06-29..2026-08-17) | 50 | **49** | **0** | 1 |

**Cero coincidencias con `api[D]` en 778 documentos.** El corrimiento no es estadístico, es
sistemático, y el cron lo sigue produciendo hoy. Cualquier conversión tiene que usar
`tcDiario[D+1]` para el precio de mercado del día `D` — o, más simple, tomar la serie de
ArgentinaDatos, que ya viene con fecha de mercado.

### MEP vs CCL: la brecha es chica pero **se mueve**, y ese es el problema

| período | n | mediana | mín | máx |
|---|---|---|---|---|
| 2023-07-20 .. 2026-08-17 | 1.125 | **2,15%** | — | 22,12% |
| 2023 | 165 | **4,73%** | −4,15% | 19,57% |
| 2024 | 366 | **2,36%** | −2,36% | 7,01% |
| 2025 | 365 | **0,77%** | −2,17% | 22,12% |
| 2026 | 229 | **3,15%** | 1,77% | 4,15% |

Percentiles de la brecha CCL/MEP−1: p5 −0,76% · p25 0,56% · mediana 2,15% · p75 3,40% · p95 9,49%.

El nivel no importa (una constante multiplicativa no cambia ningún indicador relativo). **Lo que
importa es la deriva**: la brecha pasó de 4,73% a 0,77% y volvió a 3,15%. Elegir MEP en vez de CCL
mete una tendencia espuria de ~4 pp a lo largo de la ventana. En la práctica el efecto medido en
los indicadores es acotado y **uniforme** — la columna `USD-CCL` de §5 está sistemáticamente
0,3–0,6 pp por debajo de `USD-MEP` en performance, sin cambiar ningún signo salvo TXAR en
`vsSma200Pct`. Es de segundo orden frente a la decisión ARS/USD.

**Validación independiente de que la serie es correcta:** el ratio implícito local↔ADR de §3 da
~2,7–3% por debajo del ratio nominal en los **seis** papeles, que es exactamente la brecha CCL/MEP
del período. Es decir: dividir por MEP un papel local reconstruye el precio del ADR con un sesgo
de 3%, el mismo para todos. La serie MEP está bien; simplemente no es el TC que el mercado usa
para arbitrar contra Nueva York.

### Un punto malo en la fuente de TC (no muerde, por suerte)

ArgentinaDatos tiene su propio ida y vuelta: **2025-05-02 MEP = 1.363,6** entre 1.182,8 y 1.170,4
(+15,3% / −14,2%). CCL igual (1.429,3). Es el mismo patrón que el artefacto de data912.

Hoy no hace daño por dos casualidades: BYMA no operó el 01 ni el 02/05/2025 (feriado y puente), y
el shift `D−1` lo deposita en `tcDiario[2025-05-03]`, un sábado. Se verificó: sacarlo no cambia
**ninguna** volatilidad (idénticas a 0,1 pp). **Pero es suerte, no robustez** — si se re-backfillea
sin shift o se convierte por fecha de mercado, ese punto entra. Los saltos propios >10% de las
series de TC son: MEP 3 (2023-08-14 real, 2025-05-02 y 05-03 el artefacto), CCL 6.

---

## §3 — Yahoo cubre los seis ADRs con margen; el ratio se midió

| local | ADR | ruedas | desde | hasta | moneda | ratio medido | ratio nominal |
|---|---|---|---|---|---|---|---|
| YPFD | YPF | **784** | 2023-07-03 | 2026-08-17 | USD | 9,712 | **10** |
| PAMP | PAM | **784** | 2023-07-03 | 2026-08-17 | USD | 24,296 | **25** |
| TGSU2 | TGS | **784** | 2023-07-03 | 2026-08-17 | USD | 4,860 | **5** |
| BMA | BMA | **784** | 2023-07-03 | 2026-08-17 | USD | 9,725 | **10** |
| GGAL | GGAL | **784** | 2023-07-03 | 2026-08-17 | USD | 9,725 | **10** |
| CEPU | CEPU | **784** | 2023-07-03 | 2026-08-17 | USD | 9,676 | **10** |

**Los seis pasan el gate de ≥750 ruedas** (784, con 34 de sobra). Ratio medido como mediana de
`ADR ÷ (local ÷ MEP)` sobre las últimas 250 ruedas; dispersión angosta (p10–p90 de ±2%), lo que
confirma que el ratio es estable y no hay que estimarlo día a día.

Los seis medidos caen **2,7–3,3% por debajo** del ratio nominal, todos por igual: es la brecha
CCL/MEP, no error de mapeo. Con CCL darían prácticamente clavados en 10 / 25 / 5.

**Nota sobre YPF:** el ratio nominal es 10, no 1 — YPFD.BA hizo un split 10:1 el 2026-08-03 (el
caso testigo de F9.141.1) y el ADR mantuvo su tamaño. La serie local guardada ya está
retroajustada por el motor de splits, así que el 10 aplica a toda la ventana. Cuadra.

### El trade-off de mezclar métodos, medido

Comparando, sobre las 729 ruedas comunes, la serie **ADR nativa** contra la serie **local
convertida por MEP**:

| local | ADR | corr(retornos) | vol90 conv | vol90 ADR | drawdown conv | drawdown ADR | perf1a conv | perf1a ADR |
|---|---|---|---|---|---|---|---|---|
| YPFD | YPF | 0,931 | 38,1% | 39,6% | −10,0% | −6,5% | 54,4% | **61,2%** |
| PAMP | PAM | 0,900 | 31,6% | 33,4% | −16,4% | −15,8% | 9,7% | 7,5% |
| TGSU2 | TGS | 0,893 | 37,6% | 40,7% | −19,0% | −19,9% | 1,8% | 0,7% |
| BMA | BMA | 0,915 | 53,2% | 53,3% | −33,7% | −32,0% | 16,7% | 12,9% |
| GGAL | GGAL | 0,917 | 45,7% | 51,0% | −39,2% | −39,9% | −8,8% | −12,2% |
| CEPU | CEPU | 0,884 | 38,3% | 43,0% | −25,7% | −27,3% | 14,2% | 9,6% |

**Correlación 0,88–0,93: parecidas, no iguales.** Las diferencias no son ruido:

- `volAnualizada90d` difiere hasta **5,3 pp** (GGAL 45,7% vs 51,0%) — y siempre en la misma
  dirección: el ADR es más volátil, porque cotiza en otro huso, con otro calendario de feriados y
  con arbitraje imperfecto.
- `perf1a` difiere hasta **6,8 pp** (YPF).
- `drawdownDesdeMaxPct` difiere hasta **3,5 pp** (YPF).

**El trade-off, sin elegir por vos:**

- **ADR para los seis**: dólares nativos, sin decidir MEP/CCL, sin arrastrar el error de medición
  del TC, y sin depender de que `tcDiario` se backfillee. Cuesta: una segunda fuente en el motor
  (Yahoo, hoy solo usada para sembrar splits), la tabla de ratios como dato de configuración
  versionado, y el alineamiento de calendarios (784 ruedas Yahoo vs 750 locales).
- **Conversión para todo**: un solo método, una sola fuente de precios, comparabilidad garantizada
  dentro de la cartera. Cuesta: el backfill de §2 es obligatorio, y hereda la deriva MEP/CCL.
- **Mixto**: es el peor de los dos para lo que este trabajo quiere lograr. Con vol difiriendo 5 pp
  entre métodos, **GGAL medida por ADR y TXAR medida por conversión no son comparables entre sí**,
  y el semáforo de volatilidad las mediría con reglas distintas. TRAN y TXAR no tienen ADR líquido,
  así que el mixto es inevitable si se elige la vía ADR — salvo que se acepte medirlos distinto y
  se diga en la ficha.

---

## §4 — La premisa es falsa en el régimen actual, y se dio vuelta en 2025

El spec esperaba que dolarizar **bajara** la volatilidad y que esa caída fuera el argumento
cuantitativo de todo el trabajo. **No pasa.** Sobre las 15 series en ARS, con `volAnualizada90d`:

| | resultado |
|---|---|
| baja al dolarizar | **2 de 15** (CVX −0,7 pp · GD35 −1,3 pp) |
| sube al dolarizar | **13 de 15** |
| GD30 (el caso testigo del spec) | 25,8% → **24,9%** — baja **0,9 pp**, no "mucho" |
| CEDEAR (CVX) | 30,6% → **29,9%** — baja 0,7 pp |
| DICP | 16,6% → **19,2%** (sube 15,5% relativo) |

### Por qué: el signo se dio vuelta en 2025

Volatilidad anualizada por subperíodo, ARS vs USD:

| período | mediana del cambio | baja en | vol del propio MEP |
|---|---|---|---|
| jul–dic 2023 (cepo, PASO) | **−6,7%** | 8/12 | **40,7%** |
| 2024 (crawling peg 2%) | −0,7% | 8/12 | 27,0% |
| **2025 (salida del cepo, bandas)** | **+18,9%** | **2/15** | 30,5% |
| 2026 (a la fecha) | +1,8% | 4/15 | **8,5%** |

**El spec tenía razón — en 2023.** Con el peso moviéndose 40% anualizado, dividir sacaba ruido. La
mecánica está en la correlación diaria entre el retorno del papel en ARS y el retorno del MEP:

| ticker | 2023 | 2024 | **2025** | 2026 |
|---|---|---|---|---|
| BMA | +0,17 | +0,22 | **−0,34** | −0,09 |
| GGAL | +0,06 | +0,24 | **−0,34** | −0,06 |
| TRAN | +0,18 | +0,26 | **−0,46** | −0,01 |
| DICP | −0,05 | +0,06 | **−0,44** | −0,09 |
| YPFD | +0,23 | +0,31 | **−0,25** | +0,07 |
| PAMP | +0,21 | +0,41 | **−0,18** | +0,02 |

En 2023–2024 la correlación era **positiva**: el peso empujaba el precio hacia arriba y dividir
removía varianza común. Desde 2025 es **negativa**: en los días risk-on el papel sube *y* el peso
se aprecia, así que dividir **amplifica** el movimiento en vez de limpiarlo.

El caso testigo es el 2025-10-27, el día después de las legislativas: las acciones AR subieron
~29% en pesos **y** el MEP cayó 6,8%. En dólares el movimiento es **+37% a +39%**.

**Consecuencia para el spec:** el argumento "convertir saca ruido de moneda" no se puede usar. Si
se dolariza, hay que justificarlo por **coherencia con el resto de la app y por la performance**
(§5), no por el riesgo. Y hay que asumir que **los semáforos de volatilidad van a marcar más, no
menos** — aunque, como muestra §5, con los umbrales actuales la distribución no llega a moverse.

---

## §5 — Impacto simulado

Metodología: se sacó el punto artefacto del 03/08/2023 y se calcularon los indicadores con las
funciones reales sobre **las mismas ruedas** de un lado y del otro (sin `recortarPorEstado`, para
que la comparación no quede contaminada por §5.4). TC de ArgentinaDatos con fecha de mercado,
forward-fill. Tabla completa en el JSON.

### `vsSma200Pct` — el sesgo existe, pero es la mitad de lo que dice el spec

Snapshot de hoy: **1 de 12 cambia de signo** (DICP +2,9% → −0,8%). El desplazamiento es
notablemente uniforme: **−3,1 a −4,3 pp en las doce**.

El snapshot con n=12 no alcanza para juzgar un sesgo, así que se midió sobre **los 550 días** en
que cada serie tiene 200 ruedas atrás:

| ticker | ARS por encima | USD por encima | ARS medio | USD medio |
|---|---|---|---|---|
| GD35 | **98,5%** | 89,6% | +21,4% | +13,7% |
| GD30 | 88,0% | 69,8% | +13,2% | +5,7% |
| DICP | 84,9% | 75,3% | +14,0% | +6,6% |
| YPFD | 86,2% | 82,0% | +26,1% | +18,5% |
| TGSU2 | 93,8% | 85,6% | +22,0% | +14,3% |
| PAMP | 86,7% | 75,1% | +19,5% | +12,2% |
| TRAN | 84,0% | 77,3% | +24,9% | +17,4% |
| BMA | 76,5% | 74,5% | +25,1% | +17,2% |
| GGAL | 73,8% | 70,4% | +24,6% | +16,9% |
| CEPU | 81,8% | 71,3% | +17,9% | +10,5% |
| TX26 | 39,3% | 36,5% | −2,0% | −9,0% |
| TXAR | 36,2% | 20,7% | −3,5% | −10,1% |
| **agregado** | **77,5%** | **69,0%** | | |

**El sesgo es real y está confirmado en dirección**, pero "cierto por default" es demasiado fuerte:
en pesos el precio está sobre su SMA200 el 77,5% de los días, no el ~100%. Convertir lo baja a
69,0% — **8,5 pp**, útil pero no transformador. Los casos fuertes son los bonos (GD30 88,0% →
69,8%) y GD35, que en pesos está arriba el **98,5%** de los días: ahí el indicador efectivamente
no informa nada.

### `perf1a` — acá sí, y es el resultado más fuerte de toda la investigación

Snapshot: **3 de 12 cambian de signo** (GD30 +4,2% → −7,2% · GGAL +2,4% → −8,8% · TXAR +11,3% →
−0,9%). El desplazamiento es grande y uniforme: **−11,2 a −19,0 pp**.

Sobre los 497 días con un año de historia atrás:

| ticker | ARS positivo | USD positivo | **signo distinto** |
|---|---|---|---|
| GD30 | 98,8% | 60,2% | **39,8%** |
| TXAR | 35,0% | 0,8% | **34,4%** |
| DICP | 99,2% | 71,2% | **28,0%** |
| BMA | 89,5% | 72,6% | 16,9% |
| GGAL | 76,7% | 62,0% | 14,9% |
| PAMP | 100,0% | 88,5% | 11,5% |
| YPFD | 98,8% | 88,5% | 10,3% |
| TRAN | 98,8% | 90,7% | 8,2% |
| CEPU | 98,2% | 91,5% | 6,6% |
| TX26 | 37,2% | 32,0% | 5,2% |
| TGSU2 | 100,0% | 96,2% | 3,8% |
| GD35 | 100,0% | 100,0% | 0,0% |
| **agregado** | **86,0%** | **71,2%** | **15,0%** |

En pesos, `perf1a` es positivo el **86% de los días** — y en cuatro papeles, el **100%**. La
respuesta "¿ganaste plata en el año?" es "sí" casi siempre, que es otra manera de decir que no
responde nada. **ARS y USD se contradicen en el 15% de los días.**

Las ventanas cortas casi no se mueven: `perf1m` desplaza −0,3 a −0,5 pp uniformes, `vsSma50Pct`
−0,8 a −1,3 pp. **Cuanto más larga la ventana, más importa la moneda** — que es exactamente la
tesis del spec, ahora con número.

### Rango y drawdown — se agrandan, con dos casos grandes

| ticker | drawdown ARS | drawdown USD | Δ | dist. máx 52s ARS | USD | Δ |
|---|---|---|---|---|---|---|
| TXAR | −36,3% | **−63,0%** | −26,7 | −16,7% | −20,1% | −3,4 |
| GGAL | −25,5% | **−39,2%** | −13,7 | −25,5% | −26,5% | −1,0 |
| BMA | −22,2% | **−33,7%** | −11,6 | −22,2% | −25,0% | −2,9 |
| TX26 | −63,9% | −73,4% | −9,5 | −56,5% | −57,7% | −1,1 |
| GD30 | −17,2% | −26,2% | −8,9 | −17,2% | −18,3% | −1,1 |
| PAMP | −11,6% | −16,4% | −4,8 | −11,6% | −14,1% | −2,5 |
| TGSU2 | −14,2% | −19,0% | −4,8 | −14,2% | −19,0% | −4,8 |
| YPFD | −5,9% | −10,0% | −4,1 | −5,9% | −10,0% | −4,1 |
| GD35 | −6,4% | −5,9% | +0,5 | −6,4% | −5,9% | +0,5 |

El spec acertó en dirección: el drawdown **subestima** en pesos, hasta 26,7 pp en TXAR. La
distancia al máximo de 52 semanas se agranda mucho menos (0,5 a 4,8 pp) porque en la ventana de un
año la inflación acumulada pesa menos que en la historia completa.

`CVX` es un caso didáctico: drawdown **0,0% en pesos** (está en su máximo nominal) y **−5,3% en
dólares**. En pesos el indicador dice "está en máximos" y es un artefacto de la moneda.

### Los semáforos NO se mueven — y esto decide el punto abierto del spec

Con ventana idéntica de los dos lados:

| | verde | amarillo | rojo |
|---|---|---|---|
| **drawdown ARS** | 5 | 7 | 4 |
| **drawdown USD** | 5 | 5 | **6** |
| **volatilidad ARS** | 8 | 4 | 4 |
| **volatilidad USD** | 8 | 4 | 4 |

- **Drawdown: 11 de 16 en amarillo-o-rojo en pesos, 11 de 16 en dólares.** Solo dos cambian de
  banda, y **empeoran** (GD30 y TXAR pasan de amarillo a rojo). La distribución no se abre: se
  corre hacia el rojo manteniendo la misma carga.
- **Volatilidad: idéntica.** Ni un solo cambio de banda en 16 posiciones, pese a que 13 de 15
  volatilidades subieron — los saltos son chicos frente al ancho de las bandas.

**Respuesta al punto abierto del spec: el arreglo de umbrales sigue siendo necesario y es
independiente de la moneda.** No se resuelve solo. Y conviene hacerlo *después* de decidir la
moneda, porque los umbrales de drawdown habría que recalibrarlos sobre la distribución en la
moneda que se elija.

### §5.4 — El problema nuevo: la conversión rompe el detector de splits

Al dolarizar, **cinco series cruzan `UMBRAL_SALTO` (0,35) el mismo día y quedan `sospechosa`**:

| ticker | retorno ARS 2025-10-27 | retorno USD (MEP) | retorno USD (CCL) |
|---|---|---|---|
| CEPU | ~29% | **+38,9%** | +38,4% |
| TRAN | ~29% | **+38,5%** | +38,0% |
| BMA | ~28% | **+37,2%** | +36,7% |
| GGAL | ~28% | **+37,2%** | +36,7% |
| TGSU2 | ~28% | **+36,7%** | +36,2% |

El 2025-10-27 es el día después de las legislativas: rally real de ~28-29% en pesos **más** una
caída del MEP de 6,8%. En dólares el movimiento genuino es +37%, cruza el umbral, `detectarSaltos`
lo toma por split y `recortarPorEstado` **tira todo lo anterior**: la serie pasa de 749 a **195
puntos**. Se pierde SMA200 y la ventana de 52 semanas en cinco posiciones.

El umbral de 0,35 está calibrado sobre retornos en pesos. **Dolarizar sin tocarlo destruye más
historia de la que recupera arreglar el artefacto del §1** — 5 series × 554 puntos perdidos contra
7 series × 10 puntos recuperados. Es la restricción de diseño más dura que salió de esta
investigación, y no había sido anticipada.

---

## Cierre

- [x] **§1 — Artefacto de data912, probado contra Yahoo.** Un solo punto malo (2023-08-03) en 750
      ruedas; toda la fila OHLCV, no solo el cierre; **no corregido en origen, sigue viniendo hoy**.
      Afecta 10 de 12 series con dato ese día (BMA y CEPU están bien). Sacándolo, **7 de las 10
      `sospechosa` quedan `limpia`** con ventana completa; TRAN e YPFD retienen un salto **real**
      (2023-11-21, ballotage, confirmado por Yahoo) y TX26 dos sin verificar. La etiqueta
      "devaluación post-PASO" es incorrecta: las PASO fueron el 13/08.
- [x] **§2 — `tcDiario`: 778 docs, 2024-07-01..2026-08-17, CERO huecos.** Es MEP. **Falta el 31%
      de la ventana** (347 días calendario, 229 de 750 ruedas). ArgentinaDatos cubre 347/347 con
      historia desde 2018 (MEP) y 2013 (CCL). **Convención `D` = cierre de `D−1` confirmada:
      775/778 coinciden con `api[D−1]` y 0/778 con `api[D]`**; el cron sigue produciéndola.
      Brecha CCL/MEP: mediana 2,15%, pero deriva de 4,73% (2023) a 0,77% (2025) a 3,15% (2026);
      efecto en indicadores acotado y uniforme (0,3–0,6 pp). Un punto malo detectado en la fuente
      de TC (2025-05-02), hoy inocuo por coincidencia de feriados.
- [x] **§3 — Yahoo cubre los seis ADRs con 784 ruedas (≥750, ✔).** Ratios medidos: YPF 10 · PAM 25
      · TGS 5 · BMA 10 · GGAL 10 · CEPU 10 (medidos 2,7–3,3% abajo, que es la brecha CCL/MEP).
      ADR vs conversión correlacionan 0,88–0,93 pero difieren hasta **5,3 pp en volatilidad** y
      **6,8 pp en perf1a**: mezclar los dos métodos rompe la comparabilidad dentro de la cartera.
      Trade-off reportado, decisión no tomada.
- [x] **§4 — La premisa NO se sostiene.** Dolarizar **sube** la volatilidad en 13 de 15 posiciones.
      GD30 baja 0,9 pp y el CEDEAR 0,7 pp, no "mucho". El efecto se dio vuelta en 2025: la
      correlación entre el retorno en ARS y el del MEP pasó de **+0,2/+0,5** a **−0,2/−0,46**, así
      que convertir amplifica en vez de limpiar. **No hay argumento cuantitativo por el lado del
      riesgo.**
- [x] **§5 — Tabla completa en el JSON.** `perf1a` es el resultado fuerte: 3 de 12 cambian de signo
      hoy y ARS/USD discrepan el **15,0% de los días**; en pesos es positivo el 86% del tiempo.
      `vsSma200Pct` tiene sesgo real pero moderado: 77,5% → 69,0% de días por encima. Drawdown se
      agranda hasta 26,7 pp. **Los semáforos casi no se mueven (11/16 → 11/16 en drawdown, 0
      cambios en volatilidad): el arreglo de umbrales sigue siendo necesario.** Hallazgo nuevo:
      **la conversión hace que un movimiento real cruce `UMBRAL_SALTO` y tire 554 puntos en cinco
      series.**
- [x] **Cero escrituras en Firestore. Cero cambios en producción. Scripts temporales borrados.**

### Lo que el spec va a tener que decidir, y que esta investigación no decide

1. **Qué se hace con el punto del 03/08/2023**, sabiendo que la fuente no lo va a corregir: sacarlo,
   marcarlo, o reemplazarlo por Yahoo. Son tres arquitecturas distintas.
2. **`UMBRAL_SALTO` antes que la moneda.** Dolarizar con el detector como está hoy es una regresión
   neta de historia. Y el umbral ya da falsos positivos **en pesos** (2023-11-21 en TRAN e YPFD son
   movimientos reales del ballotage).
3. **ADR o conversión, pero uno solo** — o mixto declarado en la ficha, aceptando que dos posiciones
   de la misma cartera se miden con reglas que difieren hasta 5 pp de volatilidad.
4. **El backfill de `tcDiario` es prerrequisito** de cualquier vía por conversión: sin él se pierde
   la SMA200 en todas las series AR.
5. **Los umbrales de drawdown son un trabajo aparte** y hay que hacerlos después de fijar la moneda.
