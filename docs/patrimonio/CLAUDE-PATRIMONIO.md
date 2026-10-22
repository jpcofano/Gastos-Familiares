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

- **F9.148** — Punto podrido, umbral del detector, semáforos y performance en dólares *(cerrado)*
  - §1 `PUNTOS_MALOS` marca (no borra) el 2023-08-03 de data912. Lista explícita de 82 símbolos,
    medida con un barrido completo de los tres paneles y validada contra Yahoo 37/37.
  - §2 `UMBRAL_SALTO` 0,35 → **0,45**, y la razón simple pasa a disparar sola. §1+§2 juntos:
    **9 de 10 series `sospechosa` → `limpia`, +234 ruedas**, cero regresiones.
  - §3 semáforo de liquidez **eliminado** (15/15 verdes, ninguna llega a 0,05 ruedas);
    `drawdown` → `caida52s`, que mide `distanciaMax52sPct`. No destrabó la distribución cargada.
  - §4 **solo** `perf1m/3m/6m/1a` en dólares. `tcDiario` backfilleado a 2023-06-01 (1.175 docs,
    sin huecos). `serieTcDeMercado` respeta la convención `D` = cierre de `D−1`.
  - Contrato completo abajo, en "Precios y serie diaria".
  - Verificación: `scripts/verificarF9148.ts`. Auditoría previa: `scripts/auditF9148.ts`.
    Backfill del TC: `scripts/backfillTcF9148.ts` (dry-run por defecto, `--apply` para escribir).

- **F9.150** — Semáforo en el renglón equivocado, drawdown ambiguo y seeds fósiles *(cerrado)*
  - El semáforo `volatilidad` colgaba de la fila de 30d y el motor lo calcula sobre **90d**.
    Dos casos reales donde mentía: GD30 (30d rojo, 90d amarillo) y TX26 (30d verde, 90d `n/d`).
  - Etiquetas: **"Caída desde máx. 52 sem."** (con semáforo) y **"Caída desde máx. histórico"**
    (sin). Difieren en 3 de 17, hasta **31,9 pp** en GLOB.
  - `MANUALES_SEED`: ACN corregido (50→43 papeles) y **GLOB eliminado** — sus 60 papeles del ESPP
    vienen en la corrida, así que el seed lo habría **duplicado**. Regla en `docs/CLAUDE.md`.
  - **Cero cambios en el motor**, verificado.
  - Verificación: `scripts/verificarF9150.ts`. Auditoría previa: `scripts/auditF9150.ts`.

- **F9.147** — Fundamentals y el orden de la salida del análisis *(cerrado)*
  - El contexto del prompt de posición pasó de **4 campos a la ficha entera**, por IDENTIDAD.
    `contextoPosicion` vive en `src/datos/patrimonioIA.ts` porque es puro y verificable.
  - Fundamentals **reportados**, marca `EXT`, con fuente y fecha obligatorias, bloque aparte y
    **sin semáforo**. 5–8 por tipo (`FUNDAMENTALS_POR_TIPO`); `null` explícito antes que inventar.
  - `recomendacion` + `justificacion` conviven con `queHariaEnCadaCaso`. La recomendación **solo
    se emite si cita indicadores por nombre y valor**; si no, `accion: null` con motivo.
  - El prompt prohíbe recalcular lo que ya viene en el contexto.
  - Contrato completo abajo, en "El análisis del modelo".
  - Verificación: `scripts/verificarF9147.ts`. Auditoría previa: `scripts/auditF9147.ts`.

- **F9.149** — El semáforo de caída se calibra contra la distribución del propio activo *(cerrado)*
  - CDaR (Chekhlov/Uryasev/Zabarankin 2005) sobre la curva de caída de ventana móvil de 52
    semanas: 🟢 bajo su mediana · 🟡 hasta CDaR(0,8) · 🔴 por encima. **Ningún número lo elige
    una persona.** `UMBRALES.caidaFija` queda como referencia, no gobierna.
  - `MINIMO_OBS_DRAWDOWN = 400`, **medido** con ventanas deslizantes, no elegido.
  - `ulcerIndex126` (Martin/McCann 1989) como número, **sin semáforo**.
  - `volatilidad` y `peso` sin tocar: un umbral por vez, o después no se puede atribuir qué mejoró.
  - Contrato completo abajo, en "Precios y serie diaria".
  - Verificación: `scripts/verificarF9149.ts`. Auditoría previa: `scripts/auditF9149.ts`.

- **F9.196** — Acciones, stops y cartera viva *(código cerrado el 21/10/2026; falta el deploy)*
  - H1/H1b clientes PPI y Bitfinex · H4 stops y señales · H2a sincronización de PPI y valor de hoy ·
    H2b/H3b/H3c Balanz por archivo y flujos automáticos · H2c Bitfinex · H5 tesis · H6 card
    "Acciones a mirar" y ficha reordenada.
  - Contratos abajo, en las secciones "F9.196 …".
  - Verificación: `scripts/verificarF9196.ts` y `functions/src/{ppiApi,h2a,h2c,h5,patrimonioStops}.test.ts`.

- **F9.196.1** — Ajustes después del deploy *(código cerrado el 22/10/2026; falta el deploy)*
  - H0 Balanz en dólares o en pesos · H1 flujos desde el 21/10, apareo al revés y "Para decidir" ·
    H2 ratio CEDEAR/ADR y valores absurdos · H3 candado de Bitfinex · H4 las dos fechas de Balanz ·
    H5 splits de PPI medidos, sin detector · H6 escala de data912 verificada.
  - Verificación: `scripts/verificarF9196.ts` (H0–H4 sintéticos), `verificarBalanzArchivo`,
    `verificarFlujosAuto` y `functions/src/{h2a,h2c,h5}.test.ts`.

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

### El punto podrido del 2023-08-03 se marca, no se borra (F9.148 §1)

data912 sirve una **fila OHLCV inventada** para el 2023-08-03 en los tres paneles argentinos.
Verificado contra Yahoo Finance (`.BA`): las dos fuentes coinciden **al centavo** en todas las
demás ruedas de la ventana de 750, y solo ese día difieren ~45%. El retorno real de PAMP fue
**−2,0%**, no −47,1%. No es un cierre mal capturado: es la fila entera, con volumen propio.

**La fuente no lo corrigió en tres años** — se volvió a pedir la serie el 2026-08-18 y devuelve
el mismo valor. Hay que asumir que vuelve en cada corrida.

`PUNTOS_MALOS` lo marca con `malo: true`; **el punto sigue en `serie`** y queda fuera de todo
cálculo (`soloBuenos`). Borrarlo haría que `preciosDiarios` no coincida con lo que la fuente
devuelve y la próxima sincronización lo traería de vuelta sin que nadie entienda por qué.
`puntos` cuenta lo que la fuente dio; `puntosMalos` explica por qué `puntosDisponibles` es menor.

**Es lista explícita, no comodín, y eso es una medición.** Barrido completo de los tres paneles
(2026-08-18): acciones **32 podridas de 60** con fila, bonos **18 de 41**, cedears **32 de 50**.
BMA, CEPU, ALUA, BBAR, COME y otras 23 acciones tienen el dato bien y un comodín les tiraría un
punto bueno. En los bonos, las especies en dólares (sufijo C/D) están sanas salvo BA37D. El
criterio —pozo de un día: se desvía >20% del vecino previo *y* del siguiente, con los vecinos a
menos de 15% entre sí— se validó contra Yahoo en 37 acciones: **37/37 de acuerdo**.

### `UMBRAL_SALTO` es 0,45, y la razón simple dispara sola (F9.148 §2)

Era 0,35 y fallaba de los dos lados:

- **Dejaba pasar** el rally REAL del 2025-10-27 (post-legislativas) cuando la serie se expresa en
  dólares: +28% en pesos más un MEP que cayó 6,8% da **+37%**, cruzaba el umbral, y
  `recortarPorEstado` tiraba **554 puntos en cinco series**. Era lo que bloqueaba §4.
- **Y dejaba invisibles** caídas del 33,4%, justo debajo del corte.

0,45 cubre el 37% del rally dolarizado y sigue por debajo del 50% de un split 2:1. Además el
umbral dejó de ser el único disparador: un movimiento se reporta si es grande **o** si su
cociente matchea una razón simple. Como la razón más chica es 1,5, ese segundo criterio no puede
disparar por debajo de ~30%, así que no agrega ruido — y es lo que sigue marcando las
amortizaciones de TX26 (2025-11-07 razón 1,5; 2026-05-08 razón 2).

**Efecto medido de §1 + §2 juntos:** 9 de las 10 series `sospechosa` pasan a `limpia`,
**+234 ruedas utilizables**, cero regresiones. Solo queda TX26. Los saltos del 2023-11-21 de TRAN
e YPFD eran **reales** (ballotage, confirmados por Yahoo) y eran falsos positivos del umbral viejo.

### El semáforo de liquidez se eliminó; el de rango mide 52 semanas (F9.148 §3)

**Liquidez: eliminado, no recalibrado.** Medido sobre las 16 series, `ruedasParaSalir` va de
**2,3e-6 a 1,8e-2** y daba verde en las 15 con dato. Ninguna llega siquiera a 0,05 ruedas: la
posición más ilíquida se liquida en el 2% de una rueda. Un semáforo que nunca cambia de color no
es información, entrena a no mirarlo. **El número sigue en la ficha**, que es lo que decide.

**`drawdown` → `caida52s`.** La referencia dejó de ser el máximo de toda la serie retenida y pasó
a `distanciaMax52sPct`. El máximo de la serie mide contra una ventana de 750 ruedas en unas
posiciones y de 183 en otras: el mismo semáforo comparaba cosas distintas.

**Esto NO destrabó la distribución cargada, y hay que decirlo:** entre las 12 series con las dos
referencias definidas, amarillo-o-rojo pasa de 8/12 a 7/12 — se mueve **una sola** posición
(TXAR). La hipótesis de que el punto podrido inflaba los drawdowns era falsa: ese punto es un
**pozo**, y un pozo nunca es el máximo desde el que se mide una caída. **El umbral sigue siendo
el problema abierto.**

Los dos semáforos retirados se borran con `FieldValue.delete()` en cada escritura: `set` con
`merge: true` **fusiona** los mapas anidados, así que sacarlos del objeto calculado no los saca
del documento — quedarían colgados con el valor de la última corrida vieja.

### El semáforo de caída se calibra contra la distribución del propio activo (F9.149)

Las bandas fijas por tipo de activo (🟢 <20% · 🟡 20–40% · 🔴 >40% para acción AR) **las inventó el
asistente en F9.141 §5**, no salieron de ningún lado, y marcaban 11 de 17 posiciones. Comparar el
drawdown de hoy contra un número fijo trata **una realización de un camino como si fuera una
distribución**: no medía riesgo, reflejaba que las acciones argentinas caen mucho.

**Método: CDaR** — Chekhlov, Uryasev y Zabarankin, *Drawdown Measure in Portfolio Optimization*
(IJTAF 8(1), 2005): el CVaR aplicado a las observaciones de drawdown. Por activo, sobre su propia
serie: 🟢 por debajo de su mediana · 🟡 entre mediana y CDaR(0,8) · 🔴 por encima de CDaR(0,8).
**Media de cola y no percentil**, por la misma razón que CVaR sobre VaR: con pocas observaciones
independientes, un promedio de cola es mucho más estable que un cuantil.

Se usa el objeto de CDaR y **no el de CED** (Goldberg y Mahmoud, *Drawdown: From Practice to Theory
and Back Again*, Math. Fin. Econ. 2016): CED distribuye *máximos de ventana*, que por construcción
son peores que una observación típica, así que comparar el drawdown puntual de hoy contra esa
distribución sub-marcaría sistemáticamente.

#### La distribución es la del MISMO estadístico que se clasifica

El spec construía la distribución con el máximo corrido (`dd_t = p_t / max(p_0..p_t) − 1`) pero
dejaba `distanciaMax52sPct` como valor clasificado. **Son objetos distintos** y clasificar X contra
la distribución de Y es un error: como `max(toda la serie) ≥ max(últimas 252)`, el valor de hoy es
sistemáticamente menor en magnitud que la curva contra la que se lo compara, y sub-marca.

Implementado con la curva de drawdown **de ventana móvil de 52 semanas**
(`dd_t = p_t / max(p_{t−251..t}) − 1`), que es el mismo objeto que `distanciaMax52sPct`. Medido: la
variante incoherente cambia la banda de 1 de las 13 series con datos (GLOB), así que hoy el costo
es chico — pero además la curva de ventana móvil es **mucho mejor estimador**, ver abajo.

#### El mínimo de observaciones está medido, no elegido

Ventanas deslizantes de largo N sobre la curva de drawdown, dispersión `(p90−p10)/valor_total` del
estimador entre ventanas, promediada sobre las 13 series largas:

| N | mediana (ventana 52s) | CDaR(0,8) (ventana 52s) | mediana (máx. corrido) | CDaR(0,8) (máx. corrido) |
|---|---|---|---|---|
| 150 | 112% | 47% | 148% | 64% |
| 200 | 82% | 27% | 130% | 55% |
| 250 | 51% | 16% | 104% | 47% |
| 300 | 34% | **4%** | 97% | 41% |
| 400 | **18%** | **3%** | 65% | 31% |

**`MINIMO_OBS_DRAWDOWN = 400`.** Es donde los dos estimadores son aceptables a la vez: CDaR(0,8)
varía 3% y la mediana 18%. A 300 el CDaR ya está estable (4%) pero la mediana todavía baila 34%.

**La curva de máximo corrido no se estabiliza nunca** en el rango disponible (31% de dispersión en
CDaR con N=400, diez veces peor). Es esperable: el máximo corrido es monótono no decreciente, así
que la curva tiene deriva de nivel y dos ventanas de la misma serie miden cosas distintas. Es la
segunda razón, independiente de la coherencia, para usar la ventana móvil.

Como la curva necesita 252 ruedas para dar su **primera** observación, una serie necesita
**652 puntos** para tener banda. Las tres de 183 puntos y TX26 (68) quedan en `sin_datos`, que es
lo correcto: no hay distribución que estimar.

#### Qué cambia en la cartera, medido

Umbral fijo `verde=5 amarillo=6 rojo=2 sin_datos=4` → calibrado `verde=3 amarillo=9 rojo=1
sin_datos=4`. **6 de 17 cambian de banda**, y los casos interesantes son los dos extremos:

| ticker | caída hoy | su mediana | su CDaR(0,8) | fija | calibrada |
|---|---|---|---|---|---|
| **GD30** | −17,2% | 10,4% | 15,6% | amarillo | **rojo** |
| **GLOB** | −48,6% | **62,4%** | 74,3% | rojo | **verde** |
| ACN | −36,9% | 30,1% | 45,8% | rojo | amarillo |
| GD35 | −6,4% | 3,2% | 7,7% | verde | amarillo |
| PAMP | −11,6% | 10,9% | 21,8% | verde | amarillo |
| TGSU2 | −14,2% | 10,4% | 20,3% | verde | amarillo |

**GD30 es el caso que justifica el método**: un bono que normalmente cae 10% y cuyo peor 20%
promedia 15,6% está hoy en 17,2%, o sea afuera de su propia cola — el umbral fijo de bonos
(8%/20%) lo llamaba amarillo. **GLOB es el caso inverso**: pasa la mayor parte del tiempo más de
62% abajo de su máximo de 52 semanas, así que −48,6% es *mejor* que lo típico para él, y el umbral
fijo de CEDEARs (15%/30%) lo pintaba rojo sin informar nada.

`UMBRALES.caidaFija` y `bandaCaidaFija` **no se borraron**: siguen disponibles para comparar hasta
que el método calibrado tenga uso suficiente.

#### Cómo se lee, y dos correcciones al spec que hay que tener presentes

🔴 significa *"este papel estuvo así de caído o peor solo una fracción chica del tiempo de su
historia"*. **Es porcentaje de tiempo, no probabilidad de un evento**, y esa distinción no es
pedantería: las observaciones diarias de drawdown están fuertemente autocorreladas —un drawdown
persiste día tras día— así que 750 ruedas contienen muchos menos episodios distinguibles que
observaciones. Goldberg y Mahmoud señalan justamente la sensibilidad de estas medidas a la
correlación serial. Sigue sin significar "vendé" (F9.144 §3).

1. **El "~20% en rojo" esperado no es lo que la definición produce.** CDaR(0,8) es la **media** del
   peor 20%, que cae más adentro de la cola que el percentil 80: superarla pasa bastante menos que
   el 20% del tiempo. Verificado sobre las 13 series: CDaR(0,8) ≥ p80 en todas, y el tiempo por
   encima de CDaR(0,8) promedia **8,7%**. La cartera da **1 de 13 en rojo (8%)**, que es
   exactamente lo que la definición predice. No es una anomalía.
2. **Amarillo-o-rojo ≈ 50% es por construcción**, porque el borde verde/amarillo *es* la mediana.
   No se puede comparar contra el 69% viejo: son criterios distintos. Lo que importa es el rojo.

**Cambio de régimen, anotado y sin corregir.** La historia cubre cepo y post-cepo, y la
investigación de indicadores en dólares midió que la correlación papel/MEP se dio vuelta entre 2024
y 2025. La distribución de 2023-24 puede no describir cómo se mueve esto hoy. Recortar la historia
empeoraría la estimación —y el mínimo medido de 400 observaciones no dejaría margen—, así que se
deja como está y se anota.

#### Ulcer Index: número, no banda

`ulcerIndex126` — Martin y McCann, *The Investor's Guide to Fidelity Funds* (1989): raíz de la
media de los drawdowns al cuadrado sobre 126 ruedas. Captura **profundidad y duración en un solo
número**: dos posiciones con la misma caída máxima se viven distinto si una se recuperó en tres
meses y la otra sigue abajo, y el drawdown puntual no las distingue.

**Va sin semáforo, a propósito.** No hay base para elegirle bandas y esta fase existe justamente
para dejar de inventarlas. Si con uso se ve que distingue algo, se calibra con el método de arriba.

**Lo que este método NO resuelve, y es deliberado.** Hay una segunda calibración legítima que no se
puede derivar de datos: el umbral como **presupuesto de riesgo** —cuánto está dispuesto a ver caer
el dueño antes de actuar—. Esa es una pregunta sobre él, no sobre el activo. La estadística dice
"esto es raro para este papel"; el presupuesto dice "esto excede lo que tolero". Si alguna vez se
quiere la segunda, es **agregar** una banda, no reemplazar ésta.

### La performance va en dólares; todo lo demás, en la moneda de la serie (F9.148 §4)

`perf1m/3m/6m/1a` se calculan sobre la serie convertida. **Nada más se convierte**, y no es una
inconsistencia sino el resultado de una medición (investigación del 2026-08-17):

- **Dolarizar volatilidad, drawdown y medias las EMPEORA.** La correlación diaria entre el
  retorno del papel en ARS y el del MEP pasó de **+0,2/+0,5** (2023-24, bajo cepo: se movían
  juntos y convertir cancelaba ruido) a **−0,2/−0,46** (2025: se mueven en contra y convertir
  amplifica). La volatilidad **sube** en 13 de 15 posiciones al dolarizar.
- **La performance es el caso opuesto**: `perf1a` cambia de signo en 3 de 12 posiciones (GD30,
  GGAL, TXAR), ARS y USD discrepan el **15,0% de los días**, y en pesos da positiva el **86% del
  tiempo** —100% en cuatro papeles—, que es la deriva nominal contestando "¿gané o perdí?" con un
  sí que no significa nada.

`monedaPerformance` lo dice explícitamente por posición; la ficha marca la moneda de cada grupo
de indicadores para que nadie reste un `perf1a` en dólares de un drawdown en pesos.

**La conversión usa `serieTcDeMercado`, que lee el documento `D+1` para el día de mercado `D`.**
`tcDiario` no está indexado por fecha de mercado: el cron corre a las 09:00 ART, antes de que
abra el mercado de bonos que arma el MEP, así que guarda el cierre de ayer bajo el rótulo de hoy.
Reconfirmado en F9.148: **779/779** documentos coinciden con `api[D−1]`. Es MEP, no CCL — la
brecha contra los ADRs es ~3% de nivel, que no cambia el signo de una performance anual.

**Si falta el TC de una sola rueda, `dolarizarSerie` devuelve `null`** y la performance queda en
pesos, dicho en `motivoPerfEnMoneda`. Una serie con agujeros correría la ventana de 252 ruedas de
`perf1a` sin que se note. Por eso el default del backfill se retrocedió a **2023-06-01**:
`tcDiario` quedó en **1.175 documentos, 2023-06-01 .. 2026-08-18, sin huecos**, y las 15 series
en ARS tienen TC en todas sus ruedas.

## El análisis del modelo (F9.147) — contrato

### Lo calculado y lo reportado no se mezclan

Los números de `indicadoresPosicion` salen de Firestore y se auditan contra `preciosDiarios`. Los
fundamentals salen de una búsqueda web y **la app no los puede verificar**. En una grilla se ven
idénticos, y un P/E equivocado al lado de un semáforo verde se lee como dato de la app.

Por eso los reportados viajan en su propia estructura (`Fundamentals`), se pintan en un **bloque
aparte** con la marca `EXT`, y llevan **fuente y fecha obligatorias** — el validador rechaza
métricas con valor y sin fuente: un número reportado sin procedencia no se puede juzgar.

**Sin semáforo, y no es un olvido.** Un umbral aplicado a algo no verificable convierte un dato
dudoso en un veredicto. Si alguna vez se quiere, primero hay que medir qué tan estables son entre
corridas — el mismo criterio que F9.149 aplicó al drawdown: la banda se calibra, no se elige.

**`null` explícito antes que un número inventado.** Una métrica que no se encontró viaja con
`valor: null` y se muestra en la línea "Sin dato: …". El hueco es información; el número inventado
es daño.

### El contexto es la ficha entera, por identidad

Eran cuatro campos (`ticker`, `totalUsd`, `totalPortafolio`, `sectorDisp`): el modelo opinaba sobre
una posición de la que no sabía nada y reconstruía por su cuenta datos que la app ya tenía
calculados. Ahora `contextoPosicion` manda precio con fecha, tendencia, rango, riesgo,
`calibracionCaida`, performance con su moneda, momentum, liquidez, semáforos y `estadoSerie`.

**Una entrada por IDENTIDAD (`ticker|tipo|paisRiesgo`), no por ticker** — GLOB manda dos fichas, la
del CEDEAR en ARS y la de la acción global en USD. Es la misma regla de F9.141.1 y F9.144.

Vive en `src/datos/patrimonioIA.ts` y no dentro de `Patrimonio.tsx` porque es una transformación
pura: es lo único de esta fase que se puede verificar sin pintar.

**El prompt prohíbe recalcular lo que ya viene dado**, y advierte sobre la moneda: la performance
está en USD y el resto en `monedaSerie`, así que no se restan entre sí. También explica que la
banda de caída no es un umbral fijo — sin eso, el modelo leería un −48% verde como un error.

### La recomendación reemplaza a la prohibición vieja, no la borra

La regla anterior era *"PROHIBIDO imperativos sin condición"*, y existía por un motivo válido: una
recomendación categórica sin condición es una opinión con cara de conclusión. La nueva es **más
exigente**, no más laxa:

- La recomendación **solo se emite si cita indicadores concretos, por nombre y valor**.
- Si no puede citar ninguno, `accion: null` con `motivoSinRecomendacion`. El validador lo fuerza:
  `accion` sin `indicadoresCitados` es un error de importación.
- `justificacion` son 2 a 5 razones, cada una anclada a un dato de la ficha o a una fuente.
- **No reemplaza a `queHariaEnCadaCaso`**: el veredicto responde "qué hago hoy", los escenarios
  "qué hago si pasa X". Los dos van.
- Sigue escrito en el prompt que **no se asume que una posición deba venderse por estar en
  ganancia ni comprarse por estar en pérdida**.

### Los campos nuevos son opcionales, y eso es deliberado

Los 40 análisis guardados al 2026-08-19 (todos `origen: chat`) no traen `fundamentals`,
`recomendacion` ni `justificacion`. **Renderizan degradados, no se migran ni se borran**, y el
validador sigue aceptándolos: los cuatro campos obligatorios no cambiaron. Verificado sobre los 40.

### El prompt de lote NO cambió, a propósito

`buildPromptLote` produce análisis con el mismo shape y escribe en la misma colección, pero pide
~150 palabras por ticker para toda la cartera de una vez. Meterle fundamentals por posición
reventaría el presupuesto de tokens y desvirtuaría para qué existe. **Consecuencia asumida:** un
análisis generado por lote no trae los campos nuevos, igual que los viejos.

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

## "Actualizar todo" v2 y reserva (F9.190) — contrato

### El global interpreta, no calcula
El análisis global del informe v2 recibe los números del motor (escenarios, brecha, bandas de la
política, exposición por factor, exposiciones sin decidir de F9.131) calculados con las mismas
funciones que pinta "Riesgo y escenarios", y tiene prohibido recalcularlos. Lo que devuelve es
**reportado** (`analisisGlobal`) y se muestra con esa marca.

### Materialidad en el cliente
≥ 2% análisis completo; 0,5–2% una nota solo si hay novedad; < 0,5% y bloque `cash` fuera. Lo decide
`contextoInformeV2` (`src/datos/patrimonioInformeV2.ts`), no el modelo.

### La reserva ES el piso de caja
No hay un concepto "reserva" aparte: es `pisoCajaPct` de la política (F9.116). Cuenta lo que
`bloqueDe` manda a `cash` (efectivo, stablecoins, `money_market_usd`).

### Señales de mercado: solo en la app
Riesgo país, Merval en USD y S&P (SPY) contra umbrales fijos, en una card. Sin campana, sin push,
sin histéresis — es la decisión cerrada "no alarmas" aplicada, no una excepción. Las fuentes que
fallan se muestran con el error crudo; el Merval sin fuente no se reemplaza por un proxy.

## Sistema cripto (F9.195) — contrato

### Política propia, dentro del total
El bloque cripto tiene reglas propias (`configPatrimonio/cripto`: objetivos BTC/ETH/otras/reserva,
banda, tope por plataforma, freno, tramos de BTC) pero **sigue sumando en el total familiar y en su
banda de clase**. No se tocan la banda de clase ni los escenarios.

### Precio de hoy o el del snapshot, marcado
Valor = cantidad del último snapshot × precio de `criptoLectura/ultima`. Sin precio, el `valorUsd`
del snapshot con la marca "valor del DD/MM". Nunca un proxy ni un valor viejo presentado como de hoy.
Stablecoins a 1 por definición.

### Plataforma ≠ cuenta
El tope se mide por plataforma (`PLATAFORMA_DE_CUENTA`, por prefijo, sin matcheo difuso). Una cuenta
fuera de la tabla es su propia plataforma, marcada "sin mapear". La custodia es por cuenta (F9.130).

### Base fija y freno sobre días completos
La base de BTC se fija con la primera lectura y no se mueve sola ("Reiniciar base" la fija en hoy). El
máximo del freno sale de los días de `criptoHistorial` con todo valuado a precio del día.

### Solo en la app
Sin campana, sin push, sin Calendar. "Qué haría en cada caso" es texto fijo, no una salida del sistema.

## Stops y señales (F9.196 §4–§5) — contrato

### Los stops son niveles de referencia visuales, no alarmas
Se muestran **solo en la app**: sin push, sin campana y **sin campo de "acción sugerida"**. Un stop
`tocado` dice que el precio llegó a un nivel medido; no dice "vendé". Es la decisión cerrada "no
alarmas" aplicada a los stops, no una excepción. Las señales de §5 siguen la misma regla: nivel
`info` o `atencion`, nunca una orden.

### Qué se calcula, dónde y para quién
En `calcIndicadores` (`functions/src/patrimonioPrecios.ts`, `calcStops` y `calcSenales`), dentro del
cron de precios, y se guarda en `indicadoresPosicion` (`atr14`, `stops`, `historialStops`, `senales`).
Moneda: la de la serie (`monedaSerie`). Parámetros en `UMBRALES.stops` y `UMBRALES.senales`.
**Solo acciones y CEDEARs** (`llevaStops`); bonos y ONs no llevan stop: la volatilidad es tan baja
que el número no sirve.

- **Stop ATR (chandelier):** máximo de **cierre** de 22 ruedas − 3 × `atr14` (ATR absoluto, la misma
  media de true range que `atrPct`). Con menos de 30 puntos, `null` con `motivoStopAtr`; sin OHLC
  (`usa_stocks`: ACN, GLOB global) también `null`, con `sin_ohlc`.
- **Trinquete:** el vigente nunca baja: `max(base de hoy, stopAtr de la lectura anterior)`;
  `stopAtrDesde` es la fecha del último ajuste hacia arriba. Se **reinicia** si el documento era de
  otra identidad o si hubo una corrida, posterior a la lectura anterior, en la que la posición no
  estaba (vendida entera y recomprada). Una venta total y recompra entre dos corridas no se ve
  todavía: la verá `movimientosCuenta` (H3).
- **Stops por media:** `stopSma50` / `stopSma200` con estado `encima` / `cerca` (a menos de
  0,5 × ATR por encima) / `debajo`. `debajo` exige **dos cierres seguidos** por debajo de la media de
  cada día; un solo cierre debajo queda en `cerca` (no confirma: evita el falso cruce de un día).
- **Estado resumido:** `tocado` (cierre ≤ stop ATR, o SMA200 `debajo`) · `cerca` (a 1 ATR o menos
  del stop ATR, o SMA200 `cerca`) · `ok` · `sin_datos` cuando no hay ni stop ATR ni SMA200: no se
  inventa un `ok`.
- **Historial:** `historialStops`, una lectura por fecha de mercado (re-correr el mismo día la
  reemplaza), últimas 60.

### Señales: `desde` medido, "nueva" por 3 ruedas
Cruce de medias (en las últimas 10 ruedas, `desde` = día del cruce), stop ATR tocado, debajo de la
SMA200, RSI14 > 70 / < 30, caída 52s peor que su CDaR80 (la banda roja de F9.149) y volumen > 2× su
promedio de 30 ruedas. El `desde` sale de la serie (inicio de la racha actual); solo el del stop ATR
se hereda de la lectura anterior, porque el trinquete no se reconstruye desde la serie. Una señal es
**nueva** durante 3 ruedas desde `desde`. "Evento próximo" y "Gatillo de tesis" entran por
`ContextoStops.senalesTesis` cuando exista la tesis (§6, H5).

## Balanz por archivo: "Mis Instrumentos" (F9.196 Addendum 2 §A) — contrato

### Alimenta la cartera viva, no crea corrida
"Actualizar Balanz" (`src/vistas/PatrimonioBalanz.tsx`) lee el .xlsx sin LLM
(`src/datos/patrimonioBalanzArchivo.ts`) y escribe `cuentasVivas/balanz_<comitente>` más los
movimientos inferidos, en un solo batch. Las corridas siguen siendo la foto histórica (F9.189 §1).

### Qué se toma del archivo
- `Valor actual` está en USD para todas las especies y `Precio` es USD por unidad nominal (bonos
  por 1 VN). `Moneda` es la moneda de cotización, no la del valor. `Precio promedio de compra`
  va a `costoPromedio`.
- La comitente y el momento de exportación salen del nombre, con o sin corchetes. Si no están,
  Juan elige la cuenta en un selector: nunca se adivina.
- El archivo no trae sector ni país: se heredan de la importación anterior o de la corrida (mismo
  ticker y tipo). Si no aparecen, la fila queda `revisar` con motivo.
- Un `Tipo de Instrumento` desconocido toma el tipo conocido del ticker (corrida o importación
  anterior) y queda `revisar` con el texto crudo. Sin tipo conocido va a `paraRevisar`: no entra a
  la cartera viva, pero su valor sí cuenta en el total del archivo.
- La clasificación se busca en este orden: la corrida de la misma cuenta, la importación anterior y
  la corrida de otras cuentas. Así una corrección en la corrida llega a la cuenta viva.
- Si en una fila `Nominales × Precio` no da el `Valor actual` (más de 1 USD), es un número mal
  leído y el archivo no se puede confirmar.

### Doble importación, diferencias y caja
- El mismo archivo (misma comitente, fecha y hora) no cambia nada. Un archivo **más viejo** que la
  importación vigente no se importa. Entre dos archivos de la misma comitente en la misma subida, se
  queda el más nuevo.
- Un cambio de cantidad contra la importación anterior genera `compra` / `venta` con
  `inferido: true` y monto estimado. Nunca es flujo, y `armarCarteraViva` nunca lo aplica,
  aunque la cuenta caiga a la corrida.
- "Mis Instrumentos" no trae caja. Una cuenta viva sin `saldos` conserva la caja de la corrida
  (`armarCarteraViva`, solo para `archivo_balanz` sin filas cash) hasta que el archivo de
  Movimientos (H3c) la mueva.

### Control contra la app
Valor del archivo contra `indicadoresPosicion` (último cierre) × el TC de la vista. Si la
diferencia total supera el 2%, se avisa con el detalle por especie. Las especies con escala
distinta (más de 5×, por ejemplo bonos cotizados cada 100 VN en data912) se listan aparte y no
entran al total. No corrige nada.

### Vista en dólares o en pesos (F9.196.1 §0)

- Balanz deja exportar "Mis Instrumentos" en la vista en dólares o en pesos.
  - En pesos, `Precio` y `Valor actual` vienen en pesos del día, salvo los FCI en dólares.
  - `Precio promedio de compra` y `Valor inicial` vienen en pesos **históricos**.
  - La columna `Moneda` no cambia entre las dos vistas.
- **Detección** (`detectarVista`), sobre las filas que no son FCI en dólares. Hay dos referencias:
  - los precios de la app, con 3 especies o más (por 1 VN: `precioDia`, o el cierre ÷ 100 en bonos
    y ONs);
  - la importación anterior **confiable** (con `vista`, o razonable contra la corrida o la app).

  Cuentan solo las referencias que caen dentro de banda. Si se contradicen, o no hay ninguna, la vista
  queda `'desconocida'`: Juan elige con dos botones y sin elegir no se guarda. Elegir contra una
  detección segura pide confirmación.
- **Pesos** (`aplicarVista`):
  - Se divide por el **MEP del día de los precios del archivo**, que es el último día hábil en o
    antes de la exportación. Sale de la cartera viva si es de ese día; si no, del `tcDiario` que
    guarda ese cierre. Sin ese MEP, no se guarda.
  - El costo no se convierte: queda el `costoPromedio` en USD del último import en dólares.
    - Si no hay, la especie queda sin costo en USD (`costo_en_pesos_historicos`).
    - El costo crudo en pesos va a `costoPromedioArs`.
  - Se guardan `vista`, `tcConversion`, `valorArchivoArs`, `costoMotivo` y `costoUsdDel`.
- El control contra la app corre **después** de convertir.
- **Reimportar:** si lo guardado no tiene `vista` (es de antes de §0) o tiene otra, el mismo archivo
  se puede reimportar.
- **Lo guardado inflado** (más de 50 veces la corrida):
  - no sirve de referencia;
  - sus movimientos inferidos se borran;
  - contra eso se infiere solo por cantidad.
  - `scripts/listarBalanzInflados.ts` lo lista. Es de solo lectura.

## Balanz: archivo de Movimientos (F9.196 Addendum 2 §B) — contrato

`src/datos/patrimonioBalanzMovimientos.ts` (puro) y el mismo botón "Actualizar Balanz".

- **Comitente:** el nombre del archivo no la trae. Se sugiere por los tickers en común con el
  último "Mis Instrumentos" (o la corrida) y Juan la confirma.
- **Clasificación:** por el texto de `Descripcion`, con la tabla de §B tal cual. Lo que no está en
  la tabla queda `para_revisar` con el texto crudo, sin reglas nuevas. Las dos muestras reales
  dan 0 (`scripts/clasificarBalanzMuestras.ts`).
- **Un boleto es un movimiento**, aunque venga en varias filas (una por moneda). La tenencia sale
  de la fila con precio; las de otra moneda mueven solo la caja.
- **FCI:** la tenencia sale solo de "Suscripción desde Balanz" / "Rescate a Balanz". Su importe NO
  entra a la caja: en las muestras espeja al de "Liquidación de …", y sumar los dos dejaría una
  suscripción sin efecto en la caja.
- **Devolución por rechazo:** anula el `Comprobante de Pago` anterior del mismo monto y moneda.
  Se anulan los dos.
- **Transferencia de títulos:** es un depósito o retiro en especie, valuado cantidad × precio del
  archivo. La fila no trae moneda y se asume pesos (pendiente de confirmar).
- **Duplicados:** el id es la clave `(comitente, Descripcion, Concertacion, Moneda, Importe,
  Cantidad)` más el número de ocurrencia dentro del archivo. Un export que se pisa con otro no
  duplica nada, y dos filas idénticas del mismo archivo cuentan como dos. Los boletos se agrupan
  por número, operación, fecha y ticker. Se escribe con `merge`.
- **Devolución en un export posterior:** el retiro que guardó el export anterior se borra
  (`idsAnulados`).
- **Caja anclada:** caja de la última corrida de la comitente + Importe de lo liquidado después.
  Las tres subcuentas de dólar suman USD, y se guarda el detalle por subcuenta. Sin corrida con
  caja, o si el archivo no llega hasta la corrida, la caja es "desconocida".
- **La caja va a la cuenta viva** como `saldos`, con `cajaAnclada.hasta` (la última liquidación).
  Una caja más vieja no pisa a una más nueva. Re-importar "Mis Instrumentos" la conserva. Sin
  "Mis Instrumentos", se crea la cuenta viva solo con la caja (`posiciones: []`): la cartera viva
  usa la tenencia de la corrida y la caja anclada.
- **En Balanz, la tenencia sale de "Mis Instrumentos" y la caja de la caja anclada.**
  `armarCarteraViva` no aplica los movimientos de origen `archivo_balanz`: son historial y
  candidatos de §C. Aplicarlos no reproduciría la caja, porque las comisiones en otra moneda, las
  retenciones y las cauciones no son movimientos.
- ⚠ Si "Mis Instrumentos" y Movimientos son de fechas distintas, una operación entre las dos puede
  quedar en la caja y no en la tenencia, o al revés. La vista previa lo avisa; el corte está
  pendiente de decisión.
- Una `Moneda` desconocida queda fuera de la caja y se informa.
- Depósitos, retiros y transferencias de títulos son **candidatos** de §C: no son flujo solos.

## Aportes y retiros automáticos (F9.196 Addendum 2 §C) — contrato

`src/datos/patrimonioFlujosAuto.ts` (puro). El flujo de F9.96 sale solo de los movimientos de
cada fuente. Una transferencia entre cuentas propias no es flujo.

- **Dinero:** retiro y depósito en cuentas distintas, misma moneda, montos a 1% o menos y a
  5 días hábiles o menos: es interna.
- **Cripto:** mismo activo, llega igual o menos que lo que salió (comisión de 1% o menos,
  propuesto) y a 3 días corridos o menos.
- **Títulos en especie:** misma especie y misma cantidad, a 5 días hábiles o menos (propuesto).
- El apareo es de cardinalidad máxima (caminos aumentantes) y determinista: prefiere el depósito
  más cercano en el tiempo y, a igual distancia, el de monto más parecido, pero un par válido no
  queda afuera por una elección golosa. La llegada nunca es anterior a la salida.
- Las claves son el `id` o, sin id, la clave de duplicado más la ocurrencia: dos movimientos iguales
  sin id son dos.
- Un retiro o depósito **con ticker** es en especie: en la cartera viva mueve la tenencia, no la
  caja. Sin valuación (monto 0) no genera un flujo de 0: queda pendiente.
- Lo que no aparea queda **pendiente**, sin flujo, hasta que Juan elige aporte, retiro o interna.
- Los movimientos `inferido` nunca son flujo.
- Un monto en pesos sin TC para su fecha va a `sinTc`: no se inventa la conversión.

### Ajustes de F9.196.1 (§1)

- **Fecha de inicio:** `FLUJOS_AUTO_DESDE = '2026-10-21'`. Lo que no aparea y es anterior va a
  `historial`: solo se cuenta (`flujosAuto/estado.historial`) y nunca genera flujo, porque esa época
  ya está en los flujos manuales. El apareo corre sobre todo.
- **Al revés:** el depósito puede figurar hasta 1 día hábil antes del retiro (1 corrido en cripto).
  El orden de preferencia es |días| y, a igual distancia, el sentido normal primero.
- **Card "Para decidir (N)"** en Configuración, arriba de "Aportes y retiros":
  - Botones Aporte, Retiro e Interna, con el sugerido primero.
  - Avisa "¿Ya lo cargaste a mano el dd/mm?" (misma plataforma, ±5 días hábiles, ±1%). Solo avisa.
  - Muestra aparte los decididos sin precio y los sin dólar del día.
  - "Decididas" queda plegada, con "Cambiar" y su estado (aplicada, por aplicar, sin precio, sin
    efecto). Se ve aunque no haya pendientes.
  - "Aplicar" llama a `recalcularCarteraViva`, que ahora también corre los flujos.
  - `decisionesFlujo/{clave}`: si la clave tuviera "/", el id va hasheado y la clave queda en el
    campo `clave`.
- **Frescura de Balanz (§4):** "Balanz <comitente>: tenencia del dd/mm · caja al dd/mm". La tenencia
  es la exportación de "Mis Instrumentos" y la caja, `cajaAnclada.hasta`. Si difieren en más de 1
  día hábil, se agrega "⚠ fechas distintas".

### Botones, respuesta de `recalcularCarteraViva` y escala de data912 (F9.196.1 Addendum 1)

- **A — `BotonesSincronizar`** (`src/vistas/Patrimonio.tsx`): Sincronizar PPI, Sincronizar Bitfinex
  y Recalcular ("Calcular valor de hoy" en el hero de la corrida).
  - Va en los dos heroes: si el primer cálculo falla, igual se puede sincronizar.
  - Los errores pasan por `mensajeDeErrorCallable` (`src/datos/patrimonioRecalcular.ts`):
    - un `internal` sin texto → "No respondió la función…";
    - `deadline-exceeded` → aviso de tiempo;
    - el resto → el mensaje real.
- **B — `ok: false` nunca es éxito.** `recalcularCarteraViva` devuelve `{ ok, totalUsd, error?,
  flujos }`, y con `ok: false` siempre trae su motivo (también "no hay una corrida vigente").
  - En el cliente, `recalcularCarteraViva()` pasa la respuesta por `exigirRecalculoOk`: con
    `ok: false` tira con el mensaje real. Un error de los flujos vuelve aparte (`avisoFlujos`), sin
    tapar el resultado.
  - `recalcularCarteraVivaCrudo()` es para "Para decidir", que necesita el detalle.
  - `sincronizarBitfinex` devuelve `carteraError` en vez de tragarse el fallo de la cartera.
  - Si PPI o Bitfinex sincronizaron pero la cartera falló, el toast dice las dos cosas.
- **C — escala de data912 fija:** `escalaData912(tipo)` da 100 para `bono` y `on`, y 1 para el
  resto. La escala de PPI (`nominalInPrice` / `escalaPPI`) se usa solo para el precio que viene de
  PPI. Está medido en `docs/patrimonio/data912-escala.md`.

## Sincronización de PPI y valor de hoy (F9.196 H2a) — contrato

### Código compartido entre cliente y Functions
`armarCarteraViva`, `resolverTcCarteraViva`, los movimientos, los flujos automáticos y la tabla de
PPI viven en `src/datos/compartido/`. Hay una copia **idéntica byte a byte** en
`functions/src/compartido/`, porque `functions/` no puede importar de `src/`. El original es el de
`src/`: se edita ahí y se copia con `npx tsx scripts/verificarCopiasIdenticas.ts --copiar`. Sin
`--copiar`, el script falla si las copias difieren. Los módulos de siempre (`src/datos/patrimonio…`)
re-exportan desde `compartido/`.

### `sincronizarPPI` (cron de días hábiles a las 18:10, más el botón "Sincronizar PPI ahora")
- **Cliente:** `functions/src/ppiApi.ts`, solo lectura, con lista blanca (las rutas de §0 más
  `Configuration/*`). Credenciales en secretos de Firebase (`PPI_*`). Token cacheado 8 h, refresh
  con el Bearer anterior, y un 400 en el login se trata como credenciales inválidas.
- **`cuentasVivas/ppi`:** posiciones de `BalancesAndPositions`, con sector y país de la corrida.
  La caja es la fila INMEDIATA de cada moneda (Pesos → ARS; CCL y MEP → USD). Guarda
  `costoPromedio` (de `ppc`) y `costoSospechoso` cuando costo y precio difieren más de 5×:
  PAMP, TGSU2, TRAN e YPFD, por la escala de antes de los splits. **Ese costo no entra en ningún
  cálculo**; el costo de esas especies sale de los movimientos.
- **`movimientosCuenta`:** se clasifican con `FAMILIAS_PPI`, las 16 familias de textos medidas
  sobre 3 años (0 `para_revisar`). Lo que no está en la tabla queda `para_revisar` con el texto
  crudo. Ids `ppimov_<hash>` deterministas. La primera corrida trae 3 años; las siguientes, 10 días.
- **Si falla:** `cuentasVivas/ppi.error` guarda el mensaje crudo, se conserva la última lectura
  buena y la frescura dice "sin sincronizar desde dd/mm".
- **Flujos (§C):** después de cada sincronización corre el apareo sobre los depósitos y retiros de
  todas las fuentes. Lo que no aparea queda en `flujosAuto/estado.pendientes`. Las decisiones de
  Juan van en `decisionesFlujo/{clave}`; las de aporte o retiro se escriben en `flujosPatrimonio`
  como `auto_<hash>`.

### Precios: PPI de respaldo de data912
data912 sigue siendo la fuente principal. Si no trae el precio de la especie (acción AR, CEDEAR,
bono u ON), sale de `MarketData/Current` de PPI a 24 hs. La escala (`nominalInPrice`) se pide una
vez por identidad y queda en `indicadoresPosicion.escalaPPI`. Si esa consulta falla, el precio va
crudo y actúa la guarda `escala_dudosa`. Cada precio del día queda en `indicadoresPosicion.precioDia`
con su `fuente` (`data912` o `ppi`).

### `actualizarCarteraViva` (cron de días hábiles a las 18:20, más el botón "Recalcular")
Escribe `carteraViva/ultima` con la composición por cuenta, los efectos y la `frescura`.
- PPI sale de la API y Balanz de su archivo o de la corrida.
- Bitfinex, Nexo y Lemon salen de la corrida, y Bitfinex pasa a la API en H2c.
- FCI sale de la corrida: el valor cuotaparte del día de CAFCI todavía no se usa.
- El dólar es el MEP del día (Addendum 1).

### Qué usa el valor de hoy
- El hero de Resumen muestra "Valor de hoy (estimado)". Abajo van la última carga, la diferencia
  separada en precios, dólar y movimientos, y la frescura.
- **Pesos, riesgo y reserva** se calculan sobre la cartera viva (`Mhoy`), y también la base del
  modo privacidad.
- **Evolución, Benchmark, informe IA, Plan, Optimización y decisiones** siguen con la corrida. El
  informe recibe el valor de hoy como dato aparte (`valorDeHoy`).
- La card cripto sigue con la corrida hasta H2c.

## Sincronización de Bitfinex (F9.196 H2c) — contrato

- **`sincronizarBitfinex`:** cron diario a las 09:20, después de la lectura de precios cripto,
  más el botón "Sincronizar Bitfinex ahora".
- **Cliente:** `functions/src/bitfinexApi.ts`, solo `auth/r/*`, con secretos `BITFINEX_*`. Firma
  HMAC-SHA384 con body `{}`. El **nonce es en milisegundos y no se cambia nunca**. Va a 1 llamada
  por segundo como máximo y sin `limit`, paginando de a 25 con `end`.
- **`cuentasVivas/bitfinex`:** posiciones por activo, sumando las billeteras exchange, margin y
  funding (lo prestado sigue en la billetera funding). El USD fiat va a la caja. Guarda
  `porBilletera` y `prestamos`.
- **Funding:** el lector es tolerante. Una fila con forma desconocida queda `para_revisar` sin
  romper nada. La forma se confirma la primera vez que Juan preste.
- **`movimientosCuenta`** (ids `bfxmov_<ID del asiento>`):
  - categoría 101: depósito en especie;
  - categoría 104: retiro en especie;
  - categoría 28: renta (interés de funding);
  - la 51 (transferencia entre billeteras propias) no es ni movimiento ni flujo.
- Al terminar corre los flujos automáticos (regla de cripto: mismo activo, 3 días o menos) y
  recalcula la cartera viva. La card cripto toma de ahí las cantidades de Bitfinex.

### Candado y funding (F9.196.1 §3 y §6)

- **Un solo cliente a la vez.** El cron y el botón son servicios de Cloud Run distintos y el nonce
  es monótono solo dentro de una instancia. Por eso:
  - Las dos funciones llevan `maxInstances: 1` y además el candado `locks/bitfinex`
    (`functions/src/candado.ts`).
  - El candado se toma en una transacción y es idempotente ante reintentos.
  - Vence a los 6 min; antes de eso, a los 270 s, el cliente deja de llamar.
  - Se libera al final, también si falla, y solo lo libera quien lo tomó.
  - Si está tomado: el cron sale sin error y el botón responde `failed-precondition`.
  - En las Rules, `locks` es `false`: solo lo usa el Admin SDK.
- **Funding:** hoy está vacío y sin confirmar. Se confirma la primera vez que haya un préstamo
  activo: la sincronización tiene que mostrar los préstamos (`leerFunding`) y el interés (categoría
  28 del ledger).

## Tesis por acción (F9.196 H5) — contrato

- **El Chat 2 propone, la app calcula y Juan edita.** El prompt de la parte 2 (`buildPromptPosicionesV3`)
  pide un bloque `tesis`, con la forma de §6 (`ESQUEMA_TESIS`), al lado de `resultado`. Solo lo pide
  para las acciones y CEDEARs materiales (`contextoPosicionesV3.conTesis`), y le pasa la última
  tesis guardada para que la actualice.
- **Reglas del prompt:** datos con fuente y fecha; `null` si no hay dato; lenguaje condicional; sin
  precio objetivo propio, solo el consenso publicado. Los informes viejos, sin `tesis`, importan
  igual.
- **Dónde se guarda:** `tesisPosicion/{ticker}` (`src/datos/compartido/tesis.ts`). Un campo con
  `editadoPorJuan` no lo pisa la importación siguiente; si el chat trae otro valor, queda en
  `distintoDelChat` ("dato del chat distinto: X").
- **Cálculos** (`calcularTesis`, con el cierre del día en el cron de precios, en
  `indicadoresPosicion.tesisCalculo`):
  - P/E = precio ÷ promedio del EPS. Si las monedas no coinciden, el precio se pasa con el MEP de
    `resolverTcCarteraViva`.
  - Potencial = consenso ÷ precio − 1.
  - Cada gatillo se marca cumplido según su operador.
  - Se calculan los días al evento.
  - ⚠ En un **CEDEAR**, P/E y potencial quedan en null (`cedear_sin_ratio`): el precio es del
    certificado y los fundamentals son del subyacente.
- **Señales (§5):**
  - "Evento próximo": a 7 días o menos, nivel info.
  - "Gatillo de tesis": un gatillo que pasa a cumplirse o deja de cumplirse, nivel atención, con
    su `desde` y visible 10 días. Un gatillo nuevo no es un cambio.
  - Entran por `senalesTesis`. El estado se guarda en `indicadoresPosicion.estadoGatillosTesis`.
- **Arreglos de la revisión (a94b327):**
  - La clave de un gatillo incluye su texto; los repetidos llevan número de aparición.
  - Una lectura sin dato no pisa el último estado conocido: cumplido → sin dato → no cumplido es
    un cambio.
  - `monedaFundamentals` inválida queda en null (motivo `sin_moneda`), nunca se asume USD. P/E
    también da `sin_eps` y `eps_no_positivo`.
  - Días al evento contra hoy en Argentina.
  - La edición de Juan escribe solo el campo (`updateDoc` con `tesis.<campo>`). La importación va
    en transacción con `mergeFields`, y su error no frena el resto de `importarAnalisisIA`.

### Ratio con el subyacente y valores absurdos (F9.196.1 §2)

- **`ratioSubyacente`:** `{ valor, tipo: 'cedear' | 'adr', fuente, fecha }` o `null`.
  - CEDEAR: N CEDEARs = 1 acción. ADR: 1 ADR = N acciones locales.
  - Precio del subyacente = precio local × N; después se pasa a la moneda como siempre.
  - No se aplica a una serie en USD que no sea de un CEDEAR (esa ya es el subyacente).
  - Lo trae el Chat 2 con fuente, nunca inventado; Juan lo edita.
  - Un chat que no manda el campo conserva el ratio anterior; un `null` explícito lo saca.
  - No hay tabla fija en el código.
- **Controles** (`CONSENSO_SOBRE_PRECIO = [0,2; 5]`, `PE_MAXIMO = 300`):
  - Consenso ÷ precio fuera de banda → potencial y P/E en null (`consenso_fuera_de_escala`, "el
    consenso está X veces el precio").
  - P/E fuera de (0; 300] → null (`pe_fuera_de_escala`).
- **Ficha:** dice qué ratio se usó y avisa si el tipo no coincide con el instrumento.

## Card "Acciones a mirar" y ficha reordenada (F9.196 H6, diseño 3) — contrato

- **Card en Resumen**, debajo de Reserva y señales (`AccionesAMirarCard` +
  `src/datos/patrimonioAccionesAMirar.ts`):
  - Muestra solo excepciones, en el orden de §7: stop tocado, stop cerca, señal nueva de atención,
    gatillo que cambió y evento a 7 días o menos.
  - Formato de fila: logo, ticker, precio, variación del día (los dos últimos cierres de
    `historialStops`) y, en una segunda línea, el detalle (stop ATR y distancia, SMA200, evento).
  - Sin excepciones: "Ninguna acción cerca de un stop ni con señales nuevas · N acciones revisadas
    hoy HH:MM".
- **Deep link:** tocar una fila pone `fichaAbierta` y cambia a Tenencias, que expande ese ticker y
  hace scroll hasta `#ficha-<identidad>`.
- **Ficha** (`FichaPosicion` + `FichaStopsTesis.tsx`), en el orden de §7:
  1. encabezado (precio y variación, valor de hoy, peso, cuentas, fuente del precio del día);
  2. stops (barra con precio, stop ATR, SMA50 y SMA200, y mini gráfico SVG de `historialStops`),
     con la etiqueta fija "Niveles de referencia, no órdenes";
  3. chips de señales (las nuevas, resaltadas);
  4. tesis: P/E, potencial y días al evento en grande, gatillos ✓/✗, textos con fuentes y fecha, y
     el botón Editar (los campos editados quedan `editadoPorJuan`);
  5. indicadores técnicos, plegados;
  6. análisis IA completo, plegado.
- **Tenencias:** orden por peso, "cerca del stop primero" o variación, más un buscador por ticker,
  manteniendo la agrupación por identidad.
- **Textos:** ninguno es una orden; describen niveles y señales. Sin push, campana ni "acción
  sugerida".
- **Arreglos de la revisión de H6:**
  - **Distancia a un nivel** en el formato de §7: nivel ÷ precio − 1 (`distANivel`). El cron guarda
    precio ÷ nivel − 1.
  - **Variación:** dice "hoy" solo si el último cierre es de hoy en Argentina; si no, "al dd/mm". Si
    entre las dos lecturas hay más de 4 días, no se muestra.
  - **Tesis en la ficha:** se recalcula en el cliente con `calcularTesis` (lo editado se ve al
    guardar). Usa el último cierre y el MEP de la cartera viva.
  - **Gatillos:** se editan de a uno (`gatillosEditados` y `gatillosDistintos`), así que corregir un
    valor no congela la lista. Cada campo o gatillo "distinto" tiene "usar el del chat".
  - **Guardado:** `guardarTesis` escribe todo en un solo `updateDoc`. `tesisMap` se recarga después
    de importar.
  - **Números del editor:** se aceptan "45000", "45,5" y "1.234,56". "45.000" es ambiguo y se
    rechaza (`leerNumero`).
  - **Modo privado:** tapa los montos del detalle de la card y de los textos de señales.
  - **Varias identidades del mismo ticker:** muestran una sola tesis, en la primera.

## Decisiones cerradas — no re-litigar

- Vara USD; horizonte 1–3 años; postura crecer aunque oscile.
- Unidad = familia como una entidad; se mide el total.
- Filosofía proponer/medir/mostrar, no alarmas. El diario registra y contrasta; nunca puntúa.
- Stops (F9.196): niveles de referencia visuales, solo en la app. Sin push, sin campana, sin
  "acción sugerida". Dos tipos: ATR y media móvil; sin stop de tesis ni desde el costo.
- Vista privada dentro de la app; datos aislados; sin puente con gastos.
- Ingesta: ventana de chat → `.txt` JSON → app valida/carga. No auto-ingesta,
  no parser por bróker, no online en la app.
- Conversión ARS→USD por la app vía `tcDiario`.
- Determinístico en TS; sectorial vía API con toggle.
- F9.196.1 (decisiones de Juan del 21/10/2026), se mantienen:
  - **5.** Tolerancias del apareo: 1% de comisión en cripto y 5 días hábiles en títulos.
  - **7.** Las transferencias en especie de Balanz son en pesos.
  - **10.** "Letras" de PPI se tratan como `bono`.
  - **14.** Una tesis se importa aunque `resultado` no pase la validación.
  - **15.** El análisis de un solo ticker no pide tesis.
- F9.196.1 §5 (22/10/2026): PPI no registra los splits de PAMP, TGSU2, TRAN ni YPFD
  (`docs/patrimonio/ppi-splits-medicion.md`). No hay detector de splits y siguen `costoSospechoso`
  (decisión de Juan del 21/10: quedan así por ahora).
- F9.196.1 Addendum 1 (21/10/2026), decisiones aceptadas por Juan:
  - **Archivo de Balanz en pesos:** el dólar es el cierre del último día hábil de su fecha.
  - **"Para decidir":** se ve con las decididas aunque no haya pendientes.
  - **Escala de data912:** queda fija en 100 para bonos y ONs.
  - **xlsx:** sigue en el backlog.
- Set de métricas completo; bandas estándar (ajustables); RV sin semáforo.
- Historial fechado desde el día uno.
- Anexo en archivo propio; puntero desde el CLAUDE.md principal.
