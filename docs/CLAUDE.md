# Sistema de Gastos Familiares — Firebase

## Que es esto

Sistema familiar de gestion de gastos. Migrado desde Google Sheets + Apps Script
a Firebase (Hosting + Auth + Firestore + Functions + Storage). Fuente de verdad
unica: Firestore. Sheets queda archivado en read-only.

Cuatro usuarios reales: Juan y Maria (admins, login con Google), Federico y Sofia
(dependientes, login con Google propio, solo ven y cargan lo suyo).

## Estado actual

- Fase 0 — Setup: cerrado.
- Fase 1 — Modelo de datos: cerrado.
- Fase 2 — Seed Sheets a Firestore: codigo listo, pendiente correr en produccion.
- Fase 3 — Auth + shell PWA: cerrado.
- Fase 4 — Vistas read-only (Dashboard, Resumen, pantalla de hijos): cerrado.
- Fase 5 — Flujos de escritura (Manual, Eventuales, Ingresos): F5.1 cerrado. F5.1.0 hotfix P0 cerrado (autorizados por email). F5.2 cerrado (state machine 8 estados, registrar desde checklist, itemEsperadoId). F5.3 cerrado (realtime onSnapshot + offline persistentLocalCache; latency compensation automática, sin optimistic manual).
- Fase 6 — Tarjetas + Comprobantes con Cloud Functions: F6.2 (infra Functions + extracción Anthropic) cerrado. F6.3 (match server-side propone→confirmás, 3 ramas + dedup) cerrado. F6.4 (carga manual sin comprobante, dedup advisory no-bloqueante, origen Manual) cerrado. F6.4.5 (clasificador on-write: lookup cliente DiccionarioContext + trigger aprendizaje server-side, clave alineada SHA256 patron+banco+tarjeta, arregla bug gf_dictLookup_ de 1 vs 3 params) cerrado. F6.6 (PWA share-target Android: manifest + SW handler IDB + auto-subida en Comprobantes; iOS fallback via input file existente) pendiente prueba en dispositivo real.
- Fase 7 — Cutover y archivo del Sheet: pendiente.

## Decisiones cerradas

- Sheets se descarta como fuente. Firestore es source of truth unica.
- Plan Blaze con presupuesto de alerta US$5/mes.
- Seed-as-fresh-project: trabajamos como si nunca hubiera estado en prod.
- Stack frontend: Vite + React + TypeScript (mismo blueprint que sistema de comidas).
- Auth: Firebase Auth con signInWithPopup + GoogleAuthProvider.
  Whitelist en `/config/familia.miembros[*].emails`. Sin custom claims.
- Hijos se loguean. Read scope a su persona. Pueden crear, no editar ni borrar.
- Dict de aprendizaje global: lo que aprende cualquiera aplica para todos.
- Audit = solo timestamps (creadoEn, actualizadoEn, creadoPor). Sin subcoleccion history.
- Naming: castellano camelCase para colecciones y campos.
- Etiquetas tecnicas (JuanARS, etc.) se convierten a persona + moneda en seed.
- Router: React Router (react-router-dom), se instala al inicio de F4.
  Rutas montadas en shell-content; header fijo queda fuera del router.
- Resumenes se pagan al vencimiento. No hay flujo de revision por estados;
  pendiente_revision del legacy es vestigial y no se porta.
- ResumenMes es vista calculada en vivo, no se materializa.

## Reglas operativas

- Seed contra emulador por default. `--target=production` requiere `--i-am-sure`.
- Toda query filtra por `mes` o usa `limit()`. Nunca query sin filtro temporal.
- Dependientes siempre consultan movimientos con where('persona','==',memberId).
  Sin ese filtro, las Rules deniegan la query entera (fail-closed).
- Listeners `onSnapshot` en `movimientos`, `comprobantes` e `itemsEsperados` (F5.3).
  `itemsEsperados` se suscribe una vez en `ItemsEsperadosContext` (AppShell), compartido por Resumen, Comprobantes y ConfigEsperados. `movimientos` suscribe por vista (`useMovimientosDelMes`). Colecciones quasi-estáticas (subcategorias, etiquetas, config/familia): one-shot. `diccionario`: one-shot en `DiccionarioContext` (getDocs al montar AppShell), ~470 entradas en memoria para el clasificador.
- Backup diario de Firestore a GCS configurado en F0.
- `serviceAccountKey.json` SIEMPRE gitignored. Si se filtra, Google revoca la key.
- El formato de `numeroComprobante` para altas manuales (`YYYY-MM-<slug>`) vive en DOS lugares:
  el prompt de extracción (lo genera el modelo) y `generarNumeroManual()` en AltaMovimiento.tsx.
  Mantenerlos consistentes a mano al modificar cualquiera de los dos.

## Compromisos para fases posteriores

Estas mejoras quedan registradas pero no se implementan en F2:

- F3-F5: offline persistence (`enablePersistentLocalCache`), optimistic updates,
  onSnapshot en pantalla del mes.
- F4: aggregation queries (count, sum) en lugar de bajar docs.
- F6: transacciones atomicas para confirmar resumen, custom claims si Rules se sienten lentas.
- F0/F6: COOP/COEP headers en `firebase.json` (ya estan), TTL en `/temp/` de Storage,
  Cloud Scheduler para backup diario, tests de Security Rules con
  `@firebase/rules-unit-testing` antes de las Rules mismas.
- Antes de produccion: exportar `public/icons/icon.svg` a PNG 192x192 y 512x512.
  SVG funciona en Chrome 98+ para instalabilidad local; PNG requerido para stores e iOS.
- Pre-F7: `npm run dups` + limpieza de planilla.
- F6: comprobantes con prompt endurecido (CUIT vs numero, pseudo-numero).
  Spec completa: docs/flujos_incompletos_spec.md.

## Trabajando con Claude Code

- Sesiones de arquitectura: en el Project de Claude.ai. Sesiones de implementacion:
  en VS Code con Claude Code.
- Mockup-before-code: cuando una pantalla cambia, dos alternativas con tradeoffs
  antes de implementar.
- Cambios a CLAUDE.md: mostrar diff antes de aplicar.
- Investigar primero, reportar findings, esperar aprobacion antes de tocar codigo.
- Commit por tarea numerada, mensaje en castellano, push al final cuando lo pida yo.
- Claude Code NO corre `npm install`, `npm run seed`, ni `firebase deploy` por
  iniciativa propia. Esos comandos los corro yo manualmente.

## Proceso de prompts (modo B)
- Un prompt BASE por feature en docs/prompts/ (ej: F5.3_realtime_base.md), congelado al entregarse.
- Cambios posteriores → ADDENDUMS numerados (ej: F5.3_addendum_1.md) que indican qué sección del
  base modifican. NUNCA se reescribe un .md ya entregado a Code (evita confundirlo con versiones).
- Las idas y vueltas de diseño se resuelven en chat (claude.ai); el .md nace solo con lo acordado.
- Regla: cada cierre de feature actualiza docs/CLAUDE.md (estado + backlog) en el MISMO commit.

## Como correr el seed contra produccion

Solo despues de validar contra emulador. Pasos:

1. Verificar que `secrets/serviceAccountKey.json` existe y esta gitignored.
2. `npm run seed:prod -- --i-am-sure`
3. `npm run validate -- --target=production`
4. Confirmar que los 10 validators dan verde.

Si algun validator falla, diagnosticar antes de continuar.

## Modelo de datos

Colecciones:
- `/config/familia` (doc unico): miembros, categorias, bancos, tarjetas.
- `/subcategorias/{id}`: 92 docs.
- `/etiquetas/{id}`: 13 docs (las tecnicas se descartan).
- `/reglasNormalizacion/{id}`: 7 reglas.
- `/tcDiario/{YYYY-MM-DD}`: 147+ docs, escritura solo desde Function.
- `/autorizados/{email}`: un doc por email de miembro activo; sembrado; read-only vía Rules por token.email.lower().
- `/movimientos/{id}`: 1136 docs (snapshot 2026-06-12), source of truth de movimientos.
- `/resumenesTarjeta/{id}`: 18 docs iniciales, cabeceras de resumenes.
- `/itemsEsperados/{id}`: 24 docs (20 gastos + 4 ingresos), unificada con `tipo`. Campos: `periodicidad` (default `mensual`; bimestral/trimestral/anual/unico previstos, sin uso hoy), `pagoAutomatico` (default `false`).
- `/comprobantes/{hashPdf}`: un doc por comprobante subido (id = SHA-256 del archivo). Estados: `subido` → `extraido` → `vinculado` | `error`. Campos: `datosExtraidos` (tipoDocumento, fecha, montoTotal, moneda, comercioRazonSocial, cuit, numeroOperacion, periodoFacturado, numeroCliente, vencimientos[]), `propuestaMatch` (rama 0-3, movimientoId?, itemEsperadoId?, candidatos?), `refStoragePdf`, `contentType`, `tamano`, `subidoPor`, `subidoEn`, `actualizadoEn`. La function `extraerComprobante` (onDocumentCreated) llama a Claude claude-sonnet-4-6 (PDF o imagen). La function `matchComprobante` (onDocumentUpdated, guard anti-loop) calcula la propuesta vía matchLogica.ts.
- `/diccionario/{id}`: ~470 entradas de aprendizaje, dict global.

Ver `scripts/seed/transformers/*.ts` para schemas completos y logica de migracion.

## Backlog de inflación (fase propia, futura)

Inflación en esperados/proyecciones ARS (fase propia, futura): los `itemsEsperados` con `moneda: "ARS"` tienen `montoEsperado` estático. Para proyecciones reales habría que ajustar por inflación mensual (INDEC IPC). Opciones: campo `ajusteInflacion: boolean` + factor mensual en `/config/familia`, o bien dejar que el usuario actualice `montoEsperado` manualmente cada N meses. No se implementa hasta que el caso de uso sea claro.

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
  Paridad con el sistema viejo (12_ShareTemp.gs: carpeta Drive temporal + token + TTL). En Firebase
  colapsa: share-target llama directo a subirComprobante → Storage (F6.1) + dedup SHA-256 + trigger
  onCreate (F6.2). No se porta la carpeta Drive. Feature chica (la infra pesada ya existe).

## State machine de esperados (ResumenMes)

Derivada en vivo, NO materializada. Nueve estados (F5.5):

- `pagado`: mes cerrado con match(es), O mes en curso con al menos un match confirmado y monto >= 99%.
- `por_confirmar`: mes en curso/futuro con match(es) detectados pero ninguno con `confirmadoPago=true`.
- `parcial`: mes en curso/futuro con confirmados pero monto confirmado < 99% esperado.
- `automatico`: sin match, `pagoAutomatico=true`; cubierto sin conciliar.
- `pendiente`: mes en curso, sin match, diaVencimiento no alcanzado (o sin diaVencimiento).
- `vencido`: mes en curso, sin match, diaVencimiento < hoy.
- `programado`: mes futuro, sin match.
- `no_registrado`: mes cerrado, sin match.
- `no_aplica`: periodicidad no incluye este mes (placeholder; requiere mes-ancla cuando se active).

Cubierto = `pagado` || `automatico`. `por_confirmar` y `parcial` NO cuentan como cubiertos.

Confirmación (F5.5): el checklist NO crea movimientos. "Confirmar pago" opera solo sobre un movimiento
ya matcheado (estado `por_confirmar`): escribe `confirmadoPago=true` + `itemEsperadoId` vía
`writeBatch` (admin). "Deshacer" lo revierte (solo mes en curso). Meses cerrados con match = pagado
automáticamente sin acción (asunción: sin migración retroactiva).

`confirmadoPago: boolean` existe en `Movement` (default false al leer; los docs migrados no tienen el
campo → se normaliza a false). El alta global puede presetear `itemEsperadoId` al crear un movimiento
vinculado a un esperado puntual; ese movimiento entra por Rama 0 y se puede confirmar.

Pendiente: periodicidades no-mensuales necesitan mes-ancla cuando se activen. Hoy `aplicaEnMes`
devuelve `true` para todas como placeholder.

## Estructura del repo

- `docs/CLAUDE.md` — este archivo. Fuente de verdad.
- `docs/prompts/` — prompts iniciales de cada sesion con Claude Code.
- `docs/sesiones/` — resumenes de sesion al cerrar cada fase.
- `scripts/seed/` — script de migracion Sheets a Firestore.
- `data/` — snapshots .xlsx versionados.
- `secrets/` — service account JSON (gitignored).
- `src/` — frontend React + TypeScript (F3 completo).
- `public/` — manifest PWA, service worker, iconos.
- `firestore.rules` — Security Rules.
- `firestore.indexes.json` — indices compuestos.
- `firebase.json` — config de Hosting + Emulators + Headers.
