import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { getFirestore, FieldValue, Timestamp, type Firestore } from 'firebase-admin/firestore';
import { google, type calendar_v3 } from 'googleapis';

// F9.43/F9.45 — Canal B: recordatorios en Google Calendar, vía OAuth (el dueño
// del mail de calendario del legacy — Config!B4, capturado en
// config/familia.calendarEmail — ya autorizó una vez; el refresh token vive
// en Secret Manager, NUNCA en Firestore). Idempotente por calendarEventId
// guardado en el propio doc:
// - itemsEsperados: 1 evento RECURRENTE mensual por ítem (no se recrea cada
//   mes — un solo evento con RRULE).
// - resumenesTarjeta: 1 evento PUNTUAL por resumen no confirmado; se borra al
//   confirmarse (ya no hace falta recordar un pago hecho).
//
// F9.46 — gate GLOBAL: `config/familia.calendarSync` (admin, switch único —
// es un calendario compartido, no por-ítem). Reemplaza el gate por-ítem
// `autoCalendario` de F9.45 (sigue existiendo en el modelo como opt-out
// futuro, pero hoy no gatea nada). Con el flag en false, una corrida borra
// los eventos que hubiera creado en vez de no hacer nada — para que apagar
// el switch limpie el calendario compartido.
const oauthClientId     = defineSecret('GOOGLE_OAUTH_CLIENT_ID');
const oauthClientSecret = defineSecret('GOOGLE_OAUTH_CLIENT_SECRET');
const oauthRefreshToken = defineSecret('GOOGLE_OAUTH_REFRESH_TOKEN');

const CALENDAR_SECRETS = [oauthClientId, oauthClientSecret, oauthRefreshToken];

function calendarClient(): calendar_v3.Calendar {
  const auth = new google.auth.OAuth2(oauthClientId.value(), oauthClientSecret.value());
  auth.setCredentials({ refresh_token: oauthRefreshToken.value() });
  return google.calendar({ version: 'v3', auth });
}

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function toDateSafe(v: unknown): Date | null {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v === 'string') { const d = new Date(`${v}T12:00:00`); return Number.isNaN(d.getTime()) ? null : d; }
  return null;
}

interface SyncResult { creados: number; actualizados: number; borrados: number; }

// ── itemsEsperados → evento recurrente mensual (1 por ítem) ─────────────────
// `syncOn`: el gate global de F9.46. En false, no crea nada — solo borra lo
// que hubiera y limpia calendarEventId (apagar el switch limpia el calendario).
async function syncEsperados(db: Firestore, calendar: calendar_v3.Calendar, calendarId: string, syncOn: boolean): Promise<SyncResult> {
  const snap = await db.collection('itemsEsperados').get();
  const out: SyncResult = { creados: 0, actualizados: 0, borrados: 0 };

  for (const doc of snap.docs) {
    const item = doc.data();
    const calendarEventId = item.calendarEventId as string | undefined;
    const quiere = syncOn && Boolean(item.activo) && item.tipo === 'Gasto' && item.diaVencimiento != null;

    if (!quiere) {
      if (calendarEventId) {
        try { await calendar.events.delete({ calendarId, eventId: calendarEventId }); }
        catch (e) { console.warn(`[calendarSync] borrar evento esperado ${doc.id}:`, e); }
        await doc.ref.update({ calendarEventId: FieldValue.delete() });
        out.borrados++;
      }
      continue;
    }

    const etiqueta = [item.categoria, item.subcategoria].filter(Boolean).join(' › ') || item.notas || 'Pago esperado';
    const dia = item.diaVencimiento as number;
    const hoy = new Date();
    let ancla = new Date(hoy.getFullYear(), hoy.getMonth(), dia);
    if (ancla < hoy) ancla = new Date(hoy.getFullYear(), hoy.getMonth() + 1, dia);

    const summary = `Vencimiento: ${etiqueta}`;
    const description = item.montoEsperado != null ? `Monto esperado: ${item.moneda} ${item.montoEsperado}` : undefined;

    if (!calendarEventId) {
      const res = await calendar.events.insert({
        calendarId,
        requestBody: { summary, description, start: { date: isoDate(ancla) }, end: { date: isoDate(ancla) }, recurrence: ['RRULE:FREQ=MONTHLY'] },
      });
      await doc.ref.update({ calendarEventId: res.data.id });
      out.creados++;
      continue;
    }

    try {
      await calendar.events.patch({ calendarId, eventId: calendarEventId, requestBody: { summary, description } });
      out.actualizados++;
    } catch (e) {
      // Evento borrado a mano en Calendar (404 u otro) — recrear.
      console.warn(`[calendarSync] patch evento esperado ${doc.id} falló, recreando:`, e);
      const res = await calendar.events.insert({
        calendarId,
        requestBody: { summary, description, start: { date: isoDate(ancla) }, end: { date: isoDate(ancla) }, recurrence: ['RRULE:FREQ=MONTHLY'] },
      });
      await doc.ref.update({ calendarEventId: res.data.id });
      out.creados++;
    }
  }
  return out;
}

// ── resumenesTarjeta → evento puntual (1 por resumen no confirmado) ─────────
async function syncResumenesTarjeta(db: Firestore, calendar: calendar_v3.Calendar, calendarId: string, syncOn: boolean): Promise<SyncResult> {
  const snap = await db.collection('resumenesTarjeta').get();
  const out: SyncResult = { creados: 0, actualizados: 0, borrados: 0 };

  for (const doc of snap.docs) {
    const r = doc.data();
    const calendarEventId = r.calendarEventId as string | undefined;
    const fechaVencimiento = toDateSafe(r.fechaVencimiento);
    const quiere = syncOn && r.estado !== 'confirmado' && fechaVencimiento != null;

    if (!quiere) {
      if (calendarEventId) {
        try { await calendar.events.delete({ calendarId, eventId: calendarEventId }); }
        catch (e) { console.warn(`[calendarSync] borrar evento resumen ${doc.id}:`, e); }
        await doc.ref.update({ calendarEventId: FieldValue.delete() });
        out.borrados++;
      }
      continue;
    }
    if (calendarEventId) continue; // ya sincronizado — fechaVencimiento no cambia una vez parseada

    const fechaIso = isoDate(fechaVencimiento!);
    const totales = [
      r.totalARS > 0 ? `$ ${Math.round(r.totalARS)}` : null,
      r.totalUSD > 0 ? `U$S ${Math.round(r.totalUSD)}` : null,
    ].filter(Boolean).join(' / ') || undefined;

    const res = await calendar.events.insert({
      calendarId,
      requestBody: { summary: `Vencimiento tarjeta: ${r.tarjeta || r.banco}`, description: totales, start: { date: fechaIso }, end: { date: fechaIso } },
    });
    await doc.ref.update({ calendarEventId: res.data.id });
    out.creados++;
  }
  return out;
}

async function correrSync() {
  const db = getFirestore();
  const famSnap = await db.collection('config').doc('familia').get();
  const fam = famSnap.data();
  const syncOn = fam?.calendarSync === true;
  const calendarEmail = fam?.calendarEmail as string | null | undefined;

  if (syncOn && !calendarEmail) {
    console.warn('[calendarSync] calendarSync:true pero config/familia.calendarEmail no está seteado — no se puede elegir calendario, no se sincroniza nada.');
    return { esperados: { creados: 0, actualizados: 0, borrados: 0 }, resumenes: { creados: 0, actualizados: 0, borrados: 0 } };
  }

  const calendar = calendarClient();
  // calendarId: si el flag está off, igual hay que poder borrar eventos viejos
  // aunque calendarEmail ya no esté — 'primary' es el mismo calendario de la
  // cuenta que autorizó el OAuth, suficiente para el borrado de limpieza.
  const calendarId = calendarEmail ?? 'primary';
  const esperados = await syncEsperados(db, calendar, calendarId, syncOn);
  const resumenes = await syncResumenesTarjeta(db, calendar, calendarId, syncOn);
  console.log(
    `[calendarSync] syncOn=${syncOn} calendarId=${calendarId} · esperados +${esperados.creados} ~${esperados.actualizados} -${esperados.borrados} · ` +
    `resúmenes +${resumenes.creados} -${resumenes.borrados}`,
  );
  return { esperados, resumenes };
}

export const sincronizarRecordatoriosCalendar = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/Argentina/Buenos_Aires', region: 'southamerica-east1', secrets: CALENDAR_SECRETS },
  async () => { await correrSync(); },
);

// Callable admin-only para probar el sync sin esperar al cron diario.
export const sincronizarCalendarAhora = onCall(
  { region: 'southamerica-east1', secrets: CALENDAR_SECRETS },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const db = getFirestore();
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }
    const resultado = await correrSync();
    return { ok: true, ...resultado };
  },
);

// F9.46 — switch global (admin-only), mismo patrón auth→/autorizados→escribir
// que las configs F9.36–41. No corre el sync acá — el cron diario (o
// sincronizarCalendarAhora) recoge el cambio en su próxima corrida.
export const setCalendarSync = onCall(
  { region: 'southamerica-east1' },
  async (request) => {
    if (!request.auth) throw new HttpsError('unauthenticated', 'No autenticado');
    const email = request.auth.token.email?.toLowerCase();
    if (!email) throw new HttpsError('unauthenticated', 'Email no disponible');
    const db = getFirestore();
    const autSnap = await db.collection('autorizados').doc(email).get();
    if (!autSnap.exists || autSnap.data()?.rol !== 'admin') {
      throw new HttpsError('permission-denied', 'Se requiere rol admin');
    }
    const { activo } = (request.data ?? {}) as { activo?: unknown };
    if (typeof activo !== 'boolean') throw new HttpsError('invalid-argument', 'activo debe ser boolean');

    await db.collection('config').doc('familia').update({ calendarSync: activo, actualizadoEn: FieldValue.serverTimestamp() });
    console.log(`[setCalendarSync] calendarSync=${activo} por ${email}`);
    return { ok: true };
  },
);
