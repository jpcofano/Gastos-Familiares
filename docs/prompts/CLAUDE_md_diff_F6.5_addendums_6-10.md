# Diff propuesto — docs/CLAUDE.md (cierre F6.5, addendums 6-10)

Cuatro ediciones puntuales sobre la línea 20 (descripción de Fase 6 / F6.5). Cada una es un
`str_replace` exacto. No se reescribe el párrafo entero: se corrigen las dos contradicciones con el
código actual y se agrega una cláusula de addendums. Mostrar el diff antes de aplicar (convención).

---

## Edición 1 — tarjeta automática + streaming (addendums 6 y streaming)

**OLD**
```
upload PDF con tarjetaCodigo pre-seleccionado → `resumenesTarjeta/{hashPdf}` estado:subido → `extraerResumenTarjeta` onDocumentCreated (max_tokens 32000,
```
**NEW**
```
upload PDF sin selector — tarjetaCodigo se resuelve del PDF (numeroCuenta → banco+tipo → si no resuelve estado:requiere_tarjeta + asignador inline que pasa a parseado sin re-extraer) → `resumenesTarjeta/{hashPdf}` estado:subido → `extraerResumenTarjeta` onDocumentCreated (streaming client.messages.stream + finalMessage con guard stop_reason, max_tokens 32000, timeoutSeconds 300,
```

---

## Edición 2 — sin dedup (addendum 9)

**OLD**
```
impuestos/percepciones sin persona. dedup post-Claude: descripcionRaw|monto + monto|moneda|fecha. Tres tipos de línea:
```
**NEW**
```
impuestos/percepciones sin persona. Sin dedup en el parseo del resumen: cada línea es una transacción real distinta y el cuadre es la única compuerta de integridad (el dedup por descripcionRaw|monto + monto|moneda|fecha borraba cargos repetidos legítimos — removido en addendum 9). Tres tipos de línea:
```

---

## Edición 3 — ajuste manual de cuadre (addendum 10)

**OLD**
```
Se capturan en `ajustesConsolidado[]` ({concepto, montoARS, montoUSD}) para trazabilidad y se muestran en el banner.
```
**NEW**
```
Se capturan en `ajustesConsolidado[]` ({concepto, montoARS, montoUSD, origen?:'pdf'|'manual'}) para trazabilidad y se muestran en el banner. Ajuste manual de cuadre: cuando el parser lee mal un monto irreconstruible, se agrega una entrada con origen:'manual' (residuo = total−suma por moneda) que cierra el cuadre sin saltearlo; el validator lista los resúmenes con origen:'manual' como señal de calidad del parser.
```

---

## Edición 4 — estado autodescriptivo + resumen de addendums (addendums 7 y 8)

**OLD**
```
Vista /tarjetas admin-only con lista + preview table + banner cuadre. Ruta separada de comprobantes — no toca extraerComprobante.) cerrado.
```
**NEW**
```
Vista /tarjetas admin-only con lista + preview table + banner cuadre. Ruta separada de comprobantes — no toca extraerComprobante. Estado autodescriptivo: el doc es la única fuente de verdad de `estado`; el seed lo escribe explícito (EstadoImport=aplicado→confirmado, resto→parseado) y el deserializador default es 'subido' (nunca 'confirmado') — fix del confirmado fantasma. Addendums F6.5: 6 (tarjeta automática del PDF, numeroCuenta) · 7 (estado autodescriptivo) · 8 (asignar tarjeta parchea metadata y pasa a parseado, no re-extrae — trigger es onDocumentCreated) · 9 (sin dedup) · 10 (ajuste manual de cuadre).) cerrado.
```

---

## Nota
- No toco la línea de F6.6 (share-target → "auto-subida en Comprobantes"). Esa cambia cuando se decida
  la ingesta unificada (router por tipo); se actualiza en ese momento, no ahora.
- Estas 4 ediciones reflejan el estado real del código en `4c232e3` + los addendums 8/9/10 una vez
  implementados. Si se aplican ANTES de implementar 8/9/10, el contrato adelanta al código por unos
  commits — aceptable si Code los corre en la misma tanda; si no, aplicar el diff junto con el merge.
```
