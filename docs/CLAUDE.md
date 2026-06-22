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
- Fase 6 — Tarjetas + Comprobantes con Cloud Functions: F6.2 (infra Functions + extracción Anthropic) cerrado. F6.3 (match server-side propone→confirmás, 3 ramas + dedup) cerrado. F6.4 (carga manual sin comprobante, dedup advisory no-bloqueante, origen Manual) cerrado. F6.4.5 (clasificador completo: lookup DiccionarioContext consciente de banco/tarjeta + trigger aprendizaje server-side + normalización on-write vía `reglasNormalizacion`; `descripcionLimpia` como descripción visible al crear movimiento desde comprobante; `descripcionOriginal` preserva texto crudo para trazabilidad; CONFIANZA_UMBRAL=0.7 para prellenar sugerencias — corrección del usuario sube confianza +0.1; persona=quien-sube como fuente primaria en comprobante ramas 2/3; alias de miembros en `config/familia` + `resolverNombreMiembro()` listo para F6.5; corrige Rules `reglasNormalizacion` esAdmin→esMiembro y bug `onAccion()` indefinido en rama 3. Addendum 5: fix preload congelado en PropuestaCard — categoria/subcategoria/etiqueta/banco prellenan en alta desde comprobante; `etiqueta` fluye por toda la cadena EntradaDict→ClasificacionResult→DiccionarioContext→preloadBase; `subcatInitCatRef` reemplaza flag booleano para sobrevivir React Strict Mode double-fire; guard `cargandoDict` en botones de apertura; `incluirResumenMes` default true solo si fecha > hoy; banco default `Efectivo` para comprobantes, rama 2 (esperado) no lo hereda) cerrado. F6.5 (pipeline resumen de tarjeta: upload PDF sin selector de tarjeta → `resumenesTarjeta/{hashPdf}` estado:subido → `extraerResumenTarjeta` onDocumentCreated (max_tokens 32000, streaming, prompt portado de 47_Tarjetas_PDF.gs con persona por bloque PDF: BBVA secciones/Galicia Visa subtotales/Galicia Master adicionales) → extrae `numeroCuenta` del encabezado, resuelve `tarjetaCodigo` por numeroCuenta→banco+tipo→requiere_tarjeta → estado:parseado + `movimientosParseados[]` inline → preview editable por fila (persona select, cat/subcat con clasificar() memoizado) → confirmar lote → N movimientos consumo (excluirDash:false, incluirResumenMes:false) + 2 totales ARS/USD (excluirDash:true, incluirResumenMes:true, confirmadoPago por fecha vencimiento, vinculados a itemsEsperados de la tarjeta) → estado:confirmado. Memoización de clasificar(): Map<texto\x00banco\x00tarjeta, result> en DiccionarioContext, se invalida cuando el dict recarga. Movimientos creados por batch atómico. `MovimientoParseado` nuevo tipo en types/index.ts con campos editables personaConfirmada/categoria/subcategoria/incluir. persona del consumo = bloque del PDF → resolverNombreMiembro() → memberId; impuestos/percepciones sin persona. Tres tipos de línea: consumo/cuota/reverso/bonificacion (persona=sí, tipo Gasto/Ingreso) · impuesto/reintegro_percepcion (persona="", categoría forzada "Impuestos y finanzas", tipo Gasto/Ingreso) · 2 totales (excluirDash:true, incluirResumenMes:true). tipoDeLinea(): reverso/bonificacion/reintegro_percepcion → Ingreso; consumo/cuota/impuesto → Gasto. Cuadre: sum(Gastos moneda) − sum(Ingresos moneda) + sum(ajustesConsolidado.monto) ≈ totalARS/USD del PDF (±$1). Los ajustes del consolidado (DEV PER período anterior, entre "SU PAGO" y "SALDO PENDIENTE") NO son movimientos pero SÍ entran en el cuadre porque el total PDF ya viene neto de ellos. Se capturan en `ajustesConsolidado[]` ({concepto, montoARS, montoUSD, origen:'pdf'|'manual'}) para trazabilidad y se muestran en el banner. Si falla → banner warning + botón Confirmar deshabilitado + botón "Cerrar diferencia manualmente" (appenda residuo como ajuste origen:'manual') + guard en confirmarResumenTarjeta. Percepciones USD = camino único: tipoLinea="impuesto", sin flag recuperable; DEV PER CONSOLIDADO (ajuste período anterior, negativo) excluido por el prompt. Estado `CardStatement`: `'subido' | 'parseado' | 'confirmado' | 'error' | 'requiere_tarjeta'` (máquina propia). Si estado=requiere_tarjeta: UI muestra asignador inline; `asignarTarjetaResumen` parchea metadata y pasa directo a parseado (sin re-extracción; trigger es onDocumentCreated, no re-dispara en update). Seed escribe `estado` explícito; `docACardStatement` default `'subido'` (fix confirmado fantasma). Vista /tarjetas admin-only con lista + preview table + banner cuadre. Ruta separada de comprobantes — no toca extraerComprobante.) cerrado. F6.6 (PWA share-target Android: manifest + SW handler IDB + auto-subida en entrantes; iOS fallback via input file existente) pendiente prueba en dispositivo real. F6.7 base (router entrantes: detección PDF/imagen, bandeja ambiguo/ruteado, reglas) cerrado. F6.7 addendum 1 (vista única de ingesta): solapa "Carga" unifica /comprobantes y /tarjetas; /tarjetas redirige; admin ve subida + bandeja + historial comprobantes + SeccionTarjetas; dependiente ve subida + bandeja + solo su historial. F6.7 addendum 2 (match robusto + fix detector): resolución tarjetaCodigo en 4 capas (numeroCuenta → ultimos4 → banco+tipo → banco+tipo+titular desempate); ultimos4 como string[] en config (todas las tarjetas físicas por cuenta, cargadas desde los resúmenes); detector exige ≥1 marcador decisivo (PAGO MINIMO / LIMITE DE CREDITO / PAN enmascarado) además de genéricos — boleta de patente ya no va a resúmenes.
- F6.8 (match por destino + dedup informativo): extracción suma destinoCbu/destinoAlias/destinoNombre para todo comprobante; nueva colección destinos/{idNorm}; matchComprobante corre rama destino (CBU→alias→nombre, confianza ≥ 0.7) antes del match por texto — si el esperado ya está pagado ese período propone movimiento adicional con categoría/etiqueta prellenadas; rama 0 enriquecida con dedupInfo {movId, mes, monto, item} para UI informativa; aprenderDestino() hace upsert en destinos al confirmar movimiento con campo destino*. F6.8 addendum 1 (cierre del ciclo): confirmarRama1 y preloadBase de ramas 2/3 propagan destinoCbu/Alias/Nombre del comprobante al movimiento — aprenderDestino() recibe el destino y puebla /destinos; NuevoMovimiento + Movement + Preload tipados con los tres campos. F6.8 addendum 2 (destinoCuit + De/Para): destinoCuit (CUIT/CUIL del receptor, 11 dígitos) agregado como campo de extracción con regla explícita Para/Destinatario NUNCA De/Origen; normalizarDestino() soporta CUIT (11 dígitos entre CBU 22 y alias); Destino.tipo suma "cuit"; matchPorDestino y aprenderDestino buscan/aprenden por CBU → CUIT → alias → nombre en ese orden; vencimientos[] propagados al movimiento para conservar 2do vencimiento; todos los tipos actualizados (Movement, DatosExtraidos, NuevoMovimiento, Preload). F6.x expensas_extraer_unidad_titular: prompt suma regla EXPENSAS/CONSORCIO — montoTotal = monto de la UF 043 (COFANO, Del Signo 4042), no el total del edificio; si UF 043 no figura → null; FamiliaConfig.unidades[] (uf, alias, etiqueta) para registro; seed escribe unidades:[{uf:"043", alias:"Del Signo 4042 043", etiqueta:"Expensas"}]. F6.9 (reconciliación pago↔obligación por payee): `reconciliarPorPayee()` en `matchLogica.ts` busca movs `tipo:Gasto / misma moneda / confirmadoPago:false` que compartan payee con el comprobante (CUIT→CBU→alias, normalizados a solo-dígitos/lowercase) y monto exacto (<0.01). Corre server-side en `matchComprobante` antes de `matchPorDestino`, solo para `tipoDocumento=transferencia|comprobante_pago` (gate `esPago` evita que una factura salve una obligación). 0 candidatos → cae a clasificación normal; 1 → rama 1 directa (`origenReconciliacion:true`); N → rama 1 `candidatos` para que el usuario elija. Separación de responsabilidades: reconciliar (por payee, no usa /destinos) va primero; clasificar (matchPorDestino + aprendizaje) queda intacto para pagos sin obligación previa. El cliente ya rutea rama 1 a `confirmarRama1` sin cambios. F6.9.1 (anti-autovínculo por monto): `calcularPropuesta` se llama con `movs=[]` — el match por monto+mes (`matchConMovimientos`) queda fuera del flujo de comprobantes. Solo auto-confirman rama 0 (dedup por hash) y F6.9 (reconciliación por payee); todo lo demás propone y abre AltaMovimiento para que el usuario valide. `matchPorDestino` y el bloque F6.9 siguen recibiendo `movs` reales sin cambio. F6.9.2 (obligación abierta): la factura (y todo comprobante no-pago) nace `confirmadoPago:false` en el preload del alta — solo `transferencia`/`comprobante_pago` se confirman por `confirmadoPagoPorFecha`; antes nacían confirmadas por fecha de emisión y F6.9 nunca las encontraba (solo busca obligaciones abiertas). F6.9.3 (destinoCuit del emisor en facturas): el prompt del extractor distinguía `destinoCuit` solo como la parte "Para"/"Destinatario", lo que dejaba `destinoCuit:null` en facturas (no hay "Para", el emisor es "De"). Ahora, para factura/comprobante de comercio, el payee del pago futuro es el emisor → `destinoCuit`/`destinoNombre` se pueblan con el mismo CUIT/razón social del emisor. Cierra el ciclo: la obligación abierta (F6.9.2) ya tiene payee (F6.9.3) para que F6.9 la encuentre cuando llega el pago. **Principio:** en el flujo de comprobantes, lo único que confirma un movimiento sin intervención del usuario es el dedup por hash (rama 0) y la reconciliación por payee (F6.9); cualquier otro match propone y abre la UI. `confirmadoPago` significa "saldado por un pago", no "la fecha ya pasó" — por eso una factura nace abierta.
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
- Las pantallas de configuración viven bajo "Tu Perfil" (avatar del header → /perfil),
  no en el nav superior. El nav pierde "Esperados". Espejo del patrón de Comidas-Familiares
  (Header.tsx → /perfil, pila de cards, gate canEdit = esAdmin || esUnoMismo).
- "Tu Perfil" tiene dos niveles: Personal (todos, scope self) y Configuración Familiar
  (solo admin, scope familia).
- El tier Configuración Familiar escribe config bloqueada en Rules (config/familia,
  /autorizados, /subcategorias, /etiquetas, /reglasNormalizacion, /tcDiario, /destinos —
  todas write:false o sin regla de cliente) vía callables admin-only con Admin SDK.
  NUNCA por write directo del cliente. Excepciones que el admin ya escribe desde el cliente:
  itemsEsperados y diccionario.
- Agregar miembro o mail escribe miembros[].emails Y /autorizados/{email} en la MISMA
  callable (transacción server-side). Desincronizarlos rompe el login (la whitelist lee de
  ambos) y reabre el P0 de escalada de privilegios. Por eso /autorizados nunca es escribible
  desde el cliente.

## Reglas operativas

- Seed contra emulador por default. `--target=production` requiere `--i-am-sure`.
- Toda query filtra por `mes` o usa `limit()`. Nunca query sin filtro temporal.
- Dependientes siempre consultan movimientos con where('persona','==',memberId).
  Sin ese filtro, las Rules deniegan la query entera (fail-closed).
- Listeners `onSnapshot` en `movimientos`, `comprobantes` e `itemsEsperados` (F5.3).
  `itemsEsperados` se suscribe una vez en `ItemsEsperadosContext` (AppShell), compartido por Resumen, Comprobantes y ConfigEsperados. `movimientos` suscribe por vista (`useMovimientosDelMes`). Colecciones quasi-estáticas (subcategorias, etiquetas, config/familia): one-shot. `diccionario` + `reglasNormalizacion`: one-shot conjunto en `DiccionarioContext` (Promise.all al montar AppShell), ~479 entradas de seed + entradas creadas por el trigger de aprendizaje (crece con el uso) + 7 reglas en memoria para el clasificador (normalización on-write).
- Backup diario de Firestore a GCS configurado en F0.
- `serviceAccountKey.json` SIEMPRE gitignored. Si se filtra, Google revoca la key.
- El normalizador de descripciones (`normalizar()` + reglas de `reglasNormalizacion`) existe en TRES copias idénticas: `scripts/seed/utils/normalize.ts` (canónico, usado por el seed), `src/datos/normalizador.ts` (cliente) y `functions/src/normalizador.ts` (trigger de aprendizaje). Paquetes independientes, no se importan cruzados — sync manual si cambia el algoritmo.
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
4. Confirmar que los 12 validators dan verde.

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
- `/resumenesTarjeta/{id}`: 18 docs seed + docs nuevos por upload. Estados: `subido` → `parseado` → `confirmado` | `error` | `requiere_tarjeta`. Campos nuevos (F6.5): `estado`, `nroResumen`, `titular`, `subidoPor`, `subidoEn`, `errorExtraccion`, `movimientosParseados[]` (inline array, ~60 líneas por resumen), `ajustesConsolidado[]`, `numeroCuenta`, `tarjetaCodigo: string | null`. La function `extraerResumenTarjeta` (onDocumentCreated) llama a Claude con el prompt portado de 47_Tarjetas_PDF.gs (persona por bloque, max_tokens 32000, streaming); extrae `numeroCuenta` y resuelve `tarjetaCodigo` desde `config/familia.tarjetas`. Seed escribe `estado` explícito; `docACardStatement` default `'subido'` (no 'confirmado').
- `/itemsEsperados/{id}`: 24 docs (20 gastos + 4 ingresos), unificada con `tipo`. Campos: `periodicidad` (default `mensual`; bimestral/trimestral/anual/unico previstos, sin uso hoy), `pagoAutomatico` (default `false`).
- `/comprobantes/{hashPdf}`: un doc por comprobante subido (id = SHA-256 del archivo). Estados: `subido` → `extraido` → `vinculado` | `error`. Campos: `datosExtraidos` (tipoDocumento, fecha, montoTotal, moneda, comercioRazonSocial, cuit, numeroOperacion, periodoFacturado, numeroCliente, vencimientos[]; F6.8: destinoCbu?, destinoCuit?, destinoAlias?, destinoNombre?, vencimientos[] propagados al movimiento), `propuestaMatch` (rama 0-3, movimientoId?, itemEsperadoId?, candidatos?; F6.8: origenDestino?, esAdicional?, categoriaPrellena?, subcategoriaPrellena?, etiquetaPrellena?, dedupInfo?{movId,mes,monto,item}), `refStoragePdf`, `contentType`, `tamano`, `subidoPor`, `subidoEn`, `actualizadoEn`. La function `extraerComprobante` (onDocumentCreated) llama a Claude claude-sonnet-4-6 (PDF o imagen). La function `matchComprobante` (onDocumentUpdated, guard anti-loop) corre: rama 0 dedup por hashPdf (con dedupInfo) → rama destino (F6.8, busca en /destinos) → calcularPropuesta() por texto/monto (matchLogica.ts).
- `/diccionario/{id}`: seed ~479 entradas; crece vía trigger de aprendizaje F6.4.5 (no hay upper bound fijo). Validator chequea `count >= excel - 15`.
- `/destinos/{idNorm}` (F6.8): mapa aprendido de destinos de pago. idNorm = SHA-256[:24] del destino normalizado (CBU 22 dígitos / alias lower-trim / nombre NFD-lower). Campos: destinoNorm, tipo ('cbu'|'cuit'|'alias'|'nombre'), itemEsperadoId?, categoria?, subcategoria?, etiqueta?, confianza (umbral 0.7; +0.1 al corregir), creadoPor, actualizadoEn. Poblado por aprenderDestino() al confirmar un movimiento con campos destino*. No se presemilla — aprende desde la primera confirmación.

Ver `scripts/seed/transformers/*.ts` para schemas completos y logica de migracion.

## Backlog de inflación (fase propia, futura)

Inflación en esperados/proyecciones ARS (fase propia, futura): los `itemsEsperados` con `moneda: "ARS"` tienen `montoEsperado` estático. Para proyecciones reales habría que ajustar por inflación mensual (INDEC IPC). Opciones: campo `ajusteInflacion: boolean` + factor mensual en `/config/familia`, o bien dejar que el usuario actualice `montoEsperado` manualmente cada N meses. No se implementa hasta que el caso de uso sea claro.

## Backlog (post F5.3)
- **F6.6 — PWA share-target (compartir desde el celular).**
  Paridad con el sistema viejo (12_ShareTemp.gs: carpeta Drive temporal + token + TTL). En Firebase
  colapsa: share-target llama a subirEntrante → `entrantes` (F6.7: router detecta tipo y rutea a
  comprobante o resumen) → Storage + dedup SHA-256 por hash + trigger onCreate (F6.2). No se porta
  la carpeta Drive. Feature chica (la infra pesada ya existe).

## F6.5 — Resumen de tarjeta

Estado: pipeline completo. Probado con Galicia Visa 2026-04 (60 líneas, 2 personas).

Prompts: `docs/prompts/F6.5_resumen_tarjeta_base.md` + addendums 1–10 implementados.

### Decisiones de modelo (cerradas, no re-litigar)

1. **Trigger separado** `extraerResumenTarjeta` (onDocumentCreated en `resumenesTarjeta`),
   NO branch en `extraerComprobante`. Ruta de upload dedicada. Single call, sin detección de tipo.
2. **Persona del consumo** = bloque del PDF (encabezados "Consumos {Nombre}" /
   "Total Consumos de {Nombre}" / "TOTAL ADICIONAL DE {Apellido},{Nombre}"), resuelta vía
   `resolverNombreMiembro`. NO se deriva del `tarjetaCodigo`. Impuestos/percepciones → persona vacía.
   Titular vacío ese mes → todo al adicional (funciona solo). Nombre que no resuelve → sin persona
   en preview, lo completa el usuario.
3. **Clasificación**: el LLM extrae y limpia `descripcionRaw`; `clasificar()` (diccionario) categoriza.
   Las categorías NO vienen del prompt de Claude (evita dos criterios en conflicto y permite
   aprendizaje). Lo que el diccionario no reconoce queda en blanco y aprende al confirmar.
4. **Tres tipos de línea** con flags anti-doble-conteo: consumo (`excluirDash:false`,
   `incluirResumenMes:false`); impuesto/percepción (ídem, sin persona, categoría "Impuestos y
   finanzas"); los 2 totales ARS/USD (`excluirDash:true`, `incluirResumenMes:true`).
5. **Total** = TOTAL A PAGAR del PDF, no la suma de consumos (incluye impuestos, resta ajustes).
6. **DEV PER del consolidado** (entre "SU PAGO" y "SALDO PENDIENTE", negativo): EXCLUIDO de
   movimientos (no es gasto del mes actual) pero INCLUIDO en el cuadre como `ajustesConsolidado`
   (el total del PDF ya viene neto). Campo `ajustesConsolidado: AjusteConsolidado[]` en
   `CardStatement`; visible en banner del preview para trazabilidad.
7. **Percepción USD**: camino único (siempre impuesto del mes, sin flag recuperable). El ajuste
   pagaste-en-USD se refleja vía la DEV del mes siguiente (excluida). No se modela la bifurcación
   pesos/USD.
8. **Reintegros de percepción del mes** (CR.RG, DEV.IMP positivos en detalle, CAJA SEG-PROMO):
   categoría "Impuestos y finanzas" (NO "Ingresos"), restan en esa categoría.
9. **Validación de cuadre** al confirmar: `consumos + impuestos − reintegros + ajustesConsolidado
   = total a pagar` (ARS y USD por separado). Avisa y bloquea confirmación si no cuadra.
10. **Casos especiales** portados de `47_Tarjetas_PDF.gs`: USD sin duplicar (el ARS entre
    paréntesis es conversión), reversos, cuotas (C.XX/YY), reintegros.
11. **Datos**: array `movimientosParseados[]` inline en el doc (≤60 líneas, no subcolección).
    Estado `CardStatement`: `'subido' | 'parseado' | 'confirmado' | 'error' | 'requiere_tarjeta'`
    (máquina propia, distinta del estado de Comprobante).
12. **Sin dedup en parseo** (addendum 8): el modelo emite una lista autoritativa; dos líneas
    idénticas son dos transacciones reales. `dedupMovimientos` eliminada. El cuadre (±$1) es la
    única compuerta de integridad. Bug real: un ANTHROPIC U$S 5,00 era borrado por k1 coincidente
    con otro ANTHROPIC del mismo período → descuadre exacto de U$S 5.
13. **Tarjeta automática desde PDF** (addendum 6): `subirResumenTarjeta` no recibe tarjetaCodigo.
    CF extrae `numeroCuenta` del encabezado del PDF, resuelve por `config.tarjetas[].numeroCuenta`
    → fallback banco+tipo → `estado: 'requiere_tarjeta'`. `CardStatement.tarjetaCodigo: string | null`.
    `config.tarjetas[].numeroCuenta` es campo nuevo en seed y en tipo.
14. **`asignarTarjetaResumen` → parseado** (addendum 9): el trigger es `onDocumentCreated`;
    resetear a `'subido'` no re-dispara. Asignar tarjeta parchea metadata y pasa directo a
    `'parseado'` (parseo ya está en el doc; no re-llama a la CF).
15. **Ajuste manual de cuadre** (addendum 10): `AjusteConsolidado.origen?: 'pdf' | 'manual'`.
    `agregarAjusteCuadreManual()` calcula el residuo desde las lineas actuales del preview y lo
    appenda en `ajustesConsolidado` con `origen:'manual'`. El `onSnapshot` recalcula el cuadre y
    habilita confirmar. UI: confirm() si diferencia > $5.000 o > 2% del total (o > U$S 2).
    Auditoría: entradas `origen:'manual'` son señal de calidad del parser.

### Aprendizajes técnicos

- **Bug Timestamp-vs-string**: el seed guarda `fechaCierre`/`fechaVencimiento` como `Timestamp`,
  la Cloud Function como string `"YYYY-MM-DD"` (viene del JSON de Claude). `docACardStatement`
  debe manejar ambos con `toDateSafe()`; asumir solo `Timestamp` crashea el callback de `onSnapshot`
  y deja la lista vacía sin error visible.
- **El parseo tarda ~111–155s** para PDFs de 60 líneas. `timeoutSeconds ≥ 300` requerido en la
  function (default 60s la cortaría en prod).
- **`max_tokens` alto (32000)** → el SDK exige streaming; bajo (16000) → trunca PDFs grandes.
  Solución: `client.messages.stream()` + `finalMessage()` + `max_tokens: 32000`.
- **Import duplicado rompe onSnapshot**: dos `import` del mismo módulo (`firebase/firestore`) en
  el mismo archivo causan fallo silencioso del `onSnapshot` bajo el HMR de Vite — el callback
  nunca dispara y la lista queda vacía sin error visible. Regla: un único `import` por módulo,
  consolidado al top del archivo.
- **Dedup falso positivo**: `dedupMovimientos` borraba transacciones reales con descripción/monto
  coincidentes (dos ANTHROPIC U$S 5,00 en el mismo resumen → solo pasaba uno). Causa real de
  descuadre en Visa Galicia 2026-04. Eliminado en addendum 8; el cuadre es la única compuerta.

### Pendientes (backlog F6.5)

- **Re-seedear emulador**: addendum 7 cambió el seed para escribir `estado` explícito. Sin re-seed,
  los docs existentes muestran `estado:'subido'` (default conservador). `npm run seed` contra el
  emulador pisa los docs por id.
- **Probar el final del pipeline end-to-end**: subir un PDF nuevo → parseado → confirmar →
  movimientos creados + 2 totales + aprende. El pipeline nunca fue probado de punta a punta.
- **Probar BBVA Visa** (4 personas): primer PDF multi-persona grande pendiente de validación.
- **Probar `requiere_tarjeta`**: subir PDF de tarjeta sin `numeroCuenta` en config → aparece
  asignador inline → asignar → pasa a parseado sin re-extracción.

## Ciclo factura → obligación → pago (F6.9.x)

- Una factura crea un movimiento como OBLIGACIÓN ABIERTA (confirmadoPago:false), clasificado por destino/texto. El payee de una factura es el EMISOR (extracción: destinoCuit/destinoNombre = emisor).
- Un pago (transferencia/comprobante_pago) a un payee con obligación abierta del mismo monto RECONCILIA esa obligación (reconciliarPorPayee → rama 1) y la marca confirmadoPago:true, SIN crear un segundo movimiento. La llave es el payee (destinoCuit/Cbu/alias, normalizado); el monto exacto desempata. Sin gate de fecha.
- En el flujo de comprobantes SOLO auto-confirman sin intervención del usuario: dedup por hash (rama 0) y reconciliación por payee (F6.9). Todo otro match propone y abre AltaMovimiento. El match por monto+mes quedó fuera del flujo (calcularPropuesta se llama con movs=[]).
- Preclasificación del alta: por DESTINO (matchPorDestino → categoriaPrellena, payee aprendido por CBU/CUIT) o por TEXTO (diccionario). El payee para el clasificador se elige por tipo: destinatario (destinoNombre) en pagos, emisor (comercioRazonSocial) en facturas — porque billeteras tipo MP llenan comercioRazonSocial con su marca.
- confirmadoPago = "saldado por un pago", NO "la fecha ya pasó". Por eso una factura nace abierta aunque su emisión sea pasada.

Changelog: F6.9.1 (anti-autovínculo: calcularPropuesta con movs=[]) · F6.9.2 (factura nace confirmadoPago:false, gateado por esPago) · F6.9.3 (extracción: destinoCuit/destinoNombre = emisor en facturas) · F6.9.4 (preload usa categoriaPrellena del match por destino) · F6.9.5 (el payee para el clasificador se elige por tipo (destinatario en pagos, emisor en facturas) porque billeteras tipo MP llenan comercioRazonSocial con su marca).

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

## Tu Perfil / Configuración Familiar

Entry point: avatar+nombre clickeable en el header → /perfil (reemplaza el texto plano
actual). El dependiente solo ve su perfil Personal; el admin ve Personal + Configuración
Familiar. ConfigEsperados se re-monta adentro; /config-esperados queda como redirect
(igual que /tarjetas → /comprobantes). El nav superior queda: Dashboard · Resumen (admin) · Carga.

### Nivel Personal (todos, self)
- Tu cuenta: nombre, emails, rol (read-only)        → config/familia.miembros[self] (vía callable)
- Instalar app (PWA)                                → local
- Tema claro/oscuro (de Comidas, opcional)          → local
- Notificaciones (placeholder)                      → —

### Nivel Configuración Familiar (solo admin) — primer corte
Toda escritura vía callable admin-only (Admin SDK), salvo donde se indique cliente:
- Gastos/Ingresos esperados → itemsEsperados        → cliente admin (ya existe ConfigEsperados)
- Miembros (nombre, emails, rol, activo, alias)     → config/familia.miembros + /autorizados (callable)
- Tarjetas (codigo, banco, tipo, titular,
  cuentaDebito, numeroCuenta, ultimos4[])           → config/familia.tarjetas (callable)
  ultimos4 es el ancla confiable de resolución de resúmenes
  (numeroCuenta → ultimos4 → banco+tipo → titular).
- Categorías + Bancos                               → config/familia.{categorias,bancos} (callable)
- Subcategorías + Etiquetas                         → /subcategorias, /etiquetas (callable)
- Unidades funcionales (uf, alias, etiqueta)        → config/familia.unidades (callable)
- Destinos aprendidos (ver/corregir/borrar)         → /destinos (callable; sin regla de cliente)

### Futuro (no en el primer corte)
- Diccionario (ver/corregir/borrar lo aprendido)    → /diccionario (cliente admin, bajo costo)
- Reglas de normalización                           → /reglasNormalizacion — TRAMPA: viven en
  tres copias sincronizadas a mano (seed, cliente, functions). Una UI tocaría solo Firestore
  y rompería la sincronía. No hacer hasta cambiar ese modelo.
- Tipo de cambio (override manual puntual)          → /tcDiario (lo escribe la Function)
- Inflación / presupuesto                           → engancha con el backlog de inflación

### Vínculo con el cutover a producción
Las pantallas familiares (miembros, tarjetas+ultimos4, categorías, bancos, unidades,
subcategorías, etiquetas) son la superficie que, en la migración a producción, reemplaza
al Excel como fuente de verdad. Hoy esos datos viven solo en el seed/transformers; cuando
estas pantallas existan y estén pobladas, el cutover puede dejar de re-seedear desde Excel.

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
