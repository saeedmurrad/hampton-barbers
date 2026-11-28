// Checks the database rules for the queue against the Firebase emulators (never the real project).
// Run:  npm run test:rules
import * as Q from '../src/lib/board.ts';

const P = 'hampton-barbers';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';
const DOCS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`;
const NAME = (p) => `projects/${P}/databases/(default)/documents/${p}`;
const res = [];
const ok = (c, label, detail = '') => res.push(`${c ? 'PASS' : 'FAIL'}  ${label}${!c && detail ? ': ' + detail : ''}`);
const allowed = (status, label) => ok(status === 200, label, `got ${status}`);
const refused = (status, label) => ok(status === 401 || status === 403, label, `got ${status}`);

const enc = (v) => v === null ? { nullValue: null }
  : typeof v === 'boolean' ? { booleanValue: v }
  : typeof v === 'number' ? (Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v })
  : typeof v === 'string' ? { stringValue: v }
  : { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
const call = async (method, url, body, token) => {
  const r = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return r.status;
};
const signUp = async (email) => {
  const r = await fetch(`${AUTH}/accounts:signUp?key=fake`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(email ? { email, password: 'test-pass-1', returnSecureToken: true } : { returnSecureToken: true }) });
  const j = await r.json();
  return { token: j.idToken, uid: j.localId };
};
// Saves a whole document.
const put = (who, path, data) => call('POST', `${DOCS}:commit`, { writes: [{ update: { name: NAME(path), fields: enc(data).mapValue.fields } }] }, who?.token);
// Sends only the listed fields, as the website does. A listed field missing from `data` is removed.
const patch = (who, path, data, mask) => call('POST', `${DOCS}:commit`, { writes: [{ update: { name: NAME(path), fields: enc(data).mapValue.fields }, updateMask: { fieldPaths: mask }, currentDocument: { exists: true } }] }, who?.token);
const get = (who, path) => call('GET', `${DOCS}/${path}`, undefined, who?.token);
const del = (who, path) => call('DELETE', `${DOCS}/${path}`, undefined, who?.token);
const f = (uid, field) => 't.`' + uid + '`' + (field ? '.' + field : '');

const BOARD = 'boards/hampton-vale';
const now = Date.now();
const owner = await signUp('owner@test.local');
const other = await signUp('someone-else@test.local');
const [a, b, c] = [await signUp(), await signUp(), await signUp()];
let seq = 0;
const ticket = (n, extra = {}) => ({ n, s: 'way', at: now, eta: 10, src: 'web', ...extra });
const join = (who, t, s = seq + 1) => patch(who, BOARD, { seq: s, t: { [who.uid]: t }, updatedAt: now }, ['seq', f(who.uid), 'updatedAt']);

refused(await put(a, 'site/owner', { uid: a.uid }), 'a visitor cannot make themselves the owner');
allowed(await put(owner, 'site/owner', { uid: owner.uid }), 'the first staff account becomes the owner');
refused(await put(a, BOARD, Q.openToday(null, now)), 'a visitor cannot create a shop queue');
refused(await put(other, BOARD, Q.openToday(null, now)), 'another email account cannot create a shop queue');
refused(await put(owner, 'boards/made-up-shop', Q.openToday(null, now)), 'the owner cannot create a queue for a shop that does not exist');
allowed(await put(owner, BOARD, Q.openToday(null, now)), 'the owner opens today’s queue');
allowed(await get(null, BOARD), 'anyone can read the queue without signing in (it holds no names)');

refused(await patch(null, BOARD, { seq: 1, t: { nobody: ticket(1) }, updatedAt: now }, ['seq', f('nobody'), 'updatedAt']), 'nobody can join without a sign-in');
refused(await join(a, ticket(5)), 'a visitor cannot pick their own ticket number');
refused(await join(a, ticket(3), 3), 'a visitor cannot skip numbers');
refused(await join(a, ticket(1, { s: 'chair', b: 'b1' })), 'a visitor cannot put themselves straight in a chair');
refused(await join(a, ticket(1, { vip: true })), 'a visitor cannot add extra fields to a ticket');
refused(await join(a, ticket(1, { eta: 600 })), 'a visitor cannot claim an arrival time hours away');
refused(await patch(a, BOARD, { seq: 1, t: { [b.uid]: ticket(1) }, updatedAt: now }, ['seq', f(b.uid), 'updatedAt']), 'a visitor cannot file a ticket under someone else');
allowed(await join(a, ticket(1)), 'a visitor takes number 1'); seq = 1;
refused(await join(a, ticket(2)), 'the same visitor cannot take a second number');
allowed(await join(b, ticket(2, { s: 'here', eta: 0, src: 'qr' })), 'a visitor at the door takes number 2, already in the shop'); seq = 2;
allowed(await join(c, ticket(3)), 'a third visitor takes number 3'); seq = 3;

refused(await patch(b, BOARD, { t: { [a.uid]: { s: 'here', arr: now } }, updatedAt: now }, [f(a.uid, 's'), f(a.uid, 'arr'), 'updatedAt']), 'a visitor cannot mark someone else as arrived');
refused(await patch(b, BOARD, { t: {}, updatedAt: now }, [f(a.uid), 'updatedAt']), 'a visitor cannot remove someone else’s ticket');
refused(await patch(a, BOARD, { t: { [a.uid]: { n: 0 } }, updatedAt: now }, [f(a.uid, 'n'), 'updatedAt']), 'a visitor cannot change their number to jump the line');
refused(await patch(a, BOARD, { t: { [a.uid]: { s: 'chair' } }, updatedAt: now }, [f(a.uid, 's'), 'updatedAt']), 'a visitor cannot seat themselves');
refused(await patch(a, BOARD, { online: false, updatedAt: now }, ['online', 'updatedAt']), 'a visitor cannot switch online joining off');
refused(await patch(a, BOARD, { staff: {}, updatedAt: now }, ['staff', 'updatedAt']), 'a visitor cannot change the barbers');
refused(await patch(a, BOARD, { seq: 0, updatedAt: now }, ['seq', 'updatedAt']), 'a visitor cannot reset the numbering');
refused(await patch(a, BOARD, { t: { [a.uid]: { eta: 120, late: 0 } }, updatedAt: now }, [f(a.uid, 'eta'), f(a.uid, 'late'), 'updatedAt']), 'a visitor cannot extend their place without using "running late"');
allowed(await patch(a, BOARD, { t: { [a.uid]: { eta: 20, late: 1 } }, updatedAt: now }, [f(a.uid, 'eta'), f(a.uid, 'late'), 'updatedAt']), 'a visitor can say they are running late');
refused(await patch(a, BOARD, { t: { [a.uid]: { eta: 30, late: 1 } }, updatedAt: now }, [f(a.uid, 'eta'), f(a.uid, 'late'), 'updatedAt']), 'but only once');
allowed(await patch(a, BOARD, { t: { [a.uid]: { s: 'here', arr: now } }, updatedAt: now }, [f(a.uid, 's'), f(a.uid, 'arr'), 'updatedAt']), 'a visitor can mark themselves arrived');
refused(await patch(a, BOARD, { t: { [a.uid]: { s: 'way' } }, updatedAt: now }, [f(a.uid, 's'), 'updatedAt']), 'and cannot undo it afterwards');
allowed(await patch(c, BOARD, { t: {}, updatedAt: now }, [f(c.uid), 'updatedAt']), 'a visitor can leave the queue');

allowed(await put(a, `${BOARD}/names/${a.uid}`, { name: 'Sam', at: now }), 'a visitor can save their own first name');
allowed(await get(a, `${BOARD}/names/${a.uid}`), 'and read it back');
refused(await get(b, `${BOARD}/names/${a.uid}`), 'another visitor cannot read that name');
refused(await get(null, `${BOARD}/names/${a.uid}`), 'nor can someone who is not signed in');
refused(await put(b, `${BOARD}/names/${a.uid}`, { name: 'Changed', at: now }), 'another visitor cannot change that name');
refused(await put(a, `${BOARD}/names/${a.uid}`, { name: 'x'.repeat(25), at: now }), 'a name longer than 24 letters is refused');
refused(await put(a, `${BOARD}/names/${a.uid}`, { name: 'Sam', at: now, phone: '07000 000000' }), 'nothing but a first name can be stored');
refused(await get(b, `${BOARD}/names`), 'a visitor cannot list the names in the queue');
refused(await get(other, `${BOARD}/names`), 'another email account cannot list the names');
allowed(await get(owner, `${BOARD}/names`), 'the owner can list the names');
refused(await del(b, `${BOARD}/names/${a.uid}`), 'a visitor cannot delete someone else’s name');

refused(await patch(other, BOARD, { online: false, updatedAt: now }, ['online', 'updatedAt']), 'another email account cannot run the queue');
const seated = Q.openToday(null, now);
seated.seq = 3;
seated.t = { [a.uid]: { ...ticket(1), s: 'chair', b: 'b1', ct: now, arr: now }, [b.uid]: ticket(2, { s: 'here', eta: 0, src: 'qr' }) };
seated.updatedAt = now + 1;
allowed(await put(owner, BOARD, seated), 'the owner can call a customer to a chair');
refused(await patch(a, BOARD, { t: {}, updatedAt: now }, [f(a.uid), 'updatedAt']), 'a customer in the chair cannot remove their own ticket');
allowed(await del(a, `${BOARD}/names/${a.uid}`), 'a visitor can delete their own name');
refused(await del(owner, BOARD), 'nobody, not even the owner, can delete a shop queue');
allowed(await put(owner, BOARD, { ...seated, online: false, updatedAt: now + 2 }), 'the owner can pause online joining');
refused(await join(c, ticket(4)), 'and then nobody can join online');
const full = Q.openToday(null, now);
for (let i = 1; i <= 40; i++) full.t[`w${i}`] = { n: i, s: 'here', at: now, eta: 0, src: 'desk', arr: now };
full.seq = 40; full.updatedAt = now + 3;
allowed(await put(owner, BOARD, full), 'the owner can save a queue of 40');
refused(await join(c, ticket(41), 41), 'a full queue takes no more online places');
refused(await put(owner, BOARD, { ...full, secret: 'x' }), 'even the owner cannot add unknown fields to a queue');
refused(await put(a, 'tickets/old-style', { shop: 'street', name: 'Sam', eta: 10, uid: a.uid, status: 'waiting' }), 'the old ticket list no longer accepts anything');

console.log(res.join('\n'));
console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} of ${res.length} passed`);
process.exit(res.some((r) => !r.startsWith('PASS')) ? 1 : 0);
