// The Firebase side of the queue: sign-in, live updates and safe saves. Loaded only where it
// is needed: staff pages, the shop TV, and a customer's page once they hold a ticket.
import { initializeApp, getApps } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInAnonymously, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, doc, collection, onSnapshot, runTransaction, setDoc, deleteDoc, deleteField, getDoc, getDocs, query, where, updateDoc, serverTimestamp } from 'firebase/firestore';
import { cleanBoard, londonDay, openToday, QueueError, type Board } from './board';
import { cleanRules, cleanSale, type PayRules, type Sale } from './sales';
import { useEmulator } from './store';

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
  if (useEmulator()) {
    connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
    connectFirestoreEmulator(db, '127.0.0.1', 8080);
  }
  ready = { auth, db };
  return ready;
}
export const denied = (e: unknown) => String((e as { code?: string }).code ?? '').includes('permission');

// ---------- staff sign-in (real email accounts only; visitors' anonymous sign-ins never count) ----------
export const onStaff = (cb: (email: string | null) => void) => onAuthStateChanged(fb().auth, (u) => cb(u && !u.isAnonymous ? u.email ?? 'staff' : null));
export const staffSignIn = (email: string, password: string) => signInWithEmailAndPassword(fb().auth, email, password);
export const staffSignOut = () => signOut(fb().auth);

// ---------- live updates ----------
// Calls back at once and again on every change. `live` is false while the connection is down.
export function watchBoard(shop: string, cb: (b: Board | null, live: boolean) => void, onError?: () => void): () => void {
  return onSnapshot(doc(fb().db, 'boards', shop), { includeMetadataChanges: true },
    (snap) => cb(snap.exists() ? cleanBoard(snap.data()) : null, !snap.metadata.fromCache),
    () => onError?.());
}
export type Names = Record<string, { name: string; at: number }>;
export function watchNames(shop: string, cb: (names: Names) => void, onError?: () => void): () => void {
  return onSnapshot(collection(fb().db, 'boards', shop, 'names'), (snap) => {
    const m: Names = {};
    snap.forEach((d) => { m[d.id] = { name: String(d.data().name ?? ''), at: Number(d.data().at ?? 0) }; });
    cb(m);
  }, () => onError?.());
}
export const setName = (shop: string, id: string, name: string) => setDoc(doc(fb().db, 'boards', shop, 'names', id), { name: name.slice(0, 24), at: Date.now() });
export const dropName = (shop: string, id: string) => deleteDoc(doc(fb().db, 'boards', shop, 'names', id));

// ---------- saving ----------
// A staff change: read the latest queue, apply the change, save, all in one step, so two
// barbers tapping at the same moment can never overwrite each other.
export async function actStaff(shop: string, fn: (b: Board, now: number) => Board): Promise<Board> {
  const { auth, db } = fb();
  const ref = doc(db, 'boards', shop);
  const run = () => runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const next = fn(openToday(snap.exists() ? cleanBoard(snap.data()) : null, now), now);
    tx.set(ref, next);
    return next;
  });
  try {
    return await run();
  } catch (e) {
    if (!denied(e) || !auth.currentUser) throw e;
    await setDoc(doc(db, 'site', 'owner'), { uid: auth.currentUser.uid }); // the first staff account claims the site
    return run();
  }
}

// A customer change. No account: the visitor gets an anonymous sign-in, and the database
// rules let that sign-in touch only its own ticket. Only the changed fields are sent.
export async function actCustomer(shop: string, fn: (b: Board, id: string, now: number) => Board): Promise<{ board: Board; id: string }> {
  const { auth, db } = fb();
  await auth.authStateReady();
  if (!auth.currentUser) await signInAnonymously(auth);
  const id = auth.currentUser!.uid;
  const ref = doc(db, 'boards', shop);
  const board = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const cur = snap.exists() ? cleanBoard(snap.data()) : null;
    if (!cur || cur.day !== londonDay(now)) throw new QueueError('closed');
    const next = fn(cur, id, now);
    if (next === cur) return cur;
    const patch: Record<string, unknown> = { updatedAt: next.updatedAt };
    if (next.seq !== cur.seq) patch.seq = next.seq;
    const a = cur.t[id] as Record<string, unknown> | undefined;
    const z = next.t[id] as Record<string, unknown> | undefined;
    if (!z) patch[`t.${id}`] = deleteField();
    else if (!a) patch[`t.${id}`] = z;
    else for (const key of new Set([...Object.keys(a), ...Object.keys(z)])) if (a[key] !== z[key]) patch[`t.${id}.${key}`] = key in z ? z[key] : deleteField();
    tx.update(ref, patch);
    return next;
  });
  return { board, id };
}

// ---------- money: sales and the barbers' percentages ----------
// Finishing a cut and writing down the sale happen together, so a chair is never freed
// without its sale being saved, and a sale is never saved twice.
export async function finishSale(shop: string, make: (b: Board, now: number) => { board: Board; sale: Omit<Sale, 'id'> }): Promise<{ board: Board; sale: Sale }> {
  const { auth, db } = fb();
  const ref = doc(db, 'boards', shop);
  const saleRef = doc(collection(db, 'boards', shop, 'sales'));
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const made = make(openToday(snap.exists() ? cleanBoard(snap.data()) : null, now), now);
    const sale = { ...made.sale, by: auth.currentUser!.uid };
    tx.set(ref, made.board);
    tx.set(saleRef, { ...sale, ts: serverTimestamp() }); // the server's own time, used for the ten-minute correction window
    return { board: made.board, sale: { ...sale, id: saleRef.id } };
  });
}
export const changeSale = (shop: string, id: string, patch: Record<string, unknown>) => updateDoc(doc(fb().db, 'boards', shop, 'sales', id), patch);
// The owner's reports: every sale at a shop between two dates (inclusive).
export async function loadSales(shop: string, from: string, to: string): Promise<Sale[]> {
  const snap = await getDocs(query(collection(fb().db, 'boards', shop, 'sales'), where('day', '>=', from), where('day', '<=', to)));
  const out: Sale[] = [];
  snap.forEach((d) => { const s = cleanSale(d.data(), d.id); if (s) out.push(s); });
  return out;
}
export async function loadPay(shop: string): Promise<PayRules> {
  const s = await getDoc(doc(fb().db, 'boards', shop, 'private', 'pay'));
  return cleanRules(s.exists() ? s.data().rules : {});
}
export const savePay = (shop: string, rules: PayRules) => setDoc(doc(fb().db, 'boards', shop, 'private', 'pay'), { rules, updatedAt: Date.now() });
// Whether the signed-in account is the owner (the only one who may open the reports).
export async function amOwner(): Promise<boolean> {
  const { auth, db } = fb();
  try {
    const s = await getDoc(doc(db, 'site', 'owner'));
    return s.exists() && s.data().uid === auth.currentUser?.uid;
  } catch {
    return false; // the database refuses anyone who is not the owner
  }
}
