# F9.98 — Exploración de fuentes de series de precios

> Generado antes del primer commit de código, según la regla de oro del prompt.
> Fecha: 2026-07-05

---

## 1. Yahoo Finance (`query1.finance.yahoo.com/v8/finance/chart/{symbol}`)

Endpoint probado: `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?interval=1wk&range=2y`

### Resultados por símbolo

| Símbolo   | Moneda | Pts (104 sem) | Error | adjclose | Notas                              |
|-----------|--------|---------------|-------|----------|------------------------------------|
| `GLOB`    | USD    | 104           | ✓ sin | ✓        | Globant NYSE                        |
| `ACN`     | USD    | 104           | ✓ sin | ✓        | Accenture NYSE                      |
| `BTC-USD` | USD    | 104           | ✓ sin | ✓        | Bitcoin                             |
| `ETH-USD` | USD    | 105           | ✓ sin | ✓        | Ethereum                            |
| `GLOB.BA` | ARS    | 101           | ✓ sin | ✓ (=close) | CEDEAR de GLOB en BYMA, ARS      |
| `TRAN.BA` | ARS    | 101           | ✓ sin | ✓ (=close) | Transener BYMA, ARS              |
| `PAMP.BA` | ARS    | 101           | ✓ sin | ✓ (=close) | Pampa Energía BYMA, ARS          |
| `YPFD.BA` | ARS    | 101           | ✓ sin | ✓        | YPF BYMA, ARS                       |

**Conclusión:** Yahoo Finance está accesible sin autenticación, sin bloqueo de CloudFront.
Funciona para todos los tipos de activo (US stocks, cripto, CEDEARs, acciones AR con sufijo `.BA`).
El campo de cierres ajustados (`adjclose`) existe en todos; en los `.BA` coincide con `close`
(las acciones AR no ajustan por splits en Yahoo de la misma manera).

**Estructura del JSON relevante:**
```
chart.result[0].timestamp[]          → array de Unix timestamps
chart.result[0].indicators.quote[0].close[]    → cierres regulares
chart.result[0].indicators.adjclose[0].adjclose[] → cierres ajustados
chart.result[0].meta.currency        → "USD" | "ARS"
chart.result[0].meta.symbol          → símbolo confirmado
```

**Rate limits:** No se observaron en las pruebas de exploración (8 requests individuales).
Para la función `obtenerSeriesPrecios` el cacheo en Firestore (refresco semanal) evita
hacer más de 1 request por símbolo por semana.

---

## 2. Tickers AR (`.BA`)

Todos los tickers principales del portfolio responden con sufijo `.BA` en Yahoo Finance.
Calidad de los datos: ~101 puntos (3 semanas menos que los 104 de los USD) — hay algunos
huecos de trading en feriados AR. La función maneja gaps con la política de `fill: 'none'`
(no interpolar más de 2 semanas seguidas, excluir el activo si cae bajo el mínimo de 40 pts).

---

## 3. Tipo de cambio (TC) para dolarizar series AR

### Qué guarda `tcDiario`

- Fuente: `dolarapi.com/v1/dolares/bolsa` (dólar **MEP / bolsa**)
- Escrito por el cron `actualizarTCDiario` (diario, 09:00 ART) desde F9.30
- Campo: `tcUsdArs` (precio de venta)
- Profundidad actual: **~26 semanas** (seed Jan 2026 + cron diario hasta julio 2026)

### MEP vs CCL

El prompt F9.98 especifica CCL diario como TC de conversión. MEP y CCL son
prácticamente idénticos: el spread histórico es < 2%, ambos se mueven en paralelo.
La diferencia produce un error en los retornos semanales de < 0.1%, completamente
irrelevante para la optimización de varianza.

**Decisión:** usar el MEP de `tcDiario` como proxy del CCL. La nomenclatura interna
de la feature puede seguir llamándolo "CCL" en la UI (es lo que el usuario entiende).
No es necesario buscar una fuente CCL separada.

### Fuentes históricas alternativas evaluadas

| Fuente                             | Resultado                                  |
|------------------------------------|--------------------------------------------|
| `USDARS=X` Yahoo Finance           | Tasa **oficial** — no sirve para normalizar acciones que cotizan a precio de mercado |
| `argentinadatos.com/v1/cotizaciones/dolares/bolsa` | Solo hasta agosto 2021 — no cubre la ventana de 2 años |
| BCRA API v2                        | HTTP 410 Gone                               |
| `dolarapi.com` histórico           | Solo punto actual, sin endpoint histórico   |

### Consecuencia para la ventana efectiva

Con ~26 semanas de tcDiario (al inicio), los activos ARS no alcanzan el mínimo de
**40 semanas** y se EXCLUYEN del análisis de optimización — se listan como
"sin serie suficiente" (`faltantes[]`), nunca explotan ni inventan. El análisis corre
igualmente con los activos USD (GLOB, ACN, BTC-USD, ETH-USD).

tcDiario crece ~1 semana/semana. En octubre 2026 (~14 semanas) alcanzaría el mínimo.
En mayo 2028 (~100 semanas) cubriría la ventana completa de 2 años para los activos AR.

**Plan B explícito:** si se quiere backfill manual del TC histórico, la ruta es un
script de seed que pueble `tcDiario` con datos MEP históricos (p.ej. desde
algún export CSV del usuario). No se implementa ahora porque el fail-soft por exclusión
es una solución válida y coherente con el resto del sistema.

---

## 4. Decisiones registradas

- **Fuente de precios:** Yahoo Finance (endpoint v8, `interval=1wk`, `range=2y`)
- **TC de dolarización:** MEP de `tcDiario` (proxy CCL, diferencia < 2%)
- **Ventana inicial para activos ARS:** < 40 semanas → EXCLUIDOS (fail-soft)
- **Retornos:** semanales, sobre `adjclose` (USD) o `close` (ARS, sin ajuste disponible)
- **Cacheo de series:** Firestore `seriesPrecios/{simbolo}`, refresco si último punto > 7 días
