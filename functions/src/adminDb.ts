// F9.141 — bootstrap de Firestore para código de functions/ invocado desde scripts/.
//
// POR QUÉ VIVE ACÁ Y NO EN scripts/: el repo tiene DOS instalaciones de firebase-admin
// (raíz 12.7.0 para los scripts, functions/node_modules 13.10.0 para el deploy). Node resuelve
// el paquete desde la carpeta del archivo que importa, así que un script en scripts/ que se
// trae un módulo de functions/ termina con la clase `FieldValue` de un árbol y la instancia
// `Firestore` del otro. Los sentinelas se comparan por identidad de clase, y el resultado es:
//
//   Couldn't serialize object of type "ServerTimestampTransform" (found in field "actualizadoEn")
//
// El cron desplegado nunca lo sufre — allá todo resuelve dentro de functions/. Solo aparece
// corriendo por tsx desde la raíz. Al vivir este archivo en functions/src/, su `firebase-admin`
// resuelve al mismo árbol que el resto de functions/, y db y sentinelas quedan emparejados.
//
// Regla: un script que importe cualquier módulo de functions/ que toque Firestore usa ESTE
// bootstrap, nunca scripts/seed/utils/firestore.ts.
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';

export function getDbAdmin(target: 'emulator' | 'production'): Firestore {
  if (getApps().length > 0) return getFirestore();

  if (target === 'emulator') {
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
    initializeApp({ projectId: 'gastos-familiares-e6415' });
  } else {
    const keyPath = process.env.GOOGLE_APPLICATION_CREDENTIALS
                 || './secrets/serviceAccountKey.json';
    initializeApp({ credential: cert(keyPath) });
  }

  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  return db;
}
