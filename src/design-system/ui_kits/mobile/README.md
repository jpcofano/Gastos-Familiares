# UI kit — App móvil (legacy)

The **primary** product surface: a faithful, improved recreation of the legacy Apps Script
app's mobile pattern, themed on the **emerald + ink** identity. From `_styles.html` and
`60_Dash.gs` in
[jpcofano/Sistema-Gastos-Personales](https://github.com/jpcofano/Sistema-Gastos-Personales).

Open `index.html`. The app is a single phone frame with a **fixed bottom-nav** (Inicio ·
Resumen · Cargar · Perfil), a floating **+** for quick manual entry, and full-screen
**hero + drawer + CTA** capture modals.

## Screens
- **Inicio (Dashboard)** — `DashboardMobile.jsx`. Legacy `60_Dash.gs` parity: neto del mes en
  **equivalente ARS**, split **ARS/USD** (pesos disponibles, faltante USD, ingresos/gastos),
  **TC ref**, **gastos por categoría** (barras), y **movimientos recientes**. Month stepper.
- **Resumen** — `ResumenMobile.jsx`. Totales (esperado / pendiente / al día) + el **checklist
  de pagos esperados**: cada ítem con tint + acento de 3px + `StatusBadge`, y "Registrar pago"
  en los accionables. Header → **Tarjetas**.
- **Tarjetas** — `TarjetasMobile.jsx`. Resúmenes de tarjeta (cara ink + total + estado).
  Sub-vista alcanzable desde Resumen.
- **Cargar** — `CargaMobile.jsx`. Dropzone + entrantes recientes (`M_ENTRANTES`) con estado
  ok/wait/warn. Cualquier item abre el flujo Comprobante.
- **Perfil** — `PerfilMobile.jsx`. Card stack de la brief **F8.0**: tier *Personal* (todos) +
  *Configuración familiar* (admin). Apariencia marca el tema oscuro como "Pronto".

## Capture modals (hero + drawer + CTA)
- **Confirmar comprobante** — `ComprobanteConfirm.jsx`. `StepIndicator`, datos extraídos
  (read-only), clasificación editable, match propuesto (`Message` + `StatusBadge`).
- **Alta manual** — `ManualGasto.jsx`. Chips tipo/moneda, field-rows, monto en vivo en el hero.

## Components used
`Button (size="cta") · Badge · StatusBadge · Card · Money · Message · RadioChip · FieldRow ·
StepIndicator · MonthSelector` de `window.GastosFamiliaresDesignSystem_d81a5e`, + el scaffold
local `Phone / AppBar / Screen / BottomNav / FullModal / Hero / Drawer / CtaBar`
(`MobileShell.jsx`). Íconos: **Lucide** (CDN).

## Mejoras vs. la legacy
Verdes separados (esmeralda marca / verde ingreso / ink neutral), labels de field-row con
mejor contraste (`#374151`), step indicator con barra de progreso, hero a peso 800 +
tabular-nums. Tema oscuro diferido hasta tener todas las pantallas. Ver README raíz →
"RECOMMENDATIONS".
