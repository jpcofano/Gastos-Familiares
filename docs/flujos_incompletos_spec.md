# Flujos incompletos del legacy — especificación para F5.2 y F6

Registro de decisiones y diseño para dos flujos que el sistema viejo dejó incompletos.
Origen: revisión uno-por-uno de esperados (2026-06) + casos reales de la planilla.

---

## Decisión registrada — estado de resúmenes

Los resúmenes de tarjeta **se pagan al vencimiento y listo**. NO existe flujo de
revisión/confirmación por estados. `EstadoImport='pendiente_revision'` del legacy es
vestigial (de un flujo eliminado) y NO se porta: ninguna lógica nueva debe leer ni
depender de ese estado. El estado "pendiente/registrado" del checklist deriva SOLO de
la existencia del movimiento TarjetaPago correspondiente.

→ Agregar esta línea a `docs/CLAUDE.md` (decisiones cerradas) en el próximo paso que lo toque.

---

## Flujo 1 — Verificación de duplicados

Motivación real: en mayo 2026 la planilla tenía AySA ×3 idénticos (45.365,16) y
Expensas ×2 (159.519,43) — residuos de pruebas que nadie detectó hasta una revisión manual.

### 1.a — Aviso al cargar (entra en F5.2)

Al crear un movimiento (manual o desde checklist), buscar en el MISMO mes candidatos:
- mismo `monto` exacto + misma `moneda` + `fecha` a ±3 días, **o**
- mismo `numeroComprobante` (solo si ambos lo tienen no-null).

Comportamiento: **aviso, no bloqueo.** Mostrar el/los candidatos (fecha, descripción,
monto) y pedir confirmación explícita ("cargar igual"). Razón: existen duplicados
legítimos (dos compras iguales el mismo día); el sistema informa, el humano decide.

Implementación: query sobre el mes ya filtrado (barato, ya está en memoria en la vista
del mes o es una query con `where mes ==`). Sin índices nuevos.

### 1.b — Reporte de duplicados (script, antes del cutover)

`npm run dups` — solo lectura contra el emulador (o producción post-cutover con
`--target`):
- Agrupa movimientos por (`monto`, `moneda`, `mes`) y reporta grupos de 2+ con
  fechas a ≤7 días entre sí, mostrando id, fecha, descripción, subtipo, persona.
- Excluye pares TarjetaConsumo↔TarjetaPago (la bifurcación es duplicación INTENCIONAL
  por diseño) y movimientos con distinto `resumenTarjetaId`.
- Salida: reporte markdown en `docs/`, NO modifica nada.

Uso principal: limpieza sistemática de la planilla ANTES del snapshot final del
cutover (F7). Reemplaza el hallazgo casual por barrido completo.

---

## Flujo 2 — Comprobantes: número vs CUIT (entra en F6)

Problema real reportado: no siempre hay número de comprobante, y la extracción a veces
trae el CUIT en lugar del número.

### 2.a — Prompt de extracción (endurecimiento del prompt legacy, que se conserva)

El prompt de comprobantes del sistema viejo (`gf_buildComprobantePrompt_`) se porta
casi textual (decisión de auditoría) con estos agregados:
- **Campos separados y definidos por formato:**
  - `cuitEmisor`: identificación fiscal del emisor. Formato: 11 dígitos, usualmente
    `XX-XXXXXXXX-X`. Pedirlo EXPLÍCITAMENTE como campo propio (que tenga su lugar
    evita que contamine otros campos).
  - `numeroComprobante`: número del documento (factura/recibo/transferencia). Formatos
    típicos: `XXXX-XXXXXXXX` (factura), alfanuméricos de transferencia. NUNCA es el CUIT.
  - Instrucción explícita: "si no encontrás número de comprobante, devolvé null — NO
    uses el CUIT ni inventes".
- **Validación post-extracción (en la Function, no confiar solo en el prompt):**
  - Si `numeroComprobante` matchea patrón CUIT (`^\d{2}-?\d{8}-?\d$`) → moverlo a
    `cuitEmisor` si está vacío, y dejar `numeroComprobante` en null.
  - CUIT con dígito verificador inválido → null + warning en log.

### 2.b — Fallback cuando no hay número (patrón legacy conservado)

Si `numeroComprobante` queda null tras extracción+validación: generar pseudo-número
determinístico (patrón del viejo `gf_generarPseudoNumero_`): `{mes}-{subcategoria}-{persona}{moneda}`
o equivalente estable. Marca distintiva (prefijo `PSEUDO-` o campo booleano
`comprobanteGenerado: true`) para que el dedup por comprobante (Flujo 1.a) sepa que dos
pseudo-números iguales NO son necesariamente el mismo documento.

### 2.c — Dedup de PDF (ya decidido, solo registro)

El hash SHA-256 del PDF antes de llamar a la API (anti doble-import + ahorro de
tokens) se conserva tal cual del legacy. Campo: `hashPdf`.

---

## Secuencia

1. F5.1 (en curso) — alta manual.
2. F4.2.1 (pasado a Claude Code) — match fino de esperados.
3. F5.2 — registrar desde checklist + edición/borrado admin + **Flujo 1.a** (aviso de duplicados al cargar).
4. F5.3 — realtime (onSnapshot mes, optimistic, offline).
5. Pre-F7 — **Flujo 1.b** (`npm run dups`) sobre los datos, limpieza de planilla, snapshot final.
6. F6 — comprobantes con **Flujo 2** completo (prompt endurecido + validación + pseudo-número).
