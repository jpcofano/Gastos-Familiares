# Sesión 10 — Briefing

## Contexto
Dashboard mobile-first redesign en progreso. Commit 1.1 ya en producción.

## Qué hicimos en sesión 9 (commit 1.1)
Reemplazamos `<style>` + `<body>` de Dashboard.html por un layout mobile-first
basado en el mock `dashboard-mobile.jsx`. El `<script>` (renderAnual, renderMensual,
todas las funciones drawXxx, helpers) quedó 100% idéntico — no se tocó.

**Qué ya funciona:**
- Header sticky: pill ARS/USD + segmented control Mensual/Anual
- Indicadores 2×2 con datos reales del mes
- Donuts por categoría (anual y mensual)
- Gráficos SVG existentes en sus nuevos contenedores
- Insight chips (renderAnnualInsights, renderMonthlyInsights, etc.)
- Detección touch → `body.is-desktop` → max-width 600px centrado

**Qué queda vacío/roto (esperado):**
- `#heroBalance` y `#miniKpiRow` ocultos (display:none), sin JS que los pueble
- `#catBarsAnual` y `#catBarsMensual` vacíos (contenedores .catbars-wrap sin JS)
- `#monthListBody` vacío (contenedor .month-list sin JS)
- `#drillSheet` sin lógica (backdrop no cierra nada)
- `#legacyCompat` recibe los KPIs de `renderKpis` pero está off-screen

## Próximos commits

### 1.2 — Hero + MiniKpi render
Agregar al `<script>` de Dashboard.html:
- `renderHeroBalance(k, netDelta, deltaHint, tab)` → puebla `#heroBalance` con
  `.hero-value`, `.hero-sec`, `.hero-delta`, `.hero-glow.neg` si balance < 0.
  Mostrar el div con `style.display = ''`.
- `renderMiniKpis(k, ingDelta, gasDelta, deltaHint)` → puebla `#miniKpiRow` con
  dos `.mini-kpi-card` (Ingresos / Salidas) con stripe de color, main, sec, delta.
- Llamar ambas desde `renderKpis()` además del código legacy existente.
- `headerPeriodLabel` debe mostrar el período (año o mes): actualizar en
  `renderAnual` y `renderMensual`.

### 1.3 — CatBars + MonthList JS
- `drawCatBars(containerId, items, valueKey, promKey, prevKey, colors, currency, onItemClick)`
  → genera HTML `.catbar-item` con `.catbar-fill`, `.catbar-ref`, `.catbar-delta`.
  Llamar desde `renderAnual` (→ `#catBarsAnual`) y `renderMensual` (→ `#catBarsMensual`).
- `drawMonthList(containerId, rows, isArs, accent)`
  → genera HTML `.month-row` con `.month-bar-fill`, `.month-dlt`, `.month-net`.
  Llamar desde `renderAnual` (→ `#monthListBody`).
- Leyenda del gráfico anual: poblar `#annualChartLegend` con año actual / año prev / prom 12m.

### 1.4 — Drill-down sheet
- `openDrillSheet(cat, color, subs, currency, refLabel, prevKey, promKey)`
  → muestra `#drillSheetBackdrop` + `#drillSheet`, puebla `#drillSheetContent`.
- `closeDrillSheet()` → oculta ambos.
- Keydown Escape → `closeDrillSheet()`.
- Conectar `onItemClick` de CatBars al `openDrillSheet`.

## IDs clave a no mover
heroBalance, miniKpiRow, indicadoresGrid, annualByMesCard, catCard, catCardMensual,
monthlySubcatCard, annualMonthListCard, descTableSection, catBarsAnual, catBarsMensual,
monthListBody, annualChartLegend, drillSheet, drillSheetBackdrop, drillSheetContent,
legacyCompat (zoneKpis + kpi* IDs off-screen)

## Archivos involucrados
- `Dashboard.html` (único archivo para todos los commits 1.2/1.3/1.4)
- `dashboard-mobile.jsx` en `C:\Users\20243359679\Downloads\` — referencia del mock
