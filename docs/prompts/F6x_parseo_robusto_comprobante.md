# F6.x addendum — parseo robusto de JSON en extraerComprobante

**Problema:** la extracción de comprobantes falla con `JSON inválido — raw (500c)` cuando el
modelo narra prosa antes del JSON. Se observó con una liquidación de expensas (Del Signo,
UF 043): el modelo razonó correctamente en texto ("Analizando el documento… Debo buscar la
UF 043…") pero el parser intentó `JSON.parse` sobre todo el string y reventó. Documentos
simples (ej. factura ITPA) no narran y pasan — por eso la asimetría recién se destapó ahora.

**Causa:** el path de comprobante en `functions/src/index.ts` (~líneas 150-159) solo saca
un fence ```json``` al inicio/fin y parsea el string entero. El path de resumen de tarjeta
(~líneas 913-920) ya hace extracción robusta (regex del bloque + `sanitizarJson`). Hay que
igualar comprobante a ese patrón.

**Archivo:** `functions/src/index.ts`, función `extraerComprobante` (path de parseo del
comprobante, NO el de resumen).

## Reemplazo exacto

Reemplazar este bloque:

```ts
      const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(cleaned) as Record<string, unknown>;
      } catch {
        throw new Error(`JSON inválido — raw (500c): ${raw.slice(0, 500)}`);
      }
```

por:

```ts
      // Extracción robusta: el modelo puede narrar prosa antes del JSON
      // (típico en docs complejos como liquidaciones de expensas). Mismo patrón
      // que extraerResumenTarjeta: bloque ```json``` o primer {…último }.
      const mdMatch  = raw.match(/```json\s*([\s\S]*?)\s*```/);
      const rawMatch = raw.match(/(\{[\s\S]*\})/);
      const jsonStr  = mdMatch ? mdMatch[1] : (rawMatch ? rawMatch[1] : null);
      if (!jsonStr) throw new Error(`Sin JSON en la respuesta (500c): ${raw.slice(0, 500)}`);

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(sanitizarJson(jsonStr)) as Record<string, unknown>;
      } catch {
        throw new Error(`JSON inválido — raw (500c): ${raw.slice(0, 500)}`);
      }
```

Notas:
- `sanitizarJson` ya existe a nivel de módulo (~línea 836). No redefinir, no importar.
- No tocar el prompt de extracción ni el path de resumen de tarjeta.
- Mantener intactas las validaciones posteriores (vencimientos, montoTotal, tipoDocumento,
  moneda, numeroOperacion).

## Build y prueba (obligatorio antes de probar)
1. `cd functions && npm run build` — el emulador corre `functions/lib` (compilado), no el .ts.
2. Reset opcional de emulator-data si querés un estado limpio, levantar emuladores.
3. Re-subir el PDF de expensas (Del Signo 4042). Criterio de éxito:
   - estado pasa a `extraido` (no `error`).
   - `montoTotal` = 387604.43 (total de la UF 043, NO el total del edificio).
   - `fecha` / vencimiento = 2026-06-15.
   - `destinoCuit` = 30636696281 (solo dígitos) y `destinoCbu` poblado.
4. Regresión: re-subir la factura ITPA SA y confirmar que sigue extrayendo igual ($220.000).

## Criterio de cierre
- El PDF de expensas llega a `extraido` con los campos correctos.
- La factura simple no se rompió.
- Cero cambios fuera del bloque indicado.
