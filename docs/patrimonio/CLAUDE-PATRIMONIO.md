# Patrimonio — Anexo de CLAUDE.md

> Vista privada de análisis de patrimonio/portfolio, **dentro** de la app
> Gastos-Familiares pero **aislada** de los datos de gastos.
> Este archivo es el contrato de la parte Patrimonio. El `docs/CLAUDE.md`
> principal solo lo referencia; no se mezclan.

## Cómo referenciarlo desde el CLAUDE.md principal

Agregar en `docs/CLAUDE.md` una sección puntero (no volcar contenido acá):

```
## Anexo: Patrimonio
Vista privada de portfolio, aislada de gastos (colecciones propias, sin puente).
Contrato completo en docs/CLAUDE-PATRIMONIO.md.
```

---

## Qué es esto

Un módulo de análisis de patrimonio de inversión que vive como **una solapa
privada más** ("Patrimonio") en la app existente. Reusa el caparazón de
Gastos-Familiares (auth, Firestore, Functions, Storage, design system, deploy)
pero **no comparte datos** con la parte de gastos. Sin puente entre ambos:
ningún dato cruza en ninguna dirección.

El objetivo del dueño: **mantener el valor medido en USD**, entendiendo los
riesgos de cada posición. El sistema **propone, mide y muestra riesgos**;
nunca ordena ni dispara alarmas. Las decisiones las toma el usuario.

---

## Objetivo y política (decisiones cerradas)

- **Vara de medida:** USD. Todo se juzga en dólares.
- **Horizonte:** 1–3 años.
- **Postura:** crecer aunque oscile (apetito por renta variable alta).
- **Unidad medida:** la **familia como una sola entidad**. Se mide el total,
  sin separar la parte personal de las cuentas conjuntas.
- **Filosofía:** proponer, medir y mostrar riesgos. Nunca prescribir **incondicionalmente**.
  La guía por casos (condición → opciones → costo) es el formato permitido de acción; la decisión la toma siempre el titular.
  Los semáforos son resumen visual de dónde se concentra el riesgo, no alarmas.
  El diario registra y contrasta decisiones; nunca las puntúa — la revisión es del dueño.

---

## Alcance y aislamiento (decisiones cerradas)

- El patrimonio es una **vista privada dentro** de la app, no una app separada.
- **Aislamiento de datos:** colecciones nuevas y propias
  (`posiciones`, `snapshotsPortafolio`, `informesPortafolio`), que **nunca**
  tocan `movimientos`, `comprobantes`, ni ninguna colección de gastos.
- **Visibilidad:** la solapa "Patrimonio" se renderiza en el nav **solo para el
  admin/dueño** (jpcofano@gmail…), scopeada por el modelo `autorizados`
  existente (`esAdmin()` o `memberId` propio). Los dependientes no la ven ni
  tienen acceso de lectura.

---

## Stack (reuso del caparazón)

- Frontend: React 18 + Vite + TS PWA (el existente).
- Backend: Firebase — Auth, Firestore, Cloud Functions (Node 22), Storage,
  Hosting (los existentes).
- Design system, AppShell/navegación y pipeline de deploy: reusados.

---

## Flujo de ingesta (decisión cerrada — reemplaza la auto-ingesta)

La extracción de PDFs **no** ocurre dentro de una Cloud Function. Ocurre en
una **ventana de Claude aparte**, con un prompt fijo. La app solo recibe un
`.txt` ya estructurado.

1. **Extracción (ventana de Claude aparte):** el usuario pega el prompt fijo
   + los resúmenes de las cuentas → Claude lee, clasifica sector/país, y
   devuelve **solo** el JSON del contrato (ver abajo). La revisión humana
   pesada ocurre acá.
2. **Carga (app, botón Patrimonio):** el usuario sube el `.txt` →
   la app valida contra el esquema → pantalla de confirmación → escribe en
   `posiciones` + crea un `snapshotsPortafolio` fechado → regenera las solapas.

Consecuencia: la app **no** hace detección-de-fuente ni parser por bróker ni
llamadas online para precios/TC. Solo valida, convierte ARS→USD vía `tcDiario`
y calcula.

---

## Contrato del `.txt` (esquema — decisión cerrada)

JSON dentro del `.txt`. La extracción deja cada posición en su **moneda
original**; el `valor_usd` lo calcula la app (ver conversión).

```json
{
  "meta": {
    "fecha_corrida": "2026-07-01",
    "entidad": "familia",
    "fuentes": ["balanz_402665.pdf", "balanz_1120830.pdf", "acciones.pdf", "cripto.pdf"],
    "total_declarado_usd": 111000
  },
  "posiciones": [
    {
      "cuenta": "Balanz 402665",
      "titular": "Lascano y/o Cofano",
      "ticker": "TRAN",
      "tipo": "accion",
      "sector": "energia",
      "pais_riesgo": "AR",
      "moneda_origen": "ARS",
      "valor_origen": 22250000,
      "cantidad": 4068,
      "fuente": "balanz_402665.pdf",
      "revisar": false
    }
  ]
}
```

- `tipo` ∈ `accion | bono | on | cedear | fci | cripto | cash`
- `pais_riesgo` ∈ `AR | global`
- `moneda_origen` ∈ `ARS | USD`
- `revisar: true` marca lo que Claude no pudo resolver con certeza (dispara
  atención en la pantalla de confirmación).
- `total_declarado_usd` sirve de checksum contra la suma que calcula la app.

Definir el tipo TS `Posicion` espejo de este esquema (no reusar los tipos de
gastos).

---

## Conversión ARS → USD (decisión cerrada)

- La app calcula `valor_usd` **al cargar**, no la ventana de chat:
  - `moneda_origen == USD` → `valor_usd = valor_origen`.
  - `moneda_origen == ARS` → `valor_usd = valor_origen / tcDiario[fecha_corrida]`.
- `tcDiario` es la **única fuente autoritativa** del tipo de cambio (colección
  ya existente en la app). Mismo criterio que `tcUsdArs` en gastos.
- El snapshot guarda el TC efectivamente usado, para trazabilidad.

---

## Colecciones nuevas y reglas de acceso

- `posiciones` — foto vigente (una fila por tenencia).
- `snapshotsPortafolio` — histórico fechado ("la película, no la foto").
  Requisito desde el día uno, no retrofit.
- `informesPortafolio` — informes generados (por solapa y fecha).

Reglas: `allow read, write: if esAdmin()` (o scopeadas al `memberId` del dueño).
Nunca legibles por dependientes. Nunca referencian colecciones de gastos.

---

## Solapas / informes (decisión cerrada)

1. **Tenencias** — consolidadas por ticker, con desglose por cuenta al expandir; ninguna tenencia queda oculta (regla: agrupación visible, nunca agrupación que esconde).
2. **Concentración / foto** — con semáforos (ver bandas).
3. **Rebalanceo / Plan** — menú de opciones medidas + riesgos de cada una
   (no una recomendación única); incluye **Diario de decisiones** (F9.94):
   registro con snapshot de métricas al crear, revisión a 30/90 días con
   tabla entonces→hoy. El diario registra y contrasta; nunca puntúa —
   la revisión es del dueño.
4. **Research sectorial** — informe de juicio (nacional + internacional); incluye **Calendario de eventos** (F9.95/F9.95.1): línea de tiempo fusionada con eventos por posición (chip ticker) + agenda macro día por día (chip driver: CER/Tarifas/Fed/etc.) generada por IA con botón manual. Análisis con caché cargado al montar.
5. **Configuración** — posiciones manuales, activos fijos, toggle IA; futuras: actualización de precios de referencia (capa informativa, nunca pisa la corrida) y ajustes manuales trazables entre corridas.
6. **Benchmark vs CAFCI** — al final (fase diferida).

---

## Motor de análisis (decisión cerrada — A1)

- **Determinístico → código puro en Functions/TS, sin API.** Tenencias,
  métricas, concentración, HHI, y toda la matemática del rebalanceo
  (el efecto de cada opción se calcula, no se opina). Instantáneo, gratis,
  reproducible.
- **Sectorial (de juicio) → vía API de Anthropic**, implementado, **con un
  toggle activar/desactivar** por control de costo.

---

## Métricas (decisión cerrada — set completo, A3)

Base:
- Concentración del nombre más grande (top-1).
- Peso por sector.
- Peso por país (AR vs global).
- % en renta variable (informativo, ver salvedad).

Completo:
- HHI (concentración global; umbrales estilo DOJ).
- Concentración acumulada top-3 y top-5.
- **Drivers de riesgo** — agrupar por: regulatorio/tarifario, precio de
  commodity, macro/tasas AR, inflación/CER, crédito soberano, cripto, global.
  (La más valiosa para este portfolio.)
- Exposición cambiaria: USD duro vs ARS vs cripto.
- Breakdown por clase de activo: RV / RF / cripto / cash.

---

## Semáforos: bandas propuestas (A4 — estándar, ajustables)

Referencias: regla UCITS 5/10/40 para nombres; umbrales HHI del DOJ.

| Métrica          | 🟢 Verde | 🟡 Amarillo | 🔴 Rojo |
|------------------|---------|------------|--------|
| Nombre único     | ≤ 5%    | 5–10%      | > 10%  |
| Sector           | < 25%   | 25–40%     | > 40%  |
| País único       | < 40%   | 40–60%     | > 60%  |
| Cripto (clase)   | < 10%   | 10–20%     | > 20%  |
| HHI              | < 0,15  | 0,15–0,25  | > 0,25 |

**Salvedad:** el **% en renta variable NO lleva semáforo**. Es descriptivo,
no un riesgo a limitar — el perfil quiere RV alta. Pintarlo de rojo
contradiría la postura. Va como número informativo, sin color.

---

## Orden de trabajo (fases)

1. **Receta/contrato** (este documento) → pasar a Claude Code para documentar
   e implementar el esqueleto.
2. **Validar** la lógica de los informes contra PDFs reales hasta confiar.
3. **Enchufar la vista privada** en la app (barato: caparazón, auth, patrón
   de ingesta y deploy ya existen).

---

## Artefactos a producir

- `docs/prompts/patrimonio-extraccion.md` — el **prompt-de-pegar** para la
  ventana de Claude. **PENDIENTE de calibración** contra la forma real de cada
  fuente (ver A5). Debe: leer las fuentes, extraer toda tenencia, clasificar
  sector/país, y devolver solo el JSON del contrato.
- Tipo TS `Posicion` (+ `SnapshotPortafolio`, `InformePortafolio`).
- Reglas de Firestore para las colecciones nuevas.
- Vista `Patrimonio.tsx` (+ subvistas por solapa) en `src/vistas/`.
- Functions determinísticas de análisis + Function sectorial (API, con toggle).

---

## Pendientes / decisiones abiertas

- **A5 — Fuentes a documentar (bloqueante para el prompt):** un archivo por
  cuenta. Cuentas conocidas hasta ahora:
  - Balanz 402665 (conjunta, Lascano y/o Cofano)
  - Balanz 1120830 (Cofano)
  - Cuenta de acciones (Estado de cuenta / "Portfolio RAW", trae VALOR CORRIENTE)
  - Cripto (definir: resumen de exchange o carga manual)
  *Los archivos no llegaron a la sesión donde se definió esto; re-subir en la
  cuenta nueva para calibrar el prompt y documentar cada formato.*
- **Micro-decisión #2 (propuesta, a confirmar):** que la app solo **valide el
  esquema + una pantalla de confirmación**, sin re-edición campo a campo
  (la revisión pesada ya ocurre en la ventana de chat).
- **Fuente de cripto:** ¿exchange con export, o carga manual del valor USD?

---

## Roadmap de fases (estado al 04/07/2026)

Implementación en cadena (cada una depende de la anterior):
- **F9.90** — Ingesta `.txt` + activos fijos + doble lente *(cerrado)*
- **F9.90.1** — Posiciones manuales ACN/GLOB (planes de empleado) *(cerrado)*
- **F9.90.2** — Resumen sin Recomendaciones + chips neutros *(cerrado)*
- **F9.91** — Opciones medidas + escenarios de estrés + evolución *(cerrado)*
- **F9.91.1** — Tenencias consolidadas por ticker con desglose *(cerrado)*
- **F9.92** — Informe PDF completo bajo demanda + archivado *(cerrado)*
- **F9.93** — Análisis IA por posición + sectorial (toggle, caché, lote) *(cerrado)*
- **F9.93.1** — Wording condicional: `queHariaEnCadaCaso` en prompts + UI mini-cards *(cerrado)*
- **F9.93.2** — Solapa Configuración + cosmética Resumen/hero + fix Storage *(cerrado)*
- **F9.94** — Diario de decisiones: registro + revisión 30/90 d *(cerrado)*
- **F9.95** — Calendario de eventos: `proximosEventos` estructurados + `CalendarioCard` en Research + sección 11 PDF *(cerrado)*
- **F9.95.1** — Agenda macro día por día: modo `agenda` en `analizarConIA`, colección `agendaMacro`, fusión en calendario *(cerrado)*
- **F9.96** — Aportes/retiros (`flujosPatrimonio`) + retorno real Modified Dietz *(cerrado)*
- **F9.97** — Benchmark CAFCI: comparación vs fondos ACCIONES_AR / BONOS_SOBERANOS_AR vía `cafciCarteras` *(cerrado)*
- **F9.98** — Optimización formal de portafolio *(cerrado)*
  - Yahoo Finance weekly (`query1.finance.yahoo.com/v8/finance/chart/{sym}?interval=1wk&range=2y`), caché 7d en `seriesPrecios`
  - TC: MEP de `tcDiario` como proxy CCL (diferencia <2%); activos AR excluidos con <40 puntos dolarizables
  - Ledoit-Wolf α=0.2 fijo → mínima varianza (gradiente proyectado) + risk parity (Newton cíclico MRT-2010)
  - Nueva colección `optimizacionPortafolio`; solapa "Optimización" en Patrimonio.tsx
  - Funciones: `obtenerSeriesPrecios` onCall; módulo `src/datos/patrimonioOptimizacion.ts` con 4 tests unitarios analíticos
  - Exploración de fuentes: `docs/patrimonio/f998-fuentes-series.md`
- **F9.99** — Análisis IA vía chat (sin costo API) *(cerrado)*
  - `generarPromptIA` onCall: reutiliza builders de `analizarConIA`, agrega instrucciones de formato, sin toggle ni API key
  - `importarAnalisisIA` onCall: valida esquema, persiste con `origen: 'chat'` + `generadoEn: FieldValue.serverTimestamp()`
  - Frontend: `ModalPromptChat` (2 pasos: Prompt → Importar); botón "Chat" en `AnalisisIASection` y en Research (sectorial + agenda)
  - Chip "vía chat" en sectorial y en análisis de posición cuando `origen === 'chat'`
  - `analizarConIA` refactorizado: `extraerResultado` helper (function declaration, hoisted); escribe `origen: 'api'`

- **F9.141** — Serie de precios diaria e indicadores técnicos por posición *(cerrado)*
  - data912 (`https://data912.com`), pública, sin API key. Colecciones `preciosDiarios` e
    `indicadoresPosicion`, un doc por ticker. Cron `actualizarPreciosDiarios`, 18:00 ART.
  - Contrato completo abajo, en "Precios y serie diaria".

- **F9.142** — La config de CAFCI gobierna el benchmark *(cerrado)*
  - `cargarUltimasCarteras` filtra por `configPatrimonio/cafci` y pagina hasta cubrir los fondos
    configurados, en vez de cortar en 50 documentos a ciegas.
  - Seed corregido: `15/15` (Pionero Acciones **Plus**) → `39/6174` (Pionero Acciones), fuera
    `514/1038` (fondo con patrimonio 0), etiqueta de `505/1021` sin la "s".
  - Contrato completo abajo, en "Benchmark CAFCI".
  - Auditoría previa y línea de base: `scripts/auditF9142.ts`,
    `docs/patrimonio/benchmark-baseline-F9142.json`. Verificación: `scripts/verificarF9142.ts`.

- **F9.143** — El benchmark es el segmento, ponderado por patrimonio *(cerrado)*
  - Universo derivado del join `consulta-de-fondos.json` ⋈ `pb_get`, guardado fechado en
    `cafciUniverso/{YYYY-MM-DD}`. Rebalanceo trimestral, fechas fijas.
  - `calcBenchmark` pondera por patrimonio **del fondo** (suma de clases), no equiponderado.
  - `UMBRAL_COBERTURA_MINIMA` 95 → 85, con log agregado en una línea.
  - Contrato completo abajo, en "Benchmark CAFCI (F9.143)".
  - Investigación previa: `docs/patrimonio/investigacion-universo-benchmark-resultados.md`,
    `docs/patrimonio/universo-rv-argentina-20260817.json`.

- **F9.144** — Ficha de posición sobre `indicadoresPosicion` *(cerrado)*
  - `src/vistas/FichaPosicion.tsx`, dentro de la card expandida de Tenencias, **antes** del
    análisis del modelo. Orden: TENENCIA → INDICADORES → DIAGNÓSTICO → (F9.147: análisis).
  - **Una ficha por IDENTIDAD (`ticker|tipo|paisRiesgo`), no por ticker.** GLOB muestra dos.
  - `MINIMO_PUNTOS` es gemelo declarado de las ventanas del motor: sirve para **explicar** una
    ausencia ("faltan puntos: 183 de 200"), nunca para calcular. Si el motor cambia una ventana,
    hay que tocar las dos.
  - Solo lectura. **Nunca `preciosDiarios` desde el cliente** (~30 KB por documento).
  - Verificación: `scripts/verificarF9144.ts`. Auditoría previa: `scripts/auditF9144.ts`.

Fases pendientes:
  *(Era "F9.142" en este roadmap; renumerada porque F9.142/F9.143 quedaron tomadas por el
  trabajo de CAFCI.)*

---

## Precios y serie diaria (F9.141) — contrato

### El panel se elige por `tipo`, nunca buscando el ticker

Buscar un ticker entre paneles devuelve precios equivocados, que es peor que no devolver
ninguno. Medido: la posición cripto **BTC existe como ticker listado en `usa_stocks`**, y los
seis CEDEARs (B, BIOX, CVX, GLOB, VIST, VZ) existen en `usa_stocks` como el subyacente en USD,
que no es el CEDEAR en ARS.

| `tipo` | panel live | panel histórico |
|---|---|---|
| `accion` con `pais_riesgo: 'AR'` | `arg_stocks` | `stocks` |
| `accion` con `pais_riesgo: 'global'` | `usa_stocks` | `usa_stocks` (solo cierre) |
| `cedear` | `arg_cedears` | `cedears` |
| `bono` | `arg_bonds` | `bonds` |
| `on` | `arg_corp` | — (`/historical/corp/` da 404) |
| `fci` | — (CAFCI, F9.104) | — |
| `cripto` | — (fuera de alcance) | — |
| `cash` | — (no tiene precio) | — |

Lo que no está en la tabla se marca `sin_fuente`. No se adivina.

**Valuación siempre por `c`**, nunca el punto medio de `px_bid`/`px_ask`: GLOB llegó a tener 25%
de spread entre puntas.

### `sa` no se usa. `dr` tampoco se guarda

`dr` es el retorno del cierre crudo, derivable de `c`, y viene **sin ajustar por splits**: el día
del split 10:1 de YPFD (2026-08-03) reporta −90,23% sobre un movimiento real de −2,35%.

`sa` no es el factor de ajuste, y no es rescatable:

- En el split de YPFD se mueve ×2,352, donde un 10:1 exigiría ×10 o ×0,1.
- No es monótono ni acumulativo — en BMA sube 2821 ruedas y baja 2747.
- **Queda contaminado por los mismos glitches que tendría que corregir.** El 2021-11-04 la fuente
  publicó DICP y GD30 divididos por 1000 y los devolvió al día siguiente; `sa` tomó el valor del
  retorno roto (1004,4372, igual a `dr`) y quedó congelado ahí.

Ninguno de los dos se persiste, para que nadie los use más adelante creyendo que están ajustados.

### El detector de splits marca; no reescala

Solo dos capas modifican los precios, y las dos son certeza, no inferencia:

1. **Tabla curada** `SPLITS_CONFIRMADOS`, a mano.
2. **`cantidad` entre corridas**: si la cantidad se multiplicó por N y el precio implícito se
   dividió por N, está probado con dato propio.

La tercera capa — reconocer razones simples (10, 5, 4, 3, 2, 3/2 y sus inversas) en saltos de
más de 35% — **corre siempre en modo reporte y nunca toca la serie.** Medido sobre las series
completas de los 16 tickers con historia: en la ventana de 750 días que se retiene detecta 6
saltos con razón simple y **solo uno es un split**. Los otros cinco son eventos macro y
amortizaciones de bonos:

```
YPFD  2026-08-03  −90,23%  razón 10     ← split real
TRAN  2023-08-04  +48,79%  razón 0,667  ← rebote de la devaluación post-PASO
DICP  2023-08-04  +52,38%  razón 0,667  ← ídem
TX26  2023-08-04  +52,24%  razón 0,667  ← ídem
TX26  2025-11-07  −35,19%  razón 1,5    ← amortización
TX26  2026-05-08  −49,76%  razón 2      ← amortización
```

Reescalar por parecido habría corrompido cinco series con un factor inventado. Lo que la capa 3
ve queda en `saltosDetectados` y mueve `estadoSerie` a `sospechosa`, para que un humano lo
resuelva y, si es un split, lo agregue a la capa 1.

### `estadoSerie` manda sobre qué se calcula

| estado | qué se calcula |
|---|---|
| `limpia` | todo |
| `ajustada` | todo; los splits aplicados quedan en `splitsAplicados` |
| `sospechosa` | solo ventanas que entran enteras después del último salto sin resolver |
| `sin_serie` | nada; el ticker existe en el panel live pero la fuente no tiene historia |

### Mínimos de puntos, sin excepciones

Ningún indicador se calcula sobre menos puntos que su ventana. SMA200 sin 200 puntos válidos
es `null` con semáforo `sin_datos`, nunca una media de 200 días sobre 40 datos. Los mínimos se
cuentan **después** de recortar por `estadoSerie`, y `puntosDisponibles` queda visible en el doc
para que la ausencia se entienda.

Consecuencia medida de esto: `/historical/cedears/` arranca el 2025-11-12 para todos, o sea
**183 puntos**. Ningún CEDEAR tiene SMA200, `max52s` completo ni `perf1a`, y no es un bug.

`/historical/usa_stocks/` devuelve `{ticker, dates[], prices[]}` — **solo cierre, sin OHLCV**.
Para ACN y GLOB-global eso deja `atrPct` y todos los indicadores de volumen en `null`
permanente. No se sustituye por la serie del CEDEAR: está en ARS y mezcla el movimiento del
papel con el del dólar.

### El contrato de errores de data912 no se lee por status HTTP

- Ticker inexistente → **HTTP 200** con `{"Error":"Nahh no tengo ese ticker loko"}`
- Ruta inexistente → HTTP 404 con `{"detail":"Not Found"}`

No hay 422. Discriminar por status guardaría el objeto de error como si fuera una serie: la
validación es sobre la forma del payload.

### Un ticker no identifica una posición (F9.141.1)

Lo que determina el ruteo es la tripleta **`ticker` + `tipo` + `paisRiesgo`**, y esa es la clave
del universo de objetivos. GLOB es el caso testigo: el CEDEAR de la corrida y el plan de empleado
en dólares comparten símbolo y no son el mismo instrumento — uno cotiza en ARS en BYMA y el otro
en USD en Nueva York. Agruparlos por ticker le colgaría al plan de empleado los indicadores del
CEDEAR, que es el falso positivo de BTC entrando por la puerta de atrás: F9.141 lo cerró en el
routing y quedaba abierto en la identidad.

**Convención de id:** ticker pelado mientras no haya ambigüedad; cuando dos posiciones comparten
símbolo, la de la corrida conserva el ticker pelado y las demás se sufijan
(`GLOB` y `GLOB__accion_global`). Así una colisión nueva no renombra documentos que ya existen.

**El cliente nunca construye el id.** Cada documento lleva su propio `docId`, y
`src/datos/patrimonioPrecios.ts` indexa `indicadoresPosicion` por la tripleta leída de los campos
y usa ese `docId` para ir a buscar la serie. Si el cliente recalculara la convención habría dos
implementaciones de la misma regla y la ambigüedad se decidiría distinto en cada lado.

### Lo que `sospechosa` cuesta de verdad (F9.141.1 §0)

Medido sobre las 10 series marcadas: **19 de los 21 saltos pendientes son eventos macro**
verificables (17 la devaluación post-PASO del 3–4/8/2023, 2 el post-balotaje del 21/11/2023) y
**2 son amortizaciones de TX26**. Ningún split sin clasificar.

Y el costo es casi nulo: la ventana usable queda en 739 de 750 puntos para siete series y en 667
para TRAN y YPFD. **Nueve de las diez conservan `sma200`, `max52s`, `perf1a` y `volAnualizada90d`
completos.** La única que pierde todo es TX26, con 68 puntos — y su causa es la amortización de
mayo, no el macro. Para un bono que amortiza, no tener indicadores de ventana larga es el
resultado correcto, no una degradación.

Conclusión: **no hay nada que hacer con los saltos macro.** Clasificarlos como "evento de
mercado" para recuperar 11 puntos de serie no paga la complejidad de mantener un catálogo de
fechas macro.

### `/historical/` no soporta rango (F9.141.1 §3 — medido, no aplicable)

El contrato declarado en `https://data912.com/openapi.json` da un solo parámetro para los tres
endpoints históricos: `ticker:path`. Probadas nueve grafías (`from`, `desde`, `start`,
`start_date`, `range`, `days`, `limit`, `period`, `interval+range`), las nueve devuelven las 4766
filas completas de PAMP. **El fetch incremental no es implementable**; el cron seguirá bajando la
serie entera. Punto cerrado.

Nota del mismo relevamiento: `/historical/usa_stocks/{ticker}` **no figura en el OpenAPI** aunque
responde 200. ACN y las acciones globales dependen de un endpoint fuera del contrato publicado.

### Yahoo puede sembrar splits, pero su feed no se copia crudo (F9.141.1 §2)

El gate del §2 **pasa**: Yahoo reporta `YPFD.BA 10:1 el 2026-08-03`, exactamente el caso testigo,
y no reporta nada para TRAN, DICP ni TX26 en las fechas de sus saltos (los dos bonos ni siquiera
existen en Yahoo: 404).

Pero el feed **mezcla splits con dividendos en acciones**, y los codifica igual:

```
BMA.BA    2023-05-23 1.09:1 · 2023-06-05, 06-27, 07-26, 08-28, 09-26  1.090364:1
TGSU2.BA  2019-11-11 1.038487:1
CEPU.BA   2017-02-03 8:1
YPFD.BA   2026-08-03 10:1
```

Sembrar eso sin filtro aplicaría seis reescalados de 1,09 a BMA, que hoy es `limpia` con 750
puntos y ningún salto. Es el mismo modo de falla que motivó que la capa 3 no reescale, entrando
desde una fuente que parece confiable.

Si se implementa, hace falta un umbral explícito (razón ≥ 2 o ≤ 0,5 como split; el resto se
reporta como dividendo en acciones y no se siembra). **Con ese umbral, hoy no agrega ninguna
entrada dentro de la ventana de 750 días**: CEPU 8:1 es de 2017 y YPFD 10:1 ya está en la tabla.
El valor de la siembra es prospectivo — atrapar el próximo split sin que nadie lo investigue.

### Dónde vive el motor

En `functions/src/patrimonioPrecios.ts`, **no** en `src/datos/`. El cron es quien calcula, y
`functions/` tiene `rootDir: "src"` propio: no puede importar de `src/`. Para no repetir el
error de tener dos motores, `src/datos/patrimonioPrecios.ts` solo **lee** las dos colecciones y
no reimplementa nada de la tabla ni de los indicadores.

---

## Benchmark CAFCI (F9.143) — qué mide hoy

**El benchmark es el segmento de renta variable argentina, ponderado por el patrimonio de cada
fondo.** No es un promedio de fondos elegidos a mano, y no es equiponderado.

Eso responde la pregunta *cómo se mueve el dinero del segmento*. La versión anterior
(doce fondos, equiponderado) respondía *qué hace el gestor típico*. **Son dos benchmarks
distintos, no uno bueno y uno malo** — el número viejo no estaba roto, medía otra cosa. La
única foto del anterior es `docs/patrimonio/benchmark-baseline-F9142.json`.

### El universo se deriva, no se configura

`cafciUniverso/{YYYY-MM-DD}` es la fuente de verdad del universo, y se construye con un join
determinístico de las dos fuentes de CAFCI:

1. `estadisticas.cafci.org.ar/consulta-de-fondos.json` — filtrar `tipo_renta = 'Renta Variable'`,
   `region = 'Argentina'`, `moneda = 'Peso Argentina'`. Aporta identidad y, sobre todo, el
   **`fondo.id` que es el `fondoId` de la URL de ficha**, junto con `clases[].id` (= `claseId`).
2. `api.pub.cafci.org.ar/pb_get` — planilla diaria XLSX, **una fila por clase**. Aporta el
   patrimonio, joineando por `claseId` = columna `Código CAFCI`.

Ninguna de las dos alcanza sola: el catálogo no trae patrimonio y la planilla no trae el
`fondoId`. La columna `Id Fondo CAFCI padre` de la planilla **parece** ser ese id y viene
**vacía en las 4.236 filas** — no usarla. (F9.105 daba por sentado que había que scrapear el
buscador por nombre para resolver el `fondoId`; no hace falta, el catálogo lo trae.)

### **El patrimonio es del FONDO, no de la clase**

Es la trampa central de esta fase. **54 de 60 fondos del segmento tienen más de una clase**, y
el patrimonio en la planilla viene por clase. El patrimonio con el que un fondo pondera es la
**suma de todas sus clases**.

Testigo: Superfondo Renta Variable (`fondoId 51`) tiene **nueve** clases y suma
**ARS 175.889 M**. La config apuntaba a su Clase B, que sola vale **ARS 39.084 M**. Ponderar por
la clase configurada lo subestimaría **4,5×**.

Es el mismo error de identidad que ya se pagó con Pionero y con GLOB, con otra cara: confundir
la parte con el todo. El `claseTop` (la clase de mayor patrimonio) se usa **solo para armar la
URL de ficha** — la cartera es del fondo, no de la clase.

### Calendario: rebalanceo trimestral, fechas fijas

El universo se recalcula el **primer día hábil de enero, abril, julio y octubre**. Fechas fijas
y no "cada 90 días", para que dos mediciones del mismo trimestre sean comparables sin tener que
pensar.

Entre rebalanceos el universo **no cambia**, aunque la planilla se actualice todos los días.
Un fondo que crece, se achica, entra o sale del segmento en febrero entra al benchmark en abril.

Se guardan el universo **vigente y el anterior** (`cafciUniverso`, id = fecha de cálculo), y
cada cálculo de benchmark registra cuál usó. Sin eso, un salto dentro de seis meses no se puede
atribuir: ¿cambió la cartera, el mercado, o entró un fondo? Es la misma lógica de la línea de
base de F9.142, que ya sirvió dos veces.

### El monitor de deriva avisa, no actúa

`scripts/monitorDerivaCafci.ts` rehace el join y compara contra el universo vigente: qué fondos
entrarían, cuáles saldrían, y **cuánto se movió el patrimonio de los que ya están** — este
último es el que importa con ponderación por patrimonio, porque un fondo grande que se achica
mueve el benchmark aunque no entre ni salga nadie.

**No rebalancea, y no debe hacerlo.** El rebalanceo es trimestral. El monitor existe para que el
recálculo del trimestre siguiente sea una decisión informada en vez de una sorpresa.

`pb_get` soporta `If-Modified-Since` → **304**, así que consultar si cambió cuesta casi nada.

**No hay umbral de aviso todavía**, a propósito: no hay base para elegirlo y un umbral
arbitrario es peor que ninguno. Se define con el primer trimestre de datos.

---

## Benchmark CAFCI (F9.142) — contrato

### La config es la fuente de verdad del universo; `cafciCarteras` es historia

**Superado por F9.143 en cuanto al universo** (ahora se deriva, ver arriba). Lo que sigue vale
para entender `cafciCarteras`, la identidad de un `fondoId` y por qué `configPatrimonio/cafci`
sigue existiendo como override manual.

`configPatrimonio/cafci` define **qué fondos componen el benchmark**. `cafciCarteras` es el
registro histórico de lo que se descargó, y se **filtra en lectura**: nunca se borra un
documento para sacar un fondo del cálculo.

Antes de F9.142, `cargarUltimasCarteras` leía la colección sin mirar la config. Sacar un fondo
desde la UI lo sacaba de la sincronización pero **no del benchmark**: su última cartera seguía
pesando para siempre, y no había forma de corregirlo desde la aplicación. Los documentos
huérfanos no son basura —sirven para reconstruir una corrida vieja— pero no votan.

Corolario: **agregar un fondo nuevo para reemplazar a otro no reemplaza nada** si el viejo no
sale de la config. Con `15/15` y `39/6174` configurados a la vez, el benchmark tendría los dos
Pioneros.

### Qué fondo es un `fondoId`: la etiqueta de la config no es evidencia

`cafciCarteras.nombreFondo` y `.nombreClase` **no sirven para auditar la identidad de un
fondo**. En la vía automática, `sincronizarCafci` pasa `fondo.nombre` dos veces a
`parsearFichaCafci` (`functions/src/index.ts:3653`), así que ambos campos son un eco de la
etiqueta que escribió la config. Comparar uno contra otro da coincidencia perfecta siempre.
Solo `importarCafciManual`, y solo con el envoltorio JSON de la API vieja, extrae el nombre real.

Para verificar identidad hay que ir a la fuente:

- `https://estadisticas.cafci.org.ar/consulta-de-fondos.json` — catálogo completo (fondos,
  clases, CNV, tipo de renta, región). Es el que dice qué fondo es cada `fondoId/claseId`.
- `https://api.pub.cafci.org.ar/pb_get` — planilla diaria (xlsx) con **patrimonio por clase**.

Y hay que verificar **por patrimonio, no por nombre**: así nació el defecto de F9.142, con
`15/15` etiquetado "Pionero Acciones" cuando es "Pionero Acciones **Plus**", un fondo 8x más
chico y con 57% de CEDEARs brasileños. Los nombres se parecen demasiado para distinguirlos a ojo.

### El `claseId` elige la URL, no la cartera

La composición de cartera es del **fondo**, no de la clase: se verificó que el bloque es
idéntico entre `?clase=39` y `?clase=6174` del mismo fondo. El `claseId` solo cambia el
patrimonio y el valor de cuotaparte que muestra la ficha. Por convención la config usa Clase B.

### `BASE_FONDO_MINIMA` no es un filtro de calidad de fondo

El umbral de 40 (`src/datos/patrimonioCafci.ts`) existe para no renormalizar sobre una base
flaca, no para decidir qué fondo pertenece al segmento. Cuando atajó a Pionero Plus lo hizo por
casualidad y por siete décimas (base 39,30): una semana antes ese mismo fondo tenía base 41,00 y
entraba al promedio. **Un fondo que no corresponde al segmento se saca de la config**, no se
deja rebotar contra el umbral.

### Frescura: un fondo vacío sigue pesando un enésimo

*(F9.143: ya no pesa "un enésimo" sino en proporción a su patrimonio, lo que además desactiva
buena parte de este caso — un fondo con patrimonio 0 ni siquiera entra al universo. El párrafo
queda porque `fechaDatos` y `advertenciaCobertura` siguen siendo lo que hay que mirar antes de
creerle al promedio.)*

`calcBenchmark` promedia equiponderado y no mira la fecha. Consultatio Renta Variable
(`514/1038`) tenía patrimonio **0** y su cartera congelada desde 2026-01-23 —CAFCI no publica
carteras nuevas de un fondo sin plata adentro— y aportaba un doceavo del benchmark con la foto
de enero. `fechaDatos` y `advertenciaCobertura` están en cada documento; conviene mirarlos
antes de creerle al promedio.

---

## Decisiones cerradas — no re-litigar

- Vara USD; horizonte 1–3 años; postura crecer aunque oscile.
- Unidad = familia como una entidad; se mide el total.
- Filosofía proponer/medir/mostrar, no alarmas. El diario registra y contrasta; nunca puntúa.
- Vista privada dentro de la app; datos aislados; sin puente con gastos.
- Ingesta: ventana de chat → `.txt` JSON → app valida/carga. No auto-ingesta,
  no parser por bróker, no online en la app.
- Conversión ARS→USD por la app vía `tcDiario`.
- Determinístico en TS; sectorial vía API con toggle.
- Set de métricas completo; bandas estándar (ajustables); RV sin semáforo.
- Historial fechado desde el día uno.
- Anexo en archivo propio; puntero desde el CLAUDE.md principal.
