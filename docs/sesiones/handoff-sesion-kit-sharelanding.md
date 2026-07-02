# Handoff — sesión kit: editar movimiento, pulido app viva, ShareLanding (cierre 02-jul-2026)

> Para abrir la sesión nueva. Todo lo de infra/datos/PWA quedó cerrado; lo que sigue es
> **pasar a Code lo que rediseñamos en el kit** esta sesión.

## Estado general (todo verde)
- **Etapas A/B/C completas**: datos reales en prod (`gastos-familiares-e6415`), migración hecha,
  hosting `gastos-familiares-jmsf.web.app`, **PWA instalable y funcionando** (manifest OK, SW
  activated, login de los 4 miembros OK).
- El kit (`ui_kits/mobile/`) quedó **alineado con la app** en el flujo de comprobante.

## Lo que se hizo esta sesión (kit + Code)
Implementado por Code y verificado en vivo:
- **F9.53** editar/eliminar movimiento (buscador + editor admin-only).
- **F9.54** pulido app viva (copete/nav fijos, índice TC, logos de medios, instalar app, card HOY).
- **F9.55** KPIs Resumen + config de gráficos (9 paletas + Lista/Dona/Treemap, `/perfil/graficos`).
- **F9.56** Cargar: resúmenes colapsados + bandeja condicional.
- **F9.57** Dashboard Anual: meses futuros = proyección lineal (corrige el -97%).
- **F9.60–63** pipeline comprobantes (matching/fecha/backend).

## LO QUE FALTA PASAR A CODE (arrancar acá)
Tres cosas, todas ya diseñadas en el kit — falta el prompt / aplicarlas en el repo:

1. **F9.64 — payee real + sacar nombre de archivo** (prompt YA escrito, en uploads/repo).
   Historial de Cargar + ShareLanding muestran el **payee** (factura→emisor, transferencia→
   destinatario), no "IMG-…jpg". Kit listo (`CargaMobile.jsx` FileRow, `data.jsx` M_COMPROBANTES
   con `payee`/`tipoDoc`). **Depende de nada — se puede correr ya.**

2. **F9.65 — ShareLanding: badges bajo el valor + sacar pill de nombre** (prompt YA escrito).
   **Depende de F9.64.**

3. **F9.66 — ShareLanding rediseñado (FALTA ESCRIBIR EL PROMPT).** Esta sesión rehicimos el
   ShareLanding entero en el kit (`ui_kits/mobile/ShareLanding.jsx`) + el badge de
   `ComprobanteConfirm.jsx`. Cambios a portar:
   - **La espera llena la pantalla** (la parte lenta es la extracción): chip arriba, {documento
     animado grande + "Leyendo tu comprobante/resumen…"} al centro, indicador abajo —
     `justify-content: space-between` durante la espera. Aplica a las **dos ramas** (factura y
     resumen de tarjeta).
   - **Documento nuevo** (recibo estilizado con marca/líneas/total, anillos de pulso + barrido +
     flote) en vez del ícono viejo. Header arreglado (el "GF" ya no se encima).
   - **Dos indicadores compactos, icon-forward, sin texto largo**: **Pre-clasificado (ámbar,
     `sparkles`)** aparece temprano + **Gasto esperado (verde, `git-compare`)** al terminar.
     Mismo par en `ComprobanteConfirm` (reemplazó el badge largo "Gasto esperado · Edenor — luz").
   - **Listo**: "Comprobante detectado" · monto con count-up · comercio(payee) · los 2
     indicadores · chips (categoría · Vence · ARS). Rama resumen: total + banco + split
     este-mes/deuda-futura. Auto-avance al confirm intacto.
   - Para el pre-clasificado, el sistema viejo (Apps Script) ya tenía la categoría sugerida —
     usar esa fuente.
   - Keyframes agregados en `tokens/motion.css`: `gfShimmer`, `gfFloat` (+ los ya existentes
     `gfScan`, `gfRing`, `gfSpin`).

## Convenciones (recordatorio)
- Prompts numerados, **sin sub-números**, uno por número, en `docs/prompts/F9.NN-slug.md`,
  entregados como descarga.
- El kit es referencia de diseño; Code implementa en el repo `jpcofano/Gastos-Familiares`.
- No re-litigar decisiones registradas en `CLAUDE.md` (Dashboard=devengado / Resumen=caja,
  taxonomía=label, config=callables admin-only, persona=memberId, etc.).

## Para abrir la sesión nueva
"Seguimos con los prompts para Code de lo diseñado en el kit: F9.64 y F9.65 (ya escritos, F9.65
depende de F9.64) y **escribir F9.66** (ShareLanding rediseñado + badges pre-clasificado/gasto
esperado). Ver `docs/handoff-sesion-kit-sharelanding.md`."
