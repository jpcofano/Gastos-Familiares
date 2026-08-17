# Resultados — investigación del universo del benchmark de RV argentina

Medido el **2026-08-17**. Spec: `docs/prompts/investigacion-universo-benchmark.md`.
Datos crudos del universo: `docs/patrimonio/universo-rv-argentina-20260817.json`.

**Cero escrituras en Firestore. Cero cambios en producción.** Las 2 escrituras que
`parsearFichaCafci` intentó hacer sobre `cafciMapping` (mapeos auto de `adr vista oil y gas` y
`havanna holding`) se interceptaron y se contaron, no se ejecutaron. Todos los scripts de la
investigación se borraron.

---

## §1 — `pb_get` sí sirve para uso recurrente

| medición | valor |
|---|---|
| status | **200**, sin autenticación ni headers especiales |
| `Content-Type` | `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` |
| tamaño | 946.763 bytes |
| `Content-Disposition` | `attachment; filename="20260814_Planilla_Diaria_A.xlsx"` |
| `Last-Modified` | Fri, 14 Aug 2026 23:17:17 GMT |
| CDN | CloudFront (`X-Cache: Hit`, POP `EZE50-P4`), `x-powered-by: Express` |
| estructura | 1 hoja, 4.285 filas, 47 columnas, encabezado de 2 filas (7–8) |
| granularidad | **1 fila por CLASE** (4.236 clases con `Código CAFCI`) |

**Frecuencia: diaria hábil, publicada la misma noche.** El archivo del 14/08 se publicó el 14/08 a
las 23:17. La columna de comparación del encabezado dice `13/08/26`, o sea día hábil contra día
hábil anterior. Al momento de medir (lunes 17/08 de madrugada) el archivo más reciente es el del
viernes, que es lo correcto: no hay planilla de sábado ni domingo.

**Soporta `If-Modified-Since` → `304 Not Modified`.** Un cron puede consultar barato y bajar el
XLSX solo cuando cambió. Es la diferencia entre 946 KB por corrida y unos bytes.

**El patrimonio viene POR CLASE, y esto importa más de lo que decía el spec.** No es solo Pionero:

| fondo | clase | patrimonio ARS M |
|---|---|---|
| Superfondo Renta Variable (`51`) | A (`51`) | 127.675 |
| | **B (`683`) ← la que usa la config** | **39.084** |
| | I (`2663`) | 6.552 |
| | H (`2662`) | 2.578 |
| | + 5 clases más en cero | 0 |
| Pionero Acciones (`39`) | A (`39`) | 29.589 |
| | B (`6174`) | 14.129 |
| Superfondo Acciones (`148`) | A (`148`) | 193.799 |
| | + 4 clases más | 1.978 |

**54 de los 60 fondos del segmento tienen más de una clase** (266 clases en total). Ponderar por la
clase configurada en vez de por el fondo subestimaría Superfondo Renta Variable **4,5×**. La
cartera es del fondo, no de la clase (ya verificado en F9.142), así que la ponderación tiene que
sumar todas las clases del fondo.

**Hallazgo que cambia la vía de resolución de `fondoId`.** F9.105 dio por sentado que el `fondoId`
de la URL de ficha no era derivable y planteó scrapear el buscador por nombre. **Es innecesario:**
`consulta-de-fondos.json` (2,9 MB, 1.191 fondos, 4.776 clases) trae `fondo.id` — que **es** el
`fondoId` de la URL — junto con `clases[].id` (= `claseId`), `codigo_cnv`, `tipo_renta`, `region` y
`moneda`. Verificado contra 6 pares conocidos, **6/6 exactos**:

```
Galileo Acciones            615/2249  MATCH
Pionero Acciones (F9.142)    39/6174  MATCH
Consultatio Acciones Arg C  216/1634  MATCH
Superfondo Renta Variable B  51/683   MATCH
Fima PB Acciones B           22/1193  MATCH
1810 RV Argentina           275/275   MATCH
```

O sea: **el universo sale del join catálogo ⋈ planilla por `claseId`**. El catálogo aporta
identidad y `fondoId`; la planilla aporta patrimonio. Ninguna de las dos sola alcanza.

Se descartó una tercera vía que el propio archivo sugería: la columna 39 de la planilla se llama
`Id Fondo CAFCI padre` y parecía ser el `fondoId`. **Viene vacía en las 4.236 filas.** La premisa de
F9.105 en ese punto se sostiene.

## §2 — 60 de 60 tienen ficha; 54 son usables

El segmento son **60 fondos con patrimonio > 0** (64 en el catálogo, 4 en cero). El spec decía 62;
la diferencia es la fecha del corte, no un criterio distinto.

| medición | resultado |
|---|---|
| responden 200 y `extraerItemsCartera` saca items | **60 / 60** |
| errores, timeouts o 403 | **0** |
| `fechaCartera` < 60 días | **60 / 60** (49 al 31/07, 11 al 24/07) |
| congelados | **0** |
| `advertenciaSuma` (`totalPct` fuera de [98,102]) | 1 |
| `advertenciaCobertura` (< 95) | 42 |
| salteados por `BASE_FONDO_MINIMA = 40` | 6 |
| **usables** | **54 / 60** |
| **patrimonio cubierto por los usables** | **98,4 %** del segmento |
| patrimonio cubierto por la config actual | **30,6 %** |

No hubo un solo bloqueo en 60 fetches seriales con 1,5 s de pausa, con los `HEADERS_NAVEGADOR` de
F9.112. El corte por tres 403 seguidos que pedía el spec nunca se disparó.

Los 6 salteados, y por qué está bien que lo sean:

- `1876/6489` BAVSA Renta Balanceado X, `1877/6492` BAVSA Renta Balanceado XI, `425/789` Compass
  Crecimiento II, `1424/4161` **SBS Acciones Brasil** — base comparable 0. Están clasificados como
  RV argentina pero su cartera no tiene renta variable AR identificable.
- `15/678` **Pionero Acciones Plus** — base 32,3, justo debajo del piso. Es el fondo que F9.142
  sacó de la config por estar mal etiquetado; el filtro de base lo habría excluido igual.
- `1515/4528` Balanz Soja — `totalPct = 215,7` con 6 items. **Único caso de HTML anómalo del
  universo**, y la advertencia existente lo detecta.

**El "universo completo" existe.** La hipótesis del spec —que quizá solo 20 fondos tuvieran cartera
usable y hubiera que elegir un corte— no se cumplió: se llega al 98,4 % del patrimonio sin definir
ningún criterio de corte arbitrario. Esa decisión del dueño no hace falta.

**Advertencia sobre `UMBRAL_COBERTURA_MINIMA = 95`:** dispara en **42 de 60** fondos. Sobre 12
fondos elegidos a mano era una alarma; sobre el universo entero sería ruido en el 70 % de los
casos. Es un dato para F9.143, no un fix acá.

## §3 — El costo no es un problema

Medido, no estimado, sobre los 60 fetches (fetch + parseo, sin la pausa):

```
min 11 ms · p50 523 ms · p90 572 ms · max 685 ms · media 433 ms
total de los 60 en serie: 26,0 s
```

Con `PRESUPUESTO_MS = 100.000` y el timeout de 120 s que ya tiene `sincronizarCafci`:

- con la media medida: **entran 231 fondos**
- con p90 (conservador): **entran 174 fondos**
- los 54 usables: **~23 s**

**No hace falta paginar, ni subir el timeout, ni mover nada a un cron por razones de tiempo.** El
presupuesto actual sobra por un factor de ~4. (Que convenga un cron por otras razones —que el
benchmark no dependa de que alguien apriete un botón— es una decisión aparte, no un problema de
costo.)

## §4 — Las cuatro variantes

Contra la corrida vigente. **A se validó contra `calcBenchmark` llamada con las carteras juntas:
diferencia máxima 2,78e-17**, o sea la descomposición por fondo es exacta y las cuatro variantes
son comparables entre sí.

`A` = 11 fondos equiponderado · `B` = 11 ponderado · `C` = 54 equiponderado · `D` = 54 ponderado.
(11 y no 12 porque Pionero Acciones Plus queda fuera por base < 40.)

| ticker | propio | base F9.142 | A | B | C | D | B−A (pond.) | C−A (univ.) | D−A |
|---|---|---|---|---|---|---|---|---|---|
| TRAN | 22,69% | 1,81% | 1,42% | 2,42% | 2,12% | 2,44% | +1,00 | +0,70 | +1,02 |
| YPFD | 22,11% | 19,82% | 20,01% | 19,46% | 18,07% | 18,98% | −0,55 | −1,94 | −1,03 |
| PAMP | 16,10% | 14,03% | 14,05% | 13,91% | 14,01% | 14,10% | −0,15 | −0,04 | +0,04 |
| VIST | 14,29% | 1,96% | 2,05% | 3,12% | 2,38% | 3,42% | +1,06 | +0,32 | +1,37 |
| TGSU2 | 6,69% | 5,22% | 5,87% | 5,96% | 6,21% | 5,86% | +0,09 | +0,34 | −0,01 |
| BMA | 5,66% | 10,68% | 10,41% | 8,92% | 9,47% | 10,10% | −1,49 | −0,94 | −0,30 |
| GGAL | 3,80% | 18,04% | 17,81% | 16,31% | 16,69% | 15,95% | −1,51 | −1,12 | −1,86 |
| CEPU | 2,92% | 6,69% | 6,80% | 6,37% | 7,02% | 6,77% | −0,44 | +0,22 | −0,03 |
| TXAR | 2,46% | 3,83% | 3,70% | 3,81% | 2,51% | 2,82% | +0,11 | −1,19 | −0,88 |
| BBAR | — | 7,65% | 7,75% | 8,04% | 6,76% | 7,80% | +0,29 | −0,99 | +0,04 |
| BYMA | — | 4,45% | 4,55% | 5,08% | 3,96% | 4,27% | +0,53 | −0,60 | −0,28 |
| SUPV | — | 1,08% | 1,16% | 1,77% | 1,39% | 1,99% | +0,61 | +0,23 | +0,83 |
| LOMA | — | 1,44% | 1,33% | 0,86% | 1,80% | 1,33% | −0,47 | +0,47 | 0,00 |
| TGNO4 | — | 0,95% | 1,03% | 1,43% | 1,56% | 1,02% | +0,40 | +0,53 | −0,01 |
| TECO2 | — | 0,94% | 1,01% | 1,87% | 0,69% | 0,88% | +0,86 | −0,32 | −0,13 |
| ECOG | — | 0,76% | 0,59% | 0,24% | 1,50% | 0,61% | −0,35 | +0,91 | +0,02 |
| CRES | — | 0,22% | 0,24% | 0,29% | 0,68% | 0,37% | +0,06 | +0,44 | +0,14 |
| ALUA | — | 0,19% | 0,21% | 0,14% | 0,52% | 0,39% | −0,07 | +0,31 | +0,18 |
| EDN | — | — | 0,00% | 0,00% | 0,57% | 0,20% | 0,00 | +0,57 | +0,20 |

Distancia L1 (suma de |Δ| en puntos porcentuales):

```
A→B  solo ponderación                  10,03 pp
A→C  solo universo                     14,27 pp
A→D  las dos                            9,08 pp
C→D  ponderar sobre el universo grande 10,85 pp
```

**Ninguna de las dos hace casi todo el trabajo, y hay algo más interesante: se cancelan
parcialmente.** A→D (9,08 pp) es **menor** que A→B (10,03) y que A→C (14,27) por separado. Ampliar
el universo y ponderar por patrimonio empujan en direcciones opuestas, porque los fondos grandes
que entran al ponderar ya estaban casi todos en la config —la config eligió fondos grandes— y los
40 que agrega el universo son chicos y de composición más dispersa.

**El caso testigo del spec:** TRAN pasa de **1,42 % a 2,44 %** (D). Se mueve, pero contra un peso
propio de 22,69 % la lectura no cambia: la brecha va de ~21,3 pp a ~20,3 pp. **La conclusión de
concentración se sostiene en las cuatro variantes.** Lo mismo con VIST (2,05 → 3,42 % contra
14,29 % propio).

El movimiento más grande en términos absolutos es **GGAL, −1,86 pp** (17,81 → 15,95 %), y va en la
dirección de agrandar la brecha, porque lo propio es 3,80 %.

**Ojo con la columna "base F9.142":** no es directamente comparable con A. La línea de base se
calculó sobre las carteras guardadas en Firestore (más viejas) y con la config de 12 incluyendo
Pionero `39`; A usa fichas frescas del 24–31/07 y son 11. Las diferencias de hasta 0,4 pp entre
esas dos columnas son eso, no un cambio de definición.

## §5 — La ponderación NO dispara la consulta al dueño

Aporte de cada fondo al benchmark ponderado (variante D), top 8:

```
1. 10,90%  Superfondo Acciones
2.  9,79%  Superfondo Renta Variable
3.  6,43%  Fima Acciones
4.  5,81%  Galileo Acciones
5.  4,60%  FBA Acciones Argentinas
6.  4,43%  Compass Crecimiento
7.  4,21%  Consultatio Acciones Argentina
8.  4,18%  Schroder Renta Variable
```

**Los tres más grandes explican 27,1 %.** El umbral que el spec fijó para plantear la disyuntiva
era 60 %: **no se supera, ni de cerca.**

```
HHI de los aportes:  D = 0,0470  → 21,3 fondos efectivos
                     C = 0,0185  → 54 fondos efectivos (1,85% cada uno)
```

El temor de §5 —"el benchmark pasa a estar dominado por dos o tres fondos grandes"— **no se
verifica**. Superfondo Acciones, que solo él vale casi tanto como los doce de la config, aporta
10,9 % del benchmark ponderado. La razón es que el segmento tiene una cola larga: 54 fondos usables
y el #1 no llega al 11 % del patrimonio.

Eso no zanja la pregunta de diseño —equiponderar y ponderar siguen respondiendo preguntas
distintas: *qué hace el gestor típico* contra *cómo se mueve el dinero del segmento*— pero la saca
del terreno del riesgo de concentración. Con estos números es una elección de significado, no de
robustez.

---

## Lo que queda para F9.143

Todo lo que el spec pedía medir dio verde, así que las tres decisiones que quedan abiertas son de
significado, no de viabilidad:

1. **Equiponderar o ponderar** (§5) — ninguna es más frágil que la otra.
2. **Qué hacer con `UMBRAL_COBERTURA_MINIMA = 95`**, que sobre el universo entero dispara en 42 de
   60 fondos.
3. **Cómo se refresca el universo** — el join catálogo ⋈ planilla es barato y estable, pero define
   con qué frecuencia entra o sale un fondo del benchmark.
