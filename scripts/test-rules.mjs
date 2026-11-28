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
  : Array.isArray(v) ? { arrayValue: { values: v.map(enc) } }
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
// Saves a sale the way the website does: the server stamps its own time on it.
const putSale = (who, path, data) => call('POST', `${DOCS}:commit`, { writes: [{ update: { name: NAME(path), fields: enc(data).mapValue.fields }, updateTransforms: [{ fieldPath: 'ts', setToServerValue: 'REQUEST_TIME' }] }] }, who?.token);
const get = (who, path) => call('GET', `${DOCS}/${path}`, undefined, who?.token);
const del = (who, path) => call('DELETE', `${DOCS}/${path}`, undefined, who?.token);
const f = (uid, field) => 't.`' + uid + '`' + (field ? '.' + field : '');

const BOARD = 'boards/hampton-vale';
const now = Date.now();
const owner = await signUp('owner@test.local');
const other = await signUp('someone-else@test.local');
// Customers have real accounts now. `anon` is a sign-in with no account at all.
const anon = await signUp();
const [a, b, c] = [await signUp('a@test.local'), await signUp('b@test.local'), await signUp('c@test.local')];
const details = (email, extra = {}) => ({ name: 'Sam', email, mobile: '07700900123', at: now, seen: now, ...extra });
let seq = 0;
const ticket = (n, extra = {}) => ({ n, s: 'way', at: now, eta: 10, src: 'web', ...extra });
const join = (who, t, s = seq + 1) => patch(who, BOARD, { seq: s, t: { [who.uid]: t }, updatedAt: now }, ['seq', f(who.uid), 'updatedAt']);

refused(await put(anon, 'site/owner', { uid: anon.uid }), 'a visitor cannot make themselves the owner');
allowed(await put(owner, 'site/owner', { uid: owner.uid }), 'the first staff account becomes the owner');
refused(await put(a, BOARD, Q.openToday(null, now)), 'a visitor cannot create a shop queue');
refused(await put(other, BOARD, Q.openToday(null, now)), 'another email account cannot create a shop queue');
refused(await put(owner, 'boards/made-up-shop', Q.openToday(null, now)), 'the owner cannot create a queue for a shop that does not exist');
allowed(await put(owner, BOARD, Q.openToday(null, now)), 'the owner opens today’s queue');
allowed(await get(null, BOARD), 'anyone can read the queue without signing in (it holds no names)');

refused(await patch(null, BOARD, { seq: 1, t: { nobody: ticket(1) }, updatedAt: now }, ['seq', f('nobody'), 'updatedAt']), 'nobody can join without a sign-in');
refused(await join(anon, ticket(1)), 'an anonymous sign-in can no longer take a ticket');
refused(await join(a, ticket(1)), 'an account that has not given its details cannot take a ticket');
refused(await put(a, `customers/${a.uid}`, details('a@test.local', { dob: '1990-01-01' })), 'customer details: a date of birth (or any extra field) is refused');
refused(await put(a, `customers/${a.uid}`, details('a@test.local', { address: '1 High Street' })), 'customer details: an address is refused');
refused(await put(a, `customers/${a.uid}`, details('someone-else@test.local')), 'customer details: the email must be the account’s own');
refused(await put(a, `customers/${a.uid}`, details('a@test.local', { mobile: 'call me' })), 'customer details: the mobile must be a phone number');
refused(await put(a, `customers/${a.uid}`, details('a@test.local', { name: '' })), 'customer details: a first name is required');
refused(await put(a, `customers/${b.uid}`, details('a@test.local')), 'customer details: nobody can write another customer’s record');
refused(await put(anon, `customers/${anon.uid}`, { name: 'X', email: '', mobile: '07700900123', at: now, seen: now }), 'customer details: an anonymous sign-in cannot have a record');
for (const [who, email] of [[a, 'a@test.local'], [b, 'b@test.local'], [c, 'c@test.local']]) allowed(await put(who, `customers/${who.uid}`, details(email)), `customer details: ${email} saves first name, email and mobile`);
allowed(await get(a, `customers/${a.uid}`), 'customer details: a customer can read their own');
refused(await get(b, `customers/${a.uid}`), 'customer details: another customer cannot read them');
refused(await get(null, `customers/${a.uid}`), 'customer details: nobody signed out can read them');
allowed(await get(owner, `customers/${a.uid}`), 'customer details: the shop can open one customer’s record');
refused(await get(owner, 'customers'), 'customer details: not even the owner can list every customer');
refused(await del(b, `customers/${a.uid}`), 'customer details: nobody else can delete them');
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

// ---------- money: sales and percentages ----------
const SALES = `${BOARD}/sales`;
const saleDoc = (who, extra = {}) => ({ shop: 'hampton-vale', day: '2026-11-28', at: Date.now(), b: 'b1', bn: 'Barber 1', chair: 1, n: 1, src: 'desk', svc: 'Skin Fade', price: 2000, pay: 'cash', wait: 5, mins: 20, by: who.uid, ...extra });
refused(await putSale(a, `${SALES}/s1`, saleDoc(a)), 'a visitor cannot record a sale');
refused(await putSale(other, `${SALES}/s1`, saleDoc(other)), 'an email account that is not staff cannot record a sale');
allowed(await putSale(owner, `${SALES}/s1`, saleDoc(owner)), 'the owner can record a sale');
refused(await putSale(owner, `${SALES}/s2`, saleDoc(owner, { price: -5 })), 'a negative price is refused');
refused(await putSale(owner, `${SALES}/s2`, saleDoc(owner, { pay: 'cheque' })), 'only cash, online or no charge are accepted');
refused(await putSale(owner, `${SALES}/s2`, saleDoc(owner, { shop: 'shop-2' })), 'a sale cannot be filed under a different shop');
refused(await put(owner, `${SALES}/s2`, saleDoc(owner)), 'a sale must carry the server’s own time');
refused(await put(owner, `${SALES}/s2`, saleDoc(owner, { ts: 12345 })), 'a sale cannot carry a made-up save time');
refused(await putSale(owner, `${SALES}/s2`, saleDoc(owner, { by: other.uid })), 'a sale cannot be recorded in someone else’s name');
refused(await putSale(owner, `${SALES}/s2`, saleDoc(owner, { void: { at: 1, why: 'x' } })), 'a sale cannot start out cancelled');
refused(await get(a, `${SALES}/s1`), 'a visitor cannot read a sale');
refused(await get(null, SALES), 'nobody can list the takings without signing in');
refused(await get(a, SALES), 'a visitor cannot list the takings');
allowed(await get(owner, SALES), 'the owner can list the takings');
refused(await del(owner, `${SALES}/s1`), 'nobody can delete a sale, not even the owner');
allowed(await put(owner, `${BOARD}/private/pay`, { rules: { b1: [{ from: '2026-11-28', pct: 40 }] }, updatedAt: now }), 'the owner can save the barbers’ percentages');
allowed(await get(owner, `${BOARD}/private/pay`), 'and read them back');
refused(await get(a, `${BOARD}/private/pay`), 'a visitor cannot read the percentages');
refused(await get(null, `${BOARD}/private/pay`), 'nor can someone who is not signed in');
allowed(await put(owner, 'site/owner', { uid: owner.uid, admins: [other.uid] }), 'the owner adds a staff login');
allowed(await putSale(other, `${SALES}/s3`, saleDoc(other)), 'a staff login can record a sale');
allowed(await get(other, `${SALES}/s3`), 'and read back the sale it just recorded');
refused(await get(other, `${SALES}/s1`), 'but not a sale someone else recorded');
refused(await get(other, SALES), 'a staff login cannot list the takings');
refused(await get(other, `${BOARD}/private/pay`), 'a staff login cannot read the percentages');
refused(await put(other, `${BOARD}/private/pay`, { rules: {} }), 'or change them');
allowed(await patch(other, `${SALES}/s3`, { pay: 'online', was: { svc: 'Skin Fade', price: 2000, pay: 'cash' } }, ['pay', 'was']), 'a staff login can correct its own sale straight away');
refused(await patch(other, `${SALES}/s3`, { void: { at: now, why: 'x' } }, ['void']), 'but cannot cancel a sale');
refused(await patch(other, `${SALES}/s3`, { b: 'b2' }, ['b']), 'or move it to another barber');
refused(await patch(other, `${SALES}/s1`, { pay: 'online' }, ['pay']), 'or change a sale someone else recorded');
allowed(await patch(owner, `${SALES}/s3`, { void: { at: now, why: 'entered twice' } }, ['void']), 'the owner can cancel a sale, with a reason');
refused(await patch(other, `${SALES}/s3`, { pay: 'cash' }, ['pay']), 'a cancelled sale cannot be changed by staff');
refused(await patch(owner, `${SALES}/s3`, { n: 99 }, ['n']), 'even the owner cannot rewrite which ticket a sale was for');

// ---------- staff logins ----------
const [sam, lee] = [await signUp('sam@test.local'), await signUp('lee@test.local')];
const staffDoc = (extra = {}) => ({ email: 'sam@test.local', name: 'Sam', shop: 'hampton-vale', b: 'b3', role: 'barber', at: now, ...extra });
// Asks for a barber's sales on one day, as the barber panel does.
const salesOf = (who, b, day = '2026-11-28') => call('POST', `${DOCS}/${BOARD}:runQuery`, { structuredQuery: { from: [{ collectionId: 'sales' }], where: { compositeFilter: { op: 'AND', filters: [
  { fieldFilter: { field: { fieldPath: 'b' }, op: 'EQUAL', value: { stringValue: b } } },
  { fieldFilter: { field: { fieldPath: 'day' }, op: 'EQUAL', value: { stringValue: day } } }] } } } }, who?.token);
refused(await patch(sam, BOARD, { online: true, updatedAt: now }, ['online', 'updatedAt']), 'a new email account cannot run the queue before the owner adds it');
refused(await put(sam, `staff/${sam.uid}`, staffDoc()), 'nobody can add themselves as staff');
refused(await put(other, `staff/${sam.uid}`, staffDoc()), 'a staff login cannot add another staff login');
refused(await put(owner, `staff/${sam.uid}`, staffDoc({ role: 'owner' })), 'a staff login cannot be given a made-up role');
refused(await put(owner, `staff/${owner.uid}`, staffDoc()), 'the owner cannot be turned into a staff login');
allowed(await put(owner, `staff/${sam.uid}`, staffDoc()), 'the owner adds a login for the barber on chair 3');
allowed(await get(sam, `staff/${sam.uid}`), 'that barber can read their own login record');
refused(await get(lee, `staff/${sam.uid}`), 'someone else cannot read it');
refused(await get(sam, 'staff'), 'a staff login cannot list the other logins');
allowed(await get(owner, 'staff'), 'the owner can list the staff logins');
allowed(await patch(sam, BOARD, { online: true, updatedAt: now }, ['online', 'updatedAt']), 'the new staff login can run the queue');
allowed(await putSale(sam, `${SALES}/s7`, saleDoc(sam, { b: 'b3' })), 'and record a sale');
allowed(await salesOf(sam, 'b3'), 'a barber can list their own sales for the day');
refused(await salesOf(sam, 'b1'), 'but not another barber’s');
refused(await get(sam, SALES), 'and not every sale');
refused(await get(sam, `${BOARD}/private/pay`), 'a barber cannot read the percentages');
refused(await put(sam, `staff/${sam.uid}`, staffDoc({ b: 'b1' })), 'a barber cannot move their own login to another profile');
refused(await put(sam, 'site/owner', { uid: sam.uid }), 'a staff login cannot take over as owner');
refused(await del(sam, `staff/${sam.uid}`), 'a staff login cannot remove logins');
allowed(await del(owner, `staff/${sam.uid}`), 'the owner removes the staff login');
refused(await patch(sam, BOARD, { online: false, updatedAt: now }, ['online', 'updatedAt']), 'and from then on it can no longer run the queue');
refused(await salesOf(sam, 'b3'), 'or see any sales');

allowed(await del(c, `customers/${c.uid}`), 'customer details: a customer can delete their own record');
refused(await get(owner, 'customers'), 'customer details: still no listing after that');

console.log(res.join('\n'));
console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} of ${res.length} passed`);
process.exit(res.some((r) => !r.startsWith('PASS')) ? 1 : 0);
