# Gastos-Familiares — Resumen de sesión (handoff)

> Se pega al iniciar una nueva conversación. Fuente de verdad: repo
> https://github.com/jpcofano/Gastos-Familiares. HEAD remoto verificado por
> clon en esta sesión: **`80f6e5c`**.
> Regla de contexto: el dueño trabaja con "local ≥ remoto" (git = backup +
> visibilidad para Claude); auditar SOLO contra origin/main y pedir push cuando
> haga falta punto fijo.

---

## 0. ESTADO EN UNA LÍNEA

Construcción F9.9x COMPLETA y pusheada hasta `80f6e5c`. **INCIDENTE ABIERTO:
el deploy no se refleja en producción** (ninguna feature nueva visible, card
Hoy vacía) — código auditado y exonerado; el problema está en el pipeline de
deploy/hosting. Diagnóstico pendiente de 3 datos del dueño (ver §2).

## 1. Verificado en remoto (auditoría por clon + build en esta sesión)

Commits desde el arranque de la sesión: `f9c6c0c` (F9.98+F9.99) → `5bde5cc`
(docs) → `3fd6c72` (F9.99.5 + F9.99.2/3/4 + F9.97.1 + F9.99.1 en un
mega-commit) → `4953824` (F9.99.6) → `80f6e5c` (F9.92.1 + F9.99.7).

Implementado y verificado por marcadores en código:
- **F9.99.2** hotfix Chat por posición (prop `onAbrirChat` en TenenciasTab;
  causa raíz: setters fuera de scope + tsconfig sin `.tsx` → ahora incluidos).
- **F9.99.3** renderMarkdownLite, headers canónicos `## X [driver: y]` en
  sectorial, splitSectorialPorDriver, tickerADriver, permeado agenda/sectorial
  en posiciones, fix crash proximosEventos (normalizarEventoProximo).
- **F9.97.1** parser CAFCI con estructura CONFIRMADA (fuente: AppsScript viejo
  en producción): `nombreActivo` + `share`, `carteras[]` plano,
  `semanal.fechaDatos`, headers con `www.cafci.org.ar`. Seed 13 fondos
  acciones + 70 patrones de mapeo (docs/patrimonio/cafci-seed.json).
- **F9.99.1** modo `lote` en camino chat (generar/importar batch fail-soft,
  botón Chat en "Analizar toda la cartera").
- **F9.99.6** Function `descartarEntranteCompleto` + botón Descartar en
  bandeja (reemplaza script F9.99.5, que quedó deprecado); semáforo en el
  NETO (verde/rojo), Ingresos/Gastos neutros; tarjeta cobertura redefinida:
  `gastos del mes − pesos disponibles`, "Cubierto"/"Sin cubrir" + faltante en
  USD (sin checklist/asterisco); historial de Cargar colapsable (5 + Ver más).
- **F9.99.7** semántica de pagos: ventana match [mes−1..mes+3]; picker con
  futuros (cada uno con su mes); pago adelantado (mes intacto, `pagadoEn`,
  chip); débitos automáticos SIN auto-pagado por fecha, sección propia en
  Gastos Fijos, ciclo normal; fin del arrastre pasado-con-match-sin-confirmar;
  todo gateado por `MES_CORTE_SEMANTICA_PAGOS = '2026-07'` (meses previos
  conservan lectura legacy — decisión: solo hacia adelante); botón
  "Registrar pago" en accionables sin match → CREA movimiento confirmado
  (`registradoDesdeChecklist: true`; riesgo duplicado con extracto documentado,
  dedupe diferido); default `pagado` corregido en creación manual con fecha
  futura.
- **F9.92.1** check verde "Al día" + desglose por banco en card Hoy.
- Builds en el clon: vite ✅, functions tsc ✅, frontend `tsc --noEmit`: 41
  errores PRE-existentes (bajó de 43; ninguno en Patrimonio/checklist/Resumen).

## 2. INCIDENTE ABIERTO: deploy no visible

Síntoma: tras `firebase deploy` + borrar caché, NINGUNA feature nueva se ve;
card Hoy no muestra nada (en `80f6e5c` esa card se renderiza incondicional →
el bundle servido NO es este código).

Hechos clave:
- `firebase.json`: hosting `public: "dist"` SIN predeploy hooks → el deploy
  sube lo que haya en dist/ (si no se corre `npm run build` post-pull, sube
  bundle viejo).
- **Multi-sitio**: site de hosting = `gastos-familiares-jmsf`, proyecto =
  `gastos-familiares-e6415` → dos URLs posibles que pueden servir contenido
  distinto. Sospecha fuerte: la PWA instalada apunta a una URL ≠ la del deploy.
- Huella digital: build limpio de `80f6e5c` produce `dist/assets/index-vQymdI9O.js`.

Datos pendientes del dueño (discriminan todo):
1. URL exacta que imprime `firebase deploy` (Hosting URL) vs URL que abre la PWA.
2. En la máquina del deploy: `git log --oneline -1` + `git status` (¿HEAD
   80f6e5c? ¿cambios sin commitear?) y `ls -l dist/assets | grep index`
   (hash + FECHA del archivo).
3. Incógnito desktop → F12 → Network → nombre del `index-*.js` que carga.

Ramas: hash correcto en incógnito → caché PWA teléfono (borrar datos del
sitio/reinstalar). Hash viejo → dist viejo o URL/site equivocado.

## 3. Cola de trabajo (post-incidente)

1. Resolver deploy (§2) → refresh SW forzado.
2. Ronda de pruebas punta a punta, en orden de destrabe:
   a. Descartar el entrante RUTEADO trabado desde la bandeja (valida Function
      nueva + limpia huérfano F9.99.5 de una).
   b. ¿Aparecen los análisis IA ya pagados? (incidente tokens; causa probable
      eran rules sin deployar).
   c. Tarjeta cobertura ("Sin cubrir" + faltante USD con números reales) y
      Neto rojo.
   d. Chat por posición (hotfix): generar → pegar → importar; eventos
      estructurados sin crash; chip "vía chat".
   e. Sectorial: formato legible + secciones; permeado en posiciones (TRAN
      muestra agenda energia_ar + panorama del sector).
   f. Registrar pago en un vencido; sección Débitos automáticos.
   g. CAFCI: importar fondos sugeridos (13) → sincronizar (ojo 403 CloudFront:
      si bloquea a Functions, plan B = pegado manual) → mapear → BenchmarkTab.
   h. Lote vía chat (F9.99.1) con toggle IA OFF.
   i. F9.98 Optimización: fetch series Yahoo (mismo riesgo de bloqueo),
      correlaciones, 4 tests desde UI.
3. Segunda corrida real de resúmenes (~15-jul): Evolución + diff + Modified
   Dietz (registrar aportes/retiros ANTES — flujos no registrados contaminan
   el retorno para siempre; el dueño duda de hacerlo, queda a su criterio).
4. Inventario de 41 errores tsc pre-existentes (viejos, fuera de Patrimonio).
5. Unificación mayor `pagado`/`confirmadoPago`: SOLO propuesta de Code,
   decide el dueño (F9.x futuro).

## 4. Decisiones cerradas en esta sesión (no re-litigar)

- **MEP como fuente definitiva** (no CCL) — cerrada por el dueño; registrar
  sello de cierre en docs/patrimonio/CLAUDE-PATRIMONIO.md si falta.
- Tarjeta cobertura = gastos reales del mes vs pesos disponibles (reemplaza
  semántica F9.55 de esperados).
- Pago adelantado: el movimiento queda en su mes futuro, marcado pagado.
- Match automático: horizonte +3 meses; picker: mismo mes + todos los futuros
  con mes visible.
- Débitos automáticos: sin auto-pagado por fecha; sección propia; ciclo normal.
- Corrección de reglas de pagado SOLO hacia adelante (corte 2026-07).
- Limpieza de huérfanos: SIEMPRE desde UI (repetible), no scripts one-shot.
- Numeración: F9.x = features para Code (docs/prompts/); U-xx = prompts de
  uso (U-01 lote posiciones, U-02 sectorial, U-03 agenda — los del chat de la
  app son preferibles porque llevan datos frescos).

## 5. Reglas de trabajo (vigentes + aprendizajes nuevos)

- Push tras cada F9.x, mostrando salida de `git push` y `git log --oneline
  origin/main -1` (la regla declarativa falló 5 veces; la evidencia es
  criterio de aceptación en todos los prompts nuevos).
- El informe de Code NO es evidencia: auditar contra origin/main (esta sesión
  encontró 2 veces trabajo "terminado" sin pushear y 1 informe impreciso).
- `tsc --noEmit` manual antes de deploy (vite/esbuild NO tipa; el tsconfig
  excluía los .tsx — dos bugs de producción salieron de ahí).
- Auditar antes de tocar: las causas raíz de esta sesión (scope de setters,
  render de objetos, filtro de bandeja + script incompleto, reglas de pagado
  por fecha) salieron todas de leer el código, no de re-implementar.
- Explorar antes de codear APIs externas; estructura CAFCI ya confirmada
  (no re-abrir).
- Deploy: sin predeploy hooks — compilar a mano SIEMPRE antes; verificar
  Hosting URL vs URL de la PWA (multi-sitio jmsf/e6415).
