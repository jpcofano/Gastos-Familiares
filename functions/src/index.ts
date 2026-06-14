import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { setGlobalOptions }   from 'firebase-functions/v2';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

if (!getApps().length) initializeApp();

setGlobalOptions({ region: 'southamerica-east1' });

const db      = getFirestore();
const storage = getStorage();

export const extraerComprobante = onDocumentCreated(
  {
    document:       'comprobantes/{hash}',
    timeoutSeconds: 120,
    memory:         '512MiB',
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const comp = snap.data();

    // Guard: solo procesar estado 'subido' (idempotencia — re-subir no re-dispara)
    if (comp.estado !== 'subido') return;

    const ref = db.collection('comprobantes').doc(snap.id);

    try {
      const [fileBytes] = await storage
        .bucket()
        .file(comp.refStoragePdf as string)
        .download();

      if (!fileBytes || fileBytes.length === 0) {
        throw new Error('Archivo vacío o no encontrado en Storage');
      }

      // Stub — F6.2.1 reemplaza esto con la llamada a Anthropic
      const datosExtraidos = {
        tipoDocumento:       'STUB',
        fecha:               null,
        montoTotal:          null,
        moneda:              'ARS',
        comercioRazonSocial: null,
        cuit:                null,
        numeroOperacion:     'STUB',
      };

      await ref.update({
        estado:          'extraido',
        datosExtraidos,
        errorExtraccion: FieldValue.delete(),
        actualizadoEn:   FieldValue.serverTimestamp(),
      });

      console.log(
        `[extraerComprobante] ${snap.id} → extraido (stub, ${fileBytes.length} bytes)`,
      );
    } catch (e) {
      const mensaje = e instanceof Error ? e.message : String(e);
      console.error(`[extraerComprobante] error en ${snap.id}:`, mensaje);

      await ref.update({
        estado:          'error',
        errorExtraccion: mensaje,
        actualizadoEn:   FieldValue.serverTimestamp(),
      });
    }
  },
);
