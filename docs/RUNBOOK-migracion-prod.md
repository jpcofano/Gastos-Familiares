# Runbook — Migración a producción (Etapa B)

> Estos pasos los corre el **usuario**, no Code. Code (F9.47) deja el repo seguro para esto:
> project id correcto, guardrail anti-clobber de `config/familia`, y el script de preflight.
> Nada de esto importa datos a prod por sí solo — el import real es el paso 6.

Proyecto real de Firebase: **`gastos-familiares-e6415`** (ya configurado en `.firebaserc`
y en el emulador — antes apuntaban al id viejo `gastos-familiares`, que no existe).

## 0. Preflight local (emulador)

```bash
npm run seed
npm run validate
```
Debe dar **21/21** en el validador. Si algo falla, resolverlo antes de seguir — no avanzar
con el emulador roto.

## 1. Service account

Bajar de la consola de Firebase (proyecto `gastos-familiares-e6415`):
`⚙ Configuración del proyecto → Cuentas de servicio → Generar nueva clave privada`.

Guardarlo en `./secrets/serviceAccountKey.json`. **Nunca a git** — ya está en `.gitignore`
(`secrets/*.json`, `secrets/serviceAccountKey*.json`, `**/serviceAccountKey*.json`).

## 2. Deploy de índices PRIMERO

```bash
firebase deploy --only firestore:indexes
```
Los índices compuestos tardan minutos en construir. **No seguir** al paso 5 (preflight prod)
hasta que la consola de Firebase (Firestore → Índices) muestre todos en estado **Habilitado**
(no "Compilando").

## 3. Deploy de Rules

```bash
firebase deploy --only firestore:rules
```

## 4. Deploy de Functions

```bash
cd functions && npm install && cd ..
firebase deploy --only functions
```
Incluye el cron de TC (F9.30), todas las callables admin (F9.36–41, F9.46) y el Canal B de
Calendar (F9.45/F9.46) — para Calendar, los 3 secrets (`GOOGLE_OAUTH_CLIENT_ID/SECRET/
REFRESH_TOKEN`) deben estar cargados en Secret Manager antes de este deploy.

## 5. Preflight de producción

```bash
npm run migrate:preflight -- --target=production
```
Debe imprimir **LISTO PARA IMPORT LIMPIO** (todas las colecciones en 0) antes de seguir. Si
dice que prod **no está vacío**, parar y revisar por qué — no continuar a ciegas.

## 6. Import a producción

```bash
npm run seed -- --target=production --i-am-sure
```
Idempotente (doc id determinístico, `set()` por id) — re-correrlo no duplica. **Excepción:**
`config/familia` queda protegida una vez que existe en prod (no se pisa salvo
`--force-config` explícito — ver nota al final).

## 7. Backfill de persona

```bash
tsx scripts/seed/backfillPersonaMemberId.ts --target=production
```
Dry-run primero. Si reporta candidatos > 0:
```bash
tsx scripts/seed/backfillPersonaMemberId.ts --target=production --apply --i-am-sure
```

## 8. Cuadre post-import

```bash
npm run validate -- --target=production
```
Debe dar **22/22** contra prod (incluye el check de reconciliación `autorizados ↔
config/familia.miembros` de F9.48 — detecta drift si el CRUD de Miembros editó algo después
del import sin que `/autorizados` haya quedado en el mismo estado).

## 9. Build de prod + variables de entorno (F9.48)

Antes de desplegar Hosting, crear `.env.production` (NO se sube a git) con los valores de
**Firebase Console → Configuración del proyecto → Tus apps → Web app**, proyecto
`gastos-familiares-e6415`:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=gastos-familiares-e6415.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=gastos-familiares-e6415
VITE_FIREBASE_STORAGE_BUCKET=gastos-familiares-e6415.appspot.com
VITE_FIREBASE_APP_ID=...
VITE_FIREBASE_MESSAGING_SENDER_ID=...
```
`src/firebase.ts` ya tiene `gastos-familiares-e6415` como fallback si falta alguna var, pero
no reemplaza tener las reales de la consola (API key real, etc.).

```bash
npm run build
firebase deploy --only hosting
```

## 10. Auth real en dispositivo (F9.48) — checklist

Con la app de prod abierta (no el emulador), verificar:
- Los **4 miembros** loguean con Google y ven su rol correcto: **admin** (Juan, María) ve
  Resumen + Tarjetas + el CRUD de Perfil; **dependiente** (Federico, Sofía) NO ve Resumen ni
  las sub-pantallas de configuración.
- Los **2 emails de María** (personal + Accenture) resuelven ambos a María, sin warning de
  "matchea más de un miembro".
- Un email **fuera de la familia** cae en "no pertenece a la familia" (botón Salir), sin leer
  ningún dato.
- Una cuenta con **email sin verificar** (si hay alguna para probar) cae en el mensaje de
  "Verificá tu email", no en pantalla en blanco ni permission-denied silencioso.

## 11. Sign-off

- Confirmar F9.31/F9.32 (cuadre de resúmenes de tarjeta y contrato de scopes devengado/caja)
  contra los datos reales de prod.
- Abrir la app apuntando a prod (no al emulador) y verificar que lee sin errores de permisos
  ni de índices faltantes (Dashboard, Resumen, Cargar, Perfil).
- Checklist de auth real (paso 10) completo.

### F9.53 — Verificación editar/eliminar (admin)

- Perfil → Configuración familiar → "Buscar / editar movimiento" visible solo para admin.
- BuscarMovimiento carga el mes actual, filtros de texto y persona funcionan.
- Tap en una fila → EditarMovimiento con datos prellenados.
- Guardar un cambio pequeño (descripción) → se cierra y el movimiento se actualizó (onSnapshot live).
- Eliminar un movimiento manual (no de resumen de tarjeta) → se borra, la lista se actualiza.
- Intentar eliminar un movimiento con `resumenTarjetaId` → la callable devuelve error y el modal muestra el mensaje.
- Resumen → "Por día" → tap en una card de día → se expande mostrando filas individuales de gastos.
- Tap en una fila de gasto (admin) → abre EditarMovimiento.
- Dashboard → "Mov. más alto" → tappable para admin, abre EditarMovimiento con el movimiento correcto.

## 12. PWA (Etapa C, F9.49) — instalación + share-target

Previo a este paso, una vez, local: `npm install -D sharp && node scripts/gen-pwa-icons.mjs`
(genera `public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` y
`apple-touch-icon.png` desde los SVG fuente — no hay rasterizador de imágenes en el entorno
de Code, por eso es un paso manual de una sola vez).

Con la app de prod (no el emulador) y los PNG generados:
- **Android/Chrome**: Lighthouse → PWA → "Installable" en verde. Instalar la app; una vez
  instalada, compartir un PDF desde otra app (ej. Drive/Gmail) debe ofrecer "Gastos" en el
  share sheet — al compartir, abre la app en `/comprobantes?share=1` con el archivo
  precargado (vía `sw.js` + IndexedDB, ya codeados).
- **ShareLanding (F9.51)**: al compartir, el landing in-app (pantalla ink full-screen) debe
  cubrir el arranque y avanzar con datos reales — recibido → leyendo → tipo clasificado
  (badge "Comprobante"/"Resumen de tarjeta") → extrayendo → listo. Compartir una **factura**:
  termina mostrando monto/comercio/vence + badge de match (esperado/nuevo) y encadena solo al
  confirm (`AltaMovimiento` ya abierto). Compartir un **resumen de tarjeta**: termina con
  total/consumos/cuotas + split este-mes/deuda-futura y encadena al preview de
  `SeccionTarjetas` ya abierto. Cancelar (✕) debe dejar Comprobantes utilizable y limpiar
  `?share=1` de la URL. Forzar un error de extracción (ej. PDF corrupto) debe caer a un
  estado de error con botón "Cargar manual", sin spinner colgado.
- **iOS/Safari**: "Compartir → Agregar a inicio" usa el ícono nuevo (no el genérico) y abre en
  modo standalone. iOS no soporta Web Share Target (limitación de la plataforma) — el picker
  in-app de Comprobantes sigue siendo el camino ahí, es el fallback esperado, no un bug.
- **Open Graph (F9.52)**: tras el deploy, abrir
  `https://gastos-familiares-jmsf.web.app/og-image.png` directo en el navegador (confirma que
  Hosting la sirve). Pegar el link de la app en WhatsApp (o un debugger de OG) debe mostrar
  tarjeta con imagen + "Gastos Familiares" + "Control de gastos de la familia", no el link
  pelado. WhatsApp cachea el preview por URL — si se probó antes de que la imagen estuviera
  publicada, forzar recache agregando `?v=2` una vez al link compartido.

## Notas

- **`--force-config`** solo se usa si se quiere repisar `config/familia` en prod a propósito
  (ej. volver a un estado conocido del Excel después de ediciones manuales que se quieren
  descartar). Sin el flag, un re-import deja `config/familia` intacto si ya existe.
- Las Rules ya cubren las queries reales (`firestore.indexes.json` tiene los índices
  compuestos que necesitan); por eso el orden del runbook pone índices **antes** de que la
  app lea — sin eso, las primeras queries reales fallarían con "index not found".
- El seed es de Admin SDK (saltea Rules) — el preflight (paso 5) y el validate (paso 8) usan
  la misma vía, también Admin SDK, solo lectura.
- Etapa B cierra con el sign-off del paso 11. Después, Etapa C = PWA (manifest, SW, share
  target, install). Ver `docs/plan-maestro-firestore-pwa.md`.
