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

Fases pendientes:
- **F9.142** — Ficha de posición (UI) sobre `indicadoresPosicion`. No incluida en F9.141.

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

### Dónde vive el motor

En `functions/src/patrimonioPrecios.ts`, **no** en `src/datos/`. El cron es quien calcula, y
`functions/` tiene `rootDir: "src"` propio: no puede importar de `src/`. Para no repetir el
error de tener dos motores, `src/datos/patrimonioPrecios.ts` solo **lee** las dos colecciones y
no reimplementa nada de la tabla ni de los indicadores.

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
