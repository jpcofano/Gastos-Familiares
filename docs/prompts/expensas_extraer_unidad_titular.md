# F6.x — Extracción de expensas: monto de la UF 043 del titular (no del edificio)

> Una liquidación de expensas de consorcio lista los gastos de TODO el edificio (sueldos, cargas,
> rubros → total ~$1,6M). El titular solo debe la expensa de SU unidad. En la liquidación figura
> únicamente la UF 043 (el depto); la cochera no tiene línea propia. Hoy la extracción toma el total
> del edificio. Debe tomar SOLO la línea de la UF 043.

## Evidencia (ejemplo real)
- "Expensas Del Signo 4042 2026 05": lista remuneraciones, cargas sociales, "TOTAL RUBRO 1
  $1.597.933,35" — todo del consorcio, no de la unidad.
- El pago real de expensas fue **$159.519,43** (transferencia a Cons Prop Pje Del Signo,
  CUIT 30-63669628-1, confirmado por Juan).
- La única unidad de la familia que figura en la liquidación es la **UF 043** (Del Signo 4042, depto).
  Es **una sola línea, un solo monto** → ese es el montoTotal.

## Decisión (confirmada con Juan)
Para documentos de tipo expensas / liquidación de consorcio, `montoTotal` = expensa de la **UF 043**
del titular, NO el total del edificio. Una sola unidad → un solo monto. No sumar ni buscar otras UF.

## Cambios

### 1. Config: unidad del titular
Agregar al config (ej. `config/familia` o un `config` de inmuebles) la unidad de la familia:
```ts
unidades?: Array<{ uf: string; alias?: string; etiqueta?: string }>;
// [{ uf: '043', alias: 'Del Signo 4042 043', etiqueta: 'Expensas' }]   // UNA sola unidad
```
(Titular COFANO; dirección Del Signo 4042; UF 043 = depto. La cochera no tiene expensa propia.)

### 2. Extracción (prompt del comprobante)
Regla para expensas/consorcio, pasando la(s) unidad(es) del titular como contexto:
"Si el documento es una liquidación de expensas/consorcio, NO extraigas el total del edificio. Buscá la
fila/sección de la unidad funcional 043 del titular (COFANO) y extraé el **monto a pagar de ESA
unidad** como montoTotal. Es una sola unidad → un solo monto. Ignorá cualquier otra UF y los totales
del edificio (rubros, sueldos, cargas)."

### 3. Match por destino (ya cubierto por F6.8)
El destino de la transferencia (CUIT 30-63669628-1 del consorcio) ya alcanza para vincular el pago al
esperado de expensas. Este addendum arregla el **monto del lado factura**, no el match del pago.

## Criterio de cierre
- Subir "Expensas Del Signo 4042" → montoTotal = expensa de la UF 043 (no $1,6M del edificio).
- Si la liquidación no muestra la UF 043 (caso raro) → montoTotal = null o el total del documento como
  fallback, y marcar para revisión manual (no inventar).

## Nota
- Una sola unidad (UF 043). La cochera (030) aparece en facturas de Aysa pero NO en la expensa del
  consorcio → no se busca ni se suma.
