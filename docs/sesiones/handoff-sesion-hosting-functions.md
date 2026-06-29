# Handoff — sesión de hosting + functions + íconos (cierre 29-jun-2026)

> Para abrir la sesión nueva. Estado tras desplegar infra a prod. Detalle de fases en
> `CLAUDE.md` (tabla F9.21→F9.51).

## Lo que se hizo HOY (esta sesión)

### Prompts escritos para Code (en `docs/prompts/`)
- **F9.47** ✓ corrido — preflight + guardrails + runbook. Code arregló `.firebaserc`,
  emulador, `audit_tipos.ts` y `src/firebase.ts` (projectId/storageBucket hardcodeados) →
  `gastos-familiares-e6415`; guardrail `--force-config` anti-clobber de `config/familia`;
  `scripts/seed/preflight.ts` + `npm run migrate:preflight`; `docs/RUNBOOK-migracion-prod.md`.
- **F9.48** ✓ corrido — auth real: `firebase.ts` projectId/storageBucket por env; estado
  `emailNoVerificado` (gate cliente chequea `email_verified`); check reconciliación
  `/autorizados`↔`config.miembros` (validate 21→22); pasos 9-11 del runbook (env+build+deploy
  hosting + checklist auth).
- **F9.49** ✓ corrido — PWA instalable: `manifest.webmanifest` con íconos PNG + `share_target`;
  4 tags iOS en `index.html`. (Code dejó un `scripts/gen-pwa-icons.mjs` que necesita `sharp`;
  NO hace falta — los PNG ya están generados, ver abajo.)
- **F9.50** ✓ corrido + **DEPLOYADO** — memoria de las 2 funciones de aprendizaje 128→256 MiB.
  Las 20 functions quedaron ACTIVE en prod.

### Infra desplegada a PROD hoy (gastos-familiares-e6415)
- **Functions: las 20 ACTIVE** (callables admin + cron MEP `actualizarTCDiario` + extraer/
  match/routear + las 2 `aprender*` + Calendar). Secrets cargados (ANTHROPIC + 3 OAuth).
- **Hosting**: sitio nuevo **`gastos-familiares-jmsf.web.app`** creado y deployado. El viejo
  `gastos-familiares-e6415.web.app` también sirve. `firebase.json` tiene
  `"site": "gastos-familiares-jmsf"`.
- **Web App** creada (no existía): App ID `1:811162500609:web:43251eacb48ce3d39e4a00`.
  `.env.production` armado con la config real (storageBucket = `.firebasestorage.app`, formato
  nuevo, NO `.appspot.com`).

### Diseño hecho en el kit (este proyecto de diseño)
- **ShareLanding** (`ui_kits/mobile/ShareLanding.jsx`): pantalla in-app de recepción al
  compartir. Detecta tipo (factura/comprobante vs resumen de tarjeta) y se bifurca; monto en
  vivo (count-up); badge de destino (Gasto esperado·match | Movimiento nuevo); rama tarjeta
  con split este-mes/deuda-futura. Cableado en el kit: Tweaks → "Flujos · compartir a la app"
  (2 botones). Hero ahora acepta slot `badge` y `ComprobanteConfirm` lo muestra.
- **Ícono de la app — elegido**: "$" + barras ascendentes, sin solape (azul ink #1e3a5f +
  esmeralda). PNG finales en `exports/pwa-icons/`: `icon-192.png`, `icon-512.png`,
  `icon-maskable-512.png` (safe-zone 80%), `apple-touch-icon.png` (180).
- **OG / preview de WhatsApp**: `exports/share/og-image.png` (1200×630) con el ícono + título.
  Mock comparativo en `exports/whatsapp-preview.html`.

## Pendiente del usuario (ejecución en vivo)
1. **Subir los íconos PWA al repo**: copiar `exports/pwa-icons/*.png` → `public/icons/` y
   `exports/share/og-image.png` → `public/`. Después `npm run build && firebase deploy --only
   hosting`. (Sin esto la PWA no tiene íconos reales / el share no muestra imagen.)
2. **Autorizar dominio para login**: Consola → Authentication → Settings → Authorized domains
   → agregar `gastos-familiares-jmsf.web.app` (sino el Google sign-in falla en esa URL).
3. **Probar la app en `gastos-familiares-jmsf.web.app`**: que cargue + login Google de los 4
   miembros. Hoy entra a una **base vacía** (el import a prod NO se hizo todavía).
4. **El gate de Etapa B sigue pendiente** (ver abajo).

## Etapa B — el IMPORT a prod (lo que falta, núcleo de la sesión nueva)
Infra (functions + rules + índices + hosting) ya está. Falta meter los DATOS:
1. **Service account** de `-e6415` → `./secrets/serviceAccountKey.json` (en `.gitignore`).
2. **Índices primero**: `firebase deploy --only firestore:indexes` (tardan; esperar build) →
   luego `firestore:rules`.
3. **Preflight**: `npm run migrate:preflight -- --target=production` → debe decir LISTO y
   matchear **1143 movimientos / 18 resúmenes / 177 tcDiario**.
4. **Import**: `npm run seed -- --target=production --i-am-sure`.
5. **Backfill** persona→memberId si dry-run > 0 (en emulador dio 0).
6. **Cuadre**: `npm run validate -- --target=production` → 22/22 (el FAIL de cuadre
   devengado/caja es falso positivo conocido).
7. **Sign-off F9.31/F9.32**.
Comandos exactos en `docs/RUNBOOK-migracion-prod.md` (lo creó F9.47, en el repo).

## Pendiente de DISEÑO (prompts ya escritos — listos para correr en Code)
- **F9.51** ✓ prompt escrito (`docs/prompts/F9.51-montar-sharelanding-app-real.md`): montar
  `ShareLanding` sobre `/comprobantes?share=1` mientras `leerYBorrarArchivoCompartido()`
  resuelve; **fases atadas a la async real** (no timers), encadena al confirm existente, badge
  y split con datos reales. Kit `ShareLanding.jsx` = referencia visual. Pide a Code documentar
  en `docs/CLAUDE.md` + RUNBOOK del repo.
- **F9.52** ✓ prompt escrito (`docs/prompts/F9.52-open-graph-whatsapp.md`): Open Graph en
  `index.html` (tags og:*/twitter:* absolutos a `gastos-familiares-jmsf.web.app`) + subir
  `exports/share/og-image.png` → `public/og-image.png`.
- Backlog: config de gráficos (paletas + tipo), dirección A hero-ink en Cargar/Tarjetas, push
  (Canal C, depende de PWA).

## Datos clave para la sesión nueva
- Proyecto: **gastos-familiares-e6415** · sender **811162500609**.
- Web App ID: `1:811162500609:web:43251eacb48ce3d39e4a00`.
- Hosting lindo: **https://gastos-familiares-jmsf.web.app**.
- storageBucket real: `gastos-familiares-e6415.firebasestorage.app` (formato nuevo).
- Functions: las 20 ACTIVE en `southamerica-east1`; triggers Firestore en Eventarc `nam5`.
