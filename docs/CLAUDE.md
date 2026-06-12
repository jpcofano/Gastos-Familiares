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
- Fase 5 — Flujos de escritura (Manual, Eventuales, Ingresos): F5.1 cerrado (Rules escritura, alta manual, validators).
- Fase 6 — Tarjetas + Comprobantes con Cloud Functions: pendiente.
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

## Reglas operativas

- Seed contra emulador por default. `--target=production` requiere `--i-am-sure`.
- Toda query filtra por `mes` o usa `limit()`. Nunca query sin filtro temporal.
- Dependientes siempre consultan movimientos con where('persona','==',memberId).
  Sin ese filtro, las Rules deniegan la query entera (fail-closed).
- Listeners `onSnapshot` solo donde el realtime aporta valor (carga sincronizada
  Juan-Maria). Dashboard y pantallas historicas: one-shot.
- Backup diario de Firestore a GCS configurado en F0.
- `serviceAccountKey.json` SIEMPRE gitignored. Si se filtra, Google revoca la key.

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
- F5.2: aviso de duplicados al cargar.
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

## Como correr el seed contra produccion

Solo despues de validar contra emulador. Pasos:

1. Verificar que `secrets/serviceAccountKey.json` existe y esta gitignored.
2. `npm run seed:prod -- --i-am-sure`
3. `npm run validate -- --target=production`
4. Confirmar que los 10 validators dan verde.

Si algun validator falla, no avanzar a F3. Diagnosticar primero.

## Modelo de datos

Colecciones:
- `/config/familia` (doc unico): miembros, categorias, bancos, tarjetas.
- `/subcategorias/{id}`: 92 docs.
- `/etiquetas/{id}`: 13 docs (las tecnicas se descartan).
- `/reglasNormalizacion/{id}`: 7 reglas.
- `/tcDiario/{YYYY-MM-DD}`: 147+ docs, escritura solo desde Function.
- `/autorizados/{uid}`: 1 doc por usuario logueado; contiene {memberId, rol} para las Security Rules.
- `/movimientos/{id}`: 1136 docs (snapshot 2026-06-12), source of truth de movimientos.
- `/resumenesTarjeta/{id}`: 14 docs iniciales, cabeceras de resumenes.
- `/itemsEsperados/{id}`: 24 docs (20 gastos + 4 ingresos), unificada con `tipo`.
- `/diccionario/{id}`: 412 entradas de aprendizaje, dict global.

Ver `scripts/seed/transformers/*.ts` para schemas completos y logica de migracion.

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
