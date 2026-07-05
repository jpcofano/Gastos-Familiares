# Patrimonio — Resumen de sesión (handoff)

> Se lee/pega al iniciar en cualquier cuenta. Fuente de verdad: `docs/patrimonio/` en el repo.
> Contrato técnico: `CLAUDE-PATRIMONIO.md`. Prompts: `docs/prompts/F9.9x-*.md`.

**Última actualización:** cierre de la sesión de construcción completa (F9.90 → F9.97).

---

## 0. ESTADO EN UNA LÍNEA

**Construcción terminada** (F9.90→F9.97 implementadas por Code; F9.98 diferida
post-CAFCI por diseño). **Nada deployado desde F9.93.2.** Fase siguiente:
verificar push del 96/97 → deploy grande → ronda de pruebas punta a punta.

---

## 1. Qué se construyó (todo por Claude Code, verificado en repo salvo lo marcado)

| Feature | Qué es | Estado repo |
|---|---|---|
| F9.90 | Ingesta .txt (validar→confirmar→persistir), activos fijos, doble lente | ✅ pusheado |
| F9.90.1 | Posiciones manuales ACN/GLOB (entran al análisis, a diferencia de fijos) | ✅ |
| F9.90.2 | Resumen sin "Recomendaciones", chips neutros, wording "Opciones" | ✅ |
| F9.91 | Plan → 3 opciones medidas (simularOpcion real) + estrés (4 escenarios) + Evolución | ✅ |
| F9.91.1 | Tenencias consolidadas por ticker, desglose por cuenta al tap | ✅ |
| F9.92 | Informe PDF 14 secciones, bajo demanda + archivado Storage | ✅ |
| F9.93 | IA por posición + sectorial (toggle server-side, caché, lote manual) | ✅ |
| F9.93.1 | queHariaEnCadaCaso (caso→opciones→costo); prohibido solo lo incondicional | ✅ |
| F9.93.2 | Solapa Configuración, hero doble moneda, sector en Resumen, fix storage.rules | ✅ (b4147d4) |
| F9.94 | Diario de decisiones + revisión 30/90d (deltas NEUTROS, sin puntuar) | ✅ (c061d51) |
| F9.95/95.1 | Calendario eventos posición + agenda macro IA (checklist 9 categorías) | ✅ (f996cea/741fbb7) |
| F9.96 | Aportes/retiros + retorno aprox. (Modified Dietz 0,5) | ⚠️ implementado local — **VERIFICAR PUSH** |
| F9.97 | Benchmark CAFCI (Function sincronizarCafci, BenchmarkTab, mapping) | ⚠️ ídem — **VERIFICAR PUSH** |
| F9.98 | Optimización formal | ⏸ documentada en contrato, post-CAFCI (decidido) |

Último remoto verificado: `1735280`. Code dejó 96/97 en commits locales
(sugirió: commit 1 = core F9.96, commit 2 = integración + F9.97).

---

## 2. SITUACIÓN CAFCI (importante, honesta)

- La API (`api.pub.cafci.org.ar/fondo/{id}/clase/{id}/ficha`) devuelve
  **403 "Route not allowed" (CloudFront) fuera de un browser** — Code intentó
  desde la Function y curl; bloqueado.
- Estructura exterior CONFIRMADA (exploración previa):
  `data.info.semanal.carteras[]` con `fechaDatos`.
- **Campos internos de cada posición NO confirmados**: el parser usa
  suposiciones educadas (`especie`/`nombreEspecie`/`instrumento`/`descripcion`;
  `porcentaje`/`peso`/`porcentajeFondo`/`participacion`/`pct`), fail-soft
  (`incompleto: true`, nunca explota). Documentado en
  `docs/patrimonio/cafci-estructura-confirmada.md`.
- **ACCIÓN PENDIENTE DEL DUEÑO:** abrir cafci.org.ar en el browser, ficha de un
  fondo, DevTools → Network → copiar el JSON real de un elemento de
  `carteras[]` → actualizar nombres de campos en el parser
  (`functions/src/index.ts`, sincronizarCafci) y en el doc de estructura.
  Hasta entonces la sincronización puede devolver posiciones `incompleto`.
- Ojo también: si CloudFront bloquea a la Cloud Function en producción,
  evaluar plan B (proxy con headers de browser completos, o pegar el JSON
  manualmente como se hace con los resúmenes).

---

## 3. PRÓXIMOS PASOS, EN ORDEN

1. **Verificar push F9.96/97** (`git ls-remote` debe superar `1735280`).
   Revisar el commit del 97: debe incluir `cafci-estructura-confirmada.md`.
2. **Fix cosmético pendiente** (prompt listo: `F9.55.1-inicio-otros-expandible.md`):
   en Inicio → Por categorías, "Otros" no expande; debe traer sus categorías y
   movimientos. (El fix f9f06f2 arregló la vista Por categoría, no el Inicio.)
3. **DEPLOY GRANDE** — `firebase.json` NO tiene predeploy hooks (compila a mano):
   `git pull` → `npm install` (raíz; pdfmake) → `npm run build` →
   `cd functions && npm install && npm run build` → `firebase deploy` (completo:
   hosting + functions + firestore rules/indexes + storage). Después: forzar
   actualización del service worker de la PWA (cerrar/reabrir) o se ve la UI vieja.
4. **RONDA DE PRUEBAS punta a punta** (orden sugerido):
   a. PDF: generar → descarga Y archiva (primera prueba del fix de Storage);
      aparece en "Informes anteriores".
   b. Configuración: toggle IA on; editar ACN recalcula; fijos no tocan métricas.
   c. IA: análisis de TRAN → formato queHariaEnCadaCaso, casos observables,
      "mantener" como opción legítima, fuentes reales. Si sale genérico → afinar
      prompt interno (iterativo, esperable).
   d. Agenda macro: generar → DEBE traer el cupón de Globales GD del 9-jul y el
      IPC INDEC de julio (test vivo de calidad).
   e. Diario: registrar primera decisión desde una opción del Plan; simular
      revisión 30d (retroceder creadaEn en consola).
   f. CAFCI: tras validar campos (punto 2 de arriba), configurar 2 fondos,
      sincronizar, mapear pendientes, ver BenchmarkTab.
   g. Segunda corrida real (resúmenes ~15-jul): activa Evolución, diff de
      ingesta y (con flujos registrados) el retorno aprox. — nunca corrieron
      con datos reales.
5. **Registrar aportes/retiros desde YA** en Configuración (F9.96): los flujos
   no registrados contaminan el retorno histórico para siempre.

---

## 4. Pendientes de datos del dueño

- **Accenture:** encontrar claves del plan (50 ACN, USD 6.870 sembrado a precio
  de mercado 02/07 — único dato "de memoria" que queda). Al conseguirlas: misma
  jugada que Globant ESPP (fuente de extracción, borrar manual).
- **GLOB manual:** verificar que fue ELIMINADA tras cargar el .txt con el ESPP
  (si no: doble conteo ~1.951; la vista consolidada lo delata — GLOB debe decir
  "2 cuentas" ≈ 2,4k, no 3).
- CAFCI: elegir los fondos a seguir (fondoId/claseId de la URL de la ficha).

---

## 5. La foto del patrimonio (datos reales, corrida 01/07/2026)

- **Financiero/invertible ≈ USD 109,3k** = 102.549 (.txt con Globant ESPP
  incluido) + 6.870 ACN manual. Fijos: depto 220k + auto 10k → total ≈ 339k
  (fijos FUERA del análisis, solo suman abajo).
- Energía AR ~44,9% 🔴 · País AR ~69,8% 🔴 · Cripto ~19,7% 🟡 (cruzó de rojo
  por la dilución global) · Global ~10,5%.
- Top nombres: TRAN ~14,5% · ETH ~10,4% · PAMP ~10% · YPFD ~9% · BTC ~8,2%.
- Cripto REAL: 21.505 (ETH 11.385 > BTC 8.224 + AAVE 1.291 + UNI 604) — el
  "30k mitad y mitad" viejo está DESCARTADO.
- Cuentas: Balanz 402665 (conjunta) · Balanz 1120830 · PPI 101268 · Nexo ·
  Bitfinex · Globant ESPP 0000010348 · (ACN manual).
- Decisiones de datos cerradas: VIST = energía AR; BIOX = AR/agro; cripto
  oficial = solo Nexo+Bitfinex.

## 6. Reglas de trabajo (no re-litigar)

- **Push después de cada F9.x cerrado** (falló dos veces; el repo es la
  continuidad entre cuentas).
- **Explorar antes de codear** APIs externas (CAFCI lo demostró).
- Filosofía: proponer/medir/mostrar; prescripción solo condicional
  (caso→opciones→costo); el diario nunca puntúa; semáforos informan, no alarman.
- TC: `tcDiario` única fuente. Fijos fuera del análisis. La divergencia con
  fondos es información, no error.
- Deploy: reglas nuevas sin deploy = permission-denied fantasma; PWA cachea
  (forzar refresh).
