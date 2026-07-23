# Resumen para retomar — 21/07/2026

## Contexto de la sesión

Se auditaron tres frentes (Card HOY, Bench, Optim) y se descubrieron **tres
bugs preexistentes encadenados**, cada uno tapado por el anterior. El patrón
se repitió: arreglar una capa destapaba la siguiente.

1. `alinearSeries` intersectaba fechas exactas → todas las series se excluían
   → matriz de correlaciones vacía.
2. Con la matriz vacía, `setDoc` nunca vio un array anidado → el bug de
   persistencia (Firestore no acepta `number[][]`) estuvo dormido desde F9.98.
3. Con el optimizador nunca corriendo con datos reales, el bug de
   `proyectarSimplex` (proyección radial en vez de euclídea → solución
   bang-bang) tampoco se había manifestado.

---

## Specs producidas (en `/docs/prompts/`)

- **F9.102** — Card HOY completa, banner de fijos con números, feedback CAFCI,
  alineado por semana ISO en Optim, dedupe de chips. **Implementada.**
- **F9.102.1** — Serialización de la matriz de correlaciones (row-major
  `matrizFlat`), guardado fail-soft, retrocompatibilidad de formato.
  **Implementada.**
- **F9.102.2** — Proyección euclídea al símplex (bisección sobre τ), guarda de
  la columna Mín. var., cierre del experimento de región, ingesta manual
  CAFCI ("Pegar JSON"). **Implementada.**
- **F9.103** — Backfill de `tcDiario` desde ArgentinaDatos. **En curso.**

---

## Estado por frente

### Optim — funcionando, pendiente de validar el fix del símplex

- El alineado por semana ISO funcionó: 9 símbolos USD con serie (USDT, B,
  BTC, VZ, AAVE, GLOB, CVX, ETH, ACN). Matriz de correlaciones renderiza y
  persiste. Volatilidad ~2.25% semanal.
- Todos los `.BA` siguen excluidos por `tc_insuficiente` — es lo que F9.103
  viene a resolver.
- **Pendiente de verificar tras el deploy de F9.102.2**: que `correrTests` dé
  10/10 (los 2 de min-var fallaban), que la columna Mín. var. deje de asignar
  `wMax` a todos los activos no nulos, y el chequeo de sanidad: **la
  volatilidad de mín. varianza tiene que ser ≤ la de risk parity** (propiedad
  matemática; si no se cumple, el optimizador sigue mal).
- Se corrigió un test mal escrito desde F9.98 (`n=2, wMax=0.4` es infactible:
  `2×0.4 < 1`). La corrección lo dejó degenerado (con `wMaxEfectivo=0.5` la
  única solución es `[0.5, 0.5]`, pasa siempre). **Reemplazarlo** por:
  `Σ = diag(1,2,3)`, `wMax = 0.4`, n=3 → esperado **`[0.4, 0.36, 0.24]`**
  (el tope ata en un solo activo, los otros dos quedan en proporción no
  trivial).

### CAFCI — bloqueo confirmado, fallback construido

- **CloudFront bloquea a las Cloud Functions, no depende de la región**:
  falló igual en `southamerica-east1` y en `us-central1`. Experimento cerrado.
- Los headers de la CF son **idénticos** a los del Apps Script legacy que sí
  funcionaba (URL, User-Agent, Accept, Origin, Referer). La diferencia es el
  egress: `UrlFetchApp` sale por rangos de Apps Script, Node por los de Cloud
  Functions. Hipótesis: reputación de IP/ASN.
- Decisión tomada: **no reintroducir Apps Script**.
- Fallback: modal "Pegar JSON" por fondo en Config (CF `importarCafciManual`,
  parseo compartido con la sync automática vía `parsearFichaCafci`).
- **Pendiente**: verificar con `firebase functions:list` que
  `sincronizarCafci` quedó **una sola vez, en `southamerica-east1`**; que el
  código esté revertido en `functions/src/index.ts` (sin `region:
  'us-central1'`) y en `src/firebase.ts` (sin `functionsUsCentral`).
  Señal de que está bien: el toast dice `0/13 fondos · 13 con error (HTTP
  403)`. Si dice `internal`, cliente y servidor están desalineados.
- **Pendiente**: probar "Pegar JSON" con **un** fondo primero y comparar el
  doc resultante en `cafciCarteras` contra uno de la sync automática. Si anda,
  el benchmark queda destrabado.

### Card HOY y gastos fijos — implementado, pendiente de verificación visual

- Card HOY suma movimientos reales del día no matcheados (tipo local
  `HoyEntry`, sin tocar `AgendaEntry`); el pendiente usa
  `pendienteDeEntrada()` (monto real de matches, no `montoEsperado` null).
- Banner de fijos muestra `alDia/total` + monto a confirmar.
- **Pendiente**: verificar en pantalla con un día que tenga un esperado por
  confirmar + un movimiento real ya pagado.

---

## Deuda de proceso (recurrente)

- **Push**: Claude Code reportó tareas como terminadas sin mostrar `git push`
  ni `git log --oneline origin/main -1` en **cuatro** ocasiones de este ciclo.
  Exigir la evidencia antes de dar cualquier tarea por cerrada.
- **Baseline de `tsc`**: se movió de 48 a 41 errores preexistentes entre
  sesiones sin quedar registrado. Fijarlo y **anotarlo en el repo**, si no
  el control "0 errores nuevos" no significa nada.

---

## Próximos pasos, en orden

1. Terminar **F9.103** (backfill de `tcDiario`). El paso bloqueante es la
   validación del solapamiento 29/12/2025 → hoy: comparar API vs `tcDiario`
   día por día **antes** de escribir hacia atrás. Si aparecen diferencias
   sistemáticas, frenar (implicaría criterios distintos y un escalón
   artificial en el empalme → volatilidad falsa en todas las series AR).
2. Optim → Recalcular y confirmar que los `.BA` entran (TRAN, PAMP, TGSU2,
   ECOG, VIST, CEPU, TXAR, YPFD, BMA, GGAL, BIOX). Reportar cuántos entraron
   y el motivo de los que sigan afuera.
3. Verificar los pendientes de CAFCI y de Card HOY listados arriba.
4. Recalcular concentración post-venta de energía AR — quedó pendiente desde
   la corrida `patrimonio_2026-07-17.txt` y recién ahora se podrá hacer con
   el universo completo.
5. Fase 1 del sistema de benchmarking (schema unificado de posiciones) —
   sigue en pausa.

---

## Datos de referencia

- **TC**: cobertura actual 29/12/2025 → 21/07/2026 = 205 días, 30 semanas ISO.
  Hueco: 10–13/04/2026. Para 40 semanas hay que llegar al **14/10/2025**;
  para 104, al **23/07/2024**.
- **Fuente de TC**: cron F9.30 usa `dolarapi.com/v1/dolares/bolsa`, campo
  **`venta`**, 09:00 ART, `origen: 'dolarapi-bolsa'`. El backfill usa
  ArgentinaDatos `/v1/cotizaciones/dolares/bolsa` — **misma fuente upstream
  (DolarApi), misma casa, mismo campo**. Histórico desde **29/10/2018**.
- **Legacy**: el Apps Script nunca guardó serie diaria de TC (usaba
  `TC_MEP_REFERENCIA`, valor manual). No hay nada que migrar.
- **Commits**: F9.102 en `d9030e6`. Las siguientes, pendientes de confirmar
  en `origin/main`.
