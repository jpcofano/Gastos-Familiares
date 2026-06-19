# F6.5 addendum 11 + fix detector F6.7 — Identificación robusta de tarjeta

> Dos arreglos del mismo tema (identificar tarjetas): (A) la resolución de `tarjetaCodigo` depende hoy
> de `numeroCuenta`, que es el dato frágil; agregar `ultimos4` como ancla confiable + guarda de
> ambigüedad. (B) el detector de F6.7 mandó una boleta de patente a resúmenes (falso positivo).
> Code: aplicar a los archivos de cada parte; filing sugerido: parte A → addendum 11 de F6.5,
> parte B → addendum del detector de F6.7.

## Parte A — Resolución de tarjeta en capas (con guarda)

### Contexto (repo)
- `config.tarjetas[]` = `{ codigo, banco, tipo, numeroCuenta? }` (types/index.ts ~185).
- La CF resuelve hoy `numeroCuenta → banco+tipo → requiere_tarjeta`. `numeroCuenta` es frágil
  (Galicia Master usa "N° de Socio", no cuenta).

### Decisión (A-over-B)
Resolución **en capas por especificidad, con guarda de ambigüedad**: en cada capa, si resuelve a
exactamente UNA tarjeta de `config.tarjetas` → listo; si matchea más de una → no adivina, baja a la
siguiente capa o a `requiere_tarjeta`. Es la misma filosofía propone→confirmás.

### Cambios
1. `config.tarjetas[]` y el tipo `FamiliaTarjeta`: agregar `ultimos4?: string` (4 dígitos) y
   `titular?: string` (memberId del titular). Campos nuevos en tipo + seed.
2. La CF de extracción ya saca un número de tarjeta; que extraiga también **los últimos 4 dígitos**
   del PAN del encabezado (campo nuevo `ultimos4` en el parseo).
3. Resolución de `tarjetaCodigo` en este orden, cada una con guarda "exactamente una":
   1. `numeroCuenta` exacto.
   2. `ultimos4` exacto. ← ancla principal nueva (más confiable que numeroCuenta).
   3. `banco + tipo` **solo si resuelve a una sola** tarjeta.
   4. `banco + tipo + titular` (desempate cuando banco+tipo colisiona; el titular sale del bloque/encabezado).
   5. nada o ambiguo → `estado: 'requiere_tarjeta'` (asignador inline existente).

### Criterio de cierre
- Resumen Galicia Master (sin numeroCuenta legible) resuelve por `ultimos4`.
- Dos tarjetas mismo banco+tipo → no se autoasigna; cae a titular o a requiere_tarjeta.

## Parte B — Fix del detector (patente ≠ resumen)

### Contexto (repo)
El router de F6.7 clasifica un PDF como `resumen` con ≥2 marcadores. `VENCIMIENTO` y `CIERRE` aparecen
también en boletas de patente/impuestos → falso positivo (BOLETAS-PATENTE-ID.pdf fue a resúmenes).

### Cambio
Localizar la función de detección del router (en `functions/src/` o `src/datos/entrantes.ts`) y exigir
**al menos un marcador decisivo** que solo un resumen de tarjeta tiene, no solo los genéricos:
- Decisivos: número de tarjeta enmascarado (`\d{4}\s?[X\*]{4,}\s?\d{4}` o PAN agrupado de 16),
  `PAGO MINIMO`, `LIMITE DE COMPRA`/`LIMITE DE CREDITO`, `SALDO ANTERIOR`.
- Regla nueva: `resumen` solo si hay **≥1 decisivo** (idealmente + 1 genérico). `VENCIMIENTO`/`CIERRE`
  solos → NO resumen → cae a `comprobante` (una boleta es un comprobante/factura).
- `motivoDeteccion` debe nombrar el marcador decisivo que disparó, para trazabilidad.

### Criterio de cierre
- Una boleta de patente con VENCIMIENTO + CIERRE pero sin PAN/PAGO MINIMO → va a `comprobante`.
- Un resumen real (con PAN enmascarado o PAGO MINIMO) → sigue yendo a `resumen`.
