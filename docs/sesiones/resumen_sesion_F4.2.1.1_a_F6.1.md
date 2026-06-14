# Gastos Familiares — Resumen de sesión (cierre F6.1)

## Dónde estamos
Migración a Firebase. **F6.1 cerrado** (Storage + dedup de comprobantes). Backend recién inaugurado.
Todo verde en emulador. **Push hecho y verificado** — GitHub al día, HEAD `2a6baaf`.

## Estado del repo (verificado clonando fresco)
`github.com/jpcofano/Gastos-Familiares`, branch `main`, cadena de commits:
- `2a6baaf` F6.1 — Storage + dedup comprobantes por SHA-256
- `2eebab3` F5.5 — confirmación de pago en checklist
- `a2e500a` F5.4 — ABM de itemsEsperados (admin)
- `0baf25d` F5.2 — state machine 8 estados + registrar (revertido por F5.5) + fix P2 hooks
- `ca62a3c` F4.2.1.1 — fix colisión id + matchTexto incluye/excluye
- `f6b49a3` F5.1.0 — hotfix P0 autorizados por email
Todo contra emulador, nada en producción.

## Lo que se hizo esta sesión (en orden)

### P0 de seguridad — CERRADO (`f6b49a3`)
Escalación de privilegios: el cliente escribía su propio rol en `/autorizados/{uid}` y las Rules
confiaban en ese doc → cualquier cuenta de Google podía auto-promoverse a admin por SDK directo.
Fix aplicado y verificado en remoto: seed transformer `autorizados.ts` (doc-id = email lowercase,
derivado de config), `authDoc()` resuelve por `request.auth.token.email.lower()`,
`/autorizados` con `write: if false`, `setDoc` eliminado del cliente, validator de integridad.
**Era el bloqueante duro de producción. Ya no lo es.**

### F4.2.1.1 — dos bugs de match de esperados
- **Colisión de id**: el id de itemsEsperados no incluía `tarjetaCodigo` → las 8 filas de pago de
  tarjeta (4 tarjetas × 2 monedas) colapsaban a 2. Fix: agregar `tarjetaCodigo` + `matchTexto.incluye`
  al hash. Check nuevo en validator: `count(itemsEsperados) == filas activas Excel`.
- **Match por subcat exacta**: el matcher exigía categoría+subcategoría iguales, pero los movimientos
  tienen subcats inconsistentes (AySA vs Agua, "Internet y telefonía" vs Internet, etc.). Fix:
  `matchTexto` pasa a objeto `{ incluye:[], excluye:[] }`; cuando está presente, relaja cat/subcat y
  matchea por texto de descripción (duros solo tipo+moneda). Resolvió AySA depto/cochera, Internet, Colegio Fede.

### F5.4 — página de configuración de esperados (ABM)
`/config-esperados`, admin-only. CRUD de itemsEsperados (gastos + ingresos, misma colección por `tipo`).
- **id automático** para ítems nuevos (no más hash → colisiones imposibles; matcher es id-agnóstico).
- Editor de chips para `matchTexto.incluye/excluye` → el discriminador AySA/ABL sale del código y vive en el dato.
- Rules: `itemsEsperados` pasa a `read: esMiembro()` + `write: esAdmin()` (arregla de paso el checklist vacío de dependientes).
- Soft-delete por `activo:false`. Decisión: el Excel sigue siendo seed de DEV; la página es el editor de PROD; no se mata el seed ahora.

### F5.5 — pagado por confirmación (revisa la acción de F5.2)
**El match ya NO significa pagado automáticamente.** Estados de un esperado vs sus movimientos:
pendiente (sin match) → **por confirmar** (apareció match, sin confirmar) → **pagado** (botón).
- Botón "Confirmar pago" solo en `por_confirmar`: pone `confirmadoPago:true` + estampa `itemEsperadoId`
  en el movimiento existente. **No crea movimientos.** "Deshacer" disponible.
- **Asunción tomada**: meses cerrados/pasados con match = pagado directo (no se confirma la historia a mano).
- `confirmadoPago: boolean` nuevo en `Movement`. Rules: `movimientos` habilita `update` para admin
  (campos `creadoPor`/`creadoEn` inmutables); `delete` sigue cerrado.
- 9 estados en `EstadoItem`. Automáticos (`pagoAutomatico`) siguen cubiertos sin botón.

### F6.1 — infraestructura de comprobantes (primer backend)
Storage + emulador (:9199), `storage.rules` (auth-gated + límite 10MB + tipo pdf/imagen),
`getStorage` en cliente, util `hashArchivo.ts` (WebCrypto en browser, NO la de Node del seed),
tipo `Comprobante`, `comprobantes.ts` con `subirComprobante`, vista `/comprobantes` (cualquier miembro).
- **doc-id = hash del archivo** → dedup automático e idempotente (re-subir el mismo lo frena).
- Nombres alineados con el modelo: `hashPdf` / `refStoragePdf` (no `hash`/`rutaStorage`), `subidoPor` = memberId,
  enum `'subido' | 'extraido' | 'vinculado'` completo desde ya.
- **Limitación consciente**: Storage Rules no pueden hacer `get()` a Firestore, así que usan
  `request.auth != null` (más laxo que Firestore); el control fino cae en las Rules de Firestore.
  Si algún día importa, se cierra con custom claim.

## F6 — diseño aprobado del pipeline de comprobantes
El comprobante es la evidencia; el match es el vínculo; confirmar el match = marcar pagado (misma cabeza que F5.5).
Dos dedups distintos: por archivo (SHA-256, F6.1) y por pago (match contra movimientos). Tres ramas:
1. **Movimiento ya existe** → adjuntar comprobante + confirmar pago. NO crea.
2. **Solo esperado matchea** → **crear movimiento con tu confirmación** (pre-linkeado: `itemEsperadoId` + `confirmadoPago`). Decisión tomada.
3. **Nada matchea** → alta precargada para revisar.
La extracción nunca se auto-confirma: propone → confirmás.

## En cola
1. **F6.2** (próximo) — Function (primer backend de cómputo) + prompt de extracción endurecido
   (clasifica tipoDocumento PRIMERO, CUIT-vs-número, pseudo-número `^\d{4}-\d{2}-` para recurrentes sin
   nro de operación) + API key de Anthropic en Secret Manager. Llena el comprobante (`estado:'extraido'`).
   Arrancar por la infra de Functions, después el prompt.
2. **F6.3** — match contra movimientos/esperados → las 3 ramas del pipeline.
3. **F5.3** — realtime (onSnapshot, optimistic, offline). Quedó postergado detrás de la config.
4. **Pre-F7** — script `npm run dups` + limpieza + snapshot final.
5. **Producción** — con P0 cerrado, el camino es: congelar esquema → una migración limpia a prod → la página es el editor (nunca más `rmdir` en prod).

## Principios / decisiones vigentes
- Estado de esperados derivado en vivo (ResumenMes no se materializa), EXCEPTO `confirmadoPago` (F5.5).
- Rescate del sistema viejo: bancos canónicos, normalización on-write, dedup SHA-256, prompt de comprobantes.
- Excel = seed de DEV + migración; la app es el editor de PROD; el Excel "desaparece" recién en el cutover.
- Recomendación operativa: usar `firebase emulators:start --import=./emulator-data --export-on-exit`
  para persistir estado entre sesiones y reservar el `rmdir` para resets intencionales.
- Validación: cualquier cambio de tipo/seed dispara ciclo limpio (`rmdir → seed → validate`). Verde actual.
- Push: uno por feature cerrada (esta sesión casi se pierden 6 features por no pushear).

## Para arrancar la próxima
"Continuamos Gastos-Familiares. F6.1 cerrado y pusheado (HEAD 2a6baaf), P0 cerrado. Sigo con F6.2
(Function + extracción de comprobantes). Leé del repo si necesitás código."
