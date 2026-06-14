# Mapeo — actualización post F5.3 (seguridad + backlog + proceso)

> No es una feature. Es actualizar el source of truth (`docs/CLAUDE.md`) y resolver una exposición de datos.
> Orden: 1) seguridad PRIMERO, 2) backlog, 3) proceso.

## 1. ACCIÓN DE SEGURIDAD (antes que nada)

El repo es **público** y tiene commiteados en `data/` dos snapshots reales de la planilla
(`*_sheet_snapshot.xlsx`) → data financiera personal de la familia, descargable por cualquiera.

Confirmá con `git ls-files | grep data/` qué está trackeado. Resolver con **una** de estas vías
(Juan decide):
- **A (recomendada)**: hacer el repo **privado** en GitHub. Resuelve todo de una, sin reescribir historia.
- **B**: mantener público → sacar los xlsx, agregar `data/*.xlsx` al `.gitignore`, **purgar del historial**
  (`git filter-repo` o BFG) y `git push --force`. Borrarlos en un commit nuevo NO alcanza: siguen en
  los commits viejos públicos.

En ambos casos: agregar `data/*.xlsx` (o `data/` salvo `.gitkeep`) al `.gitignore` para que los próximos
snapshots no se vuelvan a commitear. Los snapshots viven local.

## 2. Backlog → agregar a `docs/CLAUDE.md`

```markdown
## Backlog (post F5.3)
- **F6.4 — Carga manual de movimiento (ingreso/gasto) desde Comprobantes.**
  Botón que abre AltaMovimiento sin pasar por extracción. Feature chica.

- **F6.5 — Pipeline de resumen de tarjeta (1 resumen → N movimientos).**
  Un resumen_tarjeta NO es un pago único: es un estado de cuenta con N consumos → mapea a la
  colección resumenesTarjeta y genera N movimientos. Pipeline distinto al de F6 (extracción
  multi-línea, alta masiva con confirmación). Versión moderna del folder-scan de
  49_Tarjetas_API.gs (detectaba tarjetaCodigo por nombre de archivo, dedup por ResumenID).
  Fase propia, requiere ronda de diseño dedicada.

- **F6.6 — PWA share-target (compartir desde el celular).**
  Paridad con el sistema viejo (12_ShareTemp.gs: carpeta Drive temporal + token + TTL, era un
  workaround de Apps Script). En Firebase colapsa: el share-target del teléfono llama directo a
  subirComprobante → Storage (F6.1) + dedup SHA-256 + trigger onCreate (F6.2) ya hacen el resto.
  No se porta la carpeta Drive; se reemplaza por share-target alimentando el pipeline existente.
  Feature chica (la infra pesada ya existe).
```

## 3. Proceso de prompts (modo B) → agregar a `docs/CLAUDE.md`

```markdown
## Proceso de prompts (modo B)
- Un prompt BASE por feature en docs/prompts/ (ej: F5.3_realtime_base.md), congelado al entregarse.
- Cambios posteriores → ADDENDUMS numerados (ej: F5.3_addendum_1.md) que indican qué sección del
  base modifican. NUNCA se reescribe un .md ya entregado a Code (evita confundirlo con versiones).
- Las idas y vueltas de diseño se resuelven en chat (claude.ai); el .md nace/cambia solo con lo acordado.
- Regla: cada cierre de feature actualiza docs/CLAUDE.md (estado + backlog) en el MISMO commit, para
  que el mapeo nunca quede atrás del código.
```

## 4. Estado a reflejar en `docs/CLAUDE.md`
- **F5.3 CERRADO** (HEAD b5c0189): realtime con onSnapshot, latency compensation (sin optimistic
  manual), persistentLocalCache + multi-tab con degradado elegante, índices compuestos declarados en
  firestore.indexes.json (incluye persona+mes para prod). Hooks useComprobantes/useMovimientosDelMes,
  ItemsEsperadosContext. Colecciones quasi-estáticas siguen one-shot.

## Cierre
- Resolver seguridad (privado o purga) y confirmar.
- Commit del mapeo: `docs — backlog F6.4/5/6, proceso modo B, cierre F5.3` (+ gitignore data si aplica).
