import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator } from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  connectFirestoreEmulator, getFirestore,
} from 'firebase/firestore';
import { getStorage, connectStorageEmulator } from 'firebase/storage';
import { getFunctions, connectFunctionsEmulator } from 'firebase/functions';

// F9.48 — projectId/storageBucket vivían hardcodeados al id viejo (sin
// fallback de env, a diferencia del resto de estos campos) — un build de
// producción (fuera del emulador, donde el id no importa porque
// singleProjectMode lo resuelve por .firebaserc) apuntaba a un proyecto que
// no existe. Variables de .env.production (consola Firebase del proyecto
// gastos-familiares-e6415 → Configuración → Apps → Web app):
// VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID,
// VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_APP_ID,
// VITE_FIREBASE_MESSAGING_SENDER_ID.
const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY             ?? 'emulator-key',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN         ?? 'gastos-familiares-e6415.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID          ?? 'gastos-familiares-e6415',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET      ?? 'gastos-familiares-e6415.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID              ?? '',
};

export const app       = initializeApp(firebaseConfig);
export const auth      = getAuth(app);
export const storage   = getStorage(app);
export const functions = getFunctions(app, 'southamerica-east1');
// F9.102.2 3a — instancia extra para `sincronizarCafci`, que corre en us-central1 (experimento
// de región: CloudFront bloquea el egress de compute de southamerica-east1, ver F9.102.1/.2).
// El resto de las Cloud Functions sigue en `functions` (southamerica-east1). Si el experimento
// no resuelve el 403, esta instancia y la función vuelven a southamerica-east1 y se elimina.
export const functionsUsCentral = getFunctions(app, 'us-central1');

let _db: ReturnType<typeof initializeFirestore>;
try {
  _db = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  console.warn('[Firebase] offline cache no disponible, sin persistencia:', e);
  _db = getFirestore(app);
}
export const db = _db;

if (import.meta.env.DEV) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectStorageEmulator(storage, '127.0.0.1', 9199);
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
  connectFunctionsEmulator(functionsUsCentral, '127.0.0.1', 5001);
  console.log('[Firebase] conectado al emulador — Auth:9099  Firestore:8080  Storage:9199  Functions:5001');
}
