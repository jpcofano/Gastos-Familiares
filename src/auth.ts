import { GoogleAuthProvider, signInWithPopup, signOut, type User } from 'firebase/auth';
import { auth } from './firebase';

export async function signInConGoogle(): Promise<User | null> {
  const provider = new GoogleAuthProvider();
  try {
    const result = await signInWithPopup(auth, provider);
    return result.user;
  } catch (err: any) {
    if (err?.code === 'auth/popup-closed-by-user') return null;
    throw err;
  }
}

export async function signOutUsuario(): Promise<void> {
  await signOut(auth);
}
