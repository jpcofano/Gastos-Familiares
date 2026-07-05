# Patrimonio — Resumen de sesión (handoff)

> Se lee/pega al iniciar en cualquier cuenta. Fuente de verdad: `docs/patrimonio/` en el repo.
> Contrato técnico: `CLAUDE-PATRIMONIO.md`. Prompts: `docs/prompts/F9.9x-*.md`.

**Última actualización:** sesión de cierre de construcción TOTAL (F9.90 → F9.99,
incluida F9.98 que estaba diferida). Repo verificado por clon hasta `47ed8e4`.

---

## 0. ESTADO EN UNA LÍNEA

**Construcción 100% terminada** (F9.90→F9.99, las diez features). **Nada deployado
desde F9.93.2.** Camino crítico: verificar push de F9.98/99 → DEPLOY GRANDE →
ronda de pruebas punta a punta → JSON real de CAFCI (pendiente del dueño).

---

## 1. Estado del repo (verificado por clon en esta sesión)

- HEAD remoto verificado: **`47ed8e4`** = F9.96+F9.97 completo (incluye
  `cafci-estructura-confirmada.md`, `patrimonioFlujos.ts`, `patrimonioCafci.ts`,
  Function `sincronizarCafci`, firestore.rules).
- `231ec59` = fix F9.55.1 (Inicio → "Otras" expandible) también en remoto. ✅
- **F9.98 y F9.99 implementadas por Code DESPUÉS de `47ed8e4` — PUSH NO
  VERIFICADO.** Primera acción de la próxima sesión: `git ls-remote` /
  `git log --oneline 47ed8e4..origin/main`. La regla de push ya falló 3 veces.

## 2. Qué se construyó en el último tramo (informe de Code, no verificado en remoto)

### F9.98 — Optimización formal
- `docs/patrimonio/f998-fuentes-series.md`: exploración documentada (Yahoo
  Finance, TC, BCRA, ArgentinaDatos) con pruebas por símbolo.
- **⚠️ DECISIÓN DESVIADA A REVISAR:** el contrato decía dolarizar con **CCL**;
  Code usó **MEP de `tcDiario` como proxy** (justificado en el doc de fuentes).
  El dueño debe aceptarla (y cerrarla en el contrato) o pedir corrección.
- `src/datos/patrimonioOptimizacion.ts` (~260 líneas): dolarización fail-soft
  (<40 puntos excluye), retornos, covarianza Ledoit-Wolf α=0.2, mín. varianza
  (gradiente proyectado, box [0, wMax]), risk parity (Newton cíclico,
  Maillard-Roncalli-Teïletche), 4 tests unitarios analíticos.
- Function `obtenerSeriesPrecios` (onCall): Yahoo Finance, caché 7 días en
  `seriesPrecios`, fail-soft por símbolo. Sin API key de Anthropic.
- Rules: `esDueno()` para `seriesPrecios` y `optimizacionPortafolio`.
- UI: solapa "Optimización" (entre Benchmark y Research): advertencias,
  parámetros (ventana/pesoMax), estado de series, heatmap correlaciones,
  tabla Actual | MínVar | RiskParity con deltas pp, tests colapsables.
  Helper `toYahooTicker(ticker, tipo, pais_riesgo, moneda)`.

### F9.99 — Análisis IA vía chat (sin costo de API)
- `extraerResultado` helper compartido; `analizarConIA` refactorizado y ahora
  escribe `origen: 'api'`.
- `generarPromptIA` (onCall): reutiliza builders + instrucciones de formato;
  no requiere toggle ni API key.
- `validarResultadoImportado`: posicion (keys requeridas), agenda (array
  eventos), sectorial (≥200 chars).
- `importarAnalisisIA` (onCall): valida → persiste con `origen: 'chat'`,
  `generadoEn` server + `generadoEnISO`.
- UI: `ModalPromptChat` (bottom-sheet 2 pasos: generar/copiar/descargar →
  pegar/validar/confirmar); botón "Chat" en análisis por posición, sectorial
  (ResearchTab) y agenda (CalendarioCard); chip neutro "vía chat".

## 3. INCIDENTE TOKENS (diagnosticado, cierre pendiente)

- El dueño probó los informes IA, "no generó nada" y consumió el crédito API
  (~408k in / ~37k out Sonnet ≈ USD 1,80, 29-jun→5-jul, incl. 5 web searches).
- **Diagnóstico:** `analizarConIA` persiste en Firestore ANTES de responder →
  los análisis probablemente ESTÁN en `analisisPosiciones` / `agendaMacro` /
  `analisisSectorial`. Lo que falló fue la lectura: reglas sin deployar
  (permission-denied fantasma) y/o PWA cacheada. **Verificar en consola
  Firestore**; tras el deploy deberían aparecer solos.
- Mitigación estructural = F9.99 (camino chat, costo cero). El toggle IA sigue
  gateando solo el camino API.

## 4. SITUACIÓN CAFCI (sin cambios, sigue bloqueante para su prueba)

- API `api.pub.cafci.org.ar/...ficha` da **403 CloudFront fuera de browser**.
- Estructura exterior confirmada (`data.info.semanal.carteras[]` +
  `fechaDatos`); **campos internos de cada posición NO confirmados** — parser
  fail-soft con supuestos: especie: `especie`/`nombreEspecie`/`instrumento`/
  `descripcion`; peso: `porcentaje`/`peso`/`porcentajeFondo`/`participacion`/
  `pct`; sub-array: `posiciones`/`tenencias`/`items`. Además **asume
  `carteras[0]` = más reciente** (confirmar orden con el JSON real).
- **ACCIÓN DEL DUEÑO:** browser → ficha de un fondo → DevTools → Network →
  copiar JSON real de un elemento de `carteras[]` → corregir parser
  (`functions/src/index.ts`, `sincronizarCafci`) y
  `docs/patrimonio/cafci-estructura-confirmada.md`.
- Si CloudFront también bloquea a la Function en producción: plan B = pegar
  JSON manual (mismo patrón que resúmenes y que F9.99).
- Mismo riesgo aplica a Yahoo Finance (F9.98): si bloquea a Functions,
  mismo plan B.

## 5. PRÓXIMOS PASOS, EN ORDEN

1. **Verificar push F9.98/99**: `git log --oneline 47ed8e4..origin/main` debe
   mostrar los commits nuevos (incl. `f998-fuentes-series.md` y los prompts
   `F9.98-patrimonio-optimizacion-formal.md` / `F9.99-patrimonio-analisis-ia-via-chat.md`
   en `docs/prompts/`). Si no están: push antes que nada.
2. **Decidir MEP vs CCL** (desviación F9.98): aceptar y cerrar en contrato, o
   pedir corrección a Code. No dejarla implícita.
3. **DEPLOY GRANDE** (sin predeploy hooks, compilar a mano):
   `git pull` → `npm install` (raíz; pdfmake) → `npm run build` →
   `cd functions && npm install && npm run build` → `firebase deploy`
   (completo: hosting + functions + rules/indexes + storage) → forzar refresh
   del service worker de la PWA.
4. **Verificar incidente tokens**: tras deploy, ¿aparecen los análisis ya
   pagados? (consola Firestore como respaldo).
5. **RONDA DE PRUEBAS punta a punta:**
   a. PDF: genera → descarga Y archiva → aparece en "Informes anteriores".
   b. Configuración: toggle IA; editar ACN recalcula; fijos fuera de métricas.
   c. **F9.99 con toggle OFF**: prompt de posición (TRAN) → pegar en chat →
      importar JSON → render idéntico a origen api + chip "vía chat".
      Repetir con agenda (debe traer cupón GD 9-jul e IPC INDEC julio).
   d. Diario: primera decisión desde una opción del Plan; simular revisión 30d.
   e. **F9.98**: solapa Optimización → fetch series (ojo bloqueo Yahoo) →
      correlaciones y carteras; correr los 4 tests unitarios desde la UI;
      verificar que un activo sin serie queda excluido fail-soft.
   f. CAFCI: tras el JSON real (punto 4 de arriba), configurar 2 fondos,
      sincronizar, mapear, ver BenchmarkTab.
   g. Segunda corrida real (resúmenes ~15-jul): Evolución + diff ingesta +
      retorno Modified Dietz con flujos registrados.
6. **Registrar aportes/retiros desde YA** (F9.96): flujos no registrados
   contaminan el retorno histórico para siempre.

## 6. Pendientes de datos del dueño

- CAFCI: JSON real de `carteras[]` (DevTools) + elegir fondos a seguir
  (fondoId/claseId de la URL de la ficha).
- Decidir MEP-como-proxy vs CCL (punto 5.2).
- ~~Accenture claves~~ → **CERRADO: ACN queda como posición manual** (50 ACN,
  USD 6.870). ~~GLOB manual duplicada~~ → **CERRADO: eliminada, verificado
  por el dueño.**

## 7. La foto del patrimonio (datos reales, corrida 01/07/2026 — sin cambios)

- Financiero/invertible ≈ USD 109,3k = 102.549 (.txt incl. Globant ESPP) +
  6.870 ACN manual. Fijos: depto 220k + auto 10k → total ≈ 339k (fijos FUERA
  del análisis).
- Energía AR ~44,9% 🔴 · País AR ~69,8% 🔴 · Cripto ~19,7% 🟡 · Global ~10,5%.
- Top: TRAN ~14,5% · ETH ~10,4% · PAMP ~10% · YPFD ~9% · BTC ~8,2%.
- Cripto real: 21.505 (ETH 11.385 > BTC 8.224 + AAVE 1.291 + UNI 604).
- Cuentas: Balanz 402665 (conjunta) · Balanz 1120830 · PPI 101268 · Nexo ·
  Bitfinex · Globant ESPP 0000010348 · ACN manual.
- Decisiones de datos cerradas: VIST = energía AR; BIOX = AR/agro; cripto
  oficial = solo Nexo+Bitfinex.

## 8. Reglas de trabajo (no re-litigar)

- **Push después de cada F9.x cerrado** (falló TRES veces; el repo es la
  continuidad entre cuentas).
- **Explorar antes de codear** APIs externas (CAFCI lo demostró; Yahoo, ídem).
- Filosofía: proponer/medir/mostrar; prescripción solo condicional
  (caso→opciones→costo); el diario nunca puntúa; semáforos informan.
- Desviaciones de diseño del implementador (como MEP vs CCL) se registran y
  el dueño las cierra explícitamente; nunca quedan implícitas.
- TC: `tcDiario` única fuente. Fijos fuera del análisis. La divergencia con
  fondos es información, no error.
- Deploy: reglas nuevas sin deploy = permission-denied fantasma; PWA cachea
  (forzar refresh); Functions se compilan a mano (sin predeploy hooks).
- IA: toggle gatea SOLO el camino API; el camino chat (F9.99) es siempre
  gratis y disponible. Prompts de features nuevos van a `docs/prompts/`.
