# Investigación — universo del benchmark de renta variable argentina

**Solo lectura. No escribir en Firestore, no cambiar código de producción.**
Esto no es F9.143: es lo que hay que medir antes de poder escribirlo. Si la conclusión es que el
universo completo no es viable, eso también es un resultado y cambia el spec.

## Contexto y decisión ya tomada

El benchmark tiene que representar **el segmento de renta variable argentina**, no un promedio de
fondos elegidos a mano. Decidido por el dueño el 17/08.

Estado actual, medido en la auditoría del 16/08:

- 12 fondos configurados, sobre **62** del segmento con patrimonio.
- Cubren **29,5%** del patrimonio del segmento.
- Falta el #1: Superfondo Acciones (`fondoId 148`, ARS 197.609 M), que solo él vale casi tanto
  como los doce juntos.
- `calcBenchmark` (`src/datos/patrimonioCafci.ts:351-359`) promedia **equiponderado**: un fondo de
  ARS 2.253 M pesa igual que uno de ARS 86.503 M.

Las dos cosas —universo y ponderación— van juntas. Ampliar sin ponderar cambia la forma del sesgo,
no lo saca.

La línea de base del benchmark viejo está en `docs/patrimonio/benchmark-baseline-F9142.json`. Es
irremplazable: sirve para medir cuánto se mueve el número, y ese movimiento **no es una
corrección**, es un cambio de definición.

---

## §1 — `pb_get`: qué es y si sirve para un cron

`api.pub.cafci.org.ar/pb_get` se usó una vez en la auditoría, para una consulta puntual. Colgar el
benchmark de ahí es otra cosa. Medir y reportar:

- Qué devuelve exactamente: estructura, campos, tamaño de la respuesta.
- **Con qué frecuencia se actualiza.** La auditoría mencionó "planilla 20260813" — ¿es diaria,
  semanal, con qué retraso respecto de hoy?
- Si el patrimonio viene **por clase o por fondo**. Importa: Pionero tiene clases A (ARS 30.051 M)
  y B (ARS 14.357 M); ponderar por la clase equivocada subrepresenta al fondo.
- Si hay rate limiting, autenticación, o headers necesarios. Reportar los status crudos.
- Si el endpoint es estable o si —como pasó con la API vieja de CAFCI, que hoy devuelve 403
  universal— tiene pinta de poder desaparecer.

**Si `pb_get` no sirve para uso recurrente, decilo.** La alternativa sería derivar el universo de
`consulta-de-fondos.json`, que también se usó en la auditoría; medir si ese trae patrimonio o solo
el catálogo.

## §2 — Cuántos fondos tienen cartera publicada (el que puede cambiar todo)

El universo del segmento son 62 fondos. Pero el benchmark no necesita el patrimonio: necesita **la
composición de cartera**, que se lee de `estadisticas.cafci.org.ar/fondos/{id}?clase={c}`.

Medir, para los 62:

- Cuántos tienen ficha que responde 200 y de la que `extraerItemsCartera` saca items.
- Cuántos tienen `fechaCartera` reciente (menos de 60 días) y cuántos están congelados como
  Consultatio Renta Variable, que tenía cartera de enero y patrimonio cero.
- La distribución de `baseFondo` que tendrían: cuántos caen bajo `BASE_FONDO_MINIMA = 40` y
  quedarían fuera igual.
- Cuánto patrimonio del segmento cubren **los que efectivamente tienen cartera usable**, que es el
  número que importa, no el 100% teórico.

Hacerlo **serial y con pausa**. Son 62 fetches contra un sitio que ya dio 403 antes (F9.112) y del
que dependemos sin acuerdo alguno. Si aparecen bloqueos, parar y reportar en vez de insistir.

**Este punto puede cambiar el enfoque.** Si resulta que solo 20 fondos tienen cartera usable, el
"universo completo" no existe, y la pregunta pasa a ser otra: cuál es el corte —los que cubren el
80% del patrimonio, un mínimo de patrimonio, otro— y eso es una decisión del dueño, no una
inferencia.

## §3 — Costo de sincronizar el universo

Hoy `sincronizarCafci` recorre 12 fondos con un presupuesto de tiempo por lote
(`PRESUPUESTO_MS`, `functions/src/index.ts` en el entorno de `sincronizarCafci`) y ya corta si se
queda sin tiempo. Con N fondos:

- Cuánto tarda un fetch + parseo, medido, no estimado.
- Con ese número, cuántos fondos entran en el presupuesto actual.
- Si no entran todos: si conviene paginar en varias invocaciones, subir el timeout, o mover la
  sincronización a un cron en vez de un callable disparado a mano.

Reportar el número; **no elegir la solución todavía.**

## §4 — Simulación de impacto, sin escribir nada

Con los datos de §2, calcular `calcBenchmark` en cuatro variantes contra la corrida vigente, y
comparar las cuatro contra `benchmark-baseline-F9142.json`:

- **A** — 12 fondos, equiponderado (lo de hoy).
- **B** — 12 fondos, ponderado por patrimonio.
- **C** — universo usable, equiponderado.
- **D** — universo usable, ponderado por patrimonio.

Tabla de deltas por ticker para las cuatro. Interesa especialmente **cuánto de la diferencia viene
de la ponderación y cuánto del universo** — si una de las dos hace casi todo el trabajo, eso cambia
qué priorizar.

Referencia de por qué importa: en la corrida actual, TRAN da 22,68% propio contra 1,46% del
benchmark. Si ese número se mueve mucho entre variantes, la lectura de la concentración cambia.

## §5 — La pregunta de diseño que hay que dejar planteada

Ponderar por patrimonio tiene un efecto que conviene decir antes de implementarlo: **el benchmark
pasa a estar dominado por dos o tres fondos grandes.** Superfondo Acciones solo sería una fracción
enorme del total.

Eso es defendible —así se mueve el dinero del segmento— pero no es obviamente mejor que
equiponderar, que responde otra pregunta: qué hace el gestor típico. Son dos benchmarks distintos,
no uno bueno y uno malo.

Reportar, con el dato de §4, qué porcentaje del benchmark ponderado explican los tres fondos más
grandes. Si es más del 60%, vale plantearle la disyuntiva al dueño antes de implementar.

---

## Cierre

- [ ] Las cinco secciones reportadas con datos crudos.
- [ ] Explícito si `pb_get` sirve para uso recurrente o no.
- [ ] Explícito cuántos de los 62 tienen cartera usable, y cuánto patrimonio cubren.
- [ ] Las cuatro variantes del §4, con deltas contra la línea de base.
- [ ] Cero escrituras en Firestore. Cero cambios en producción. Scripts temporales borrados.

No propongas ni ejecutes ningún fix. Con estas salidas se escribe F9.143 — o se descubre que hay
que escribir otro.
