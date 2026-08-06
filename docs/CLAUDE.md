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
- Fase 9 — Rediseño visual sobre el design system (`src/design-system`): F9.0/F9.0b/F9.0c
  (doc-only: decisiones de diseño, auditoría de paridad legacy, auditoría app+plan de
  cableado) cerrado. F9.1 (tokens.css importado globalmente) cerrado. F9.2 (shell móvil:
  AppBar/Screen/BottomNav/Fab + Icon sobre lucide-react + scaffold de modal de captura +
  los 14 componentes del DS portados a TSX) cerrado. F9.3 (pantallas, PRs visuales con
  datos de ejemplo, ver sección de detalle más abajo): Dashboard, Resumen, Cargar (+
  modales Confirmar comprobante/Alta manual), Perfil + 4 sub-pantallas — cerrado. Tarjetas
  no es pantalla propia: vive dentro de Cargar (`SeccionTarjetas`, real, sin cambios).
  **Pendiente: la PR de cableado de cada pantalla** (reemplazar datos de ejemplo por reales;
  el detalle de qué hook falta en cada caso está en el changelog de cada pantalla, sección
  "Sistema de diseño / UI" más abajo).

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
- F9.38 — `config/familia.categorias` pasa de `string[]` a `CategoriaItem[]`
  ({id, nombre, activo}), igual que ya tenían subcategorias/etiquetas. Los
  `movimientos` (y el diccionario) SIGUEN guardando el LABEL (string), no el
  id — no se migra ese campo. El id es solo la identidad estable que usa la
  UI de Perfil › Categorías para trackear una fila a través de un rename; la
  callable `guardarTaxonomia` cascada el label viejo→nuevo en movimientos +
  diccionario (+ subcategorias.categoriaPadre si renombra una categoría) en
  la misma operación, en batches de 450 docs. Borrado: un nodo con uso
  documentado (movimientos o, para categoría, subcategorías) solo se puede
  desactivar (`activo:false`); el borrado duro exige conteo de uso en cero.
- F9.39 — Perfil › Tipo de cambio gana escritura (antes solo lectura): la callable
  `actualizarTCManual` (admin-only) hace upsert en el MISMO `tcDiario/{YYYY-MM-DD}` que
  escribe el cron F9.30 (`actualizarTCDiario`), con `origen:'manual'` — no hay colección
  paralela. `tcParaFecha` no cambia. Pisa con confirm() si ya hay un valor para esa fecha;
  el cron del día siguiente vuelve a poner el automático sin intervención.
- **Dashboard = devengado · Resumen = caja (F9.40, NO reconcilian por diseño).**
  Dashboard imputa el gasto a cuándo se hizo el consumo y excluye los pagos de tarjeta
  consolidados — filtro `excluirDash != true` (`ExcluirDash` en el Excel histórico).
  Resumen (sección "Por día") toma lo efectivamente pagado en el mes, incluyendo el pago
  del resumen de tarjeta — filtro `incluirResumenMes == true` (`FlagResumenMes` en el
  Excel; `TarjetaPago` lo fuerza a `true` aunque el Excel no lo tenga marcado).
  `fecha`/`mes` coinciden siempre en el seed — la diferencia entre ambos scopes NUNCA es
  por el campo de mes, es por diseño. No intentar cuadrar un scope contra el otro: son
  agregaciones distintas a propósito (ver `src/datos/agregados.ts` y `Resumen.tsx`,
  comentario "contrato de scope"). El validador del seed (`scripts/seed/validators/
  checks.ts`) los chequea cada uno contra el Excel por separado, nunca uno contra el otro.
- F9.41 — Perfil › Tarjetas gana escritura (cierra el bloque de 6 configs editables F9.36–
  F9.41, hallazgo de paridad F9.32): `cierreDia`/`venceDia`/`tipoTarjeta` (F9.35, antes
  solo-lectura a propósito) más alta/baja del catálogo, vía la callable `guardarTarjeta`
  (admin-only, mismo patrón). Baja bloqueada si hay `resumenesTarjeta` con ese
  `tarjetaCodigo`. Marcar `tipoTarjeta:'debito'` se bloquea si la tarjeta ya tiene líneas en
  cuotas cargadas (débito no genera cuotas — antes solo un `console.warn` en `TarjetaFace`).
- F9.53 — Editar / eliminar movimientos (admin-only). Dos callables nuevas en `functions/src/index.ts`:
  - `editarMovimiento({ id, cambios })` — recibe solo los campos que cambian. Invariantes servidor:
    `persona` = memberId o null (familiar); `medio` normalizado vía `medioCanonicoBancos()` (alias→canónico);
    `categoria` validada contra `config/familia.categorias` (activo, label); al cambiar categoría, `subcategoria`
    se limpia si no se pasa nueva; `subcat` validada contra colección `subcategorias` de esa categoría;
    `tcUsdArs` recomputado vía `tcParaFechaAdmin()` si cambia `fecha` o `moneda`; `mes` recomputado desde `fecha`;
    `itemEsperadoId` se limpia si cambia persona, categoría o monto fuera de ±10% del original.
    Escribe `actualizadoEn: FieldValue.serverTimestamp()`.
  - `eliminarMovimiento({ id })` — guardrail: bloquea si `mov.resumenTarjetaId != null` OR `mov.excluirDash === true`
    (forzaría descuadre en resumen de tarjeta). En caso contrario, borra el doc.
  - `tcParaFechaAdmin()` — helper interno: busca `tcDiario/{YYYY-MM-DD}` exacto o el último anterior con
    `orderBy(FieldPath.documentId(), 'desc').startAt(dateStr).limit(1)`.
  - `medioCanonicoBancos()` — helper inline servidor, mismo concepto que `medioCanonico()` del cliente
    (`src/datos/medios.ts`) pero recibe `bancos[]` directamente (no hay importaciones cross-env en Functions).
  Flujo cliente:
  - `src/datos/movimientos.ts`: `CambiosMovimiento` interface + `llamarEditarMovimiento()` + `llamarEliminarMovimiento()`.
  - `src/vistas/EditarMovimiento.tsx`: FullModal (mismo patrón que AltaMovimiento). Carga subcats + config,
    muestra todos los campos editables; solo envía los campos que cambiaron (diff). Aviso ámbar si viene de
    resumen de tarjeta. Delete con confirmación inline.
  - `src/vistas/perfil/BuscarMovimiento.tsx`: pantalla admin bajo `/perfil/buscar-movimiento`. Selector de período
    (month-picker), campo de búsqueda textual (descripcion/categoria/subcat/banco/persona), chips de persona.
    Lista onSnapshot (vía `useMovimientosDelMes`), tap en fila → abre `EditarMovimiento`.
  - `src/AppShell.tsx`: ruta `/perfil/buscar-movimiento` (admin-only) + entrada en `TITULOS_PERFIL_SUB`.
  - `src/vistas/Perfil.tsx`: ítem "Buscar / editar movimiento" (icono search) al final del grupo admin.
  - `src/vistas/Resumen.tsx`: `PorDiaSeccion` acepta `esAdmin` + `onEditarMovimiento`; cards de día son
    expandibles (toggle chevron) → muestra filas individuales de gastos del día → admin puede tappear → EditarMovimiento.
  - `src/datos/agregados.ts`: `DashMensual.movMasAlto` suma campo `id: string | null`.
  - `src/vistas/Dashboard.tsx`: card "Mov. más alto" es tappable para admin (pencil icon, navega a EditarMovimiento).
  No hay agregados persistidos que recalcular (F9.25): los onSnapshot listeners ya propagan los cambios.
- F9.54 — Pulido app viva: 5 fixes post-import detectados en prod.
  1. **AppBar + BottomNav fijos:** `.shell-phone` usa `height: 100dvh; overflow: hidden` (no `min-height`);
     `Screen` tiene `minHeight: 0` en el div exterior para evitar que el flex item expanda el contenedor y
     empuje header/nav al hacer scroll. Sin estos dos cambios, todo el shell scrollea.
  2. **TC sin error de índice:** `tcParaFecha()` en `src/datos/tcDiario.ts` reemplaza el
     `where(documentId(), '<=', dateStr) + orderBy(documentId(), 'desc')` (requería índice compuesto sobre
     `__name__`, que Firestore no auto-crea en combo filter+sort) por
     `orderBy(documentId(), 'desc') + startAt(dateStr)`. Mismo resultado: primer doc con ID ≤ dateStr; cero
     índice adicional. **El usuario debe correr `firebase deploy --only hosting` después del `npm run build`.**
  3. **"Instalar app":** ítem en Perfil › sección Personal, visible a todos. Android/Chrome captura
     `beforeinstallprompt` (guardado en `promptRef`) y llama `prompt()` al tap. iOS: muestra el instructivo
     "Safari › Compartir → Agregar a inicio" como `desc` del ítem (sin tap). Oculto si ya instalado
     (`display-mode: standalone`). Requiere el manifest servido (F9.49).
  4. **Logos de medios:** `.env.production` ya tiene `VITE_BRANDFETCH_CLIENT_ID=1idDEHYBi7zAzQv9-MQ`.
     `BankLogo` integrado en chips "Gastos por día" del Resumen (reemplaza puntito de color). Fallback:
     local `/assets/medios/{id}.svg` → monograma. También en la card HOY: fila conciliada muestra
     `BankLogo` del banco del movimiento que saldó el ítem.
  5. **Card HOY en Resumen:** reemplaza el contador simple de movimientos de hoy. Ahora muestra los
     `itemsEsperados` con `diaVencimiento === hoy.getDate()` para el mes actual — conciliado (check / BankLogo
     del banco) o pendiente (reloj / "A pagar"). Sin ítems → "Nada que pagar hoy". Para meses distintos al
     actual → "Ver mes actual para pagos de hoy". `PorDiaSeccion` recibe `checklist: CheckItem[]` y
     `mes: string` como props nuevas desde `ResumenVisual`.
- F9.99.7 — Semántica de pagos: match contra futuros, débitos automáticos al ciclo normal, fin del
  "pagado por fecha" (ver `docs/prompts/F9.99.7-semantica-pagos-y-match-futuros.md`). **Corte:**
  `MES_CORTE_SEMANTICA_PAGOS = '2026-07'` (`src/datos/checklist.ts`) — las reglas nuevas de estado
  solo aplican a `mes >= corte`; meses anteriores conservan el comportamiento legacy (no se
  re-pinta la historia). **Parte 1 (ventana de match):** `matchComprobante` (functions) pasa de
  `[mes−1, mes, mes+1]` a `[mes−1 … mes+3]` — un pago de hoy puede saldar una obligación hasta 3
  meses adelante. `reconciliarPorPayee`/`reconciliarPorNombre`/`matchPorDestino` no cambiaron (ya
  operan sobre el `movs` que les pasa el caller). **Parte 2 (picker manual):**
  `buscarObligacionAbierta` → `buscarObligacionesAbiertas` (`src/datos/comprobantes.ts`): ya no es
  mes exacto + `limit(1)`, es `mes >= mesDelComprobante` ordenado asc, `limit(12)`, devuelve
  `{id,mes}[]`. Picker en `Comprobantes.tsx`: al elegir el ítem, busca sus obligaciones abiertas;
  si hay ≥1 muestra una segunda lista "¿Qué mes salda este pago?" con cada mes visible (nunca
  auto-elige); si hay 0, cae al flujo existente (crea movimiento nuevo en el mes del comprobante).
  Índice compuesto nuevo `movimientos (itemEsperadoId ASC, confirmadoPago ASC, mes ASC)` en
  `firestore.indexes.json`. **Parte 3 (pago adelantado):** `confirmarRama1` (comprobantes.ts) y
  `confirmarPagoEsperado` (movimientos.ts) escriben `pagadoEn: serverTimestamp()` al confirmar
  pago — nunca tocan `mes` del movimiento (auditado: ya no lo tocaban). Campo nuevo
  `Movement.pagadoEn?: Date | null`. `ItemChecklistCard` (Resumen.tsx) muestra "Pagado por
  adelantado el DD/MM" cuando `pagadoEn` cae en un mes distinto al del ítem. El mes del pago no
  suma el gasto como propio porque `mes` nunca se tocó (consecuencia del diseño, no requirió
  código extra). **Parte 4 (débitos automáticos):** `estadoItem` ya no asume `pagado` por
  `diaVencimiento <= hoy` en ítems `pagoAutomatico` para `mes >= corte` — caen a la misma máquina
  que cualquier ítem (programado/no_registrado/vencido/pendiente; `pagado` solo con match
  confirmado). `pagoAutomatico` queda como metadato. UI: `GastosFijosSeccion` separa
  `checklist.filter(pagoAutomatico)` en una sub-sección propia "Débitos automáticos" (mismas
  tarjetas/estados/acciones, vía `ItemChecklistCard` compartido). **Botón "Registrar pago"**
  (nuevo, aplica a TODO accionable sin match, no solo débitos): mini-form inline (monto prefill
  `montoEsperado`, fecha prefill hoy, ambos editables) → `registrarPagoChecklist()`
  (movimientos.ts) crea un movimiento con `mes` = mes del ítem (NO el de `fecha`, que es cuándo se
  registra el pago — pueden diferir a propósito), `itemEsperadoId`, `confirmadoPago:true`,
  `pagado:true`, `pagadoEn:fecha`, `registradoDesdeChecklist:true`. Riesgo de duplicado
  documentado, no resuelto acá: si más tarde el extracto bancario trae el mismo débito, se crea un
  movimiento duplicado; el marcador `registradoDesdeChecklist` queda como señal para una
  deduplicación futura (no construida en esta feature). **Parte 5 (fin del arrastre):** para
  `mes >= corte`, un mes pasado con matches sin confirmar ya no es automáticamente `pagado` — usa
  `confirmadoPago` real (`por_confirmar`/`parcial`/`pagado` según corresponda), igual que un mes en
  curso. **Parte 6 (auditoría `pagado` vs `confirmadoPago`):** inventario — `movimiento.pagado` no
  lo lee ninguna lógica de negocio hoy (ni checklist, ni agregados, ni Dashboard), solo se guarda;
  los únicos escritores son `AltaMovimiento.tsx` y la callable `cargarMovimientoDesdeComprobante`
  (ambos ya derivan de la fecha, correcto) y `resumenesTarjeta.ts` (hardcodea `true`, correcto —
  un consumo de tarjeta ya ocurrió). Fix aplicado: `crearMovimiento` (movimientos.ts) tenía
  `payload.pagado ?? true` — código muerto en la práctica (el único caller siempre lo manda
  explícito) pero corregido a `payload.pagado ?? pagadoPorFechaDefault` (deriva de `fecha` como
  F9.63) para no dejar una trampa a futuros callers. `crearMovimiento` también gana `mes?`/`pagadoEn?`/
  `registradoDesdeChecklist?` opcionales en `NuevoMovimiento` (antes `mes` existía pero se
  ignoraba). No se unificaron los dos campos (fuera de alcance, decisión del dueño).
- F9.99.8 — Resumen: agenda de pagos unificada (Hoy + vencidos + futuros sueltos; check con monto
  pendiente). Ver `docs/prompts/F9.99.8-agenda-pagos-unificada.md` (spec) y
  `docs/prompts/F9.99.7_addendum_1.md` (ciclo de vida completo del gasto, documental). Todo en
  `src/vistas/Resumen.tsx`, sin tocar `checklist.ts` (el cálculo del checklist no cambia).
  **Agenda unificada:** tipo `AgendaEntry = {kind:'esperado',ci:CheckItem} | {kind:'suelto',mov:Movement}`.
  `sueltosFuturosDelMes(movs, checklist, hoy)` filtra movimientos `tipo='Gasto'`, `pagado=false`,
  `fecha >= hoy` (comparación por día, no por hora) que NINGÚN ítem esperado capturó — dedupe vía
  el `Set` de ids ya presentes en `checklist[].matches` (si una rama de `movimientosDelItem()` lo
  agarra, ya cuenta como esperado y no aparece como suelto). `agenda = checklist ∪ sueltosFuturos`,
  calculada en `ResumenVisual` y pasada a `GastosFijosSeccion` (reemplaza el prop `checklist` por
  `agenda`) — los sueltos entran siempre a "principales" (nunca son `pagoAutomatico`), suman a
  "Pendiente" (monto crudo, mismo criterio sin conversión de moneda que ya tenía esa suma, F9.62)
  y al denominador de "Al día X/Y". Card nueva `SueltoAgendaCard`: sin estado de la state machine
  (no es `ExpectedItem`) — check verde solo si `mov.confirmadoPago===true`, badge "Sin plantilla".
  **Card Hoy** (`PorDiaSeccion`, scope `esMesActual` sin cambios): unión de (a) esperados con
  `diaVencimiento===hoy.getDate()` (como antes), (b) esperados en estado `vencido` (por
  definición de `estadoItem` ya están sin match/no cubiertos — un vencido ya pagado deja de ser
  `vencido` y no aparece acá), (c) futuros sueltos con fecha exactamente hoy. Vencidos primero
  (sin duplicar: `vencido` exige `diaVencimiento < hoy.getDate()`, nunca coincide con (a)). Fila de
  un vencido en la card muestra "Venció día D" en `--gf-expense` en vez de "A pagar". `hoyPendienteArsEq`,
  `todoPagadoHoy` y el desglose por banco (`hoyPorBanco`, F9.92.1) se recalculan sobre el conjunto
  ampliado vía helper `agendaCubierto(e)` (esperado: `cubierto(estado)`; suelto: `confirmadoPago===true`).
  "Nada que pagar hoy" solo si la unión filtrada da vacío.
  **Check "Al día":** `porRevisar` sigue calculándose exactamente igual (sobre esperados, sin
  cambios) — solo cambia el texto: con pendientes, suma cantidad + monto ARS eq inline ("Revisar
  pendientes del mes · 3 sin pagar · $ 1.234.567", reutilizando el patrón de conversión ya usado
  para `hoyPendienteArsEq`); el badge numérico separado se retira (redundante con el texto). Con
  `porRevisar===0`, texto verde sin números, sin cambios.
  Frontend puro, sin cambios de Rules/Functions. `tsc --noEmit`: 41 errores pre-existentes, ninguno
  nuevo en `Resumen.tsx`. Deploy: `--only hosting`.
- F9.99.8.1 — Hotfix agenda: card Hoy con la fila de "Por día", check "Al día" con pendiente
  total, sueltos accionables y ordenados. Ver `docs/prompts/F9.99.8.1-hotfix-agenda-card-hoy.md`.
  **Módulo compartido nuevo `src/datos/agenda.ts`:** `AgendaEntry`, `agendaCubierto`,
  `sueltosFuturosDelMes`, `construirAgenda`, `pendienteAgenda` (vencidos/pendientes sin match →
  `montoEsperado`; `por_confirmar`/`parcial` → monto REAL de sus matches; sueltos → monto real) y
  `diaDeAgenda` (día de vencimiento de una entrada, `99` si no tiene) se extraen de `Resumen.tsx`
  para que F9.99.9 (picker con agenda unificada) los reuse sin duplicar — sin cambio de
  comportamiento en la extracción. **1. Card Hoy = fila de "Por día":** nuevo `DiaRowShell`
  (día + chips de banco + total grande/chico + chevron expandible), compartido entre "Gastos por
  día" y la card Hoy (antes visual propia). El contenido expandido de Hoy agrega estado por ítem
  (check verde/reloj/alerta/"Venció día D", sin cambios de esa lógica) y lápiz de edición cuando
  hay un único movimiento real detrás del ítem (esperado con 1 match, o el suelto mismo) —
  `onEditarMovimiento` ya existía, solo se extiende a este contexto. **2. Check "Al día":** el
  monto ahora es `pendienteAgenda(agenda)` (vencidos + por_confirmar a monto real + sueltos) en
  vez de solo ítems sin match — el disparador (`porRevisar===0`) no cambia.
  **3. `SueltoAgendaCard` accionable:** "Marcar pagado"/"Deshacer" vía `marcarPagadoSuelto`/
  `desmarcarPagadoSuelto` (`src/datos/movimientos.ts`) — mismo patrón `writeBatch` directo que
  `confirmarPagoEsperado`/`desmarcarPago` (admin-only por Rules), sobre el movimiento existente;
  nunca crea uno nuevo (evita duplicado si más tarde el mismo gasto llega por extracto, F9.99.7).
  **4. Orden:** `principales` (checklist no-automático ∪ sueltos) pasa de "sueltos al final sin
  ordenar" a sort por `diaDeAgenda` ascendente (sort estable — empates conservan el orden previo
  por estado); `pendiente` y `alDia/total` de `GastosFijosSeccion` siguen sobre `agenda` completa,
  sin afectarse por el reorden de `principales`. Semántica del match/checklist intacta. Frontend
  puro, sin cambios de Rules/Functions. `tsc --noEmit`: mismo baseline que antes de este cambio
  (48 errores pre-existentes ajenos a este archivo — el número subió de 41 a 48 en commits
  anteriores no relacionados; 0 errores nuevos introducidos acá). Deploy: `--only hosting`.
- F9.99.9 — Comprobantes: picker de conciliación manual con agenda unificada. Ver
  `docs/prompts/F9.99.9-picker-agenda-unificada.md`. **1. Fuente de candidatos:** el picker
  consume la agenda del **mes actual** (`construirAgenda`/`calcularChecklist` sobre
  `useMovimientosDelMes(mesActualStr())`, NO la ventana [mes−1..mes+3] del match automático) —
  calculada una vez en `Comprobantes()` y pasada como prop `agenda` a `ComprobanteCard` →
  `PropuestaCard`. Filtro: `tipo==='Gasto' && moneda===d.moneda`, igual que antes.
  **2. Dos tipos de candidato:** esperado (plantilla) → flujo existente sin cambios (obligación
  abierta vía `confirmarRama1` o alta vinculada vía `cargarMovimientoDesdeComprobante`); suelto
  (gasto sin plantilla) → nueva `confirmarSueltoDesdeComprobante(comp, movId)`
  (`src/datos/comprobantes.ts`) — mismo patrón `writeBatch` que `confirmarRama1` (hashPdf +
  refStoragePdf + comprobante→vinculado) pero **sin** `origenComprobanteId`: el movimiento es
  preexistente, no nace de este comprobante — si el comprobante se descarta después,
  `descartarEntrada()` debe REVERTIR el vínculo (rama sin `origenComprobanteId` de esa función),
  no borrar un movimiento que el usuario ya tenía cargado. Marca `propuestaMatch.origenSuelto:true`
  en el mismo batch para que `RazonVinculado` (Comprobantes.tsx) distinga "Saldó un gasto suelto"
  de "Cargado como nuevo"/"Cumplió un gasto esperado". Campo nuevo `PropuestaMatch.origenSuelto?`
  (cliente, `src/types/index.ts`). Selección del picker: string prefijado
  `"esperado:<id>" | "suelto:<id>"` (antes solo guardaba el itemEsperadoId).
  **3. Presentación:** candidatos ordenados no-cubiertos primero (vencidos antes que el resto)
  por día de vencimiento ascendente (`diaDeAgenda`), cubiertos al fondo y radio deshabilitado;
  ícono check/alerta/reloj reusa la semántica de la card Hoy (F9.99.8.1); sueltos con badge
  "Sin plantilla"; vencidos muestran "Venció día D".
  **4. `buscarObligacionesAbiertas`:** piso `mes >= mesComp` → `mes >= mesComp−1` (coherente con
  la ventana de match [mes−1..mes+3]) — mismo índice compuesto `movimientos (itemEsperadoId,
  confirmadoPago, mes)` del F9.99.7, sin índice nuevo.
  **5. Gate ampliado:** el botón picker ya no exige `esPagoDoc` — disponible para CUALQUIER
  documento de gasto en rama 3 ("Conciliar con gasto esperado") y como acción secundaria en
  rama 2 ("Asignar a otro gasto"), ambos `esAdmin`-only, sin agregar fricción al camino feliz
  (rama 2 de candidato único sigue yendo directo a "Revisar y cargar").
  **6. Rama 2 con múltiples esperados:** `calcularPropuesta` (`functions/src/matchLogica.ts`)
  ahora popula `descripcion`/`monto`/`moneda` en los candidatos tipo `'esperado'` (antes solo
  mandaba `id` — la UI tomaba `itemsMatch[0]` a ciegas); `ItemEsperadoMin` gana
  `categoria`/`subcategoria`/`notas`/`montoEsperado` (poblados en `matchComprobante`,
  `functions/src/index.ts`). Cuando hay >1 candidato, `PropuestaCard` muestra un radio-chooser
  ("Coincide con varios gastos esperados — elegí cuál") ANTES de habilitar "Revisar y cargar";
  con 1 candidato (caso común) no se renderiza nada nuevo. Frontend + Functions.
  `tsc --noEmit` (cliente y `functions/`): 0 errores nuevos. Deploy:
  `cd functions && npm run build` → `firebase deploy --only functions,hosting`.
- F9.100 — Sync de tokens de tema + limpieza de deuda de color. Ver
  `docs/prompts/F9.100-sync-tokens-limpieza-color.md`. Cierra hardcodeos de color detectados
  en la auditoría formato/tema kit↔vivo (jul-2026). **1. Tokens `--gf-amber-*`:** definidos en
  `tokens.css` (`:root` + `[data-theme="dark"]`, junto a `--gf-out`); fallbacks inline
  `var(--gf-amber-*, #hex)` limpiados en `EditarMovimiento.tsx` y `ClasificacionScreens.jsx`
  (unificado el fallback divergente `#fef3c7`→`var(--gf-amber-50)`). **2. Azul→esmeralda/ink en
  acción primaria:** `ConfigEsperados.css` (`.cfg-tab--activo`→`var(--color-accent)`,
  `.cfg-btn-nuevo`/`.cfg-btn-pri`→`var(--color-primary)`/`var(--color-primary-dark)`) y
  `ResumenesTarjeta.css` (`.rt-btn--primary`→ídem); el azul informativo (`.cfg-chip-moneda`,
  outline de foco, `.rt-badge`) se deja sin tocar, es semántica distinta. **3. Token
  `--gf-chart-serie`:** reemplaza `#9cb3e8` hardcodeado en `Dashboard.tsx` (barras "no-pico" de
  diaria y anual, incl. proyección punteada); dark con equivalente muteado `#3a4d7a`. **4. Muted
  y negativo-sobre-ink:** `#9ca3af` → `var(--gf-gray-400)` en `AltaMovimiento.tsx`,
  `EditarMovimiento.tsx`, `Dashboard.tsx` y el `desc` del `Hero` de `CaptureModal.tsx`; `#fca5a5`
  (texto de balance negativo sobre el hero ink en `Dashboard.tsx`/`Resumen.tsx`) → token nuevo
  `--gf-on-ink-neg` (mismo valor light/dark, es sobre superficie ink). **5. Paleta de sectores de
  Patrimonio:** no tocada (opcional, queda igual — sigue local a `Patrimonio.tsx`). Frontend
  puro (tokens + CSS/estilos inline), sin cambios de modelo/Rules/Functions. `tsc --noEmit`: 41
  errores pre-existentes, ninguno nuevo. `vite build`: OK. Deploy: `--only hosting`.
- F9.101 — Patrimonio Research: "Actualizar todo" (un solo punto de entrada para lote +
  sectorial + agenda + manuales + sync CAFCI). Ver `docs/prompts/F9.101-actualizacion-integral.md`.
  **1. Backend, modo `'completo'`** en `generarPromptIA`/`importarAnalisisIA`
  (`functions/src/index.ts`): `buildPromptCompleto(contexto)` compone lote+sectorial+agenda+
  manuales en un único prompt, pasando a cada `buildPrompt*` solo el sub-contexto que espera
  (mismo contrato que en modo standalone, evita repetir el JSON completo dentro de cada bloque)
  y agregando un bloque final de instrucciones de formato que tiene prioridad sobre las
  instrucciones individuales de cada sub-bloque — pide un único ```json con
  `{ lote: {analisis}, sectorial: "...", agenda: {eventos}, manuales: [...] }`. Import fail-soft
  por sección: `importarLote`/`importarSectorial`/`importarAgenda` (helpers nuevos, reusan
  `validarResultadoImportado`) e `importarManuales` (nuevo, sin validación genérica — valida
  contra Firestore que el doc de `posicionesManuales` exista y que
  `|valorUsd − cantidad_del_doc × precioUnitarioUsd| < 1`; solo actualiza `valorUsd`/
  `fechaValuacion`, nunca `cantidad`, nunca crea docs; `precioUnitarioUsd: null` → skip).
  Los modos individuales (`posicion`/`sectorial`/`agenda`/`lote`) se refactorizaron para
  delegar en los mismos helpers — mismo comportamiento externo, sin duplicar la lógica de
  escritura. **2. Backend, etapa `'manuales'` en `analizarConIA`** (modo API): mismo prompt de
  manuales con `web_search`, la import reusa `importarManuales` directamente server-side.
  **3. Frontend (`Patrimonio.tsx`), card "Actualización integral"** arriba de las cards
  existentes en Research, con dos botones: **Chat** (`handleAbrirChatCompleto` arma el
  contexto combinado vía `buildContextoCompleto()` — reusa `buildByTickerMap()`, ahora
  extraído como helper compartido con "Analizar lote"/"Chat lote" — y abre el
  `ModalPromptChat` existente con `modo:'completo'`; al importar con éxito refresca
  analisisCache/sectorial/agenda/manuales y dispara `handleSincronizarCafci()`) y **API**
  (`handleActualizarTodoApi`, orquestador cliente secuencial de 5 etapas con progreso
  `Etapa N/5: <label>…`: lote reusa `analizarLoteTickers()` — extraído de
  `handleAnalizarLote` para compartir progreso —, sectorial, agenda, manuales
  (`analizarManuales()` nuevo wrapper en `patrimonioIA.ts`) y sync CAFCI; fail-soft por etapa,
  resumen final por etapa). **4. CTA post-ingesta:** `PatrimonioIngesta.tsx` no tenía pantalla
  de éxito (el modal se cerraba en seco al confirmar) — en vez de tocar ese componente, el
  callback `onConfirmado` en `Patrimonio.tsx` ahora dispara un toast fijo con "Actualizar
  análisis con la cartera nueva →" que navega a la solapa Research (`setTab('research')`);
  pura navegación, sin lógica nueva de ingesta. Auditoría previa a implementar (regla del
  proyecto) encontró 3 discrepancias menores respecto al spec — confirmadas con el usuario
  antes de tocar código: `analizarConIA` no tenía modo lote (no bloqueante, "Analizar lote"
  ya iteraba ticker por ticker); `handleSincronizarCafci` vive en la solapa Config, no
  Research (igual invocable, está en scope del componente); `PatrimonioIngesta` sin pantalla
  de éxito (resuelto con el toast del punto 4). Frontend + Functions. `tsc --noEmit`
  (cliente y `functions/`): 0 errores nuevos (48 pre-existentes ajenos, mismo baseline).
  `vite build`: OK. Deploy: `cd functions && npm run build` → `firebase deploy --only
  functions,hosting`.
- F9.102 — Card HOY completa, banner de fijos con números, feedback CAFCI y fix de alineado en
  Optim. Ver `docs/prompts/F9.102-card-hoy-fijos-cafci-optim.md`. **1. Card HOY (Resumen):**
  tercera fuente `HoyEntry = AgendaEntry | {kind:'real', mov}` (tipo local a `Resumen.tsx`, NO
  se agregó a `AgendaEntry` de `agenda.ts` para no contaminar GastosFijosSeccion/picker F9.99.9)
  — movimientos reales de caja del día (`tipo==='Gasto'`, fecha=hoy) sin match en el checklist
  ni ya listados como sueltos; se renderizan al final ("Pagado · banco"), suman a `hoyPorBanco`
  y son editables (lápiz, siempre 1 movimiento). Fix del pendiente: `pendienteDeEntrada(e:
  AgendaEntry): number` extraído en `agenda.ts` (monto real de matches si por_confirmar/parcial,
  si no montoEsperado) — `pendienteAgenda` y `hoyPendienteArsEq` lo reusan; antes un
  por_confirmar con `montoEsperado` null mostraba $0 pese a tener un match real cargado. Con
  `todoPagadoHoy`, el header suma el total pagado del día (`hoyTotalArsEq`) debajo del check
  "Al día". **2. Banner de fijos:** con `porRevisar===0` ahora muestra `alDia/total` (mismo
  cálculo que el header de `GastosFijosSeccion`: `agenda.filter(agendaCubierto).length` /
  `agenda.length`) + `· $ a confirmar` si `pendienteAgenda(agenda) > 0`. **3. Sync CAFCI:** la
  CF `sincronizarCafci` suma `errores: Array<{fondo, mensaje}>` (cap 13) poblado en el catch por
  fondo; `handleSincronizarCafci` (Patrimonio.tsx) deja de tragar el resultado — toast con
  `sincronizados/total fondos · N sin mapear · N con error (primer fondo: mensaje)`, catch con
  toast de error, retorna el resultado para que "Actualizar todo" (etapa 5) reporte
  `N/total` real en vez de `'hecho'` incondicional. **4. Optim (`patrimonioOptimizacion.ts`):**
  `alinearSeries` reescrita — bucketea cada serie por semana ISO-8601 (`claveSemanaISO`, puro,
  jueves de la semana define el año) usando la última observación de la semana, lo que absorbe
  los corrimientos de ±1–3 días entre Yahoo US/.BA(UTC-3)/cripto que antes colapsaban la
  intersección de fecha exacta; excluye PRIMERO las series cortas (< minObs semanas, antes se
  intersectaba primero y una serie mala arrastraba a todas) y, si la intersección de las
  sobrevivientes queda corta, excluye iterativamente la que más la restringe (mayor intersección
  resultante sin ella) hasta alcanzar minObs o quedarse sin series. Suma `diagnostico:
  Record<string, {puntos, semanas, motivo}>`. `ResultadoOptimizacion.diagnostico?` (campo
  opcional end-to-end, richer shape con `puntosCrudos`/`puntosDolarizados?`/`semanasAlineadas`/
  motivo incluyendo `sin_datos_yahoo`/`tc_insuficiente`) ensamblado en el `onCalcular` de
  `OptimizacionTab`: `faltantes` de la CF → `sin_datos_yahoo`; `dolarizarSerie` con `excluir` →
  `tc_insuficiente`; el resto sale de `alinearSeries`. UI: card colapsable "Diagnóstico de
  series" (tabla símbolo/puntos/semanas/motivo en texto humano) debajo de "Posiciones
  elegibles". `correrTests` suma 3 tests: fechas corridas ±2 días alinean completo, serie corta
  no arrastra a las otras, `claveSemanaISO` en borde de año (2025-12-29 → 2026-W01). **5. Dedupe
  de chips:** `OptimizacionTab` arma `Map<symYahoo, valorUsdAgregado>` desde `aptas` antes de
  mapear los chips (key ya única por símbolo) — sin cambio visual además del dedupe. Frontend +
  Functions. `tsc --noEmit` (cliente y `functions/`): 0 errores nuevos (48 pre-existentes ajenos
  en cliente, mismo baseline; 0 en functions). `vite build` y `functions` build: OK. Deploy:
  `cd functions && npm run build` → `firebase deploy --only functions,hosting`.
- F9.102.1 — Hotfix: persistencia de la matriz de correlaciones + primer intento de región
  CAFCI. Ver `docs/prompts/F9.102.1-hotfix-matriz-y-cafci.md`. **1. Serialización de la matriz**
  (`patrimonioOptimizacion.ts`): Firestore rechaza `number[][]` (arrays anidados) — hasta F9.102
  nunca explotó porque `correlacion.matriz` siempre quedaba vacía. `serializarCorrelacion`/
  `deserializarCorrelacion` (puras, exportadas) convierten a `{simbolos, matrizFlat, n}`
  row-major en el borde de Firestore; `ResultadoOptimizacion` de dominio no cambia.
  `guardarOptimizacion` sanea valores no finitos a `0` y los anota en `advertencias: string[]`
  (campo nuevo opcional del resultado). `cargarUltimaOptimizacion` es retrocompatible: doc viejo
  (`matriz`) se usa tal cual, doc nuevo (`matrizFlat`) se deserializa, sin ninguno de los dos
  devuelve matriz vacía sin tirar. **2. Guardado fail-soft** (`Patrimonio.tsx` `onCalcular`): el
  resultado se muestra (`setOptimizacion`) ANTES de intentar persistir; el guardado quedó en su
  propio try/catch con aviso ámbar discreto (`avisoGuardadoOptim`) si falla, sin perder el
  cálculo. **3. CAFCI, primer intento:** override de región a `us-central1` solo en
  `sincronizarCafci` (hipótesis: CloudFront bloquea por IP/ASN de compute en
  `southamerica-east1`) — este intento NO concluyó (ver F9.102.2 §B). `correrTests` suma 3 tests
  de serialización (round-trip 3×3, matriz vacía, contrato de detección de formato viejo).
- F9.102.2 — Fix del optimizador de mínima varianza (bug bang-bang) + cierre del experimento de
  región CAFCI + ingesta manual. Ver `docs/prompts/F9.102.2-simplex-y-cafci-manual.md`.
  **1. `proyectarSimplex` reescrita** (`patrimonioOptimizacion.ts`): el algoritmo viejo
  (clamp a `[0,wMax]` → renormalizar → repetir) era una proyección RADIAL, no euclídea —
  empujaba la solución a los vértices y expulsaba activos de forma irreversible (bug real:
  `calcMinVarianza` devolvía `wMax` en 5 activos y `0` en el resto). Reemplazada por bisección
  sobre el umbral τ: `w(τ)ᵢ = clamp(vᵢ−τ, 0, wCap)`, monótona por construcción, converge siempre.
  `wMaxEfectivo(n, wMax)` (pura, exportada) resuelve el caso infactible (`n·wMax < 1`, el
  conjunto `{w≥0, Σw=1, wᵢ≤wMax}` queda vacío) usando `1/n` y dejándolo anotado en
  `advertencias[]` del resultado (`calcularOptimizacion`, no `calcMinVarianza` — la firma de
  ésta no cambia). `testMinVarConstraintWmax` (Sigma/wMax preexistentes, n=2 wMax=0.4 es
  infactible por construcción — 2×0.4=0.8<1) ahora compara contra `wMaxEfectivo` en vez del wMax
  literal; nuevo test 11 cubre el caso infactible end-to-end vía `calcularOptimizacion`.
  **2. Guarda permanente de confiabilidad** (`OptimizacionTab`): `motorMinVarSano` corre los
  tests analíticos deterministas de min-var (casos 1 y 3) en cada render; si alguno falla, la
  columna "Mín. var." de "Carteras calculadas vs actual" se grisa con la leyenda "no confiable —
  tests del motor en rojo" en vez de mostrar pesos que no son una recomendación válida. **3.
  Cierre del experimento de región:** `src/firebase.ts` tenía `getFunctions(app,
  'southamerica-east1')` hardcodeado — el primer intento (F9.102.1) migró `sincronizarCafci` a
  `us-central1` pero el cliente seguía apuntando a la región vieja (función inexistente → 404
  HTML → SDK de callables lo mapea a `internal`); cero logs de invocación real, el experimento
  nunca corrió. Fix: instancia nueva `functionsUsCentral = getFunctions(app, 'us-central1')`
  (+ `connectFunctionsEmulator` en dev), usada por `sincronizarCafci()` en `patrimonioCafci.ts`.
  **4. Ingesta manual de JSON CAFCI** (independiente del resultado de 3 — red de seguridad):
  parseo extraído a `parsearFichaCafci(json, fondo, fechaFetch)` (`functions/src/index.ts`),
  única implementación compartida por `sincronizarCafci` (fetch automático) y la CF nueva
  `importarCafciManual({fondoId, claseId, json})` (dueño-only, valida JSON parseable y —
  best-effort si el payload lo trae— que el fondo/clase coincide con lo pedido; escribe en
  `cafciCarteras` con la misma forma que la sync automática más `origen:'manual'` y
  `fechaIngesta`). Cliente: `importarCafciManual()` wrapper + `fechaDatosDeFondo()` en
  `patrimonioCafci.ts`; `CafciCartera` gana `origen?`/`fechaIngesta?` opcionales. UI: cada fondo
  en el card "Fondos CAFCI" de Config muestra indicador de estado (fecha de datos o "sin datos")
  + botón "Pegar JSON" → `PegarJsonModal` (URL de la ficha copiable/clickeable, textarea, botón
  Importar, error inline). Mensaje de 403 corregido a `Usá "Pegar JSON" en Config` (antes
  prometía un "pegado manual" que no existía). Frontend + Functions. `tsc --noEmit` (cliente y
  `functions/`): 41 errores pre-existentes en cliente (baseline fijado en esta sesión — venía
  sin registrar, había migrado de 48 a 41 entre sesiones previas), 0 nuevos; 0 en functions.
  `vite build` y `functions` build: OK. Pendiente de cierre manual (no soy yo quien deploya):
  correr `firebase functions:delete sincronizarCafci --region southamerica-east1` (si aplica) →
  `cd functions && npm run build` → `firebase deploy --only functions,hosting` → probar
  Sincronizar → `firebase functions:log --only sincronizarCafci` para confirmar 200 o 403 CON
  log de invocación (un `internal` sin log no es una lectura válida del experimento).
- F9.103 — Backfill de `tcDiario` desde ArgentinaDatos (destraba los `.BA` en Optim: `dolarizarSerie`
  exige ≥40 semanas de TC y el legacy nunca guardó serie diaria — usaba `TC_MEP_REFERENCIA` manual,
  no hay nada que migrar). Ver `docs/prompts/F9.103-backfill-tcdiario.md`.
  **Hallazgo de auditoría (bloqueante, resuelto antes de escribir código):** comparar `tcDiario`
  propio contra ArgentinaDatos fecha-a-fecha en el tramo de solapamiento (29/12/2025→hoy) dio solo
  72/199 coincidencias con diffs de hasta 2% — la alarma que el prompt pedía no ignorar. Investigado
  con scripts read-only (service account, sin escribir nada) hasta encontrar la causa: **shift
  sistemático de 1 día**, no ruido. El cron F9.30 corre a las 09:00 ART, antes de que abra el
  mercado de bonos que arma el dólar bolsa/MEP — a esa hora `dolarapi.com` todavía devuelve el
  cierre de AYER pero lo guarda bajo el rótulo de HOY; ArgentinaDatos rotula cada cotización con la
  fecha real de mercado. Comparando `tcDiario[fecha]` contra `api[fecha − 1 día]` el match sube a
  198/200 exactas (los 2 residuales: días no sistemáticos — ni lunes ni post-feriado — con delta
  <1%, ruido puntual de la fuente). Fin de semana y feriados AR no necesitan forward-fill propio:
  la fuente ya viene con el calendario completo (repite el último cierre hábil), salvo Año Nuevo (1
  caso/año, impacto acotado). Simulación (merge propio ∪ backfill, sin escribir) confirmó **cero
  huecos internos y cero semanas ISO rotas** tanto en la ventana de 40 semanas (108 semanas
  cubiertas, 2024-W27→2026-W30) como en la de 104 (157 semanas, 2023-W30→2026-W30) — el hueco
  10-13/04/2026 y el de 28/06/2026 quedan tapados con el shift aplicado.
  **1. CF `backfillTcDiario`** (`functions/src/index.ts`, admin-only, mismo nivel que
  `actualizarTCManual`): `onCall({desde?, hasta?, pisarExistentes?, soloValidar?})`. Un solo GET a
  `api.argentinadatos.com/v1/cotizaciones/dolares/bolsa` (serie completa, filtrada en memoria — no
  pega por día); si el fetch falla no escribe nada (mismo criterio que el cron F9.30). Escribe
  `tcDiario/{fecha} = api[fecha − 1 día].venta` con `origen:'argentinadatos-bolsa-backfill'`,
  batches de 400. `pisarExistentes:false` (default) nunca toca un doc ya existente — protege el
  cron en el borde de hoy/mañana sin condición especial, es la misma regla de "no pisar" aplicada
  uniformemente. La validación de solapamiento corre SIEMPRE (con o sin `soloValidar`) y devuelve
  cuántos coinciden/difieren contra la tolerancia de <1% establecida en la auditoría.
  **2. Cliente** (`src/datos/tcDiario.ts`): `backfillTcDiario()` wrapper del callable;
  `cargarEstadoTcDiario()` (fechaMin/fechaMax/cantidadDias/semanasISO — reusa `claveSemanaISO` de
  `patrimonioOptimizacion.ts`, una sola fuente de verdad — /huecos) para la card de estado.
  `TCDiarioItem.origen` suma `'argentinadatos-bolsa-backfill'`.
  **3. UI** (`Patrimonio.tsx`, `TipoCambioCard` en la solapa Config): estado de cobertura + botones
  "Validar" (soloValidar) y "Completar histórico" (defaults del backend), reporte de solapamiento y
  plan/resultado de escritura inline, mismo patrón visual que `CafciFondosCard`.
  **Sin cambios de Rules** — `tcDiario` ya era `write:false` para cliente (solo Admin SDK), igual
  que F9.30/F9.39. **Fuera de alcance:** no se tocó el cron F9.30 ni el umbral de 40 semanas de
  `dolarizarSerie`. `tsc --noEmit` (cliente y `functions/`): 41 errores pre-existentes en cliente
  (mismo baseline de F9.102.2), 0 nuevos; 0 en functions. **Pendiente de cierre manual (no deployo
  yo):** `cd functions && npm run build` → `firebase deploy --only functions,hosting` → correr
  "Validar" desde la UI y pegar el reporte de solapamiento real (confirma además si
  `api.argentinadatos.com` sale sin bloqueo desde la Cloud Function, algo que no se puede probar
  sin el deploy) → si el solapamiento cierra, correr "Completar histórico" → Optim → Recalcular y
  confirmar cuántos `.BA` entran.
- F9.104 — Migración de la ingesta CAFCI al sitio nuevo (cierra F9.102.1/.2: los 403 nunca fueron
  CloudFront bloqueando por IP/ASN de compute — CAFCI migró de sitio y dio de baja la API vieja;
  hasta el propio sitio oficial se pega 403 contra su API muerta). Ver
  `docs/prompts/F9.104-migracion-cafci-sitio-nuevo.md`. **Auditoría previa (obligatoria por el
  spec, hecha con `curl` contra producción antes de tocar código):** confirmado que
  `estadisticas.cafci.org.ar/fondos/{fondoId}?clase={claseId}` responde 200 sin bot-detection
  para los 3 casos de prueba (incl. el borde `fondoId===claseId`); la cartera viaja en
  `<canvas data-pie-chart-items-value="[{&quot;nombre&quot;:...,&quot;porcentaje&quot;:...}]">`
  (HTML-escapado); la fecha de CARTERA vive en `<div id="cartera">…<div class="valores">Valores
  al DD/MM/YYYY</div>`, distinta de la fecha de VALORIZACIÓN del fondo (`#titlePage`,
  "información al…") — confundirlas habría ensuciado `fechaDatos` en silencio. Verificado con
  HTML real de Alpha Pesos (money market) y Galileo Acciones. **1. Módulo puro nuevo
  `functions/src/cafciHtml.ts`** (sin imports de SDK, mismo patrón que `matchLogica.ts`):
  `extraerItemsCartera(html)` (regex sobre `data-pie-chart-items-value`, decodifica entidades
  HTML antes de `JSON.parse`, falla explícito si el atributo falta / no parsea / da array vacío)
  y `extraerFechaCartera(html)` (regex acotada a `#cartera`, `null` si no matchea — el caller
  decide si eso es fatal). Self-test sin framework `cafciHtml.test.ts` (no hay jest/vitest en
  `functions/`, no se justifica sumarlo para 4 casos — mismo criterio que `correrTests()` del
  cliente): entidades escapadas, atributo ausente, JSON inválido, array vacío, más 2 casos bonus
  (fecha ausente no explota, no confunde valorización con cartera) — los 8 corren contra
  fragmentos reales auditados. Correr: `npx tsx functions/src/cafciHtml.test.ts`.
  **2. `sincronizarCafci`** (`functions/src/index.ts`): URL nueva, `Accept: text/html`, sin
  `Origin`/`Referer` (spoofeo para la API vieja); en error, loguea el `status` + primeros 300
  caracteres del body REAL en vez de un mensaje interpretado fijo ("CloudFront bloqueó") — esa
  suposición escrita en el código costó tres sesiones de investigación en F9.102.1/.2; el mismo
  criterio se aplica en `importarCafciManual`. Si no se puede extraer `fechaDatos`, falla el
  fondo (no el lote) en vez de caer a `fechaFetch` — evita ensuciar la clave del `docId` con una
  fecha equivocada de forma difícil de detectar después. **3. Bucket de desconocido
  (`parsearFichaCafci`):** el pie chart de origen es un componente de UI que trunca la cola en
  un item literal `"Resto de Activos"` — un money market puede tener hasta ~10% ahí (medido:
  Alpha Pesos 8%, Galileo Acciones 1.6% en el HTML auditado). Se persiste como posición propia
  (`categoria: 'RESTO'`, `ticker: null`, nunca pendiente de mapeo, nunca prorrateado).
  `advertenciaIntegridad` (único chequeo `totalPct∉[98,102]`) se reemplaza por DOS
  independientes: `advertenciaSuma` (mismo chequeo, detecta HTML roto) y `advertenciaCobertura`
  (`coberturaIdentificada = totalPct − pesoResto` bajo `UMBRAL_COBERTURA_MINIMA=95`, constante
  nombrada — detecta truncamiento severo). Verificado end-to-end contra el HTML real de Alpha
  Pesos: dispara `advertenciaCobertura` (92.1% < 95) SIN disparar `advertenciaSuma` (100.1% ∈
  [98,102]) — exactamente el caso que antes pasaba silencioso y la razón de ser del cambio.
  **4. `parsePosicionCafci`:** agrega alias `nombre` (campo del sitio nuevo) delante de
  `nombreActivo`, sin tocar el resto — retrocompat con `share`/`nombreActivo` intacta.
  **5. `importarCafciManual`:** ahora acepta DOS formatos pegados a mano — array directo (el
  snippet de consola `copy(document.querySelector('[data-pie-chart-items-value]').dataset
  .pieChartItemsValue)` del sitio nuevo) o el envoltorio `{success, data:{info:{semanal}}}` de
  la API vieja (retrocompat con JSON ya guardado). El array directo no trae fecha de cartera
  propia — usa la fecha de ingesta (decisión de esta sesión, documentada: es la red de
  seguridad, no el camino primario, que sí extrae la fecha real del HTML). El chequeo
  best-effort de `fondoId` en el payload solo aplica al formato viejo (el array no lo trae).
  **6. Cierre del experimento de región:** `region: 'us-central1'` eliminado de
  `sincronizarCafci` (vuelve a `southamerica-east1` vía `setGlobalOptions`); `functionsUsCentral`
  + su `connectFunctionsEmulator` eliminados de `src/firebase.ts`; `sincronizarCafci()` (cliente,
  `patrimonioCafci.ts`) vuelve a usar `functions`. **7. UI (`Patrimonio.tsx`):** banner existente
  de `advertenciaSuma` (antes `advertenciaIntegridad`) intacto en texto/estilo; banner nuevo de
  `advertenciaCobertura` con el % de cobertura por fondo. `PegarJsonModal`: URL apunta al sitio
  nuevo, instrucciones cambian de "copiá el JSON de la respuesta" a "pegá el snippet de consola
  en F12, copiá el resultado". Comentarios obsoletos que seguían atribuyendo el problema a
  CloudFront (en `Patrimonio.tsx` e `index.ts`) corregidos para no repetir la suposición que
  esta sesión cerró. `CafciCartera`/`CafciPosicion` (client) y `ParseoFichaCafci` (functions)
  actualizados con los campos nuevos; `'RESTO'` sumado a la unión de categorías.
  **Fuera de alcance (documentado en el spec, no de esta sesión):** ingesta de `pb_get` y
  reconstrucción del universo de fondos (F9.105); corrección del seed de fondos (Pionero
  15/15 resuelve al fondo equivocado, 10× más chico) — **antes de dar por buena una corrida**,
  corregir a mano esa entrada en `configPatrimonio/cafci` vía la UI existente (botón "×" +
  "Agregar fondo" en el card de Config), si no la sync trae la cartera equivocada sin avisar.
  `tsc --noEmit` (cliente y `functions/`): 41 errores pre-existentes en cliente (mismo baseline
  de F9.102.2/F9.103/F9.106), 0 nuevos; 0 en functions. `vite build` y `functions build`: OK.
  **Pendiente de cierre manual (no deployo yo):** `cd functions && npm run build` → `firebase
  deploy --only functions,hosting` → Sincronizar desde Config → `firebase functions:list`
  (confirmar `sincronizarCafci` una sola vez, en `southamerica-east1`) → revisar el reporte de
  sincronizados/errores/cobertura → corregir Pionero en la config antes de confiar en el
  benchmark.
- F9.106 — Asignación de factura a gasto esperado por **mes de pago** (no de emisión) + automatismo
  graduado por confianza. Ver `docs/prompts/F9.106.spec.md`. **Bug de origen:** una factura del
  próximo período subida dentro del mes en curso se clasificaba "pago adicional" en vez de
  "obligación del mes siguiente" — `matchPorDestino` decidía `esAdicional` colisionando contra el
  mes de EMISIÓN, no el de pago. **1. `mesDePago(datos)`** (`functions/src/index.ts`):
  `vencimientos[0]?.fecha?.slice(0,7) ?? datos.fecha?.slice(0,7)`; el `mesComp` de `matchComprobante`
  (ventana `[mes-1..mes+3]` + bucketing) usa `mesDePago` cuando el doc es obligación
  (`esObligacionDoc`), y sigue con `datos.fecha` para pagos/tickets/transferencias — una sola
  fuente de verdad que alimenta la ventana de reconciliación, `matchPorDestino` y `calcularPropuesta`
  por igual. **2. `matchPorDestino` tri-rama** (reemplaza el `if/else` binario): sin obligación de
  `itemId` en `mesComp` → rama 2 crea la obligación nueva; con una **impaga** → rama 1, la factura
  ES esa obligación (reconcilia, no duplica — antes no existía este camino, siempre creaba);
  con todas **pagas** → rama 2 `esAdicional:true` (cargo real). El short-circuit de
  `matchComprobante` que antes solo cortaba en rama 2 ahora también corta en rama 1 de destino.
  **3. Automatismo graduado** (`UMBRAL_AUTO = 0.9`, junto a `CONFIANZA_INCREMENTO`):
  `confianza < 0.7` no llega acá (ya filtrado); `0.7 ≤ c < 0.9` → `requiereConfirmacion:true`
  (card con ítem+mes editables); `c ≥ 0.9` → `requiereConfirmacion:false` (alta silenciosa).
  `PropuestaMatch` gana `requiereConfirmacion?`/`confianza?` en el twin `matchLogica.ts` ↔
  `types/index.ts` (de paso, `origenSuelto` — F9.99.9 — que faltaba en el twin de functions, sin
  uso real ahí, cerrado por prolijidad). **4. Cliente (`Comprobantes.tsx`):** banda media muestra
  card "Asignar a: {item} · Mes: {selector}" (rango `[mesPago-1..mesPago+3]`, mismo ancho que la
  ventana server) + confianza actual; el ítem se reasigna con el picker "Asignar a otro gasto" ya
  existente (F9.99.9), no uno nuevo. Banda alta: `AltaMovimiento` gana prop `autoConfirmar` —
  monta sin UI, dispara el mismo `construirYGuardar()` (extraído de `handleSubmit`) apenas
  catálogos+TC están listos, sin tap del usuario; si falla, `onErrorAuto` cae al camino manual
  (picker/"Revisar y cargar") en vez de quedar colgado. Badge post-alta vía `RazonVinculado`
  ("Asignado automáticamente a {item} · {mes}"), distinta de la confirmada a mano ("Cumplió un
  gasto esperado"). Copy: "Gasto esperado" → "Obligación de {mes}" (rama 2 no-adicional, en el
  badge del splash, el chip inline y el header de banda media); "Pago adicional" se mantiene solo
  para el cargo real. `tsc --noEmit` (cliente y `functions/`): 41 errores pre-existentes en
  cliente (mismo baseline), 0 nuevos; 0 en functions. `vite build` y `functions build`: OK.
  **Pendiente de cierre manual (no deployo yo):** `firebase deploy --only functions,hosting` →
  probar con una factura real de próximo período (caso Edenor del spec) → si no refresca en el
  celu, borrar datos del sitio (mata el service worker).
- F9.108 — Picker de conciliación manual: mes siguiente visible y pagados fuera. Ver
  `docs/prompts/F9.108-picker-mes-siguiente-sin-pagados.md`. Frontend únicamente
  (`src/vistas/Comprobantes.tsx`, `src/datos/agenda.ts`), cero cambios en `functions/`.
  **1. Dos meses en el picker:** `agenda.ts` gana `GrupoAgenda = {mes, entradas}` y
  `pendientesOrdenados(entradas)` (filtra cubiertos, ordena vencidos primero luego por
  `diaDeAgenda`) — puras, no tocan `construirAgenda`/`agendaCubierto`/`pendienteDeEntrada`
  existentes (Resumen/Card HOY sin cambio de comportamiento). `Comprobantes()` arma
  `agendaPicker: GrupoAgenda[]` con dos hooks fijos de `useMovimientosDelMes` (mes actual +
  `sumarMeses(mesAct, 1)`, sin condicionales — regla de hooks), reemplazando la prop `agenda`
  (antes `AgendaEntry[]`, ahora `GrupoAgenda[]`) de `PropuestaProps`/`ComprobanteCard`.
  **2. Ya pagados fuera del picker:** el render agrupado usa `candidatosDeGrupo()` (filtra
  Gasto + misma moneda, delega a `pendientesOrdenados`) — los cubiertos ya no se listan
  grises/deshabilitados, se excluyen. Cada grupo tiene encabezado siempre visible ("Este mes ·
  {mes}" / "Mes siguiente · {mes}" + línea "Si esta factura se paga el mes que viene, elegí
  acá.") y estado vacío explícito ("Nada pendiente en {mes}.") en vez de una lista muda; un solo
  radio group (`name="picker-${comp.id}"`) abarca ambos grupos. **3. Clave con mes:**
  `candKey(e, mes)` → `esperado:<mes>:<itemId>` | `suelto:<movId>`; `parsePickerSel(sel)`
  reemplaza el parseo por el primer `:` (rompía si el itemId traía `:`) por un split explícito
  esperado/suelto. **4. Obligaciones abiertas por la fila:** `buscarObligacionesAbiertas(pickerId,
  pickerMes || mesPagoDefault)` usa el mes de la fila elegida, no el del comprobante — una fila
  de mes siguiente sigue mostrando obligaciones de meses anteriores (la función ya pisa en
  `mesDesde−1`). **5. Fix bloqueante (hallazgo de auditoría, rama "esperado sin obligación
  abierta"):** esa rama de `handleConciliar` armaba el payload a mano y llamaba a
  `cargarMovimientoDesdeComprobante` directo — el callable exige `creadoPor`/`monto:number`/
  `fechaMs`/`mes` (`functions/src/index.ts:1756-1770`) que ese payload nunca tuvo, fallaba
  siempre con `invalid-argument` en producción (justo la rama que más pega con el mes
  siguiente, que normalmente no tiene obligación creada todavía). Reemplazada por derivar al
  alta prellenada: `setMesElegido(pickerMes || mesPagoDefault)` + `setEsperadoForzado(pickerId)`
  + `setMostrarAlta(true)` — `AltaMovimiento` es el único lugar que arma el payload válido
  (incl. `creadoPor`/`fechaMs`/`mes`/TC para USD). Estado nuevo `esperadoForzado` en
  `PropuestaCard`, con prioridad sobre la rama 2 en el cálculo de `preload` (es el usuario
  eligiendo explícito, no el match automático). `tsc --noEmit` (cliente y `functions/`): 41
  errores pre-existentes en cliente (mismo baseline, verificado idéntico antes/después —
  0 nuevos); 0 en functions. `vite build`: OK. **Pendiente de cierre manual (no deployo yo):**
  `firebase deploy --only hosting` → probar en incógnito/borrar datos del sitio (mata el
  service worker): dos grupos rotulados, ningún pagado en la lista, elegir fila de mes
  siguiente sin obligación abre el alta con fecha/mes correctos y guarda con `itemEsperadoId`
  seteado (verificar en Firestore).
- F9.109 — "Asignar como movimiento nuevo" desde rama 2 + desaprendizaje. Ver
  `docs/prompts/F9.109-desasociar-esperado-y-desaprender.md`. Depende de F9.108 (mismo
  `preload`/misma card). **Bug de origen:** un comprobante propuesto en rama 2 contra un gasto
  esperado que NO corresponde (ej. una transferencia matcheada por `matchTexto` o por destino
  aprendido contra el ítem equivocado) solo tenía dos salidas — "Asignar a otro gasto" (a OTRO
  esperado) o "Revisar y cargar" (con el vínculo malo) — y el vínculo mal aprendido en
  `/destinos` era permanente: `aprenderDestino` (`functions/src/index.ts:679`) solo ESCRIBE
  `itemEsperadoId` cuando lo hay, nunca lo borra; guardar sin vínculo no desaprendía nada.
  **1. Transparencia (hallazgo bloqueante, §Parte 0):** en rama 2 por `matchTexto` (sin banda de
  confianza 0.7-0.9) el usuario decidía a ciegas — el chip/badge solo mostraban
  "Obligación de {mes}"/"Pago adicional", nunca el ítem. `labelEsperado` (antes solo usado en
  el texto del modo auto) se adelanta y se suma siempre que `pm.rama === 2 && itemEsperadoEfectivo`:
  "Obligación de Julio 2026 · Expensas Consorcio" (chip inline + badge del Hero). Fallback al
  `itemEsperadoId` crudo si el ítem no está en `items` (inactivo/borrado), nunca vacío.
  **2. Callable nueva `desvincularDestinoItem`** (`functions/src/index.ts`, junto a
  `upsertDestino`, mismo bloque de auth admin): saca SOLO el `itemEsperadoId` de los docs
  `/destinos` que matcheen `destinoCbu/Cuit/Alias/Nombre` (mismo orden de precedencia que
  `aprenderDestino`/`matchPorDestino`) Y que ya apuntaran a ese `itemEsperadoId` (no pisa un
  vínculo distinto); no borra el doc, no crea nada, no toca categoría/confianza (el prefill de
  categoría sigue sirviendo — `matchPorDestino` cae a rama 3 sin item). Idempotente. Wrapper
  cliente en `src/datos/destinos.ts`. **3. UI — tercera salida:** botón "Asignar como movimiento
  nuevo" junto a "Asignar a otro gasto" (mismo gate `pm.rama === 2 && itemEsperadoEfectivo &&
  esAdmin`); estado `desvincular` con prioridad sobre TODO en `preload` (incluido
  `esperadoForzado` de F9.108) — fuerza `itemEsperadoId: undefined` (gasto suelto) y
  `labelRama2 = 'Movimiento nuevo'`; aviso "No lo vamos a volver a proponer como {ítem}." junto
  al alta. **4. Aprendizaje fail-soft, al guardar** (`onGuardarPayload`, solo si `res.ok` y
  `desvincular`): `corregirAprendizaje()` hace dos correcciones independientes, cada una en su
  propio try/catch — (a) `desvincularDestinoItem` siempre (no-op si no aplica); (b) si el match
  NO vino por destino (`pm.origenDestino !== true`, o sea matcheó por `matchTexto`), agrega el
  payee a `item.matchTexto.excluye` vía `actualizarItemEsperado` (admin-writable desde cliente),
  solo si el token está efectivamente contenido en el texto que evalúa `matchConEsperados` —
  nunca inventa tokens, nunca toca `incluye`. El movimiento YA quedó guardado antes de intentar
  esto; si falla, `console.error` + advertencia chica en la card, sin deshacer la carga. `d`/`pm`
  (narrowed por el guard `if (!pm || !d) return null`) se fijan en consts (`datosCorreccion`/
  `pmCorreccion`) antes de la función anidada — TS no preserva narrowing de closures, hacía
  falta para no reventar con `| undefined`. **5. No-regresión:** rama 1, rama 3, el picker de
  F9.108, `confirmarRama1`, `confirmarSueltoDesdeComprobante`, el modo auto, `aprenderDestino` y
  `upsertDestino`/`eliminarDestino` sin cambios (diff verificado: única adición nueva en
  `index.ts`, sin tocar líneas existentes). `tsc --noEmit` (cliente y `functions/`): 41 errores
  pre-existentes en cliente (mismo baseline, verificado idéntico antes/después), 0 nuevos; 0 en
  functions. `vite build` y `functions build`: OK. **Pendiente de cierre manual (no deployo
  yo):** `cd functions && npm run build && firebase deploy --only functions,hosting` → probar:
  comprobante rama 2 muestra el ítem en el chip/badge → tocar "Asignar como movimiento nuevo" →
  el movimiento guarda con `itemEsperadoId: null` → verificar en `/destinos` que el vínculo
  desapareció (log `[desvincularDestinoItem] … limpiados=[…]`) y en `itemsEsperados` que
  `matchTexto.excluye` incorporó el payee si aplica → repetir con otro comprobante del mismo
  payee y confirmar que ya no se propone contra ese ítem.
- F9.110 — Doble conteo en el checklist de fijos + copy del banner "Al día". Ver
  `docs/prompts/F9.110-doble-conteo-checklist.md`. **Bug de origen:** dos ítems con
  `matchTexto` solapado (o cat/subcat solapada) contaban los mismos movimientos — un
  movimiento vinculado a mano (`itemEsperadoId`) a un ítem A podía además ser reclamado por
  la heurística de otro ítem B, duplicando el pendiente (caso real: `Auto › Agua` y
  `Casa › Agua` mostraban los mismos $73.922 de AySA). **1. `movimientosDelItem`**
  (`src/datos/checklist.ts`) gana tercer parámetro opcional `idsConocidos`: en las ramas
  heurísticas (tarjeta por código, matchTexto/cat+subcat) descarta movimientos cuyo
  `itemEsperadoId` ya apunta a OTRO ítem conocido — un movimiento con dueño explícito no
  puede ser reclamado por la heurística de otro. Movimientos con `itemEsperadoId` colgado
  (ítem borrado, id no en `idsConocidos`) siguen disponibles para no quedar huérfanos.
  Parámetro opcional a propósito: sin él el comportamiento es el de antes, no rompe callers
  externos. `calcularChecklist` arma `idsConocidos` desde TODOS los items (activos +
  inactivos — `ItemsEsperadosContext` no filtra por `activo`, verificado) antes del filtro
  `.filter(i => i.activo)`, así un ítem desactivado sigue siendo dueño de sus movimientos.
  **2. Banner "Al día" (`Resumen.tsx`), tres estados** en vez de dos: con pendientes sin
  cargar sigue igual (rojo, "Revisar pendientes del mes"); con `porRevisar===0` se distingue
  ahora `cubiertos===total` (check verde, "Todo confirmado · n/n") de `cubiertos<total`
  (reloj gris, "Nada vencido · n/n confirmados · $X a confirmar") — antes ambos casos
  mostraban check verde y "Al día", aunque hubiera $X sin confirmar (contradicción real:
  "✅ Al día · 0/22 · $435.479 a confirmar"). KPI de `GastosFijosSeccion`: eyebrow
  "Al día" → "Confirmados" (mismo número). **3. No-regresión:** `estadoItem`,
  `ORDEN_ESTADO`, `ACCIONABLE`, `pendienteDeEntrada`, `pendienteAgenda`, `construirAgenda`
  sin cambios; `matchLogica.ts:119` (server-side, resuelve comprobante→ítem, no
  movimiento→ítem) no se tocó. Frontend puro (`checklist.ts` + `Resumen.tsx`), sin cambios
  de Rules/Functions — los tres call sites reales (`Resumen.tsx`, `Comprobantes.tsx`,
  `perfil/Notificaciones.tsx`) siguen compilando igual, la firma no cambia para ellos.
  `tsc --noEmit`: 41 errores pre-existentes (mismo baseline), 0 nuevos. `vite build`: OK.
  **Pendiente de cierre manual (no deployo yo):** `firebase deploy --only hosting` →
  verificar en incógnito/borrar datos del sitio → en agosto 2026, `Auto › Agua` deja de
  mostrar $73.922 duplicado (pasa a `programado`/`no_registrado`), `Casa › Agua` conserva
  los dos AySA; el PENDIENTE del mes baja exactamente $73.922; ningún movimiento de "Por
  día" desaparece; banner en un mes futuro con 0 confirmados lee "Nada vencido · 0/22
  confirmados · $X a confirmar" sin check verde. **Limpieza de datos aparte del código**
  (después de verificar): borrar o pasar a `activo:false` el ítem de prueba `Auto › Agua`
  en `itemsEsperados`. **Fuera de alcance (documentado en el spec):** `matchTexto` sin
  límite de palabra/largo mínimo (misma causa raíz del falso positivo de F9.109, requiere
  revisar todos los `incluye` existentes antes de cambiar semántica); alerta o job de
  limpieza para movimientos con `itemEsperadoId` colgado; periodicidades no mensuales.
- F9.111 — Arbitraje de movimientos sin dueño + `matchTexto` con límite de palabra. Ver
  `docs/prompts/F9.111-arbitraje-y-tokens.md`. Depende de F9.110 (mismas dos garantías, no
  las revierte: dueño explícito no se comparte, huérfano no se pierde). **Hueco que dejaba
  F9.110:** solo resolvía "dueño explícito vs. heurística" — si NINGÚN ítem tenía
  `itemEsperadoId` en el movimiento (caso real verificado contra producción: los dos AySA de
  agosto 2026 no tenían `itemEsperadoId` seteado, pese a que el dueño creía que sí — la
  premisa del spec de F9.110 estaba equivocada), dos ítems con `matchTexto` solapado lo
  seguían contando dos veces, porque la rama de `matchTexto` ignoraba categoría/subcategoría
  por completo. **1. Resolvedor con arbitraje** (`src/datos/checklist.ts`): reemplaza la
  vieja `movimientosDelItem` (evaluada independiente por ítem) por `calcularChecklist` en dos
  pases sobre TODOS los movimientos a la vez. Pase 1 = vínculo directo por `itemEsperadoId`
  (igual que F9.110, el ítem no participa del pase 2). Pase 2 = cada movimiento libre se
  reparte a UN solo ítem vía `puntajeReclamo()` (nuevo, no exportado): `tarjetaCodigo` 8 ·
  categoría exacta +2 · subcategoría exacta +2 · `matchTexto` +1 (ya no comodín de cat/subcat:
  ahora SUMA si además coinciden) · persona en Ingreso +1; empate en el máximo score se
  resuelve por menor id (determinístico) y se registra en `CheckItem.disputas` (nuevo campo
  opcional `{movId, otros}[]`) para mostrarlo, no ocultarlo. `movimientosDelItem` se borró
  (único call site real era `calcularChecklist`, verificado con grep). **2. Badge "Ambiguo"**
  (`ItemChecklistCard`, `Resumen.tsx`): cuando `ci.disputas?.length`, badge tono warning +
  línea "Asignalo a mano al gasto esperado que corresponda para fijarlo."; desaparece solo al
  vincular el movimiento a mano (pasa a pase 1). **3. `coincideToken`** (nuevo, exportado de
  `checklist.ts` + copia gemela en `functions/src/matchLogica.ts` `evaluarMatchTexto`, mismo
  patrón de sync manual que el normalizador): límite de palabra (sin lookbehind, por
  compatibilidad de WebView viejo) + `LARGO_MINIMO_TOKEN = 3` — antes `'glob'` matcheaba
  "BODEGON EL GLOBITO SRL" (causa raíz compartida con el falso positivo de F9.109) y `'sa'`
  matcheaba cualquier razón social. Fallback: si NINGÚN token de `incluye` llega al mínimo,
  el ítem cae a categoría+subcategoría en `puntajeReclamo` (no deja de matchear en silencio);
  en `matchLogica.ts` (solo hace matcheo por texto, sin fallback de cat/subcat posible ahí)
  simplemente no se propone por texto — documentado inline, es la única divergencia real
  entre los dos gemelos. **4. Aviso en Config → Esperados** (`ConfigEsperados.tsx`): chip
  nuevo con menos de 3 caracteres se rechaza al agregar (`addChip`, mensaje inline reusando
  `errorMsg`); chips ya guardados por debajo del mínimo se pintan en `var(--gf-out)` con
  sufijo " (se ignora)" en vez de ocultarse. **5. Gate de datos** — `scripts/auditarTokens.ts`
  (nuevo, Admin SDK, copia local de `coincideToken`/`LARGO_MINIMO_TOKEN` por el mismo
  criterio de no-import-cruzado): compara `includes()` crudo vs. `coincideToken()` sobre los
  15 ítems con `matchTexto` × 1196 movimientos de los últimos 6 meses de producción (bug de
  paso encontrado y corregido en la propia auditoría: `setMonth` restando un mes a la vez
  sobre un día 30 podía rebotar en meses cortos como febrero y saltear un mes entero —
  arreglado fijando el día en 1 antes de restar). Resultado real: **0 PIERDE, 0 GANA, 0
  ítems con todos los tokens cortos** — cambio de semántica sin impacto sobre configuración
  ya cargada, mergeable sin ajustar ningún token existente. **Verificación contra producción
  (agosto 2026, antes de borrar el ítem de prueba):** los dos movimientos AySA (`itemEsperadoId`
  ambos `undefined`, confirmado por query directa — no como asumía el spec original) quedan
  cada uno en su ítem correcto (`Auto › Agua` $22.974,79 · `Casa › Agua` $50.946,84, matchea
  el `categoria` propio de cada movimiento vía el score de especificidad); `checklist.flatMap
  (matches).map(id)` sin duplicados verificado end-to-end contra Firestore real. Empate
  forzado verificado con datos sintéticos (dos ítems sin cat/subcat, mismo `matchTexto`,
  mismo score): gana el de menor id, `disputas` queda poblado con el perdedor. `tsc --noEmit`
  (cliente y `functions/`): 41 pre-existentes en cliente (mismo baseline), 0 nuevos; 0 en
  functions. `vite build` y `functions build`: OK. **Pendiente de cierre manual (no deployo
  yo):** `cd functions && npm run build && firebase deploy --only functions,hosting` (site
  real: `gastos-familiares-jmsf`, NO el default `gastos-familiares-e6415` del proyecto — ver
  `firebase.json` → `hosting.site`) → verificar en incógnito/borrar datos del sitio: el
  checklist de agosto ya no duplica los $73.922, badge Ambiguo aparece solo en empates reales
  → limpieza de datos aparte del código (después de verificar): borrar o `activo:false` el
  ítem de prueba `Auto › Agua`.
- F9.112 — CAFCI: headers de navegador completos + timeout por fetch + error legible. Ver
  `docs/prompts/F9.112-cafci-headers-y-timeout.md`. Absorbe F9.107 (timeout de fetch
  pendiente). **Causa raíz medida, no inferida:** dos `curl` a la misma URL, misma IP
  residencial argentina, mismo POP de CloudFront (`EZE50-P7`), con 22s de diferencia —
  único cambio entre 403 y 200 fueron los headers (`User-Agent` recortado a `'Mozilla/5.0'`
  dispara el bloqueo de CloudFront; un UA de Chrome real completo con `Accept`/
  `Accept-Language` completos pasa). Descarta de nuevo el origen/ASN de compute como causa
  (la hipótesis que costó F9.102.x) — esta vez con medición, no razonamiento. **1. Headers:**
  constante `HEADERS_NAVEGADOR` (`functions/src/index.ts`, junto a
  `UMBRAL_COBERTURA_MINIMA`) con el UA/Accept/Accept-Language completos que midieron 200;
  comentario inline documenta no agregar `Accept-Encoding` (undici ya lo maneja, forzarlo
  devuelve bytes comprimidos sin decodificar) ni `Origin`/`Referer` (spoofeo de la API vieja,
  sin evidencia de que hagan falta acá). **2. Timeout + presupuesto de lote:** `fetch` gana
  `signal: AbortSignal.timeout(15_000)` por fondo; guard `Date.now() - inicioLote >
  PRESUPUESTO_MS` (100s, margen sobre los 120s de la función) antes de cada fetch — si se
  agota, registra el fondo en `errores` con mensaje explícito y sigue el loop (no corta en
  seco); un fetch colgado ya no se come el presupuesto entero de los 13 fondos en serie.
  **3. Error legible:** el body de la respuesta 403 de CloudFront trae un `<TITLE>` con el
  único texto informativo de esa página de error — antes el `slice(0,150)` cortaba justo
  antes; ahora se extrae con regex y se antepone al mensaje (`HTTP 403 — ERROR: The request
  could not be satisfied`) tanto en el log como en el `throw` que ve el cliente. `tsc
  --noEmit` (`functions/`): 0 errores nuevos. **Pendiente de cierre manual (no deployo yo):**
  `npm --prefix functions run build && firebase deploy --only functions:sincronizarCafci`
  (si sale `Skipped (No changes detected)`, `rm -rf functions/lib` y repetir) → confirmar
  que el binding IAM `allUsers → roles/run.invoker` sigue en pie sobre el servicio
  `sincronizarcafci` (se arregló a mano el 31/07; un deploy que recrea el servicio lo
  resetea — sin él, la callable vuelve `internal` sin logs de ejecución) → botón Sincronizar
  → toast esperado `CAFCI: 13/13 fondos` sin errores de HTTP → si algún fondo sigue en 403,
  el mensaje ahora trae el `<TITLE>` real, pegarlo en vez de volver a suponer. **Riesgo
  asumido a propósito:** esto es scraping contra un WAF, la regla puede endurecerse de
  nuevo — `importarCafciManual` ("Pegar JSON") sigue como camino de respaldo sin depender de
  la red de la función.
- F9.113 — Tipo de cambio: fallback sin índice + error accionable. Ver
  `docs/prompts/F9.113-tc-fallback-sin-indice.md`. Frontend puro (`src/datos/tcDiario.ts`,
  `src/vistas/perfil/TipoCambio.tsx`); **no se tocó `firestore.indexes.json`**. **1. Fallback:**
  `cargarTCReciente` envuelve la consulta `orderBy(documentId(),'desc') + limit(n)` en un
  `try/catch`; si falla por lo que sea (índice, red), lee la colección entera y ordena en
  cliente — el id de `tcDiario` **es** la fecha `YYYY-MM-DD`, así que el orden lexicográfico
  es el cronológico, y es la misma lectura completa que ya hace `cargarEstadoTcDiario`. Una
  consulta fallida ya no deja la pantalla sin valor de TC. **2. Error accionable:** el volcado
  crudo del mensaje de Firestore (link `create_composite` que en celular quedaba cortado por el
  borde, sin poder leerse ni copiarse) se reemplaza por "No se pudo leer el tipo de cambio.
  Podés cargarlo a mano acá abajo." + `<details>` con el detalle técnico (`wordBreak:
  break-all`, `userSelect: text`) + botón Reintentar; el bloque de histórico deja de decir
  `ÚLTIMOS 0` / `Sin histórico todavía` (falso: no es que no haya datos, es que no se
  pudieron leer) y dice "No se pudo leer el histórico." con su propio Reintentar; el
  formulario manual avisa que sigue funcionando (`actualizarTCManual` es callable, no depende
  de esa consulta). **3. Índice — no se agregó, a propósito:** ninguna consulta a `tcDiario`
  en `main` requiere índice compuesto (`cargarTCReciente`, `tcParaFecha` con `desc + startAt`,
  y `cargarTCRango` con `orderBy(__name__) + startAt/endAt` se sirven todas con el índice
  automático), y `firestore.indexes.json` no declara nada de esa colección. La hipótesis viva
  es bundle cacheado en el cliente. `tsc --noEmit`: 41 pre-existentes en cliente, 0 nuevos.
  `vite build`: OK. **Pendiente de cierre manual (no deployo yo):** `npm run build &&
  firebase deploy --only hosting` → recargar en incógnito (o borrar datos del sitio): si el
  error desaparece era bundle cacheado y se cierra sin tocar índices; si persiste, copiar el
  texto **completo** del error de la consola (ahora se puede, con el `<details>`) antes de
  crear ningún índice, y si hay que crearlo va también en `firestore.indexes.json` en el mismo
  commit (un índice hecho a mano por el link de la consola no está en el archivo y un deploy
  posterior puede proponer borrarlo).
- F9.114 — Valuación en USD: TC del día para lo ya movido, TC de hoy para lo vivo. Ver
  `docs/prompts/F9.114-valuacion-usd.md`. **Regla de negocio (la definió el dueño; el criterio
  NO es "mes actual vs mes viejo" sino plata que ya se movió vs plata que todavía está):**
  gasto ya pagado → TC del **día del movimiento** (ya saliste de esos pesos a ese dólar,
  congelado) · ingreso ya recibido en meses cerrados → TC del **día del movimiento** ·
  gasto esperado **no pagado** → **TC de hoy** (lo vas a pagar con pesos de hoy) · ingreso del
  **mes en curso** → **TC de hoy** (está en el banco desvalorizándose). **Cierre de mes
  (opción A, decisión explícita):** al pasar de mes los ingresos dejan de valuarse al TC de hoy
  y quedan congelados al TC de su día — se asume que esa plata ya se gastó, porque la app no
  trackea saldos de cuentas. **Consecuencia aceptada: el valor en USD de un ingreso SALTA el
  día 1 del mes siguiente. Es deliberado, no un bug.** La opción B (congelar al gastarse) exige
  saldos de cuentas y va con la feature de flujos. **Dirección USD→ARS sin cambios:** manda
  `movimiento.tcUsdArs`, el snapshot del día — un gasto en USD de marzo se sigue mostrando en
  pesos al TC de marzo. **Implementación:** `tcDeFecha(mapa, fecha)` en `src/datos/tcDiario.ts`
  resuelve exacto o el más reciente anterior (sábados/feriados no tienen doc) contra el mapa que
  devuelve `cargarTCRango` (reusado de `patrimonioOptimizacion.ts`, cargado desde 10 días antes
  del mes para que el día 1 tenga un anterior); `crearTcDeMovimiento` en `Resumen.tsx` es el
  único lugar que decide el TC de cada movimiento; los totales acumulan el par ARS/USD **por
  movimiento** (`Eq`/`eqDe`) en vez de dividir el total del día por un TC único — si no, un día
  con ingreso y gasto mezclaba criterios. `calcularKpis` ya no calcula un TC único del mes: el
  `?? 1` que dejaba el "equivalente USD" igual al monto en pesos cuando el mes no tenía ningún
  movimiento en USD (agosto 2026: todos ARS) desapareció. **Cascada de fallback** (`TC_DEFAULT`
  renombrado a `TC_FALLBACK`, `tcEfectivoDe` en `tcDiario.ts`): `/tcDiario` sin aviso → último TC
  leído con éxito, cacheado en `localStorage` (`gf-tc-ultimo`, reescrito en cada lectura exitosa
  de `cargarTCReciente`, así se actualiza solo) con aviso `TC del {fecha} — no se pudo leer el de
  hoy.` → `TC_FALLBACK = 1454` con aviso `Sin TC — valor de referencia.`. Nunca un valor plausible
  sin marcar. **Movimiento en USD sin `tcUsdArs` propio** (`AltaMovimiento` sólo lo guarda para
  USD, y su lookup puede fallar) ya no vale 0 —desaparecía de los totales en silencio—: se valúa
  con el TC de su fecha, con badge `TC estimado` en la fila y conteo bajo los KPIs. **Dashboard
  (auditoría de la Parte 6):** su `tc` no venía de `TC_DEFAULT` **ni** de `/tcDiario`, sino del
  mismo defecto `?? 1` en `agregados.ts:153` (y `?? 0` en el anual, que dejaba todo el año en 0);
  `agregarMensual`/`agregarAnual` reciben ahora `tcRef` con el TC efectivo de la cascada. **Límite
  conocido, no arreglado acá:** Dashboard sigue agregando en base USD con un TC representativo
  único por período (no por día de cada movimiento) — llevarlo a la regla completa implica
  refactorizar `agregados.ts` entero, fuera del alcance de esta fase. `tsc --noEmit`: 41
  pre-existentes en cliente, 0 nuevos. `vite build`: OK. **Pendiente de cierre manual (no deployo
  yo):** `npm run build && firebase deploy --only hosting` → verificar en incógnito: agosto 2026
  con $316.492 muestra ~U$S 218 (no U$S 316.492); un gasto de mes cerrado no cambia su USD de un
  día al otro; un esperado no pagado sí.
- F9.115 — Patrimonio: exportar corrida vigente (.txt) y dossier (.json). Ver
  `docs/prompts/F9.115-exportar-corrida-y-dossier.md`. La app ingería corridas pero no las
  devolvía: el `.txt` existía sólo donde el usuario lo hubiera guardado al generarlo. **1.**
  `exportarCorridaTxt(fechaCorrida?)` en `src/datos/patrimonio.ts` arma un `CorraidaJSON` desde
  Firestore mapeando `Posicion → PosicionRaw` (descarta los tres derivados: `valorUsd`,
  `tcUsado`, `fechaCorrida`); el round-trip es determinístico porque la ingesta los recalcula
  con `tcParaFecha(fecha_corrida)`. Sin argumento usa la vigente; con argumento, cualquier
  corrida histórica (el id del doc de `snapshotsPortafolio` **es** la fecha). `meta.fuentes`
  cae a `['export']` y nunca vacío: el validador de la ingesta exige `fuentes` no vacío y
  `total_declarado_usd > 0`, si no el archivo exportado sería irreimportable. **2.**
  `exportarDossierJson()` — propósito distinto, NO re-importable: corrida + manuales + flujos
  (Timestamp→ISO) + historial (24) + retorno. Fail-soft por bloque: cada `cargar*` que falla
  loguea el error real y deja su bloque vacío sin abortar el dossier. `retorno` es `null` sin
  flujos registrados a propósito — sin flujos el número es variación de valor, no retorno
  (misma distinción que ya hace la card de Resumen). **3.** Dos botones en la card de informes
  de `ResumenTab`, con `URL.revokeObjectURL` (el `descargar()` viejo del prompt de chat no lo
  hace; no se tocó, sólo no se repitió la omisión). El toast de CAFCI se renombró de
  `toastCafci` a `toast` porque ahora lo comparten las dos features. **Pendiente de cierre
  manual (no deployo yo):** deploy `--only hosting` → exportar la corrida vigente, subirla a la
  ingesta y confirmar diff vacío en el Paso 3.
- F9.116 — Riesgo: escenarios unificados, brecha de tolerancia y bandas. Ver
  `docs/prompts/F9.116-riesgo-escenarios-y-bandas.md`. **§1:** `calcMetrics` (+`sectorDisplay`,
  `SECTOR_DISPLAY`, `manualToPosicion`) extraída a `src/datos/patrimonioMetricas.ts`; refactor
  puro, el cuerpo movido `diff`ea vacío contra `HEAD:src/vistas/Patrimonio.tsx:139-182`.
  **Tripwire disparado — cambió el diseño de §2:** el `grep` del spec es case-sensitive y no ve
  `STRESS_ESCENARIOS` ni `calcStress()`, que ya calculaban pérdida por escenario y se consumían
  en la solapa Plan **y** en el informe PDF (que ya tenía sección de estrés). La premisa "la app
  no mide pérdida esperable" era falsa. **Decisión del dueño: unificar.** Los 4 escenarios
  idiosincráticos se movieron sin cambiar un solo shock a `src/datos/patrimonioRiesgo.ts` y
  conviven ahí con 4 sistémicos nuevos definidos por **bloque de riesgo** (el driver: acciones
  AR / global / cripto / soberano AR / renta fija / cash) y beta documentada — `global20`
  (S&P −20% × beta), `crash2020` (−34/−44/−50 observados en marzo 2020), `localAr` (agosto 2019:
  −57% en USD en un mes sin crisis global) y `rally` (+20% simétrico: mostrar sólo el downside es
  información sesgada). Un solo registro de 8, un solo motor, y el PDF **no** ganó una segunda
  sección de estrés: la brecha y las bandas entraron en la sección 7 que ya existía. **§3:**
  card "Política de riesgo" en Config → `configPatrimonio/riesgo` (tolerancia 20%, tope por
  posición 8%, por driver 35%, piso de caja 5%); sin doc usa los defaults y lo dice en pantalla.
  **§4:** card "Riesgo y escenarios" en Resumen — titular de brecha con semáforo, tabla de los 8
  escenarios expandible a contribución por bloque, bandas fuera de política con el exceso en USD,
  y mix objetivo colapsado que muestra **siempre** el upside resignado junto al recorte.
  Fail-soft por sección vía `intentar()`. **Convención de unidades:** todo el módulo de riesgo va
  en fracciones (0.20 = 20%), igual que el resto de las métricas; el formulario convierte en su
  borde. **Desvío consciente:** el semáforo de la brecha no reusa `banda()` — sus umbrales son
  absolutos y los de la brecha son relativos a la tolerancia declarada; se reusan los colores,
  no los cortes. **§6:** `npx tsx scripts/verificarRiesgo.ts` — 7 OK / 0 FAIL (los 5 del spec +
  que el mix efectivamente recorte cuando no cumple + que las bandas sean independientes del
  motor de escenarios). `tsc`: 41 pre-existentes, 0 nuevos. `vite build`: OK. **Pendiente de
  cierre manual (no deployo yo):** paridad de números en pantalla, card con datos reales y
  fail-soft renderizado.
- F9.117/F9.118/F9.119 — backlog post-F9.116. Ver `docs/prompts/backlog-post-F9.116.md`.
  **F9.117:** `tcEfectivoDe` recibe un `EstadoTcHoy` explícito (`cargando`|`ok`|`vacio`|`error`)
  en vez de `number | null`, que significaba "todavía no cargó" y "no hay TC" a la vez — el
  banner "no se pudo leer el de hoy" aparecía en cada entrada aunque el TC existiera. Mientras
  carga no se afirma nada; "resolvió vacío" y "falló" dicen cosas distintas.
  **F9.118 — mes de imputación editable.** Corrección al diagnóstico del backlog: `mesComp`
  (`functions/src/index.ts:307`) alimenta la **ventana de reconciliación**, no el `mes` que se
  persiste; tocar esa línea no arreglaba nada. El `mes` lo fijan `AltaMovimiento.tsx:237`,
  `crearMovimiento` y la callable `cargarMovimientoDesdeComprobante`. Y para un ingreso no hay
  mes de pago derivable (`mesDePago` sale de `vencimientos[0]`, un recibo de sueldo no trae),
  así que la respuesta es el **override explícito**, no una regla automática inventada. `mes`
  sigue siendo el único campo consultable y el override se escribe ahí mismo — un
  `mesImputacion` paralelo habría quedado fuera de todos los `where('mes','==',…)` y el
  movimiento no aparecería en el mes al que se lo movió. `mesManual:boolean` marca el pin: con
  el pin puesto, editar la fecha ya no pisa el mes (antes lo pisaba siempre); se suelta con
  `mes: null`. La callable `editarMovimiento` acepta `mes` e `incluirResumenMes` validados
  server-side. Control "Mes en el que cuenta" en alta y edición, y toggle "Entra en el resumen
  del mes" en la edición (existía al crear, no había forma de cambiarlo). Va hacia adelante: sin
  backfill, sin tocar `MES_CORTE_SEMANTICA_PAGOS`.
  **F9.119 — ingresos esperados:** era mucho más chica de lo que suponía el backlog. La UI de
  Perfil ya tenía solapas Gasto/Ingreso y el matcheo ya discriminaba por tipo (`checklist.ts:37`,
  `:53-54`); un cobro esperado ya entraba al checklist y a la agenda. Lo único que los dejaba
  afuera era el flujo de comprobantes: `candidatosDeGrupo` filtraba el picker a `'Gasto'` y
  `preloadBase.tipo` estaba hardcodeado. Ahora el picker ofrece los dos y el tipo del movimiento
  lo manda el ítem elegido. **F9.120 — modo privacidad** (decisiones tomadas por el dueño): toggle
  `%`/ojo al lado del de ARS/USD en Resumen y Dashboard, estado en `PrivacidadContext`
  (memoria, **no** persiste y arranca apagado siempre — que quede prendido sin darte cuenta es
  peor que prenderlo cada vez; el estado sí es compartido entre vistas para que navegar no
  destape). **Base declarada por pantalla** en el encabezado, porque un 43% sin base no
  significa nada: Resumen usa % del ingreso del mes (las dos solapas comparten
  `baseIngresoMes`, calculado con el mismo `tcDeMov` que los KPIs), Dashboard % del gasto del
  período. Los conteos no se tocan; sólo los montos. En el checklist también se tapa el campo
  editable de monto — un input con el número real adentro haría inútil el modo. **PDF:** opción
  explícita "Sin montos" al generar, independiente del toggle de pantalla, porque el informe
  queda archivado en Storage; el archivo lo declara en portada, en una nota y en el nombre
  (`-sin-montos`, también en el `storagePath`). Se implementa sombreando `fmtUsd` dentro de
  `generarYArchivarInforme` para que ninguna sección se escape con el número real; base = % de
  la cartera. **No cubierto:** la solapa Patrimonio (no tiene toggle de moneda donde colgarlo y
  es una pasada aparte sobre ~4.100 líneas). **Duda de auditoría resuelta:** "Pesos disponibles" son los **ingresos
  en ARS del mes** (`Resumen.tsx:143`, `pesosDisp: ingArs`), no un remanente — por eso coincide
  con INGRESOS cuando todo el ingreso es en pesos. El número está bien; la etiqueta induce a
  leerlo mal. Renombrarla es decisión del dueño. `tsc`: 41 pre-existentes, 0 nuevos; `vite build`
  y `functions build` OK. **Pendiente de cierre manual (no deployo yo):** F9.118 toca Functions →
  `npm --prefix functions run build && firebase deploy --only functions:editarMovimiento,functions:cargarMovimientoDesdeComprobante,hosting`.
- F9.117/F9.118/F9.119 (specs formales) — llegaron auditadas sobre `82e2233`, **después** de que
  el backlog `docs/prompts/backlog-post-F9.116.md` ya hubiera implementado las tres features
  (commits `9d6b6d9` y `6fd1fce`). **Los tres tripwires dispararon** y se reportaron; lo que se
  ejecutó fueron los **deltas** de cada spec formal contra lo ya construido. Ver
  `docs/prompts/F9.117-aviso-tc-durante-carga.md`, `F9.118-mes-de-imputacion-editable.md` y
  `F9.119-modo-privacidad.md`. **F9.117:** `EstadoTcHoy` pasa a llevar el error real
  (`{ estado:'error'; err:unknown }`) y los cuatro avisos se alinean palabra por palabra con la
  tabla de la spec — en particular `error` con cache dice "falló la lectura del TC de hoy",
  distinto de `vacio`. **F9.118:** el `<input type="month">` se reemplaza por un **selector
  acotado a mes−1/mes/mes+1** (`mesesAdyacentes`/`etiquetaMes` en `datos/movimientos.ts`), con la
  razón que da la spec: un campo libre deja mandar un movimiento a 2019 de un scroll. Suma la
  línea de ayuda con el efecto concreto, la marca "manual", el valor recibido dentro del mensaje
  de `invalid-argument` (un `"2026-13"` y un `"agosto"` ya no son indistinguibles en el log) y el
  log del cambio de mes (`mes X → Y (manual|derivado)`). Verificado lo que pedía §4: el camino de
  esperados (`registrarPagoChecklist`) pasa `item.tipo` y el `mes` del ítem sin discriminar
  Gasto/Ingreso — ya estaba cableado igual para los dos. **F9.119:** el inventario obligatorio dio
  **55 call sites fuera de `Money`** (umbral de la spec: ~15), lo que confirma que el modo no
  podía implementarse dentro de `Money` sin un refactor mayor; queda documentado. Deltas: `<1%` /
  `>-1%` cuando el monto no es cero pero redondea a 0% (si no, un gasto chico y un cero se ven
  igual), el toggle ARS/USD **deshabilitado** con el modo activo, la base de Inicio corregida a
  "% de los ingresos del mes" para que las dos pantallas respondan "% de qué" con el mismo
  denominador, fail-soft por ítem en el PDF (`—` y sigue) y el parámetro renombrado a
  `soloPorcentajes`. **Diferencias deliberadas que quedan:** el contexto expone `{ privado }` y no
  `{ oculto }` (renombrar tocaría 8 consumidores sin cambiar nada), y la solapa Patrimonio sigue
  sin cubrir en pantalla (sí su PDF) — está anotada como pendiente, no como hecha. `tsc`: 41
  pre-existentes, 0 nuevos; `vite build` y `functions build` OK.
- F9.121 — Modo privacidad en la solapa Patrimonio (pantalla). Ver
  `docs/prompts/F9.121-privacidad-patrimonio-en-pantalla.md`. Cierra el hueco que dejaron
  F9.119/F9.120: Patrimonio era la única vista donde prender el modo no tapaba nada, y es la que
  más expone. Peor que no tenerlo: ver el ojo tachado y creer que está tapado. **Helper único**
  `useDinero()` junto a `fmtUsd`/`fmtArs` (que no se tocan y siguen puros): `$.usd(n)` devuelve
  el % o el monto, `$.ars(n, tc)` devuelve `''` con el modo activo. Cubre los 35 call sites de
  los 12 componentes. **Desvío de la firma del spec, deliberado:** la base viaja por un contexto
  local (`BaseDineroCtx`) en vez de `useDinero(base)` — 7 de los 12 componentes no reciben `M` y
  varios tienen un total local a mano, que es justo el denominador equivocado; con un provider
  único la base es una sola **por construcción**, que es lo que pide §2. **Base = `M.total`**
  (portfolio invertible), no `patrimTotal`, porque la vista ya muestra chips de % sobre `M.total`
  y con otra base la misma fila daría dos números distintos. Consecuencias aceptadas y
  verificadas: el hero da `100%` y patrimonio total con fijos da `118%`. **Casos no mecánicos:**
  gemelos ARS del hero no se renderizan (nada de líneas vacías); el delta vs corrida previa
  oculta el absoluto y deja su paréntesis, que va sobre otra base; los nominales de Tenencias se
  ocultan (revelan tamaño de posición y no tienen % que signifique algo); la rama `pp` de
  `fmtDelta` no se toca; el TC del día **no** se tapa. **Agregado sobre el spec:** las 3 filas de
  `CompBar` y las de `OpcionCard`/`RiesgoTab`/decisiones ya traían un `pct()` con la **misma**
  base, así que convertir el absoluto habría mostrado el mismo número dos veces — se aplica la
  misma regla de §3 y el absoluto desaparece. **Toggle** del ojo en el header, con el estado del
  `PrivacidadProvider` de `AppShell` (prender en Inicio y venir acá llega tapado), y
  `BasePrivacidad` una sola vez en la cabecera de la vista, que cubre las 8 solapas. El checkbox
  `sinMontos` del informe PDF queda **independiente**, documentado en el código. `tsc`: 41 → 41.
  `vite build` OK. Frontend puro: deploy `--only hosting`.
- F9.122 §1 — CAFCI: unidad única en el benchmark. Ver `docs/prompts/F9.122-cafci-unidades-y-mapeo.md`.
  **Auditoría §0 medida contra producción** (`scripts/auditF9122.ts`, solo lectura): PAMP pesa
  `11.6` en Galileo Acciones con `totalPct = 100.1` → `CafciPosicion.pesoPct` está persistido en
  **escala 0–100**, mientras que `propioPct` se calculaba como fracción. Las dos unidades convivían
  en la misma `FilaBenchmark` y la UI multiplicaba ambas por 100: la columna "Fondos avg" venía
  mostrando **1140%** donde correspondía 11,4%. **Decisión: no se migra Firestore, se convierte al
  leer** — `pesoPct / 100` en `calcBenchmark`, y los campos se **renombran a `...Frac`**
  (`propioFrac`, `fondosAvgFrac`, `fondosMinFrac`, `fondosMaxFrac`, `fondosStdFrac`, `avgFrac`).
  El renombre es el fix real: un campo `...Pct` que guarda una fracción es la trampa que produjo el
  bug, y el nombre es lo único que impide que vuelva. La aritmética de render (`x * 1000 / 10`) no
  cambia: ahora es correcta para las dos columnas. `console.warn` en `calcBenchmark` si algún
  `fondosAvgFrac > 1` (imposible: sería un fondo con el 100% en un solo papel). Nota `¹` al pie de
  la tabla declarando el denominador: el promedio es sobre **todos** los fondos del set, un fondo
  que no tiene el papel computa 0. **Los informes PDF de patrimonio archivados en
  `informesPortafolio` antes de F9.122 tienen la tabla de benchmark con los pesos de fondos
  inflados ×100, y no se regeneran retroactivamente** — se corrige el generador, no lo ya emitido.
  Toca `patrimonioCafci.ts`, `Patrimonio.tsx`, `patrimonioInforme.ts`; frontend puro. `tsc`: 41 → 41.
- F9.92.1 — Resumen: "Revisar pendientes del mes" a check verde en 0 + card Hoy con desglose por
  banco. `PorDiaSeccion`: la fila de pendientes muestra ícono+texto verde "Al día con los gastos
  fijos" (sin badge) cuando `porRevisar === 0`, en vez del badge "0" que no comunicaba nada; con
  `porRevisar > 0` sin cambios (alert-circle rojo + badge numérico). Card "Hoy" suma un desglose
  por banco (`hoyPorBanco`, misma píldora `BankLogo` que "Gastos por día") entre el header y la
  lista de ítems, agregando los `hoyItems` ya conciliados (`ci.matches[0]?.banco`) — usa
  `arsEq(m)` para convertir montos USD (no `Math.abs(m.monto)` crudo, a diferencia del prompt
  original). Pendientes sin match no tienen banco todavía y no entran en el desglose. Frontend puro.
- F9.55.1 — Dashboard Inicio: "Otras" en "Por categoría" expandible. Tap en "Otras"
  despliega las categorías agrupadas (las que quedan fuera del top 6), cada una con su
  estilo normal (barra, monto, %). Cada categoría dentro de "Otras" es a su vez expandible
  y muestra sus subcategorías, replicando exactamente el patrón de las categorías top.
  Implementación: `esOtras` flag; `canDrill` de "Otras" usa `catResto.length > 0`;
  nuevo estado `openOtrasCat: string | null` para la sub-expansión interna; al cerrar
  "Otras" se resetea `openOtrasCat`. Solo modo Lista — Dona y Treemap sin cambios.
  Frontend puro. Deploy: `--only hosting`.
- F9.55 — Dos mejoras: KPIs del Resumen y gráficos del Dashboard.
  1. **KPIs Resumen:** Renombradas "Pesos disponibles" (antes "Disponible (ARS)") y "Falta
     cubrir (USD)" (antes "Resultado (USD)"). La segunda cambia de semántica: ya no es
     `(ingArs − gasArs) / tc` (flujo de caja) sino `(ΣesperadosArsEq − pesosDisp) / tc`
     (brecha de cobertura frente a compromisos del mes). Rojo si > 0 (falta plata); verde
     con texto "Cubierto" si ≤ 0. Ambas tarjetas tienen moneda fija y NO se invierten con
     el toggle ARS/USD (que solo afecta la card "Neto del mes"). `PorDiaSeccion` computa
     `esperadosArsEq` (Σ ítems del checklist, USD items × tc) y `faltaCubrirUsd` y los
     pasa a `KpiCards`. Card HOY suma el total pendiente (ARS eq) en el header: "$ N a
     pagar" si hay pendientes, "Todo pagado" si todos conciliados.
  2. **Gráficos de categorías:** Nueva `src/datos/graficosPrefs.ts` con 9 paletas × 8
     colores (`CHART_PALETTES`) y hook `usePaletaIdx()` que persiste en `localStorage`
     (`gf-chart-paleta`). `DashboardMensual` recibe `paleta: string[]` y asigna colores
     **por rango de gasto** (índice 0 = mayor gasto), no por hash del nombre. La card "Por
     categoría" gana un selector segmentado (Lista / Dona / Treemap); el tipo persiste en
     `gf-chart-tipo`. Dona: `conic-gradient` CSS con top-4 + "Otras"; aguja central
     muestra el % del top-4. Treemap: binary-split recursivo (`tmLayout`), coordenadas en
     espacio 100×60 con `paddingBottom:60%` para relación de aspecto fija sin ResizeObserver.
     Nueva pantalla `src/vistas/perfil/GraficosConfig.tsx` con el selector de paleta
     accesible desde Perfil › Personal › "Gráficos" → `/perfil/graficos`.
- F9.95.1 — Patrimonio: agenda macro día por día (IA). **Nuevo modo `'agenda'` en la Cloud Function `analizarConIA`:** `buildPromptAgenda(contexto)` arma el prompt con checklist de cobertura por driver (CER/tasas AR/soberano/energía AR/resultados/Fed/cripto/impositivo), `web_search` con max_uses 5, output JSON `{ eventos: [{ fecha, evento, driver, porQueImporta }] }`, max_tokens 4000. Regla Firestore: `agendaMacro/{autoId}` con `allow read, write: if esDueno()`. **`patrimonioIA.ts`:** tipos `EventoAgenda`, `AgendaMacro`; `cargarUltimaAgenda()` (orderBy desc, limit 1); `generarAgenda(contexto)` callable wrapper. **UI (`Patrimonio.tsx`):** botón "Actualizar agenda macro" en `CalendarioCard` (Research tab) con fecha de la última generación; deshabilitado + hint si toggle IA off; `handleGenerarAgenda()` arma el contexto de exposición desde `M.bySector`; `agenda` en estado + `cargarUltimaAgenda()` en useEffect. **Render fusionado:** `buildEventosCal` mezcla eventos de posición (chip = ticker) con eventos macro (chip = driver label: CER/Soberano/Fed/Tarifas/Earnings/etc.); `porQueImporta` como subtítulo gris. **PDF (F9.95 sección 11):** incluye macro fusionado con chip de origen + fecha de agenda.
- F9.95 — Patrimonio: calendario de eventos (agregado de análisis IA). **Shape `proximosEventos` estructurado:** `buildPromptPosicion` cambia de string[] a `[{ cuando: "YYYY-MM-DD"|"YYYY-MM"|null, evento: string }]`. Retrocompat: strings sueltos tratados como `{ cuando: null, evento }` en toda la UI y el PDF. **`patrimonioIA.ts`:** tipo `EventoProximo = { cuando: string|null; evento: string } | string`; `normalizarEventoProximo(e)` helper exportado. **`CalendarioCard` (Research tab):** agrega `proximosEventos` de todos los docs de `analisisPosiciones`; ordena por `cuando` asc (YYYY-MM como ~primer día del mes); eventos sin fecha al final en bloque "Sin fecha"; eventos pasados > 30 días atenuados (opacity 0.45) y al final — decisión documentada. Cada fila: fecha · evento · chip ticker gris · antigüedad del análisis en gris. Empty state: "Generá análisis de posiciones para poblar el calendario." **`Patrimonio.tsx`:** `cargarTodosLosAnalisis()` en useEffect inicial para poblar `analisisCache` desde Firestore (también mejora la solapa Tenencias, que ya muestra análisis cacheados sin necesidad de generarlos). **PDF:** sección 11 "Calendario de eventos" (tabla fecha/evento/origen) entre Análisis por posición (10) y Panorama sectorial (12); omite eventos pasados >30d; omite sección limpiamente si no hay eventos. Renumerado: Panorama sectorial → 12, Metodología → 13.
- F9.94 — Patrimonio: diario de decisiones (registro + revisión 30/90 d). **Principio innegociable:** el sistema registra y contrasta decisiones; nunca las puntúa — los deltas se muestran en tipografía neutra (sin semántica de color verde/rojo); la evaluación la hace el dueño. **Nueva colección Firestore:** `decisionesPatrimonio/{autoId}` con campos `titulo`, `razon`, `tickers`, `opcionReferencia`, `metricasAlCrear` (snapshot completo de métricas al momento de crear), `revisiones[]` (tipo `'30d'|'90d'`, fecha, notas, metricasAlRevisar), `estado` (`abierta|revisada30|revisada90|cerrada`). Regla: `allow read, write: if esDueno()`. **`src/datos/patrimonioDecisiones.ts` (nuevo):** tipos `MetricasSnap`, `RevisionDecision`, `DecisionPatrimonio`, `NuevaDecision`; CRUD `cargarDecisiones()`, `crearDecision()`, `agregarRevision()` (usa `arrayUnion`); helper exportado `revisionPendiente(d)` — evalúa 90d primero, luego 30d, devuelve `'90d'|'30d'|null`. **Patrimonio.tsx:** `buildMetricasSnap(M, todasPosiciones)` helper que construye el snapshot; tres componentes nuevos: `ModalRegistrarDecision` (bottom sheet: titulo requerido + razon + tickers opcional; muestra badge si viene de OpcionCard + línea de métricas actuales), `ModalRevision` (tabla entonces→hoy con 6 métricas + filas por ticker, deltas neutros `color:var(--color-text-sec)` sin verde/rojo, dos textareas guardadas como `notas`), `DiarioDecisiones` (Card al pie del Plan tab: acordeón expandible por decisión, badge ámbar "revisión Nd" con reloj si hay revisión pendiente, "Revisión 30d omitida" si se pasó al 90d sin hacer la 30d, botón "Iniciar revisión"); `OpcionCard` suma prop `onRegistrarDecision` + botón "Registrar decisión" (solo tickers tipo `'ticker'` en el preload — A: TRAN+PAMP; B/C: cortes de sector, sin preload). **Plan tab:** dot ámbar 6×6 `#f59e0b` sobre el tab cuando `pendingReviewCount > 0`; `DiarioDecisiones` al pie. **`src/datos/patrimonioInforme.ts` (PDF F9.92):** nueva sección 9 "Decisiones registradas" entre Opciones (8) y Análisis IA (renumerado a 10); filtra decisiones `abierta` o con revisión en los últimos 90d; muestra título, etiquetas, razón (truncada 200 ch), deltas por revisión + notas (truncadas 300 ch); se omite limpiamente si no hay decisiones relevantes. Secciones renumeradas: Panorama sectorial → 11, Metodología → 12.
- F9.93.2 — Patrimonio: solapa Configuración + cosmética hero + fix Storage. **§1 Storage fix:** `storage.rules` agrega `match /patrimonio/informes/{archivo}` (PDF < 10MB, solo lectura/escritura auth, no delete) — requiere `firebase deploy --only storage`. **§2 Configuración (6ª solapa, ícono engranaje):** posiciones manuales + activos fijos movidos desde Resumen; toggle IA movido desde Research; 2 placeholders futuros (precios de referencia y edición manual). `Icon.tsx` agrega `settings-2`. Tab bar usa `flex: none` + ícono solo para la 6ª tab. **§3 Composición sector en Resumen:** `CompBar` con `UMBRAL_OTROS = 0.019` — ítems < 1.9% agrupados en "Otros (n)" expandible (tap). Agregada entre Riesgos y Evolución. **§4 Hero reorganizado:** arriba = portfolio invertible (grande, USD + ARS + delta inline); divider; abajo = patrimonio total (atenuado, USD + ARS + fecha); TC al pie de la card. **§5 Dashboard:** eliminado `{c.count}` en "Por categoría" (mes) y `{x.count}` en "Por descripción"; card "Mov. más alto" centrada.
- F9.93.1 — Patrimonio: wording condicional en análisis IA. Reemplaza `senalesAVigilar` por `queHariaEnCadaCaso` en `buildPromptPosicion` (JSON estricto: 2-4 casos observables, cada uno `{ caso, acciones[], costo }`). `buildPromptSectorial` agrega bloque "qué haría en cada caso" por sector (texto libre). Regla nueva: PROHIBIDO imperativos sin condición; PERMITIDO condicionales con opciones + trade-off. UI `AnalisisIASection` en Patrimonio.tsx: nueva sección mini-cards — condición en negrita, opciones como lista, costo en gris. Retrocompat: si el caché trae el campo viejo `senalesAVigilar` lo sigue renderizando. `AnalisisPosicion.resultado` en `patrimonioIA.ts` tipado con ambos campos opcionales.
- F9.93 — Patrimonio: análisis IA por posición + sectorial. Cloud Function callable `analizarConIA` (Anthropic claude-sonnet-4-6, web_search habilitado, max_tokens 1500/3000, solo dueño). **Toggle:** doc `configPatrimonio/ia` → `{ habilitado: bool }`, editable con switch en solapa Research. **Caché:** `analisisPosiciones/{ticker}` (sobrescribe previo) y `analisisSectorial/{autoId}`. **Output posición:** JSON estricto con `queEs`, `situacionActual`, `riesgos`, `rolEnCartera`, `proximosEventos`, `senalesAVigilar`, `fuentes`. **Output sectorial:** texto libre. **UI Tenencias:** sección "Análisis IA" en cada acordeón por ticker — sin caché: botón "Generar análisis" (deshabilitado si toggle off); con caché: secciones renderizadas + antigüedad en días + botón "Regenerar". **UI Research (nueva 5ª solapa):** toggle activar/desactivar IA + botón "Analizar lote" (modal confirmación, barra de progreso, errores por ticker no frenan el lote) + card "Panorama sectorial" con botón Generar/Regenerar y texto del último con fecha. **Client wrapper:** `src/datos/patrimonioIA.ts` — `analizarPosicion()`, `analizarSectorial()`, `cargarConfigIA()`, `guardarConfigIA()`, `cargarUltimoSectorial()`, `cargarTodosLosAnalisis()`. **Firestore rules:** `analisisPosiciones`, `analisisSectorial`, `configPatrimonio` → `allow read, write: if esDueno()`. **Íconos nuevos en Icon.tsx:** `flask-conical`, `zap`, `toggle-left`, `toggle-right`. Sin llamadas automáticas; el PDF (F9.92) lee solo el caché.
- F9.92 — Patrimonio: informe PDF completo bajo demanda + archivado. **pdfmake** agregado a `package.json` (`^0.2.12`; correr `npm install`; carga lazy via dynamic import — no impacta el bundle principal). **`src/datos/patrimonioInforme.ts`:** `generarYArchivarInforme(params)` — construye 12 secciones (portada · resumen ejecutivo · evolución · composición · tenencias completas por cuenta · métricas+semáforos · liquidez · estrés · opciones · análisis IA cacheados · sectorial · metodología); descarga local del PDF + upload a Storage (`patrimonio/informes/{fechaCorrida}-{timestamp}.pdf`) + doc en `informesPortafolio/{autoId}` con `downloadURL` persistida; lee caché `analisisPosiciones` y `analisisSectorial` directamente; secciones 10 y 11 se omiten limpiamente si no hay análisis IA. `cargarInformesAnteriores(5)` — lista informes archivados con URL de descarga directa. **`PatMetrics`** movido a `src/types/patrimonio.ts`. **UI ResumenTab:** botón "Generar informe PDF" + card "Informes anteriores" con fecha de corrida, fecha de generación y link de descarga. **StressResult/OpcionResult** computados en el componente padre y pasados como parámetros (sin duplicar lógica). Solo dueño, sin tocar el lado gastos.
- F9.91.1 — Patrimonio: Tenencias consolidadas por ticker con desglose por cuenta al tap. Reemplaza la lista plana (~50 filas) por una lista de tickers únicos ordenados por valor USD desc. Cada fila muestra ticker, dot de sector, valor consolidado, % del invertible, contador "N cuentas" si > 1, badge `MANUAL` si algún componente es manual, dot ámbar si hay `revisar` o valuación stale. Tap en la fila abre acordeón con sub-filas por cuenta: cuenta, titular, cantidad (nom.), badge `MANUAL · DD/MM` o `REVISAR`. Múltiples acordeones abiertos en simultáneo. Pie de lista con total invertible que cuadra con el hero. Gancho F9.93: `data-f993-ticker` en cada acordeón (no implementado). `ChevronUp` agregado a `Icon.tsx`. Sin duplicar lógica de suma: usa `valorUsd` ya calculado de cada `Posicion`/`PosicionManual`. Frontend puro.
- F9.91 — Patrimonio: opciones medidas + escenarios de estrés + evolución. **Plan:** reemplaza palancas de texto estático por 3 opciones calculadas (A: recorte mínimo TRAN/PAMP → RV global; B: energía AR al 35% → mitad AR otros/mitad global; C: energía AR 25% + cripto 15% → RV global). `simularOpcion()` función pura: escala posiciones afectadas, agrega posiciones virtuales de redespliegue, corre `calcMetrics` sobre el portfolio ajustado — muestra movimientos USD/%, métricas antes→después con semáforo de color, y riesgos de cada opción. Config de opciones en `OPCIONES_CONFIG` (fácil de ajustar). **Riesgo:** card "¿Qué pasa si...?" con 4 escenarios (corrección energía AR −30%; invierno cripto −50% exc. stablecoins; evento soberano AR −40%/−25%/−30%; tormenta perfecta = soberano+cripto juntos). `calcStress()` aplica shocks y muestra pérdida USD, % del portfolio y total resultante. Shocks en `STRESS_ESCENARIOS`. **Resumen:** variación Δ USD + Δ% vs corrida anterior justo bajo el hero; card "Evolución" con la serie de snapshots (fecha · total invertible · Δ% vs anterior); nota metodológica "no descuenta aportes ni retiros". `cargarHistorialSnapshots(10)` nuevo en `patrimonio.ts`. Sin API, sin dependencias nuevas. Frontend puro.
- F9.90.2 — Patrimonio: Resumen sin bloque "Recomendaciones" + chips de riesgo con fondo neutro. `ResumenTab` pasa a ser: hero negro → Riesgos principales (3 semáforos) → Posiciones manuales → Activos fijos (sin el bloque de palancas numeradas). `SEM.amarillo.bg` y `SEM.rojo.bg` cambian de fondos teñidos a `var(--gf-gray-100)` — el color queda solo en el dot, reduciendo la carga visual. En la solapa Plan, el label "Palancas de rebalanceo" pasa a "Opciones" (alineación con el término que usará F9.91). Ningún texto visible de Patrimonio dice "recomendación/recomendamos". Frontend puro.
- F9.90.1 — Patrimonio: posiciones manuales (planes de empleado sin API). Nueva colección `posicionesManuales/{id}` con seeds: ACN 50 acc (USD 6870, 02/07/2026) y GLOB 50 acc (USD 1626, 03/07/2026). **Diferencia clave vs `activosFijos`:** entran al análisis de riesgo — se fusionan con la corrida vigente en `calcMetrics` (métricas, semáforos, HHI). `manualToPosicion()` convierte `PosicionManual` a `Posicion` para el motor de métricas. Concentración por ticker: `calcMetrics` ahora agrega por ticker (`byTickerAll`, `byTickerNoCripto`) para que GLOB CEDEAR + GLOB manual se sumen al calcular top1/top3/top5/HHI. `PatMetrics.nombreTop` cambia de `Posicion` a `{ ticker: string }`. Hero = invertible (corrida + manuales) + fijos. `PatrimonioIngesta` recibe `totalManualesUsd` y lo pasa a `confirmarIngesta`; el snapshot guarda `totalCorridaUsd`, `totalManualesUsd`, `totalInvertibleUsd` (suma de ambos). UI: card "Posiciones manuales" en Resumen (lápiz/+ igual que fijos) + hint ámbar si `fechaValuacion < fechaCorrida`; en Tenencias aparecen como filas normales con badge `MANUAL` + "valuado DD/MM". Reglas Firestore: `posicionesManuales` con `allow read, write: if esDueno()`. Sector `tech` → `Tecnología` en `SECTOR_DISPLAY`. Cuando el dueño recupere las credenciales, estas cuentas pasan al `.txt` como fuentes normales y las manuales se eliminan.
- F9.90 — Patrimonio: ingesta .txt + activos fijos editables + doble lente. Elimina el mock (`PAT_POS`, `PAT_META`, `PAT_BIENES`); los datos reales vienen de Firestore.
  **Tipos:** `src/types/patrimonio.ts` — `PosicionRaw`, `Posicion`, `MetaCorrida`, `CorraidaJSON`, `ActivoFijo` (NO mezclar con `src/types/index.ts`).
  **CRUD Firestore:** `src/datos/patrimonio.ts` — `cargarSnapshotVigente`, `cargarPosicionesVigentes`, `cargarActivosFijos` (seed si vacío: propiedad USD 220k + auto USD 10k), `guardarActivoFijo`, `eliminarActivoFijo`, `confirmarIngesta` (writeBatch atómico).
  **Ingesta 3 pasos (`src/vistas/PatrimonioIngesta.tsx`):** (1) file input .txt/.json → parse JSON; (2) validador manual TypeScript (sin ajv), checksum `meta.total_declarado_usd` vs suma calculada con TC real — warning si >1% de diferencia, no bloqueante; (3) confirm: total USD calculado, posiciones count, cuentas, TC usado, `revisar:true` destacados ámbar, diff vs corrida previa (nueva/baja/Δ). Botones Confirmar / Cancelar.
  **`Patrimonio.tsx` reescrito:** carga posiciones + activos fijos desde Firestore; empty-state con CTA si no hay corrida; botón "Actualizar posiciones" en cabecera. `calcMetrics(posiciones[])` recibe el array (ya no interno). `sectorDisplay(sector, pais_riesgo)` mapea sector crudo + país a display name (`energia`+AR→`Energía AR`, `cer_pesos`→`Renta fija AR`, etc.). `SECTOR_COL` keyed por display name. Lente invertible: semáforos, HHI, top-3/5 sobre posiciones financieras únicamente. Hero negro = patrimonio total (invertible + fijos) con desglose inline. Card Activos fijos en Resumen con edición modal (valorUsd + notas + alta/baja). MerchantLogo usa `ticker` como nombre.
  **Reglas Firestore:** función `esDueno()` = `esAdmin() && email.lower() == 'jpcofano@gmail.com'`; colecciones `posicionesPatrimonio`, `snapshotsPortafolio`, `activosFijos`, `informesPortafolio` con `allow read, write: if esDueno()`. Aislamiento total del scope de gastos.
  **TC:** `tcParaFecha(Date)` para convertir posiciones ARS durante la ingesta; `cargarTCReciente(1)` para el hero display. `tcUsado` guardado por posición ARS para trazabilidad.
  **Corrida vigente:** snapshot más reciente en `snapshotsPortafolio`; posiciones anteriores NO se borran (historial). `fechaCorrida` como campo en cada `Posicion` y como ID en `snapshotsPortafolio`.
- F9.87 — Navegación: Perfil vía avatar; Patrimonio en 4º slot del bottom-nav (gated a `jpcofano@gmail.com`).
  Avatar del header (ya existía, F9.70) navega a `/perfil`. Bottom-nav reorganizado: `NAV_BASE` (Inicio/Resumen/Cargar)
  más 4º slot condicional — `NAV_PATRIMONIO` (landmark, `/patrimonio`) para el dueño, `NAV_PERFIL` (user-round, `/perfil`)
  para el resto (otros admin, dependientes). Ruta `/patrimonio` reemplaza `/perfil/patrimonio` (ya no es sub-pantalla de
  Perfil sino tab de primer nivel); `TITULOS_PERFIL_SUB` pierde la entrada de patrimonio; `tituloDeRuta` maneja
  `/patrimonio` directamente. Para el dueño, estar en `/perfil` o sub-pantallas no resalta ningún tab (Perfil ya no es
  tab). Perfil.tsx actualiza el link de Patrimonio a `/patrimonio`. Gate de ruta (`esDueno && <Route path="/patrimonio">`)
  sin cambios. Frontend puro.
- F9.88 — Notificaciones: inclusión por estado del checklist, no por `diaVencimiento`.
  `recordatoriosEsperados` reescrita: ya no filtra `item.diaVencimiento == null` — incluye todo ítem
  cuyo estado del checklist sea `pendiente | vencido | por_confirmar | parcial` (lista local
  `ACCIONABLE_NOTIF`, excluye `no_registrado` de meses pasados). `diaVencimiento` pasa a ser opcional:
  si existe se construye la fecha y se aplica la ventana de 14 días; si no existe el ítem es "esperado
  del mes" (siempre visible, va como `proximo` o `vencido` según estado). `Recordatorio.fecha: Date | null`;
  `RecordatorioRow` muestra número de día + mes cuando hay fecha, o punto de color + "Este mes" cuando
  no. Sort: vencido → hoy → proximo; dentro de proximo, con-fecha primero (por día), sin-fecha al final.
  `contarVencProximos` no se infla (los sin-día van como `proximo`). `console.debug` de F9.86 eliminado.
  Frontend puro. Deploy: `--only hosting`.
- F9.86 — Notificaciones vacías pese a haber vencimientos en los próximos 14 días: diagnóstico de datos,
  no de ventana (la ventana de 14 días es correcta). Log temporal `console.debug('[notif]', ...)` agregado
  en `useRecordatorios` (Notificaciones.tsx) con conteos de items/movimientos/resumenes/recEsperados/
  recTarjetas para identificar en qué paso devuelve 0. El fix concreto depende del log: desalineación
  de nombre de campo `diaVencimiento` vs Firestore, ítems sin `diaVencimiento` cargado, o ítems
  marcados cubiertos de más. Sacar el log una vez resuelto. → Resuelto en F9.88.
- F9.85 — Dashboard: subtítulo de la card "Top 3 categorías" corregido de "Mes en superávit" (heredado
  del kit, incorrecto) a "del gasto del mes" (describe el valor real: concentración del gasto en las
  3 mayores categorías). Cambio de 1 línea en `src/vistas/Dashboard.tsx`. Frontend puro.
- F9.84 — Patrimonio: vista privada de portafolio de inversiones, gateada a `jpcofano@gmail.com`
  (`esAdmin` + email exacto). Esqueleto de UI + motor de métricas determinístico en front con datos mock
  de la foto real ~USD 111k al 01/07/2026. `src/vistas/Patrimonio.tsx` (sub-pantalla de Perfil en
  `/perfil/patrimonio`). Tipo `Posicion` propio (NO reusar tipos de gastos). 4 solapas:
  **Resumen** (hero oscuro + total USD + eq ARS vía `tcDiario` + barra apilada por sector);
  **Tenencias** (posiciones agrupadas por sector, chip ticker + tipo/país/moneda + valorUsd + %);
  **Riesgo** (5 métricas con semáforo UCITS/HHI: nombre top excl. cripto · sector · país · cripto clase · HHI;
  Top-3/Top-5; % RV informativo sin semáforo);
  **Plan** (idea madre + 4 palancas de rebalanceo + disclaimer). Motor `calcMetrics()` determinístico:
  total, bySector, byTipo, byPais, top1/3/5, HHI, sectorTop, paisAr, cripto, rvPct.
  Bandas semáforo: nombre ≤5/10% · sector <25/40% · país <40/60% · cripto <10/20% · HHI <0,15/0,25.
  % RV sin semáforo (la postura busca RV alta). Ícono `landmark` agregado a Icon.tsx.
  Datos: `PAT_POS` mock (15 posiciones, foto real); TC real de `cargarTCReciente(1)`, fallback `TC_DEFAULT`.
  Fuera de alcance en este prompt: ingesta .txt, colección `posiciones`, Firestore rules, Functions.
  Puntero al contrato completo: `docs/patrimonio/CLAUDE-PATRIMONIO.md` (ver §Anexo: Patrimonio).
- F9.84.1 — Patrimonio: variante A fija (no toggle). Resumen reemplazado: hero oscuro + 3 riesgos semáforo
  (HeadlineSem: Nombre top excl. cripto · Sector top · Cripto clase) + primeras 3 palancas de rebalanceo
  (cards numeradas) + Patrimonio total al pie (portafolio + Depto USD 220k + Auto USD 10k ≈ USD 341.5k;
  bienes fuera del análisis de riesgo). `PAT_BIENES` constante nueva. Tenencias gana CompBar arriba +
  `MerchantLogo` (fallback monograma) en lugar del ticker-box. `MerchantLogo` importado. Frontend puro.
- F9.89 — Dashboard Inicio: dos ajustes cosméticos. (1) Top subcategorías: barras 13px/borderRadius 7
  (antes 6px/3px), escaladas al máximo de la lista (`Math.max((valor/maxSub)*100, 4)%`). (2) Card
  "Top 3 categorías": contenido centrado (`textAlign:'center'`), valor 22px fontWeight 800,
  subtítulo "del gasto del mes". Frontend puro.
- F9.83 — Backfill: `scripts/seed/backfillCategoriaCanonica.ts`. Completa `categoria` en movimientos
  que tienen `subcategoria` seteada pero `categoria` vacía/null o inconsistente. Fuente de verdad:
  `/subcategorias` (campo `valor` → `categoriaPadre`) + `config/familia.categorias` (activas).
  Normalización NFD+lowercase para el lookup. Tres grupos en dry-run: (1) A completar — se escriben
  con `--apply`; (2) Revisión manual — subcat sin match en taxonomía, loguear para decidir; (3) Sin
  subcategoría ni categoría — no tocar. Batches ≤ 450, idempotente.
  Uso: `tsx scripts/seed/backfillCategoriaCanonica.ts` (dry-run) → `--apply` → prod con `--target=production --apply --i-am-sure`.
- F9.82.1 — Hotfix pase débil: índice compuesto `destinos (tipo ASC, confianza ASC)` agregado a
  `firestore.indexes.json`; `cargarNombresDestinoAprendidos()` envuelta en try/catch fail-soft —
  si el índice aún no existe o hay error de permisos, el pase débil continúa sin alias en vez de
  abortar todo el match. Deploy: `firebase deploy --only firestore:indexes` → `npm run build` en
  functions → `firebase deploy --only functions`.
- F9.82 — Conciliación pago↔obligación: pase débil + picker + alias-learning.
  **Bloqueos resueltos en `reconciliarPorPayee` (`matchLogica.ts`):** (1) ya no corta con `return []`
  si no hay CUIT/CBU/alias — ahora llama al nuevo pase débil por nombre; (2) comparación de monto
  cambiada de `m.monto` exacto a `montoSalda()` que también evalúa `m.vencimientos[].monto` (cierra
  el caso 2º vencimiento). `MovimientoMin` suma `destinoNombre` y `vencimientos` (mapeados en el bloque
  de `movs` de `matchComprobante`). **Pase débil (`reconciliarPorNombre`):** nueva función exportada que
  matchea por nombre normalizado y/o `itemEsperadoId` aprendido en `/destinos tipo='nombre'`; NUNCA
  auto-confirma: el caller lo escribe como rama 1 `candidatos` con `reconciliacionDebil:true`. Corre
  después del pase fuerte con 0 candidatos; helper `cargarNombresDestinoAprendidos()` carga hasta 500
  entradas `tipo='nombre' && confianza≥0.7` de `/destinos`. **Merge conservador en `confirmarRama1`
  (`comprobantes.ts`):** campos `destinoCbu/Cuit/Alias/Nombre/vencimientos` solo se escriben si el pago
  los trae (antes pisaban con null el payee fuerte de la factura). **Alias-learning (`aprenderDestino`,
  `index.ts`):** cuando la llave principal es CBU/CUIT/alias y hay `destinoNombre`, inserta una entrada
  adicional `tipo='nombre'` en `/destinos` para que el pase débil lo encuentre el mes siguiente.
  **`PropuestaMatch` gemelo** (functions `matchLogica.ts` + cliente `types/index.ts` + `docAComprobante`):
  suma campo `reconciliacionDebil?: boolean`. **Picker "Conciliar con gasto esperado" (`Comprobantes.tsx`,
  admin-only):** aparece en pagos (transferencia/comprobante_pago) con propuesta rama 2/3; lista ítems
  activos del mes ordenados; al confirmar busca obligación abierta con `buscarObligacionAbierta()` (nueva
  query `itemEsperadoId + confirmadoPago==false + mes`) — si la encuentra llama `confirmarRama1` (sin
  movimiento nuevo), si no llama `cargarMovimientoDesdeComprobante` con `itemEsperadoId` prefijado.
  Candidatos débiles reusan la UI de candidatos rama 1 con badge ámbar "Posible pago de factura".
  **Pendientes que F9.82 NO resuelve:** actualizar monto del movimiento al del 2º vencimiento al conciliar
  (decisión pendiente de Juan); "AYSA" vs "Agua y Saneamientos Argentinos S.A." no matchea por includes
  (primera vez siempre es picker manual; alias-learning cierra el gap desde el 2º mes).
  Deploy: `cd functions && npm run build` → `firebase deploy --only functions,hosting`.
- F9.81 — Migración `reasignarPersonaColegio.ts` (script en `scripts/seed/`): reasigna
  `persona` de movimientos e `itemsEsperados` donde algún campo normalizado contiene
  "colegio" y `persona ∈ {Federico, Sofía}` → `persona = 'Juan'`. Dry-run por defecto;
  `--apply` para escribir; `--target=production --apply --i-am-sure` para prod.
  Mismo patrón que backfillPersonaMemberId.ts (F9.24): batches ≤ 450, idempotente,
  valida IDs contra `config/familia.miembros` al arrancar. Cubre también `itemsEsperados`
  para que el prellenado de nuevos gastos de colegio sugiera al padre (no al hijo).
  Privacidad: los dependientes solo ven movimientos con `where('persona','==',memberId)`;
  reasignar persona es la única forma de ocultarles un gasto sin borrar ni agregar Rules.
  No es cambio de UI — solo migración de datos.
- F9.80 — Notificaciones (repo) al diseño del kit: grupo "Vencidos · N" con header rojo uppercase
  FUERA de la Card (antes adentro con estilo interno); card "Próximos 14 días" con badge de conteo
  ámbar si ≥1 / gris si 0, filtrando `ventana = hoy + proximo` (antes `estado !== 'vencido'` que
  coincide pero es menos explícito). `RecordatorioRow` reescrita como `<button>` con prop `last`
  (sin border-bottom en la última fila); helpers `MES_CORTO`/`ICONO_REC`/`LABEL` por id-prefix y
  estado; layout rico: punto de estado (8×8) + número de día grande (17px bold) + mes (9px) +
  icono tipo (13px) + título + sub + montos + Badge. `flexShrink:0` en el badge de conteo.
- F9.79 — Confirmar comprobante: badges Pre-clasificado/Gasto esperado persisten del splash al Hero.
  `Hero` en `CaptureModal.tsx` gana prop `badge?: ReactNode` (entre desc y tags).
  `AltaMovimiento` gana prop `badgePropuesta?: ReactNode` pasada al Hero.
  `PropuestaCard` en `Comprobantes.tsx` construye el par de píldoras inline (ámbar sparkles
  Pre-clasificado + verde/neutral git-compare/plus Gasto esperado/Movimiento nuevo) y las pasa
  como `badgePropuesta` al `<AltaMovimiento>`.
- F9.78 — Inicio: fix toggle "Por categoría" (Dona/Treemap no renderizaban: `pie-chart` y
  `layout-grid` faltaban en el mapa curado de `Icon.tsx`; agregados `PieChart`+`LayoutGrid`).
  Botones del segmentado muestran icono+label. Top subcategorías rediseñado a estilo lista de
  categorías: punto+nombre izquierda, monto+% derecha, barra full-width debajo escalada al máximo.
- F9.77 — Notificaciones a paridad del kit: segmentado Inactivo/Activo con botones separados
  (div+buttons en vez de button+spans); grupo "Vencidos · N" con header rojo aparece cuando hay
  vencidos; card "14 días" con badge ámbar/gris (≥1/0) + filas dentro de la card; row rediseñada:
  día-número + ícono tipo (credit-card/receipt) + badge "En N días"/"En 1 día"/"Hoy"/"VENCIDO".
  CalendarSyncRow no-admin: copy "Calendario compartido · lo activa un administrador.".
  `toggle` acepta valor explícito (no-op si ya activo). `LABEL`/`fmtFechaCorta` removidos.
- F9.76 — Widget "Hoy" (Resumen) deriva pagado/pendiente de `cubierto(ci.estado)`, no de
  `matches.length`. Un `por_confirmar` (recibo cargado, impago tras F9.75) ya no se pinta
  "Conciliado/Todo pagado" ni se descuenta del total a pagar; muestra estado ámbar "a confirmar".
  Filas del checklist principal y ShareLanding sin cambios.
- F9.75 — Obligaciones (`recibo_servicio`, `factura_a/b/c`) no se marcan pagadas por vencimiento.
  `cargarMovimientoDesdeComprobante` gatea `pagadoPorFecha` con `esObligacionDoc(tipoDoc)`; una
  obligación crea el movimiento con `confirmadoPago=false` siempre y `estadoItem` la muestra
  `por_confirmar` hasta que el pago real reconcilia por payee. Pagos/tickets/altas manuales sin
  cambios. `esObligacionDoc` gemelo server (`index.ts`) + cliente (`comprobantes.ts`). Limitación
  conocida: `mes < mesActual` sigue forzando `pagado` (vista histórica, fuera de alcance).
- F9.74 — `matchTexto` case-insensitive. `evaluarMatchTexto` (server, `matchLogica.ts`) y
  `checklist.ts` (cliente) bajaban a minúscula el texto objetivo pero NO el patrón de
  `incluye`/`excluye`; `String.includes` es case-sensitive → un patrón con mayúsculas nunca
  matcheaba (ej. Expensas `"Cons. Prop. Pje del Signo"` caía a rama 3). Fix: `p.trim().toLowerCase()`
  en ambos lados, en los dos sitios (deuda gemela). `clasificador.ts` (diccionario legacy) ya
  estaba OK, no se tocó. **Invariante:** los patrones de matchTexto se comparan siempre
  normalizados a minúscula y trim; si el editor algún día normaliza on-write, esto sigue siendo
  la fuente de verdad para datos viejos.
- F9.73 — Logos de comercios vía Brand Search API (async).
  **`src/datos/comerciosLogos.ts`** (nuevo): reemplaza el lookup sync de `comerciosDominios.ts` con un resolver
  async de 3 capas: (a) override curado (`COMERCIOS_DOMINIOS`), (b) Brand Search API (`GET /v2/search/{nombre}?c=CID`,
  elige best candidate por `verified → claimed → qualityScore`) y (c) null. Guard `pareceComercio()` evita llamadas
  para personas/transferencias P2P. Dual-cache: `Map<string, string|null>` en memoria + `localStorage` con prefijo
  `gf-logo:`. **`MerchantLogo`** reescrito: `useEffect` llama `logoDeComercio(nombre)` (async), muestra monograma
  mientras resuelve o si falla. `comerciosDominios.ts` inalterado. Frontend puro. Deploy: `--only hosting`.
- F9.72 — Resumen: detalle del día con MerchantLogo.
  Filas de movimientos en el panel expandible del día (F9.53) ahora muestran `<MerchantLogo nombre={m.descripcion}
  size={30} radius={8} />` antes del texto. Línea secundaria actualizada: `medioCanonico(m.banco) · m.subcategoria`
  (antes: `categoria › subcategoria`). Monto del movimiento en su moneda nativa; si USD y hay `tcUsdArs`, muestra
  ARS-eq debajo (`fmtArs(arsEq(m))`). Import de `MerchantLogo` agregado a `Resumen.tsx`. Frontend puro.
  Deploy: `--only hosting`.
- F9.71 — Resumen: "Neto del mes" rediseñado (centrado, 3 valores con eq).
  `KpiCards` (card oscura ink): `textAlign:center`. Fila superior: eyebrow "Neto del mes", valor grande (`fontSize:34`,
  fontWeight 800, signo +/−) en la moneda del toggle, eq en la otra moneda debajo (`fontSize:14`). Fila inferior
  separada por `borderTop`: dos columnas Ingresos (verde `--gf-emerald-100`) y Gastos (rojo `#fca5a5`), divididas
  por `borderLeft rgba(255,255,255,.12)`; cada columna tiene label eyebrow + valor (`fontSize:19`) + eq (`fontSize:12`).
  Helpers: `fmt(v)` = moneda toggle, `fmtOtra(v)` = la otra; `ingSmall`/`gasSmall` agregados. Tarjetas de abajo
  ("Pesos disponibles" / "Falta cubrir") sin cambios. Frontend puro. Deploy: `--only hosting`.
- F9.70 — Header global: cluster avatar · luna · campana.
  `AppBar` ya no renderiza `ThemeButton` internamente (`ThemeButton` permanece en el archivo pero no se usa en JSX).
  `ShellFrame` llama `useTheme()`, `useRecordatorios()`, `contarVencProximos()` y construye `globalRight`:
  (1) botón "Tarjetas" condicional (solo en `/resumen` + esAdmin); (2) avatar-inicial circular (ink) → navega
  a `/perfil`; (3) toggle dark/light (ícono sol/luna); (4) campana → `/perfil/notificaciones`, con badge rojo
  `vencN > 0` (posición `absolute`, `border: 2px solid var(--color-surface)` para halo). `right={globalRight}`
  se pasa a `AppBar` en todas las pantallas. Frontend puro. Deploy: `--only hosting`.
- F9.69 — Dashboard Mensual: Top subcategorías reescalado + KPIs centrados + toggle parity.
  **Top subcategorías:** barras reescaladas al máximo real de la lista (`maxSubVal = max(s.valor)`, ancho =
  `max(valor/maxSubVal*100, 5)%`) dentro de un track gris con `overflow:hidden`. Eliminada la deformación
  por factor fijo `pct*2.6`. `overflow:hidden` agregado al contenedor del chart de Evolución diaria
  para evitar que la línea de promedio diario (absoluta) desborde visualmente a la card de arriba.
  **KPIs centrados:** componente `Kpi` gana `textAlign:'center'` en la Card y prop `center` en `Eyebrow`
  (`justifyContent:'center'`). Valor ya tenía `nowrap+ellipsis`. La tira compacta de 3 KPIs ya tenía
  `textAlign:'center'` — sin cambios allí. **Toggle parity:** el segmentado Lista/Dona/Treemap ya
  matcheaba el kit; no requirió cambios. Frontend puro. Deploy: `--only hosting`.
- F9.68 — Dashboard: "Por categoría" drilleable + % sobre total (Mensual y Anual).
  **Datos:** `CategoriaSlice` suma `subs: { nombre: string; usd: number }[]` (subcats de esa categoría,
  desc por usd). `agregarMensual` computa `catSubMap` en el mismo loop que `catMap` y puebla `subs` por cat.
  **% sobre total:** Mensual y Anual muestran chip pill-gris con `%` junto al monto de cada categoría y
  subcategoría. `pct = Math.round(usd/total*100)`; si 0 pero `usd>0` → `<1%`.
  **Drill Mensual/Lista:** tap en categoría alterna `openCatMes`; expandido muestra subcats con barrita
  escalada al `maxSub` de esa categoría (no al total), monto y `%total`.
  **Drill Mensual/Treemap:** estado `zoomCat`; sin zoom: tiles con subs son clickeables (pointer), tap
  entra al treemap de subcats de esa cat. Con zoom: back-button "‹ {cat}" + caption inferior. `TreemapChart`
  acepta `onClickTile?(nombre)` opcional. Al cambiar tipo de gráfico se resetea `zoomCat`.
  **Anual:** subcats cambian base de `%` de relativo-al-padre a **relativo-al-total** (`totalCatUsd` en
  `agregarAnual`); barra de subcat sigue escalada al padre (`s.usd/c.usd`). Chip `%` sumado a fila de cat.
  `catOtras` tipada con `subs:[]`. Frontend puro. Deploy: `--only hosting`.
- F9.67 — Logos de comercios en "Por descripción" del Dashboard.
  **`src/datos/comerciosDominios.ts`** (nuevo): mapa curado de 33 comercios (`COMERCIOS_DOMINIOS`) con
  match por substring sin acentos + función `comercioDominio(nombre)` → dominio o null. Fuente única para
  resolver nombre→dominio (aparte del diccionario/destinos; nunca adivina para personas/transferencias P2P).
  **`src/design-system/components/core/MerchantLogo.tsx`** (nuevo): mismo patrón que `BankLogo`
  (Brandfetch CDN, `VITE_BRANDFETCH_CLIENT_ID`), resuelve `nombre→dominio` vía `comercioDominio()`.
  Fallback: monograma con inicial. Reset de `fail` con `useEffect` al cambiar `nombre`. Exportado desde
  el barrel `design-system/components/index.ts`. En "Por descripción" del Dashboard Mensual, cada fila
  muestra `<MerchantLogo nombre={x.desc} size={30} />` entre el número de rank y el texto de descripción.
  Frontend puro. Deploy: `--only hosting`.
- F9.66 — ShareLanding rediseñado: espera full-screen + documento animado + indicadores compactos.
  **Layout:** durante `!listo`, cuerpo usa `justifyContent:'space-between'`: chip de tipo arriba, documento
  animado + caption al centro, indicador abajo (para ambas ramas). Al `listo`: `justifyContent:'center'`
  con `gap:16`. Pill de nombre de archivo eliminado (absorbió F9.65). **Documento nuevo `LandingDoc`:**
  152×190 mientras escanea (dos anillos `gfRing`, barrido `gfScan`, flote `gfFloat`, shimmer en líneas,
  fila de total resaltada); colapsa a 92×116 con check `gfRiseIn` al terminar.
  **Keyframes nuevos** en `ShareLanding.css`: `gfShimmer` (esqueleto), `gfFloat` (flote); `gfRing`/`gfScan`
  actualizados con las curvas del kit.
  **Dos indicadores compactos `LandingInd`** (`tone: 'amber'|'green'|'neutral'`):
  - **Pre-clasificado** (ámbar, `sparkles`) — aparece al `clasificado` si `factura.categoria` tiene valor.
  - **Gasto esperado / Movimiento nuevo** (verde / neutral, `git-compare` / `plus`) — aparece al `listo`.
  `FacturaLanding.categoria` nuevo campo (`string | null`): `[categoriaPrellena, subcategoriaPrellena].join(' · ')` —
  fuente del indicador ámbar. Populado en `Comprobantes.tsx` desde `propuestaMatch`.
  **§4 — Confirm (`PropuestaCard`):** par de `Badge` reemplazado por el mismo par de indicadores compactos
  icon-forward (ámbar `sparkles` + verde/neutral `git-compare`/`plus`), con tokens de diseño que adaptan
  a light/dark. Frontend puro. Deploy: `--only hosting`.
- F9.65 — ShareLanding: badge de resultado sube justo debajo del valor; nombre de archivo eliminado.
  Pill de nombre de archivo (`nombreArchivo` + tamaño KB) eliminado del bloque "Documento". En la rama
  factura, el badge de match (antes al final de la lista de campos) pasa a ser el **primer** elemento
  dentro del contenedor `flexDirection:'column'`, antes del map Comercio/Vence — queda pegado
  inmediatamente debajo del monto hero, visible sin scrollear. `marginTop: 4` del badge removido
  (el `gap: 8` del contenedor lo reemplaza). `nombreArchivo` y `tamano` permanecen en `ShareLandingProps`
  (el padre los pasa) pero ya no se usan en el render. Frontend puro. Deploy: `--only hosting`.
- F9.64 — Payee real en historial y ShareLanding; nombre de archivo deja de ser el título de la card.
  Helper `payeeDeDatos(d: DatosExtraidos): string | undefined` (módulo-level en `Comprobantes.tsx`):
  factura → `comercioRazonSocial ?? destinoNombre`; pago/transferencia → `destinoNombre ?? comercioRazonSocial`
  (gateado por tipo, NO con `??` directo — Mercado Pago es billetera, no el payee). Reutilizado en 4 lugares:
  (1) fila de detalle `DatosResumen`; (2) título de la card del historial (fallback a `nombreArchivo` si todavía
  sin datos extraídos); (3) `descripcionCruda` en ramas 2/3 (reemplaza el bloque `esPagoDoc` inline);
  (4) campo `comercio` de `facturaLanding` en ShareLanding. Frontend puro. Deploy: `--only hosting`.
- F9.63 — Fecha del movimiento desde el vencimiento + `pagado`/`confirmadoPago` por fecha (fuente única).
  **Fecha:** `vencimientos[0]?.fecha ?? emisión ?? hoy` — el primer vencimiento alinea el `mes` del movimiento
  con el mes en que se paga el ítem esperado (ej. factura emitida en junio con vencimiento en julio → mes julio).
  **`pagado`/`confirmadoPago`:** única regla `fecha ≤ hoyAR` sobre la fecha final, para TODO comprobante (ya no
  solo `esPago`). El server (callable `cargarMovimientoDesdeComprobante`) es la autoridad: recalcula desde
  `fechaMs` con `hoyArgentinaISO()`; el front calcula para preview (`pagadoPorFecha` en `AltaMovimiento`).
  Eliminado el hardcode `pagado: true` en `crearMovimiento` → usa `payload.pagado ?? true`.
  `confirmarRama1` también usa la regla de vencimiento. `esPago` eliminado de `preloadBase` (queda `esPagoDoc`
  para la selección de payee, que es distinta). Cambios en: `src/vistas/Comprobantes.tsx`,
  `src/vistas/AltaMovimiento.tsx`, `src/datos/movimientos.ts`, `src/datos/comprobantes.ts`,
  `functions/src/index.ts`. Functions requiere `npm run build` + `firebase deploy --only functions`.
- F8.4 — Cleanup del grupo "Clasificación y aprendizaje": se quitan los placeholders
  Subcategorías y Etiquetas (ya cubiertos por Perfil › Categorías / F9.38, con
  `guardarTaxonomia` y cascade a movimientos+diccionario). Componente `Pronto` eliminado
  (sin uso). Grupo completo: Diccionario (F8.1), Destinos (F8.2), Normalización (F8.3).
  Desc de Categorías ampliado para descubribilidad. Frontend puro. Deploy: `--only hosting`.
- F8.3 — Perfil › Normalización: editor admin de `reglasNormalizacion` con preview paso a
  paso (`normalizar()` puro client-side) y validación de regex server-side. Callable
  `guardarReglaNormalizacion` (crear/editar/eliminar/reordenar). `activo` ahora REAL:
  filtro `activo !== false` agregado en `cargarReglasNormalizacion` (server) y
  `DiccionarioContext` (cliente) — antes ningún lector lo respetaba. Sin cambio de rules.
  Deploy: `--only functions,hosting`.
- F8.2 — Perfil › Destinos: editor admin de la colección `destinos`. Rules: read admin,
  write cerrado. Callables `upsertDestino` (crear con `destinoRaw`→normalización server-side /
  editar por `id`; valida FK `itemEsperadoId` contra `itemsEsperados`) y `eliminarDestino`.
  Sin campo `activo`: "desactivar" = confianza < 0.7 (umbral del matcher). Chip warning si
  confianza < umbral. Edición: `destinoNorm`/`tipo` inmutables (clave). Wrapper
  `src/datos/destinos.ts`. Deploy: `--only functions,firestore:rules,hosting`.
- F8.1 — Perfil › grupo "Clasificación y aprendizaje · admin". Editor de Diccionario
  (CRUD client-side; rules ya permiten admin/Manual). Ítems Destinos/Normalización/
  Subcategorías/Etiquetas presentes con badge PRONTO (F8.2–F8.4). Deploy: --only hosting.
  Íconos nuevos: `book-open`, `sparkles`. Ruta `/perfil/diccionario` (admin-only).
  `Diccionario.tsx`: carga colección completa (sin filtro activo), ordena por patrón,
  buscador por patrón/categoría, toggle activo, editar, borrar. Bottom-sheet con campos:
  patrón, tipoMatch (segmented), categoría, subcategoría (filtrada por categoría), etiqueta,
  personaDefault, monedaDefault. `bancoFiltro`/`tarjetaFiltro` no expuestos en v1.
  Alta: `addDoc` con `activo:true, confianza:0.9, origen:'Manual', creadoPor:memberId`.
  Edición: `updateDoc` solo los campos del form; `confianza`/`origen`/`creadoEn` intactos.
- F9.62 — Resumen: "Revisar pendientes del mes" navega a la solapa Gastos Fijos al hacer tap
  (card recibe `onClick={onIrAGastos}` → `setSec('fijos')`; `Card` extiende `HTMLAttributes<HTMLDivElement>`
  y reenvía `onClick` sin cambios). Reconteo de `porRevisar`: ahora filtra solo los ítems SIN CARGAR
  (`c.matches.length === 0 && ACCIONABLE.includes(c.estado)`); `por_confirmar` (con match, sin confirmar)
  ya no cuenta. Card PENDIENTE (solapa Gastos Fijos): antes sumaba solo `montoEsperado` de ítems sin
  cobertura y con monto definido (daba $0 si todos eran `por_confirmar`); ahora suma TODO lo no pagado:
  ítems `por_confirmar`/`parcial` aportan el **monto real** de sus matches; los sin match aportan
  `montoEsperado`. Ítems sin monto ni match no aportan. `cubierto()` sin cambios. Solo frontend.
- F9.61 — `estadoItem` aplica "pagado por fecha" a ítems `pagoAutomatico`. Antes, `pagoAutomatico`
  siempre retornaba `'automatico'` sin importar el mes ni el `diaVencimiento`. Ahora: mes pasado →
  `pagado` (el débito ya ocurrió); mes futuro → `programado` (aún no ocurre); mes actual con
  `diaVencimiento <= hoy` → `pagado` (se debitó hoy o antes); mes actual con `diaVencimiento > hoy`
  (o sin diaVencimiento) → `automatico` (se debitará más adelante este mes). Cambio en
  `src/datos/checklist.ts`; state machine actualizada en docs. `cubierto()` no cambia.
- F9.60 — `matchConEsperados` usa `destinoNombre` como fallback cuando `comercioRazonSocial` es null.
  Antes la función retornaba `[]` inmediatamente si `comercioRazonSocial` era null, dejando sin match
  a los comprobantes de transferencia (que tienen `destinoNombre` pero no razón social del comercio).
  Ahora: `texto = comercioRazonSocial ?? destinoNombre`. Sin schema ni tipo nuevo — solo lógica en
  `functions/src/matchLogica.ts`. Impacto: una transferencia a "EDESUR SA" con un `itemEsperado`
  que tenga `matchTexto.incluye: ["edesur"]` ahora se clasifica como rama 2 en vez de caer a rama 3.
  F9.60.1 (concatenar-fix): el `??` de F9.60 descartaba `destinoNombre` cuando `comercioRazonSocial`
  era no-null (ej. billetera "MERCADO PAGO" pagando a "EDESUR SA" — solo evaluaba "mercado pago").
  Ahora: `partes = [comercioRazonSocial, destinoNombre].filter(non-empty).join(' ')` — el text de
  match es la concatenación de ambos, por lo que "edesur" en `incluye` engancha aunque la billetera
  tenga su propio nombre en `comercioRazonSocial`.
- F9.58 — Banner de instalación PWA in-app + fix warnings de manifest.
  1. **Meta tag nueva:** `<meta name="mobile-web-app-capable" content="yes" />` agregada
     en `index.html` junto a la versión `apple-mobile-web-app-capable` (iOS) — elimina el
     warning de deprecated meta en Chrome DevTools.
  2. **Screenshots en manifest:** `public/manifest.webmanifest` gana bloque `screenshots`
     (narrow 1080×2280 + wide 1920×1080) para "Richer PWA Install UI" — elimina ese
     warning de Application › Manifest. **Pendiente:** Juan debe copiar las capturas reales
     a `public/screenshots/mobile-dashboard.png` y `public/screenshots/desktop-dashboard.png`.
  3. **`src/hooks/useInstallPrompt.ts`** — hook nuevo que captura `beforeinstallprompt`,
     trackea `appinstalled` y `display-mode: standalone` (ya instalada), y expone
     `instalar()` / `descartar()`. Descarte persiste en `sessionStorage` (dura la sesión
     del tab, no permanente).
  4. **`src/design-system/shell/InstallBanner.tsx`** — banner `position:fixed`
     `bottom:76px` (encima del BottomNav, misma lógica que Fab) con ícono `download`,
     copy y botones "Instalar" / "×". Solo visible cuando `mostrarBanner=true` (el evento
     dispara, no está instalada, no fue descartada).
  5. Exportado en `shell/index.ts`; montado en `AppShell.tsx` dentro de `<Screen>` antes
     de `<Routes>` — mismo stacking context que el resto del shell.
- F9.57 — Dashboard Anual: meses futuros = proyección lineal (mínimos cuadrados)
  de los meses transcurridos. `mesActualIdx` (0-indexed): mes en curso del año
  mostrado para el año actual; 11 para años pasados completos. Meses 0..mesActualIdx
  = reales (barras sólidas); > mesActualIdx = proyectados (barras fantasma: fondo
  transparente + borde punteado del color de la serie, inicial del mes en gris claro).
  Leyenda "Real / Proyección" en ambos gráficos cuando hay meses futuros.
  `tendenciaPct`: pendiente mensual de la regresión lineal sobre los meses reales ÷
  promedio real → nunca promedia contra ceros de meses futuros; badge muestra
  "+N%/mes" (↑ rojo / ↓ verde). KPI "Proy. resto del año" (solo cuando hay meses
  futuros): suma de las barras proyectadas. "Promedio mensual" y "Mes más alto/bajo"
  calculados sobre meses reales (0..mesActualIdx), no solo meses con datos.
  Cambios: `src/datos/agregados.ts` (interface DashAnual + helpers _linreg /
  proyectarMeses + agregarAnual reescrito), `src/vistas/Dashboard.tsx`
  (DashboardAnual: renderizado condicional real vs. proyectado en ambos gráficos).
  Derivado puro, sin persistencia (F9.25).
- F9.56 — Dos fixes en la pantalla Cargar.
  1. **Resúmenes de tarjeta colapsados:** `SeccionTarjetas` reemplaza las tarjetas
     completas (`TarjetaFace`) por `ResumenFila` — filas de ~50px, colapsadas por defecto,
     que expanden inline al tocar. Colapsada: swatch tintado (brand-color por red) · banco ·
     red · •••• ultimos4 · vence DD/MM · total este mes · badge de estado · chevron.
     Expandida: `CaraTarjeta` reducida + split "Este mes" / "Deuda futura" + botón "Ver N
     consumos →" (abre el preview existente). Ordenadas con `fechaVencimiento` descendente
     (período en curso primero). Se muestran 4 por defecto; "Ver todo (N)" si hay más.
     No se creó ruta ni componente nuevo: todo vive en `ResumenesTarjeta.tsx`.
  2. **Bandeja de entrada condicional:** La bandeja en `Comprobantes.tsx` ya se ocultaba
     cuando `entrantes.length === 0`, pero permanecía visible para entrantes `ruteados`
     cuyo destino ya estaba confirmado (`comprobante.estado === 'vinculado'` o
     `resumen.estado === 'confirmado'`). Ahora filtra `bandejaEntrantes` client-side:
     muestra la bandeja solo si hay ≥ 1 ítem no-ruteado O cuyo destino no está aún
     confirmado. `comprobantes` y `resumenes` ya estaban disponibles en el mismo componente.
- F9.51 — `ShareLanding` (`src/vistas/ShareLanding.tsx`) cubre el arranque en frío de
  Comprobantes cuando llega por Web Share Target (F9.49): se monta sobre `?share=1` en
  cuanto `leerYBorrarArchivoCompartido()` devuelve el File, antes de tocar Storage/Functions.
  Sus 5 fases (recibido·leyendo·clasificado·extrayendo·listo) NO usan timers — las deriva
  `calcularFaseCompartido()` en `Comprobantes.tsx` en vivo a partir de los mismos listeners
  que ya alimentan la bandeja/historial (`entrantes`, `comprobantes`, `useResumenesTarjeta`),
  matcheando por hash (id compartido entre `entrantes`/`comprobantes`/`resumenesTarjeta`).
  Al llegar a "listo" encadena al confirm real ya existente — nunca crea uno nuevo: factura
  con rama 2/3 (`itemEsperadoId` o nueva) auto-abre el `AltaMovimiento` ya montado en
  `PropuestaCard` (prop `autoAbrir`, una sola vez via ref-guard); rama 0/1 (dedup/
  reconciliación) no necesita acción, el landing solo se cierra. Resumen de tarjeta en
  `estado:'parseado'` auto-abre el preview de `SeccionTarjetas` (nuevo prop
  `abrirPreview`/`onPreviewAbierto`, consumido una vez). El split este-mes/deuda-futura
  reusa `calcularSplitCuotas()` de `TarjetaFace.tsx` (F9.21) — no se reimplementa. Entrante
  `estado:'ambiguo'` (admin-only para resolver) cierra el landing solo, sin bloquear; error
  de extracción o `requiere_tarjeta` caen a un estado de error con botón "Cargar manual" (abre
  alta manual vacía), sin spinner colgado. Refrescar `?share=1` sin File en IDB no monta nada
  (cae a Comprobantes normal) — la URL ya se limpia con `history.replaceState` apenas se
  detecta el share, antes de leer IDB, así un refresh no re-dispara. Layout/copy porteados
  literal de `ui_kits/mobile/ShareLanding.jsx`; las 4 animaciones CSS que el kit asume
  globales (`gfRiseIn`/`gfRing`/`gfScan`/`gfSpin`) no existían en el repo — se definieron en
  `ShareLanding.css`, único consumidor.
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
- Diseño = app MODERNA (2026), no copia de la legacy. La legacy aporta funcionalidad, no
  estética; no arrastrar decisiones visuales impuestas por Apps Script.
- Funcionalidad = paridad con la legacy (sobre todo Dashboard, ver 60_Dash.gs).
- Plataforma primaria: móvil. Bottom-nav fijo: Inicio · Resumen · Cargar · Perfil.
  Captura (Alta manual, Confirmar comprobante) como modal full-screen.
- Color: marca/acción = esmeralda #065f46; ink #111827 para superficie oscura (hero de
  captura = primer paso del futuro tema oscuro). Azul = solo informativo; navy del rebuild
  deprecado. Semántica de plata: ingreso verde / gasto rojo (PENDIENTE: ajustar los tonos
  exactos de verde/rojo, ver F9.0b).
- Montos SIEMPRE mostrados en ARS-equivalente Y USD-equivalente (ambos), con tabular-nums,
  formato es-AR ($ 1.234,56 / U$S 1.234,56).
- Tema claro/oscuro: pendiente, se hará cuando estén todas las pantallas.

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
- F9.49 — cerrado el manifest + share_target (ver sección PWA más abajo). Queda un paso
  manual de una sola vez antes de producción: `npm install -D sharp && node
  scripts/gen-pwa-icons.mjs` (genera los PNG reales desde los SVG fuente — no hay
  rasterizador de imágenes en el entorno de Code).
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
- Commit por tarea numerada, mensaje en castellano. Push automático al terminar cada
  tarea/feature, SIN esperar que se pida explícitamente — el objetivo es que el working
  tree quede limpio (`git status` sin pendientes) y `origin/main` refleje siempre el
  estado local. Si hay archivos sueltos ajenos a la tarea (docs movidos, notas de sesión,
  etc.) que ya estaban en el working tree, van en un commit aparte de "housekeeping" para
  no mezclarlos con el commit de la feature, pero se commitean y pushean igual — no queda
  nada sin sincronizar al cierre de la sesión.
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

Changelog: F6.9.1 (anti-autovínculo: calcularPropuesta con movs=[]) · F6.9.2 (factura nace confirmadoPago:false, gateado por esPago) · F6.9.3 (extracción: destinoCuit/destinoNombre = emisor en facturas) · F6.9.4 (preload usa categoriaPrellena del match por destino) · F6.9.5 (el payee para el clasificador se elige por tipo (destinatario en pagos, emisor en facturas) porque billeteras tipo MP llenan comercioRazonSocial con su marca) · F6.9.6 (feedback de match en UI): la card distingue **pagó factura** (rama 1 `origenReconciliacion`), **movimiento nuevo** (rama 2 esperado/adicional · rama 3 libre) y **ya cargado** (dedup rama 0, con mes/monto del `dedupInfo`); re-subida del mismo hash avisa explícito que no se procesa. `origenReconciliacion` tipado en ambos gemelos `PropuestaMatch` (cliente + functions) · F6.9.7 (P2 — destino-sin-item no secuestra el esperado): `matchPorDestino` que devuelve rama 3 (solo categoría, sin `itemEsperadoId`) deja de cortar el flujo; el orquestador prueba `matchConEsperados` por texto y, si engancha, gana la rama 2 del esperado (cierra el ciclo: el movimiento nace con `itemEsperadoId` y `aprenderDestino` lo upsertea sobre el destino). Si los esperados tampoco matchean, cae a rama 3 conservando categoría/subcategoría/etiqueta aprendidas del destino. Destino-con-item (rama 2, incl. adicional) sigue ganando directo. · F6.9.8 (razón persistente post-vinculado): el card resuelto conserva una etiqueta compacta leída de `propuestaMatch` (que sobrevive al estado `vinculado`) — pagó factura (rama 1 `origenReconciliacion`), cumplió esperado / pago adicional (rama 2), cargado como nuevo (rama 3), ya cargado (rama 0). Cierra el hueco de F6.9.6, donde el "por qué" del match desaparecía al pasar de `extraido` a `vinculado`. · F6.9.9 (scoping de lectura de comprobantes): scoping de lectura de comprobantes a `subidoPor == miMemberId()` para no-admin (cierra fuga en regla + query + render del Historial: el dependiente solo ve los que subió); `useComprobantes(memberId, esAdmin)` filtra cliente; índice compuesto `subidoPor` + `subidoEn`. · F6.9.10 (fix lectura `entrantes`: `resource == null`): bug latente (no regresión de F6.9.9) en la regla de `entrantes` — el `getDoc` de dedup en `subirEntrante` sobre un hash nuevo evalúa `resource.data.creadoPor` con `resource` null para un no-admin y revienta ("Null value error"); admin no lo sufre porque `esAdmin()` cortocircuita el `||`. Agregado `resource == null` a la rama no-admin: permite el read de un doc inexistente (dedup limpio) sin aflojar el scoping de docs existentes. · F6.9.11 (callable `cargarMovimientoDesdeComprobante`): el dependiente carga su propio comprobante como su propio movimiento sin aflojar reglas. Reglas sin cambios — `comprobantes:update` y `movimientos` siguen con sus condiciones existentes para el cliente; la callable (Admin SDK) hace batch atómico crear-movimiento + marcar-comprobante-vinculado, owner-scoped (dueño o admin) e idempotente (precondición `estado==='extraido'`: reintento corta en `failed-precondition`); valida no-impersonación (`creadoPor`/`persona` deben ser el caller, salvo admin). Rama 1 (conciliación de obligaciones) queda admin-only por decisión y se gatea en UI (`PropuestaCard` recibe `esAdmin`; no-admin ve mensaje informativo sin acción, no bloquea su camino de movimiento nuevo). `AltaMovimiento` gana `onGuardarPayload` opcional para rutear ramas 2/3 (admin y dependiente) por la callable en vez de `crearMovimiento` client-side; `marcarVinculado` queda removido (huérfano, lo absorbe la callable). `NuevoMovimiento` gana `fechaMs`/`mes` opcionales (los usa solo la callable; `crearMovimiento` los ignora). · F6.9.12 (FAB de alta manual unificado en Carga): alta manual unificada en un único FAB "+" flotante en Carga (`esManual:true`, con `numeroComprobante` + dedup); se retira el FAB del Dashboard (junto con el estado `mostrarAlta`/`exito` y `handleGuardado`, huérfanos) y el botón inline punteado de Carga; el alta manual no se gatea por rol (dato propio, también la usa el dependiente). CSS `.dash-fab` → `.cmp-fab` (mismo estilo, movido a `Comprobantes.css`); `.cmp-btn-manual` removido. · F6.9.13 (cierre de rutas de admin al dependiente + decisión de `itemsEsperados`): (a) decisión `itemsEsperados`: son familiares (sin dato por-persona; solo admin crea/edita), el read se mantiene `esMiembro()` a propósito porque `ItemsEsperadosProvider` los necesita app-wide para el flujo de comprobantes del dependiente — scopearlo a admin rompería esa vista con permission-denied; cierra la decisión de scoping que quedaba abierta. (b) fix real: `/resumen` y `/config-esperados` estaban montadas en `AppShell.tsx` sin gatear (solo el nav estaba detrás de `esAdmin`) — un dependiente llegaba por URL directa y veía el ResumenMes con totales de toda la familia; ahora ambas rutas se montan solo si `esAdmin`, más catch-all `*` → `/` para que la URL no resuelta caiga al Dashboard en vez de pantalla en blanco.

## State machine de esperados (ResumenMes)

Derivada en vivo, NO materializada. Nueve estados (F5.5):

- `pagado`: mes cerrado con match(es), O mes en curso con al menos un match confirmado y monto >= 99%.
- `por_confirmar`: mes en curso/futuro con match(es) detectados pero ninguno con `confirmadoPago=true`.
- `parcial`: mes en curso/futuro con confirmados pero monto confirmado < 99% esperado.
- `automatico`: mes en curso, sin match, `pagoAutomatico=true` y `diaVencimiento` aún no llegó (o sin diaVencimiento). Cubierto sin conciliar.
- `pendiente`: mes en curso, sin match, diaVencimiento no alcanzado (o sin diaVencimiento).
- `vencido`: mes en curso, sin match, diaVencimiento < hoy.
- `programado`: mes futuro, sin match (incluye `pagoAutomatico` de mes futuro desde F9.61).
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

## Sistema de diseño / UI

Fuente: `src/design-system/ui_kits/mobile` (paquete del DS, copiado al repo; ver
`README.md` ahí dentro). App MODERNA 2026, no copia visual de la legacy — paridad de
*funcionalidad*, no de estética (ver "Decisiones cerradas").

F9.1 (tokens → app): `src/styles/tokens.css` (colors+typography+spacing+status del DS)
importado globalmente en `src/main.tsx`. Variables `--gf-*` / `--color-*` / `--space-*` /
`--radius-*` / `--shadow-*` disponibles en toda la app. Sin cambios de lógica ni de
componentes todavía — solo el import global (F9.2 trae el shell, F9.3 las pantallas).

F9.2 (shell móvil): `AppShell.tsx` migrado del header+nav desktop a `AppBar` + `Screen` +
`BottomNav` fijo (`src/design-system/shell/`), siguiendo `ui_kits/mobile/MobileShell.jsx`.
4 destinos (Inicio · Resumen [admin] · Cargar · Perfil) + FAB global en Inicio/Resumen que
navega a `/comprobantes` (la carga real ya vive ahí desde F6.9.12; no se duplica lógica).
`Icon` (`src/design-system/Icon.tsx`) envuelve `lucide-react` con mapa curado de imports
nombrados — **no** usar el barrel `icons` de `lucide-react` (trae las ~1500 figuras del
paquete entero, infló el bundle de 831KB a 1.65MB en el intento inicial); agregar cada
ícono nuevo al mapa `ICONS` a mano. El hack DOM del mock (`window.lucide.createIcons()`
sobre un `<i>`) no aplica acá — existe solo para el preview sin bundler del design system;
en Vite usamos los componentes reales de `lucide-react`. Scaffold del modal full-screen de
captura (`FullModal`/`ModalBar`/`Hero`/`Drawer`/`SectionLabel`/`CtaBar` en
`shell/CaptureModal.tsx`) construido y listo, sin cablear todavía — lo consume F9.3
(Confirmar comprobante / Alta manual). Pantalla `/perfil` nueva, mínima (nombre/rol/emails/
salir + link a Pagos esperados para admin) — solo para que el tab del BottomNav tenga
destino; el alcance completo de F8.0 (Personal + Configuración Familiar) llega en F9.3.
`/config-esperados` sigue montada y admin-only, alcanzable desde Perfil (antes desde el nav
superior, que F8.0 ya había decidido sacarla de ahí). Pendiente antes de F9.3: falta el
bundle real de componentes del DS (`src/design-system/styles.css` + `_ds_bundle.js`:
Button/Badge/Card/Money/Message/RadioChip/FieldRow/StepIndicator/MonthSelector) — solo se
copió `ui_kits/mobile`, que son los mocks de pantalla, no la librería de componentes que
esos mocks consumen.

F9.2 addendum (componentes del DS portados): llegó `src/design-system/dist/` (bundle real:
`_ds_bundle.js` compilado + `styles.css` + `tokens/*.css`). Mismo caso que Lucide: es JS
compilado que muta `window.GastosFamiliaresDesignSystem_d81a5e` con `React.createElement`
global, pensado para el preview sin bundler — no se carga tal cual. Los 14 componentes
(Badge, Button, Card, Message, Money, StatusBadge, FieldRow, Input, MonthSelector,
RadioChip, Select, PageKicker, QuickNav, StepIndicator) se portaron a TSX reales en
`src/design-system/components/{core,forms,navigation}/` + barrel `components/index.ts`.
`StatusBadge` tipa `state` como `EstadoChecklist`, que calza 1:1 con el `EstadoItem` de 9
estados ya implementado en `Resumen.tsx` — pendiente unificar cuando F9.3 cablee esa
pantalla. `dist/` (bundle + tokens de origen) NO se versiona — cae bajo la regla `dist/`
existente en `.gitignore` (pensada para el build de Vite, pero matchea cualquier carpeta
`dist` del árbol); queda solo en el filesystem local como referencia, ya cumplió su
propósito (portar los componentes a TSX). **Bonus resuelto:** `dist/tokens/colors.css` trae la paleta de ingreso/gasto
final ("paleta B", esmeralda+coral) — `src/styles/tokens.css` actualizado
(`--gf-income #0c8f62` / `--gf-expense #d33b43`, antes #16a34a/#dc2626): cierra el pendiente
de tonos verde/rojo que F9.0b había dejado abierto.

F9.3 — Dashboard (Inicio), PR visual (1 de 2): `Dashboard.tsx` reescrito siguiendo
`DashboardMobile.jsx` del kit — tabs Mensual/Anual, toggle ARS/USD (con "eq" secundario
siempre visible, cumple el requisito transversal de F9.3), paridad con `60_Dash.gs`
(balance/ingresos/gastos en eq, por categoría con donut, top subcategorías, evolución
diaria, por descripción, histórico anual con salidas/ingresos por mes y mes-a-mes) — cierra
los 3 gaps que F9.0b/F9.0c habían marcado (por categoría, por descripción, histórico).
Datos de EJEMPLO hardcodeados (mismo shape que `ui_kits/mobile/data.jsx`,
`M_DASH`/`M_ANUAL`) — sin tocar Firestore ni Functions, por diseño (regla transversal de
F9.3: visual primero). Usa `Card` del DS portado; los gráficos (donut/barras) son divs con
estilo inline, igual que el mock (el DS no tiene componentes de chart). CSS de la vista
reducido a un único `.dash` contenedor — todo lo demás (totales/tabla/selector de mes
viejos) quedó reemplazado por la estructura del mock. **Pendiente — PR 2 de 2 (cableado):**
construir los hooks que hoy no existen (agregación por categoría/descripción, histórico
mensual/anual — ver plan de F9.0c) y reemplazar `EXAMPLE_DASH`/`EXAMPLE_ANUAL` por datos
reales; ese cableado no estaba listo al cerrar esta PR.

F9.3 — Resumen, PR visual (1 de 2): `Resumen.tsx` reescrito siguiendo `ResumenMobile.jsx`
del kit — toggle segmentado "Por día" / "Gastos Fijos". "Por día" es la tabla diaria por
banco (paridad `50_ResumenMes.gs`) que F9.0b había marcado como el gap más grande: KPIs
(neto $eq+USDeq, pesos disponibles, faltante USD), distribución de ingresos por persona,
gastos agrupados por día con desglose por banco y fila "hoy". "Gastos Fijos" es el re-skin
del checklist de esperados (mismos 9 estados — `StatusBadge` ya tipaba `EstadoChecklist`
para esto desde el addendum de F9.2) con "Marcar pagado" como estado LOCAL de ejemplo (no
llama a `confirmarPagoEsperado`/`desmarcarPago` reales — eso es la PR de cableado). Guard
de admin (`Navigate` si no-admin) se mantiene igual que antes — eso es ruteo/seguridad, no
"datos", no se tocó. Datos de ejemplo hardcodeados (mismo shape que `data.jsx`:
`M_MOVS`/`M_ESPERADOS`/`M_BANCOS`/`M_MIEMBROS`). `Icon` ganó 4 entradas al mapa curado
(`calendar`, `users-round`, `calendar-days`, `check`) para esta pantalla. CSS reducido a un
único `.res` contenedor. **Pendiente — PR 2 de 2:** hook de agregación día×banco (no existe
hoy — gap real, no solo de re-skin) + recablear el checklist a `useMovimientosDelMes`/
`useItemsEsperados`/`estadoItem` reales (la lógica ya existe, hay que reconectarla a la
nueva estructura visual) + las acciones reales de confirmar/deshacer pago.

F9.3 — Cargar, PR visual: `Comprobantes.tsx` reescrito siguiendo `CargaMobile.jsx` +
modales `ComprobanteConfirm.jsx`/`ManualGasto.jsx` del kit. Dropzone + mensaje "procesando"
+ lista de entrantes recientes + botón "Cargar manualmente", todo con datos de ejemplo —
ningún disparador sube nada real. Los dos modales full-screen (scaffold de F9.2:
`FullModal`/`Hero`/`Drawer`/`CtaBar`, ya cableado por primera vez acá) usan estado local:
"Confirmar movimiento"/"Guardar movimiento" no llaman a ningún endpoint. Desviación menor
del mock: el mock manda los tres disparadores (dropzone, lista, "cargar manualmente") al
mismo modal de comprobante; acá el dropzone/lista abren Confirmar comprobante y "Cargar
manualmente" abre Alta manual — separación más fiel a lo que cada uno hace en la app real.
`Icon` ganó 6 entradas (`file-up`, `check-check`, `loader`, `triangle-alert`, `circle-x`,
`chevron-right`). CSS reducido a `.cmp`. `SeccionTarjetas` (real, `ResumenesTarjeta.tsx`)
sigue montada admin-only al pie de Cargar — Carga sigue siendo la solapa unificada de
comprobantes + resúmenes de tarjeta (F6.7 addendum 1); Tarjetas NO se separó en una pantalla
propia, corrección sobre un intento inicial de este PR que sí la había sacado. **Queda
temporalmente desconectado (no borrado — lo reconecta la PR de cableado):**
`AltaMovimiento.tsx` (todo el form real con dedup/TC/diccionario), `datos/entrantes.ts`,
`datos/comprobantes.ts` — el dropzone/modales de esta PR son 100% visual/ejemplo, pero
`SeccionTarjetas` sí sigue siendo real (no entra en esta lista).

F9.3 — Perfil + sub-pantallas, PR visual: `Perfil.tsx` reescrito siguiendo `PerfilMobile.jsx`
(brief F8.0) — identidad real (nombre/rol/email, ya lo era desde el placeholder de F9.2,
no es dato de ejemplo) + grupo "Personal" (Mis datos/Notificaciones/Apariencia, sin destino
todavía) + grupo "Configuración familiar" admin-only con contadores de EJEMPLO ("3 personas
· 2 admin", etc. — no hay hooks de conteo). 4 sub-pantallas nuevas en
`src/vistas/perfil/` (`Miembros.tsx`, `Categorias.tsx`, `MediosPago.tsx`, `TipoCambio.tsx`,
+ `shared.tsx` con `Avatar`/`AddBtn`), todas de solo-lectura con datos de ejemplo, rutas
admin-only `/perfil/{miembros,categorias,medios-pago,tc}` con `onBack` a `/perfil`.
**Dos decisiones explícitas, no "olvidos":** (1) "Pagos esperados" linkea al
`ConfigEsperados.tsx` REAL (`/config-esperados`, CRUD ya funcionando) en vez de reescribirlo
como mock de solo-lectura — decisión del usuario, evita gutear un admin tool que ya
funciona para igualar un mock más pobre. (2) "Tarjetas" linkea a `/comprobantes` (no es
sub-pantalla ni pantalla propia — vive en Cargar, ver corrección de la PR anterior).
"Cerrar sesión" sigue real (`signOutUsuario`, ya lo era antes de F9.3 — no es dato
Firestore). `Icon` ganó 6 entradas (`bell`, `palette`, `tags`, `wallet`, `repeat`,
`log-out`). **Pendiente — PR de cableado:** hooks de conteo real para los `desc` de la
lista, y las 4 sub-pantallas en sí (hoy de ejemplo) pasan a consumir `config/familia.*`
vía las callables admin-only ya decididas en F8.0.

F9.3 — corrección (Tarjetas, cara real): la PR de Cargar había dejado `SeccionTarjetas`
(`ResumenesTarjeta.tsx`) montada SIN re-skinear — visual desktop viejo, sin la cara de
tarjeta de `TarjetasMobile.jsx` (banco/red/últimos4 + cierre/vencimiento) que el usuario
señaló que faltaba. Corregido con DATOS REALES (no ejemplo, a diferencia del resto de
F9.3): `ResumenCard` ahora muestra la cara ink-gradient con últimos4 (de
`config.tarjetas[].ultimos4`, por `tarjetaCodigo`) + `fechaCierre`/`fechaVencimiento` del
resumen real, y un footer blanco con total + `BadgeEstado` (las 5 fases propias de
`CardStatement`, sin relación con `EstadoChecklist` del DS). Todas las acciones reales
(descartar, asignar tarjeta si `requiere_tarjeta`, revisar/preview, confirmado) siguen
intactas, solo reubicadas debajo de la cara. De paso, `cmp-error-detalle`/
`cmp-btn-descartar` (clases huérfanas desde que `Comprobantes.css` se redujo en la PR de
Cargar) se reemplazan por clases propias de `ResumenesTarjeta.css`.

F9.4 (íconos del Dashboard): los 4 emojis de KPI (🧾📊🏷️💸) reemplazados por
`lucide-react` (`Receipt`, `BarChart3`, `Tag`, `TrendingUp`) vía el mapa curado de `Icon`.
`Eyebrow`/`Kpi` en `Dashboard.tsx` ganan prop `icon?` opcional, renderizado antes del texto
(`display:flex; gap:6px`, `size=13`, `--gf-gray-400`). Sin cambios de valores/layout/copy.

F9.5 (logos de medios de pago): `BankLogo({ id, nombre, color, size=34, radius=9 })` nuevo
en `src/design-system/components/core/BankLogo.tsx` — intenta `/assets/medios/{id}.svg`,
con `onError` cae a un chip de color + inicial (mismo tratamiento que ya existía a mano en
Miembros/MediosPago). `public/assets/medios/` creada (vacía salvo un `README.md` con la
convención de nombres — los SVG oficiales se suben después). Usado en Perfil → Medios de
pago. **No** aplicado al punto de color de 7px de "gastos por día" en Resumen — ahí es un
indicador compacto, no un slot de logo; forzarlo rompería ese layout denso.

F9.6 (selector de período contextual del Dashboard): el `<select>` y el título del header
ahora dependen del toggle Mensual/Anual — Mensual lista meses (estado `mes`, ya existía) y
Anual lista años (`anio`, nuevo, default `EXAMPLE_ANUAL.anio`); título `mesLabel` vs.
`Año {anio}`. Los pills ARS/USD siguen recalculando en ambos modos sin cambios.

F9.7 (separar Tarjetas: visor vs. config, spec final — corrige un primer intento de esta
misma fase que había gateado el visor a admin y mostrado campos equivocados en la config):
"Tarjetas" cubre tres cosas distintas. (1) **SeccionTarjetas** (upload/preview/confirmar/
asignar/descartar resúmenes) sigue intacta dentro de Cargar, sin tocar — eso ya se había
corregido antes en F9.3 y no se reabre. (2) **`/tarjetas` nuevo** (`TarjetasViewer.tsx`):
visor de SOLO LECTURA de resúmenes reales (misma `TarjetaFace`, sin acciones) — **lo ven
TODOS los roles** (la ruta no gatea por `esAdmin`); se llega solo desde un botón "Tarjetas"
en el header de Resumen (admin-only en los hechos, porque Resumen lo es), `onBack` →
`/resumen`. (3) **`/perfil/tarjetas` nuevo** (`perfil/Tarjetas.tsx`, admin-only): config del
catálogo de tarjetas físicas — banco/red/término + **cierre/vencimiento como día del mes**
(`cierreDia`/`venceDia`, no fechas — campos nuevos, no existen aún en
`config/familia.tarjetas` real) + titular, chevron por fila, "Agregar tarjeta", nota al pie
"Los resúmenes se ven en Resumen › Tarjetas". El ítem "Tarjetas" de Perfil pasa de linkear a
Cargar a linkear acá; ya NO se accede al visor desde Perfil. Datos de EJEMPLO en ambas
pantallas nuevas — alta/edición real (`cierreDia`/`venceDia` incluidos) vía callable
admin-only es la PR de cableado (F8.0). Refactor de paso: la cara de tarjeta (banco/red/
últimos4/cierre/vencimiento + footer total/estado) se extrajo a `src/vistas/TarjetaFace.tsx`
(+ `TarjetaFace.css`, con las clases `.rt-card*`/`.rt-badge*` movidas desde
`ResumenesTarjeta.css`) para que `SeccionTarjetas` y `TarjetasViewer` comparten el mismo
componente — `ResumenCard` ahora solo aporta las acciones (vía `children`).

- **Color** — marca/acción: esmeralda `--gf-emerald #065f46` (pressed `--gf-emerald-deep
  #054b38`, hairline/focus `--gf-emerald-line #0a7d5e`). Superficie oscura: ink
  `--gf-ink #111827` (hero de captura, botones neutros — primer paso del futuro tema
  oscuro). Azul (`--gf-blue-600 #2563eb`) es solo informativo (links, badges de espera);
  `--gf-navy #1e3a5f` queda deprecado (heredado del rebuild React, no usar). Semántica de
  plata: ingreso `--gf-income #16a34a` / gasto `--gf-expense #dc2626` — tonos finales
  pendientes de ajuste fino (ver F9.0b). Neutrales en rampa de gris `--gf-gray-*`
  (900 texto primario → 50 superficie tenue). Estados de mensaje (ok/error/warn/wait) y
  estados del checklist de esperados (`--st-*`, uno por cada uno de los 9 estados de la
  state machine) en `tokens.css`.
- **Tipografía** — system UI stack (`-apple-system, BlinkMacSystemFont, 'Segoe UI',
  system-ui, Roboto`), sin webfonts — cara nativa del OS. Escala `--text-2xs` (11px,
  labels/badges) a `--text-3xl` (40px, monto hero); pesos hasta `--weight-black` (900,
  solo montos hero). Números con `tabular-nums` siempre.
- **Superficies** — cards elevadas con `--shadow-card`/`--shadow-soft`, radios generosos
  (`--radius-card` 18px estándar, `--radius-xl` 22px bottom-sheet/modal). Modal de captura
  full-screen: hero ink + drawer + CTA bar.
- **Nav** — bottom-nav fijo de 4 destinos (Inicio · Resumen · Cargar · Perfil) con pill
  activo; FAB "+" flotante para alta rápida.
- **Íconos** — Lucide.
- **Montos** — siempre ARS-equivalente Y USD-equivalente (nunca uno solo), formato es-AR
  (`$ 1.234,56` / `U$S 1.234,56`), `tabular-nums`.
- **Tema claro/oscuro** — pendiente; se aborda cuando estén todas las pantallas (F9.3).

## Estructura del repo

- `docs/CLAUDE.md` — este archivo. Fuente de verdad.
- `docs/prompts/` — prompts iniciales de cada sesion con Claude Code.
- `docs/sesiones/` — resumenes de sesion al cerrar cada fase.
- `docs/patrimonio/` — Anexo: Patrimonio (ver §Anexo: Patrimonio más abajo).
- `scripts/seed/` — script de migracion Sheets a Firestore.
- `data/` — snapshots .xlsx versionados.
- `secrets/` — service account JSON (gitignored).
- `src/` — frontend React + TypeScript (F3 completo).
- `public/` — manifest PWA, service worker, iconos.
- `firestore.rules` — Security Rules.
- `firestore.indexes.json` — indices compuestos.
- `firebase.json` — config de Hosting + Emulators + Headers.

## Anexo: Patrimonio

Vista privada de portafolio de inversiones. Gateada a `jpcofano@gmail.com` (esAdmin + email exacto).
Aislamiento absoluto: colecciones propias (`posiciones`, `snapshotsPortafolio`); sin puente con gastos.

Contrato completo: `docs/patrimonio/CLAUDE-PATRIMONIO.md` (fuente de verdad técnica).
Resumen de sesión de diseño: `docs/patrimonio/RESUMEN-SESION.md`.
Prompt de extracción: `docs/patrimonio/patrimonio-extraccion.md`.
Schema JSON de validación: `docs/patrimonio/posicion.schema.json`.

**Implementado hasta F9.101.** Detalle completo en `docs/patrimonio/CLAUDE-PATRIMONIO.md`.
