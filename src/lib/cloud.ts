// The Firebase side of the queue: sign-in, live updates and safe saves. Loaded only where it
// is needed: staff pages, the shop TV, and a customer's page once they hold a ticket.
import { initializeApp, getApps, deleteApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, initializeAuth, inMemoryPersistence, updatePassword, GoogleAuthProvider, signInWithPopup, signInWithCredential, sendPasswordResetEmail, deleteUser } from 'firebase/auth';
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
    // Local testing only (the emulator, never the real site): stands in for Google's own sign-in window.
    (window as unknown as Record<string, unknown>).__hbGoogle = (email: string, name = '') =>
      signInWithCredential(auth, GoogleAuthProvider.credential(JSON.stringify({ sub: `g-${email}`, email, email_verified: true, name })));
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

// A customer change. The customer is signed in to their own account, and the database rules
// let that account touch only the one ticket filed under it. Only the changed fields are sent.
export async function actCustomer(shop: string, fn: (b: Board, id: string, now: number) => Board): Promise<{ board: Board; id: string }> {
  const { auth, db } = fb();
  await auth.authStateReady();
  if (!auth.currentUser) throw Object.assign(new Error('sign in first'), { code: 'signin' });
  const id = auth.currentUser!.uid;
  const ref = doc(db, 'boards', shop);
  const once = () => runTransaction(db, async (tx) => {
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
  // When two customers act in the same second, the database rules can refuse the slower one
  // (its ticket number is already taken) instead of asking it to try again. Everything the
  // rules check has already been checked above, so a refusal here means "someone got in
  // first": read the queue again and retry, a few times, a moment apart.
  for (let attempt = 0; ; attempt++) {
    try {
      return { board: await once(), id };
    } catch (e) {
      if (!denied(e) || attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 300 * (attempt + 1)));
    }
  }
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

// ---------- staff logins ----------
export type StaffInfo = { uid: string; email: string; name: string; shop: string; b: string; role: 'barber' | 'desk'; at: number };
export type Role = 'owner' | 'staff' | 'new' | 'none';
const staffOf = (uid: string, d: Record<string, unknown>): StaffInfo => ({
  uid, email: String(d.email ?? ''), name: String(d.name ?? ''), shop: String(d.shop ?? ''), b: String(d.b ?? ''), role: d.role === 'barber' ? 'barber' : 'desk', at: Number(d.at ?? 0),
});
// What the signed-in account is to the shop: the owner, a staff login the owner added, the
// first login on a site nobody owns yet ('new'), or an account that has not been added ('none').
export async function whoAmI(): Promise<{ role: Role; staff: StaffInfo | null }> {
  const { auth, db } = fb();
  const uid = auth.currentUser?.uid;
  if (!uid) return { role: 'none', staff: null };
  try {
    const o = await getDoc(doc(db, 'site', 'owner'));
    if (!o.exists()) return { role: 'new', staff: null };
    if (o.data().uid === uid) return { role: 'owner', staff: null };
  } catch { /* the site has an owner, and it is someone else */ }
  try {
    const s = await getDoc(doc(db, 'staff', uid));
    if (s.exists()) return { role: 'staff', staff: staffOf(uid, s.data()) };
  } catch { /* not a staff login */ }
  return { role: 'none', staff: null };
}
export async function listStaff(): Promise<StaffInfo[]> {
  const snap = await getDocs(collection(fb().db, 'staff'));
  const out: StaffInfo[] = [];
  snap.forEach((d) => out.push(staffOf(d.id, d.data())));
  return out.sort((x, y) => x.name.localeCompare(y.name));
}
// The owner makes a login for a barber or for the shop tablet. The new account is created on
// a second, temporary connection, so the owner stays signed in. No email is sent to anyone.
export async function createStaffLogin(input: { email: string; password: string; name: string; shop: string; b: string }): Promise<StaffInfo> {
  const { auth, db } = fb();
  const second = initializeApp(cfg, `staff-maker-${Date.now()}`);
  try {
    const a2 = initializeAuth(second, { persistence: inMemoryPersistence });
    if (useEmulator()) connectAuthEmulator(a2, 'http://127.0.0.1:9099', { disableWarnings: true });
    let uid: string;
    try {
      uid = (await createUserWithEmailAndPassword(a2, input.email, input.password)).user.uid;
    } catch (e) {
      // The email already has an account: link it, but only if this is its password.
      if ((e as { code?: string }).code !== 'auth/email-already-in-use') throw e;
      uid = (await signInWithEmailAndPassword(a2, input.email, input.password)).user.uid;
    }
    await signOut(a2);
    if (uid === auth.currentUser?.uid) throw Object.assign(new Error('own'), { code: 'own-login' });
    const info = { email: input.email.slice(0, 120), name: input.name.trim().slice(0, 30), shop: input.b ? input.shop : '', b: input.b, role: input.b ? 'barber' as const : 'desk' as const, at: Date.now() };
    await setDoc(doc(db, 'staff', uid), info);
    return { ...info, uid };
  } finally {
    await deleteApp(second).catch(() => { /* already closed */ });
  }
}
export const removeStaffLogin = (uid: string) => deleteDoc(doc(fb().db, 'staff', uid));
export const changePassword = (password: string) => updatePassword(fb().auth.currentUser!, password);
// One barber's sales on one day (their own "takings today"; the rules refuse anyone else's).
export async function loadBarberDay(shop: string, b: string, day: string): Promise<Sale[]> {
  const snap = await getDocs(query(collection(fb().db, 'boards', shop, 'sales'), where('b', '==', b), where('day', '==', day)));
  const out: Sale[] = [];
  snap.forEach((d) => { const s = cleanSale(d.data(), d.id); if (s) out.push(s); });
  return out;
}


// ---------- accounts: one sign-in for everyone (owner, staff and customers) ----------
export type Account = { uid: string; email: string; name: string };
export function onAccount(cb: (a: Account | null) => void) {
  return onAuthStateChanged(fb().auth, (u) => cb(u && !u.isAnonymous ? { uid: u.uid, email: u.email ?? '', name: u.displayName ?? '' } : null));
}
export async function googleSignIn() {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ prompt: 'select_account' });
  await signInWithPopup(fb().auth, p);
}
export const emailSignIn = (email: string, password: string) => signInWithEmailAndPassword(fb().auth, email, password);
export const emailSignUp = (email: string, password: string) => createUserWithEmailAndPassword(fb().auth, email, password);
export const resetPassword = (email: string) => sendPasswordResetEmail(fb().auth, email);
export const accountSignOut = () => signOut(fb().auth);
// What to tell someone when signing in did not work.
export function authMessage(e: unknown): string {
  const code = String((e as { code?: string }).code ?? '');
  if (/invalid-credential|wrong-password|user-not-found/.test(code)) return 'The email or password is not right.';
  if (code.includes('email-already-in-use')) return 'That email already has an account. Sign in instead, or use Forgot password.';
  if (code.includes('weak-password')) return 'Choose a password with at least 8 characters.';
  if (code.includes('invalid-email') || code.includes('missing-email')) return 'That does not look like an email address.';
  if (code.includes('too-many-requests')) return 'Too many tries. Wait a few minutes and try again.';
  if (code.includes('popup-blocked')) return 'Your browser blocked the Google window. Allow pop-ups for this site and try again.';
  if (code.includes('popup-closed') || code.includes('cancelled-popup')) return 'The Google window was closed before signing in.';
  if (code.includes('operation-not-allowed') || code.includes('unauthorized-domain')) return 'This way of signing in is not switched on yet. Use email and password for now.';
  if (code.includes('account-exists-with-different-credential')) return 'That email already has an account. Sign in with its email and password.';
  return 'That did not work. Check your internet connection and try again.';
}

// ---------- a customer's own details ----------
// Only what the queue needs: first name, email and mobile. Never a date of birth or an address.
export type Profile = { name: string; email: string; mobile: string; at: number; seen: number };
export const cleanMobile = (x: string) => x.replace(/[\s().-]/g, '');
export const validMobile = (x: string) => /^\+?\d{9,15}$/.test(cleanMobile(x));
const profileOf = (d: Record<string, unknown>): Profile => ({ name: String(d.name ?? ''), email: String(d.email ?? ''), mobile: String(d.mobile ?? ''), at: Number(d.at ?? 0), seen: Number(d.seen ?? 0) });
export async function loadProfile(): Promise<Profile | null> {
  const { auth, db } = fb();
  const s = await getDoc(doc(db, 'customers', auth.currentUser!.uid));
  return s.exists() ? profileOf(s.data()) : null;
}
export async function saveProfile(input: { name: string; mobile: string }, old: Profile | null): Promise<Profile> {
  const { auth, db } = fb();
  const u = auth.currentUser!;
  const now = Date.now();
  const p: Profile = { name: input.name.trim().replace(/\s+/g, ' ').slice(0, 24), email: u.email ?? '', mobile: cleanMobile(input.mobile), at: old?.at || now, seen: now };
  await setDoc(doc(db, 'customers', u.uid), p);
  return p;
}
// The shop can ring a customer who is in the queue. Staff logins only, one customer at a time.
export async function customerContact(uid: string): Promise<{ name: string; mobile: string } | null> {
  const s = await getDoc(doc(fb().db, 'customers', uid));
  return s.exists() ? { name: String(s.data().name ?? ''), mobile: String(s.data().mobile ?? '') } : null;
}
// Everything held about the signed-in customer, for "Download my details".
export async function exportMine(shops: string[]): Promise<Record<string, unknown>> {
  const { auth, db } = fb();
  const u = auth.currentUser!;
  const tickets: Record<string, unknown> = {};
  for (const shop of shops) {
    const b = await getDoc(doc(db, 'boards', shop));
    const t = b.exists() ? cleanBoard(b.data()).t[u.uid] : undefined;
    if (t) tickets[shop] = t;
  }
  return { exportedAt: new Date().toISOString(), account: { email: u.email, signInMethods: u.providerData.map((x) => x.providerId), created: u.metadata.creationTime, lastSignIn: u.metadata.lastSignInTime }, details: await loadProfile(), ticketsToday: tickets };
}
// "Delete my account": gives up any place in a queue, removes the customer's details and then
// the sign-in itself. Firebase asks for a recent sign-in before it will remove the sign-in.
export async function deleteMine(shops: string[]): Promise<void> {
  const { auth, db } = fb();
  const u = auth.currentUser!;
  for (const shop of shops) {
    const ref = doc(db, 'boards', shop);
    const b = await getDoc(ref);
    const t = b.exists() ? cleanBoard(b.data()).t[u.uid] : undefined;
    if (t && t.s !== 'chair') await updateDoc(ref, { [`t.${u.uid}`]: deleteField(), updatedAt: Date.now() }).catch(() => { /* the shop clears it at the end of the day */ });
    await deleteDoc(doc(db, 'boards', shop, 'names', u.uid)).catch(() => { /* nothing stored */ });
  }
  await deleteDoc(doc(db, 'customers', u.uid));
  await deleteUser(u);
}
