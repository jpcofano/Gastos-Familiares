# F6.x — descartarEntrada (cancelar comprobante O resumen mal cargado)

> Reemplaza el prompt previo `descartarComprobante`. Lo unifica: una sola callable cubre
> comprobante y resumen, igual que F6.7 unificó la subida. Solo **borrado** (delete); editar/
> modificar campos o líneas es otra feature aparte, no entra acá.

**Problema:** un comprobante mal subido o un resumen mal cargado no se pueden deshacer desde la
app. `entrantes` y `movimientos` son `delete:false` (locked al Admin SDK), y un resumen
confirmado generó 100+ movimientos hijos. Por eso es **callable admin-only**.

## Qué borra cada tipo
- **comprobante**: el doc, el entrante, el blob, y su movimiento (borrar si lo creó el
  comprobante / revertir el link si era un mov preexistente de rama 1).
- **resumen**: el doc, el entrante, el blob, y **todos** los movimientos con
  `resumenTarjetaId == id` (líneas + totales ARS/USD). Los `ajustesConsolidado`/cuadre viven en
  el doc del resumen → se van con él. Los movs de resumen no tienen `destino*` → no tocan `destinos`.
- **Fuera de alcance v1**: rollback de aprendizaje acumulativo (diccionario/destinos). Se devuelve
  advertencia para revisión manual; no se revierte.

---

## Parte A — stamp de procedencia (solo rama comprobante)

Igual que antes: marcar los movimientos creados DESDE un comprobante para distinguirlos de los
preexistentes vinculados por rama 1.

- `src/datos/movimientos.ts`, interfaz `NuevoMovimiento`: agregar `origenComprobanteId?: string;`
- `src/datos/movimientos.ts`, body de `crearMovimiento` (junto a hashPdf): `origenComprobanteId: payload.origenComprobanteId ?? null,`
- `src/vistas/Comprobantes.tsx`, `preloadBase`: agregar `origenComprobanteId: comp.id,`
- `confirmarRama1` NO lo setea (su ausencia marca "preexistente").

---

## Parte B — callable `descartarEntrada` en `functions/src/index.ts`

Espejar auth/admin de `resolverEntranteAmbiguo`.

```ts
export const descartarEntrada = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }

    const { tipo, id } = request.data as { tipo?: string; id?: string };
    if (!id) throw new HttpsError('invalid-argument', 'id requerido');
    if (tipo !== 'comprobante' && tipo !== 'resumen') {
      throw new HttpsError('invalid-argument', 'tipo debe ser "comprobante" o "resumen"');
    }

    const coleccion = tipo === 'comprobante' ? 'comprobantes' : 'resumenesTarjeta';
    const docRef = db.collection(coleccion).doc(id);
    const snap   = await docRef.get();
    if (!snap.exists) throw new HttpsError('not-found', `${tipo} no encontrado`);
    const data = snap.data()!;
    const refStorage = data.refStoragePdf as string | undefined;

    let borrados = 0, revertidos = 0;
    let advertenciaDestino: Record<string, unknown> | null = null;

    if (tipo === 'comprobante') {
      const movs = await db.collection('movimientos').where('hashPdf', '==', id).get();
      const batch = db.batch();
      for (const m of movs.docs) {
        if (m.data().origenComprobanteId === id) { batch.delete(m.ref); borrados++; }
        else {
          batch.update(m.ref, {
            hashPdf: null, refStoragePdf: null, confirmadoPago: false,
            itemEsperadoId: FieldValue.delete(),
            destinoCbu: null, destinoCuit: null, destinoAlias: null, destinoNombre: null,
            vencimientos: null, actualizadoEn: FieldValue.serverTimestamp(),
          });
          revertidos++;
        }
      }
      batch.delete(db.collection('entrantes').doc(id));
      batch.delete(docRef);
      await batch.commit();

      const d = data.datosExtraidos ?? {};
      if (d.destinoCbu || d.destinoCuit || d.destinoAlias) {
        advertenciaDestino = { destinoCuit: d.destinoCuit ?? null, destinoCbu: d.destinoCbu ?? null, destinoAlias: d.destinoAlias ?? null };
      }
    } else {
      // resumen: borrar todos los movimientos hijos + entrante + doc, en chunks (límite 500/batch)
      const movs = await db.collection('movimientos').where('resumenTarjetaId', '==', id).get();
      const refs = movs.docs.map(m => m.ref);
      refs.push(db.collection('entrantes').doc(id), docRef);
      for (let i = 0; i < refs.length; i += 400) {
        const batch = db.batch();
        for (const r of refs.slice(i, i + 400)) batch.delete(r);
        await batch.commit();
      }
      borrados = movs.size;
    }

    if (refStorage) {
      try { await getStorage().bucket().file(refStorage).delete(); }
      catch (e) { console.warn(`[descartarEntrada] blob no borrado: ${String(e)}`); }
    }

    console.log(`[descartarEntrada] ${tipo} ${id} — borrados:${borrados} revertidos:${revertidos} (por ${email})`);
    return { ok: true, tipo, borrados, revertidos, advertenciaDestino };
  },
);
```

Notas:
- El entrante y el doc comparten id == hash, así que `entrantes/{id}` es directo.
- Chunk de 400 por las dudas con resúmenes grandes (Firestore corta el batch en 500 ops).
- Limitación v1 (documentar en retorno, no resolver): el revert de rama 1 asume que
  hashPdf/itemEsperadoId/confirmadoPago/destino los puso el link; si el mov preexistente ya los
  tenía de otra fuente, se pisan. Caso raro.

---

## Parte C — UI: botón "Descartar" en AMBOS historiales (`src/vistas/Comprobantes.tsx` y la sección de resúmenes)

- Solo admin.
- Confirmación previa. Para resumen, avisar que se borran TODOS sus movimientos:
  "¿Descartar este resumen? Se borran sus N movimientos y el archivo."
- Invocar `httpsCallable(functions, 'descartarEntrada')` con `{ tipo, id }` (mismo patrón cliente
  que `resolverEntranteAmbiguo`). `tipo: 'comprobante'` en el historial de comprobantes,
  `tipo: 'resumen'` en el de resúmenes.
- Si vuelve `advertenciaDestino`, aviso no bloqueante (destino aprendido a revisar a futuro).
- Refrescar la lista tras éxito.

---

## Build y prueba (emulador)
1. `cd functions && npm run build`.
2. Reset `emulator-data`, levantar, re-seed.
3. **Comprobante rama 2/3**: subir → crear el mov → Descartar → el mov desaparece, comprobante y
   entrante borrados, re-subir el mismo archivo vuelve a rutear.
4. **Comprobante rama 1**: subir → confirmar link a un mov existente → Descartar → el mov SIGUE,
   pero sin hashPdf/itemEsperadoId/destino.
5. **Resumen**: cargar y confirmar un resumen (genera N movs) → Descartar → verificar que
   desaparecen los N movimientos (`resumenTarjetaId == id`), el resumen y el entrante, y que
   re-subir el mismo PDF vuelve a rutear.

## Criterio de cierre
- Los tres casos pasan.
- `entrantes` y `movimientos` solo se tocan vía la callable (Admin SDK).
- El stamp `origenComprobanteId` queda en movs creados desde comprobante, ausente en los vinculados.
