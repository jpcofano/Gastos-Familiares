import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, Firestore } from 'firebase-admin/firestore';

export function getDb(target: 'emulator' | 'production'): Firestore {
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

export async function writeBatch(db: Firestore, collection: string, docs: { id: string; [k: string]: any }[]) {
  const BATCH_SIZE = 400;
  for (let i = 0; i < docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    for (const doc of docs.slice(i, i + BATCH_SIZE)) {
      const { id, ...rest } = doc;
      batch.set(db.collection(collection).doc(id), rest);
    }
    await batch.commit();
  }
}
