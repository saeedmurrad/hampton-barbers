// Joining and leaving the online queue. Loaded only when a visitor taps "Join the queue",
// so the Firebase code never slows down normal page loads.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, signInAnonymously, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, addDoc, deleteDoc, doc, collection, serverTimestamp } from 'firebase/firestore/lite';

const cfg = {
  apiKey: import.meta.env.PUBLIC_FB_API_KEY, authDomain: import.meta.env.PUBLIC_FB_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FB_PROJECT_ID, appId: import.meta.env.PUBLIC_FB_APP_ID,
};

let ready: { auth: ReturnType<typeof getAuth>; db: ReturnType<typeof getFirestore> } | null = null;
function fb() {
  if (ready) return ready;
  if (!cfg.apiKey || !cfg.projectId) throw new Error('not-configured');
  const app = getApps()[0] ?? initializeApp(cfg);
  const auth = getAuth(app);
  const db = getFirestore(app);
  // Local testing only (never on the real site): add ?emulator to use the Firebase emulators.
  if (/^(localhost|127\.0\.0\.1|.+\.test)$/.test(location.hostname) && new URLSearchParams(location.search).has('emulator')) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  ready = { auth, db };
  return ready;
}

// Saves a place in the queue and returns its ticket id. No account needed: the visitor gets
// an anonymous sign-in so only they (and the shop) can see or remove their ticket.
export async function joinCloud(t: { shop: string; name: string; eta: number }): Promise<string> {
  const { auth, db } = fb();
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const ref = await addDoc(collection(db, 'tickets'), {
    shop: t.shop, name: t.name, eta: t.eta, uid: auth.currentUser!.uid, status: 'waiting', createdAt: serverTimestamp(),
  });
  return ref.id;
}

export async function leaveCloud(id: string): Promise<void> {
  const { auth, db } = fb();
  await auth.authStateReady(); // same anonymous visitor as when they joined
  if (!auth.currentUser) await signInAnonymously(auth);
  await deleteDoc(doc(db, 'tickets', id));
}
