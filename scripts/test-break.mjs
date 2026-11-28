// Tries to BREAK the queue system, against the Firebase emulators (never the real project):
// two devices tapping at the same instant, double submits, script-injection in names, junk
// prices and percentages, a dropped internet connection, an overdue customer, a new day,
// and logins that should not get in.
// Run:  npm run build && npm run test:break      (needs Java 21 for the emulators)
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { launch, open, ok, report, txt, tap, setValue, submit, waitText, signIn, sleep, newAccount, readBoard, editBoard, countSales, res, PHONE, LAPTOP, TV } from './harness.mjs';

const OUT = path.resolve(process.argv[2] ?? '.check');
await mkdir(OUT, { recursive: true });
const browser = await launch();
const EVIL = '<img src=x onerror=1>'; // would add a picture element to the page if it were not treated as text
// Customer accounts. In the join step: create an account with an email and password...
const signUpIn = async (pg, email) => {
  await pg.waitForSelector('#join-dialog [data-step="signin"]:not([hidden])', { timeout: 15000 });
  await tap(pg, '#join-dialog [data-si="mode"]');
  await setValue(pg, '#join-dialog [data-si-form] input[name=email]', email);
  await setValue(pg, '#join-dialog [data-si-form] input[name=password]', 'test-pass-1');
  await submit(pg, '#join-dialog [data-si-form]');
  await pg.waitForSelector('#join-dialog [data-step="profile"]:not([hidden])', { timeout: 15000 });
};
// ...then give a first name and a mobile number.
const giveDetails = async (pg, name, mobile = '07700 900123') => {
  await setValue(pg, '[data-profile-form] input[name=name]', name);
  await setValue(pg, '[data-profile-form] input[name=mobile]', mobile);
  await submit(pg, '[data-profile-form]');
};
const joinStep = (pg) => pg.waitForSelector('#join-dialog [data-step="join"]:not([hidden])', { timeout: 15000 });
// Take a ticket: a new customer signs up on the way, a returning one goes straight through,
// and on the demo queue (nobody signed in anywhere) a first name is all it takes.
const joinAs = async (pg, name, email) => {
  await pg.waitForSelector('[data-join]:not([disabled])', { timeout: 15000 });
  await tap(pg, '[data-join]');
  await pg.waitForSelector('#join-dialog [data-step="signin"]:not([hidden]), #join-dialog [data-step="join"]:not([hidden])', { timeout: 15000 });
  if (await pg.$('#join-dialog [data-step="signin"]:not([hidden])')) { await signUpIn(pg, email); await giveDetails(pg, name); await joinStep(pg); }
  else if (await pg.$eval('[data-name-field]', (e) => !e.hidden)) await setValue(pg, '[data-join-form] input[name=name]', name);
  await submit(pg, '[data-join-form]');
};
const clean = (pg) => pg.evaluate(() => !document.querySelector('img[src="x"]'));
const addWalkIn = async (pg, name) => { await setValue(pg, '[data-add] input', name); await submit(pg, '[data-add]'); await sleep(900); };
const tickets = async () => Object.values((await readBoard())?.t ?? {});

await newAccount('owner@test.local');
await newAccount('stranger@test.local');

try {
  const A = await open(await browser.createBrowserContext(), '/admin/live/?emulator', LAPTOP, 'desk');
  await signIn(A, '#qd-signin');
  await waitText(A, '#qd-account', /Signed in as/);
  await waitText(A, '[data-banner]', /not open yet/);
  await tap(A, '[data-open]');
  await waitText(A, '#qd-status', /Live for everyone/);

  // ---------- logins that should not get in ----------
  const X = await open(await browser.createBrowserContext(), '/admin/live/?emulator', LAPTOP, 'intruder');
  await signIn(X, '#qd-signin', 'owner@test.local', 'not-the-password');
  ok(await waitText(X, '#qd-account', /email or password is not right/), 'sign-in: a wrong password is refused with a clear message', await txt(X, '#qd-account'));
  await signIn(X, '#qd-signin', 'stranger@test.local');
  ok(await waitText(X, '#qd-status', /has not been added to the shop yet/), 'sign-in: an email the owner has not added is told so', await txt(X, '#qd-status'));
  await addWalkIn(X, 'Intruder');
  ok(await waitText(X, '#qd-status', /not allowed/), 'sign-in: that login cannot change the queue', await txt(X, '#qd-status'));
  ok((await tickets()).length === 0, 'sign-in: and nothing was added to the queue', JSON.stringify(await tickets()));
  ok(await X.$eval('[data-logins]', (el) => el.hidden), 'sign-in: it cannot see the staff logins section');

  // ---------- two devices at the same instant ----------
  const B = await open(await browser.createBrowserContext(), '/barber/?shop=hampton-vale&emulator', PHONE, 'barber');
  await signIn(B, '#bp-signin');
  await waitText(B, '#bp-account', /Signed in/);
  await tap(B, '[data-me="b2"]');
  await addWalkIn(A, 'Solo');
  await waitText(B, '[data-chair]', /Next for you 1/);
  await Promise.all([tap(A, '[data-call="b1"]'), tap(B, '[data-call]')]);
  await sleep(3000);
  const seated = (await tickets()).filter((k) => k.s === 'chair');
  ok(seated.length === 1 && (await tickets()).length === 1, 'same instant: two barbers call the only waiting customer and exactly one gets them', JSON.stringify(await tickets()));
  const winner = seated[0]?.b ?? 'b1';
  ok(/Nobody is waiting/.test(winner === 'b1' ? await txt(B, '#bp-status') : await txt(A, '#qd-status')), 'same instant: the other barber is told nobody is waiting', `${await txt(A, '#qd-status')} | ${await txt(B, '#bp-status')}`);

  const C = await open(await browser.createBrowserContext(), '/admin/live/?emulator', LAPTOP, 'desk2');
  await signIn(C, '#qd-signin');
  const seen = await waitText(C, '[data-chairs]', new RegExp(`1 \\w Barber ${winner === 'b1' ? 1 : 2} Chair ${winner === 'b1' ? 1 : 2} · Solo`));
  ok(seen && /· Solo/.test(await txt(A, '[data-chairs]')), 'same instant: both desks show the customer in the chair', `winner ${winner} | A: ${await txt(A, '[data-chairs]')} | C: ${await txt(C, '[data-chairs]')} | C account: ${(await txt(C, '#qd-account')).slice(0, 60)}`);
  for (const pg of [A, C]) {
    await tap(pg, `[data-finish="${winner}"]`);
    await pg.waitForSelector('dialog.pay[open]', { timeout: 6000 });
    await tap(pg, '.pay [data-svc="0"]');
    await tap(pg, '.pay [data-pay="cash"]');
  }
  await Promise.all([tap(A, '.pay [data-save]'), tap(C, '.pay [data-save]')]);
  await sleep(3500);
  ok(await countSales() === 1, 'same instant: two screens finish the same cut and one sale is saved, not two', String(await countSales()));
  const both = `${await txt(A, '#qd-status')} | ${await txt(C, '#qd-status')}`;
  ok(/already finished on another screen/.test(both), 'same instant: the second screen is told the cut was already finished', both);

  const C1 = await open(await browser.createBrowserContext(), '/queue/hampton-vale/?emulator', PHONE, 'customer1');
  const C2 = await open(await browser.createBrowserContext(), '/queue/hampton-vale/?emulator', PHONE, 'customer2');
  for (const pg of [C1, C2]) await pg.waitForSelector('[data-join]:not([disabled])', { timeout: 15000 });
  for (const [pg, name, email] of [[C1, EVIL, 'c1@test.local'], [C2, 'Twin', 'c2@test.local']]) { await tap(pg, '[data-join]'); await signUpIn(pg, email); await giveDetails(pg, name); await joinStep(pg); }
  await Promise.all([submit(C1, '[data-join-form]'), submit(C1, '[data-join-form]'), submit(C2, '[data-join-form]')]);
  await sleep(3500);
  const nums = (await tickets()).map((k) => k.n).sort((x, y) => x - y);
  ok(nums.join() === '2,3', 'same instant: two customers join (one double-tapping) and get tickets 2 and 3, no duplicates', nums.join());

  // ---------- hostile text typed into every free-text box ----------
  await addWalkIn(A, EVIL);
  await setValue(A, '[data-barber="b3"] input[data-f="name"]', '<img src=x>Bad');
  await setValue(A, '#qd-note', EVIL);
  await sleep(2000);
  const T = await open(await browser.createBrowserContext(), '/board/hampton-vale/?emulator', TV, 'tv');
  await waitText(T, '[data-conn]', /^Live$/);
  ok(await waitText(A, '[data-queue]', /<img src=x onerror=1>/), 'hostile text: the desk shows a name typed as code as plain text', (await txt(A, '[data-queue]')).slice(0, 160));
  ok(await waitText(C2, '[data-live="note"]', /<img src=x onerror=1>/), 'hostile text: the shop message shows as plain text on a customer’s phone', await txt(C2, '[data-live="note"]'));
  ok(/Hi, <img src=x onerror=1>/.test(await txt(C1, '[data-hi]')), 'hostile text: a customer’s own name typed as code shows as plain text on their ticket', await txt(C1, '[data-hi]'));
  for (const [name, pg] of [['queue desk', A], ['second desk', C], ['barber phone', B], ['shop TV', T], ['first customer phone', C1], ['second customer phone', C2]]) {
    ok(await clean(pg), `hostile text: nothing was injected into the ${name}`);
  }

  // ---------- junk in the price box ----------
  await tap(A, '[data-call="b1"]');
  const called = await A.waitForSelector('[data-finish="b1"]', { timeout: 15000 }).then(() => true, () => false);
  ok(called, 'payment: the desk calls the next customer to chair 1', `${await txt(A, '#qd-status')} | ${await txt(A, '[data-chairs]')} | ${(await txt(A, '[data-queue]')).slice(0, 200)}`);
  await tap(A, '[data-finish="b1"]');
  await A.waitForSelector('dialog.pay[open]', { timeout: 6000 });
  await tap(A, '.pay [data-pay="cash"]');
  for (const [junk, why] of [['abc', 'letters'], ['-5', 'a negative amount'], ['1e9', 'a number in code form'], ['99999', 'an absurd amount']]) {
    await setValue(A, '.pay input[name=price]', junk);
    await tap(A, '.pay [data-save]');
    ok(/Type the price as a number/.test(await txt(A, '.pay__err')) && await A.$eval('dialog.pay', (d) => d.open), `payment: ${why} in the price box is refused`, await txt(A, '.pay__err'));
  }
  await setValue(A, '.pay input[name=price]', '12,5');
  await tap(A, '.pay [data-save]');
  ok(await waitText(A, '.staff-toast', /finished: £12\.50 cash/), 'payment: 12,5 typed with a comma is saved as £12.50', await txt(A, '.staff-toast'));

  // ---------- junk percentages ----------
  const R = await open(A.browserContext(), '/admin/reports/?emulator', LAPTOP, 'reports');
  await waitText(R, '#rp-status', /real figures/);
  for (const junk of ['150', '-5', '']) {
    await setValue(R, '[data-pct="hampton-vale/b1"]', junk);
    await tap(R, '[data-save-pct="hampton-vale/b1"]');
    ok(await waitText(R, '#rp-status', /from 0 to 100/, 5000), `reports: a percentage of "${junk}" is refused`, await txt(R, '#rp-status'));
    await setValue(R, '[data-pct="hampton-vale/b1"]', '50');
    await tap(R, '[data-save-pct="hampton-vale/b1"]');
    await waitText(R, '#rp-status', /Saved: 50%/, 5000);
  }
  ok(/<img src=x>Bad|<img src=x onerror=1>|Barber 1/.test(await txt(R, 'main')) && await clean(R), 'hostile text: nothing was injected into the owner’s reports');

  // ---------- rules of the shop floor ----------
  await addWalkIn(A, 'Zoe');
  await waitText(B, '[data-chair]', /Next for you/);
  await tap(B, '[data-call]');
  await waitText(B, '[data-chair]', /In your chair/);
  await tap(A, '[data-drop-barber="b2"]');
  ok(await waitText(A, '#qd-status', /has a customer in the chair/), 'shop floor: a barber with a customer in the chair cannot be removed', await txt(A, '#qd-status'));
  ok(Boolean((await readBoard()).staff.b2), 'shop floor: and their profile is still there');
  await tap(A, '[data-clear]');
  ok(await waitText(C2, '[data-ticket]', /no longer in the queue/), 'shop floor: when the queue is cleared, a waiting customer is told so', (await txt(C2, '[data-ticket]')).slice(0, 80));
  ok(await waitText(B, '[data-chair]', /Your chair is free/), 'shop floor: and the barber’s chair shows free', await txt(B, '[data-chair]'));

  // ---------- an online customer who never turns up ----------
  await tap(C2, '[data-again]');
  await joinStep(C2);
  await submit(C2, '[data-join-form]');
  await waitText(C2, '[data-ticket]', /Your ticket/);
  const late = Object.entries((await readBoard()).t).find(([, k]) => k.s === 'way');
  await editBoard({ [`t.\`${late[0]}\`.at`]: Date.now() - 40 * 60_000, updatedAt: Date.now() });
  ok(await waitText(C2, '[data-ticket]', /no longer in the queue/), 'no-show: a place 30 minutes overdue lapses on the customer’s phone', (await txt(C2, '[data-ticket]')).slice(0, 80));
  ok(await waitText(A, '[data-queue]', /Nobody waiting/), 'no-show: and drops off the desk', await txt(A, '[data-queue]'));
  ok(await waitText(T, '[data-line]', /Nobody waiting/), 'no-show: and off the shop TV', await txt(T, '[data-line]'));

  // ---------- the next morning ----------
  await editBoard({ day: '2020-01-01', updatedAt: Date.now() });
  ok(await waitText(A, '[data-banner]', /not open yet/), 'new day: yesterday’s queue is not carried over as today’s', await txt(A, '[data-banner]'));
  ok(await waitText(T, '[data-conn]', /Demo on this screen|opens when the shop opens/), 'new day: the shop TV stops showing yesterday’s queue', await txt(T, '[data-conn]'));
  await tap(A, '[data-open]');
  await waitText(A, '#qd-status', /Live for everyone/);
  await addWalkIn(A, 'First');
  ok(await waitText(A, '[data-queue]', /^1 First/), 'new day: ticket numbers start again at 1', (await txt(A, '[data-queue]')).slice(0, 60));
  ok((await readBoard()).staff.b3.name === '<img src=x>Bad', 'new day: the barbers’ profiles are kept');

  // ---------- the internet drops ----------
  await T.setOfflineMode(true);
  ok(await waitText(T, '[data-conn]', /Reconnecting/), 'no internet: the shop TV says it is reconnecting', await txt(T, '[data-conn]'));
  await T.setOfflineMode(false);
  ok(await waitText(T, '[data-conn]', /^Live$/, 30000), 'no internet: the shop TV goes back to Live by itself', await txt(T, '[data-conn]'));
  await A.setOfflineMode(true);
  await setValue(A, '[data-add] input', 'Offline');
  await submit(A, '[data-add]');
  ok(await waitText(A, '#qd-status', /Could not save|No connection/, 45000), 'no internet: the desk says the change could not be saved', await txt(A, '#qd-status'));
  await A.setOfflineMode(false);
  await sleep(2500);
  await addWalkIn(A, 'Back');
  ok(await waitText(A, '[data-queue]', /Back/, 30000), 'no internet: the desk works again when the connection returns', (await txt(A, '[data-queue]')).slice(0, 120));
  ok((await tickets()).length <= 3, 'no internet: nothing was added more than once', String((await tickets()).length));
  // ---------- the customer's ticket page on its own ----------
  const qctx = await browser.createBrowserContext();
  const Q = await open(qctx, '/queue/hampton-vale/?join=1&emulator', PHONE, 'ticket-page');
  await Q.waitForSelector('#join-dialog[open]', { timeout: 10000 }).catch(() => {});
  await signUpIn(Q, 'quinn@test.local');
  await giveDetails(Q, '   ');
  ok(await waitText(Q, '[data-profile-error]', /first name/) && await Q.$eval('#join-dialog', (d) => d.open), 'ticket page: a name of only spaces is refused', await txt(Q, '[data-profile-error]'));
  await giveDetails(Q, 'Quinn', '12');
  ok(await waitText(Q, '[data-profile-error]', /mobile number/), 'ticket page: a two-digit mobile number is refused', await txt(Q, '[data-profile-error]'));
  await giveDetails(Q, 'Quinn', '+44 7700 900 456');
  await joinStep(Q);
  await submit(Q, '[data-join-form]');
  ok(await waitText(Q, '[data-ticket]', /Your ticket/) && /Hi, Quinn/.test(await txt(Q, '[data-hi]')), 'ticket page: the link from the website opens the join step and gives a ticket', (await txt(Q, '[data-ticket]')).slice(0, 60));
  const held = (await tickets()).length;
  const Q2 = await open(qctx, '/queue/shop-2/?join=1&emulator', PHONE, 'other-shop');
  ok(await waitText(Q2, '[data-elsewhere]', /You have a ticket at Hampton Vale/) && (await Q2.$eval('[data-elsewhere]', (a) => a.getAttribute('href'))).includes('/queue/hampton-vale/'), 'ticket page: another shop’s page points to the ticket already held', await txt(Q2, '[data-elsewhere]'));
  ok(await Q2.$eval('[data-join]', (b) => b.disabled) && !(await Q2.$eval('#join-dialog', (d) => d.open)) && /already have a ticket at Hampton Vale/.test(await txt(Q2, '[data-join-hint]')), 'ticket page: and does not hand out a second ticket', await txt(Q2, '[data-join-hint]'));
  const Q3 = await open(qctx, '/queue/hampton-vale/?join=1&emulator', PHONE, 'ticket-again');
  ok(await waitText(Q3, '[data-ticket]', /Your ticket/) && !(await Q3.$eval('#join-dialog', (d) => d.open)), 'ticket page: someone who already has a ticket is not asked to join again');
  await tap(Q3, '[data-leave]');
  const hiddenTicket = (pg) => pg.waitForSelector('[data-ticket][hidden]', { timeout: 15000 }).then(() => true, () => false);
  ok(await hiddenTicket(Q3) && await Q3.$eval('[data-wait]', (e) => !e.hidden), 'ticket page: leaving the queue brings the join card back', (await txt(Q3, '[data-ticket]')).slice(0, 80));
  await sleep(1500);
  ok((await tickets()).length === held - 1, 'ticket page: and the place is given up in the shop’s queue', `${held} -> ${(await tickets()).length}`);
  ok(await hiddenTicket(Q) && await Q.$eval('[data-wait]', (e) => !e.hidden), 'ticket page: the customer’s other open tab follows');
  await Q3.evaluate(() => localStorage.setItem('hb-ticket-v2', JSON.stringify({ shop: 'hampton-vale', id: 'old', name: 'Old', src: 'cloud', at: Date.now() - 3 * 86_400_000, seen: 'chair' })));
  await Q3.reload({ waitUntil: 'load' });
  await sleep(1500);
  ok(await Q3.$eval('[data-ticket]', (e) => e.hidden) && await Q3.evaluate(() => localStorage.getItem('hb-ticket-v2') === null), 'ticket page: a ticket from an earlier day is forgotten', await txt(Q3, '[data-ticket]'));
  for (const [name, pg] of [['ticket page', Q], ['other shop’s page', Q2]]) ok(await clean(pg), `hostile text: nothing was injected into the ${name}`);

  // ---------- signing in: wrong password, forgotten password, Google, a second phone ----------
  const gctx = await browser.createBrowserContext();
  const G = await open(gctx, '/queue/hampton-vale/?join=1&emulator', PHONE, 'google-customer');
  await G.waitForSelector('#join-dialog [data-step="signin"]:not([hidden])', { timeout: 15000 });
  await setValue(G, '#join-dialog [data-si-form] input[name=email]', 'quinn@test.local');
  await setValue(G, '#join-dialog [data-si-form] input[name=password]', 'wrong-password');
  await submit(G, '#join-dialog [data-si-form]');
  ok(await waitText(G, '#join-dialog [data-si-msg]', /email or password is not right/), 'sign-in: a wrong password is refused with a plain message', await txt(G, '#join-dialog [data-si-msg]'));
  await tap(G, '#join-dialog [data-si="forgot"]');
  ok(await waitText(G, '#join-dialog [data-si-msg]', /link to set a new password is on its way/), 'sign-in: "Forgot password" sends a reset link', await txt(G, '#join-dialog [data-si-msg]'));
  const mails = await (await fetch('http://127.0.0.1:9099/emulator/v1/projects/hampton-barbers/oobCodes')).json();
  ok((mails.oobCodes ?? []).some((m) => m.email === 'quinn@test.local' && m.requestType === 'PASSWORD_RESET'), 'sign-in: and the reset email really went out (to the test mailbox)');
  await setValue(G, '#join-dialog [data-si-form] input[name=email]', 'nobody-here@test.local');
  await tap(G, '#join-dialog [data-si="forgot"]');
  ok(await waitText(G, '#join-dialog [data-si-msg]', /If that email has an account/), 'sign-in: "Forgot password" does not reveal whether an email has an account', await txt(G, '#join-dialog [data-si-msg]'));
  await G.evaluate(() => window.__hbGoogle('gina@test.local', 'Gina Green'));
  await G.waitForSelector('#join-dialog [data-step="profile"]:not([hidden])', { timeout: 15000 });
  ok(await G.$eval('[data-profile-form] input[name=name]', (i) => i.value) === 'Gina', 'sign-in: Google signs the customer in and fills in their first name', await G.$eval('[data-profile-form] input[name=name]', (i) => i.value));
  await giveDetails(G, 'Gina', '07700 900789');
  await joinStep(G);
  await submit(G, '[data-join-form]');
  ok(await waitText(G, '[data-ticket]', /Your ticket/) && /Hi, Gina/.test(await txt(G, '[data-hi]')), 'sign-in: a Google customer takes a ticket', (await txt(G, '[data-ticket]')).slice(0, 50));
  const G2 = await open(await browser.createBrowserContext(), '/queue/hampton-vale/?join=1&emulator', PHONE, 'second-phone');
  await G2.waitForSelector('#join-dialog [data-step="signin"]:not([hidden])', { timeout: 15000 });
  await G2.evaluate(() => window.__hbGoogle('gina@test.local', 'Gina Green'));
  ok(await waitText(G2, '[data-ticket]', /Your ticket/) && !(await G2.$eval('#join-dialog', (d) => d.open)), 'sign-in: signing in on a second phone brings the same ticket back, not a second one', (await txt(G2, '[data-ticket]')).slice(0, 50));

  // ---------- my account: see, correct, download, delete ----------
  const M = await open(gctx, '/account/?emulator', PHONE, 'my-account');
  ok(await waitText(M, '[data-status]', /Signed in as gina@test.local/) && await M.$eval('[data-details] input[name=mobile]', (i) => i.value) === '07700900789', 'my account: shows the details held', await txt(M, '[data-status]'));
  await setValue(M, '[data-details] input[name=mobile]', 'x');
  await submit(M, '[data-details]');
  ok(await waitText(M, '[data-msg]', /mobile number/), 'my account: a bad mobile number is refused', await txt(M, '[data-msg]'));
  await setValue(M, '[data-details] input[name=mobile]', '07700 900000');
  await submit(M, '[data-details]');
  ok(await waitText(M, '[data-msg]', /^Saved\.$/), 'my account: a corrected mobile number is saved', await txt(M, '[data-msg]'));
  await tap(M, '[data-download]');
  ok(await waitText(M, '[data-msg]', /downloaded as a file/), 'my account: "Download my details" prepares the file', await txt(M, '[data-msg]'));
  const before = (await tickets()).length;
  await tap(M, '[data-delete]');
  ok(await waitText(M, '[data-status]', /account and details have been deleted/), 'my account: "Delete my account" removes the account', await txt(M, '[data-status]'));
  await sleep(1200);
  ok((await tickets()).length === before - 1, 'my account: and gives up the place in the queue', `${before} -> ${(await tickets()).length}`);
  const left = await (await fetch('http://127.0.0.1:8080/v1/projects/hampton-barbers/databases/(default)/documents/customers?pageSize=50', { headers: { Authorization: 'Bearer owner' } })).json();
  ok(!(left.documents ?? []).some((d) => d.fields?.email?.stringValue === 'gina@test.local') && (left.documents ?? []).every((d) => Object.keys(d.fields).sort().join() === 'at,email,mobile,name,seen'), 'my account: nothing of theirs is left, and every customer record holds only name, email and mobile', (left.documents ?? []).map((d) => d.fields?.email?.stringValue).join());
  for (const [name, pg] of [['Google customer’s page', G], ['my account page', M]]) ok(await clean(pg), `hostile text: nothing was injected into the ${name}`);

  // ---------- retention: details unused for 24 months are removed by the owner's desk ----------
  const CUST = 'http://127.0.0.1:8080/v1/projects/hampton-barbers/databases/(default)/documents/customers';
  const adminHdr = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
  const plant = (id, daysAgo) => fetch(`${CUST}?documentId=${id}`, { method: 'POST', headers: adminHdr, body: JSON.stringify({ fields: { name: { stringValue: id }, email: { stringValue: `${id}@test.local` }, mobile: { stringValue: '07700900111' }, at: { integerValue: '1' }, seen: { integerValue: String(Date.now() - daysAgo * 86_400_000) } } }) });
  const kept = async () => ((await (await fetch(`${CUST}?pageSize=100`, { headers: adminHdr })).json()).documents ?? []).map((d) => d.name.split('/').pop());
  await plant('gone-3-years', 1100);
  await plant('gone-25-months', 765);
  await plant('seen-23-months', 700);
  await plant('seen-last-week', 7);
  const keptBefore = (await kept()).filter((id) => !id.startsWith('gone-')).length;
  const RD = await open(await browser.createBrowserContext(), '/admin/live/?emulator', LAPTOP, 'retention-desk');
  await signIn(RD, '#qd-signin');
  let ids = await kept();
  for (let i = 0; i < 40 && ids.some((id) => id.startsWith('gone-')); i++) { await sleep(500); ids = await kept(); }
  ok(!ids.includes('gone-3-years') && !ids.includes('gone-25-months'), 'retention: the owner’s desk removes details unused for more than 24 months', ids.join());
  ok(ids.includes('seen-23-months') && ids.includes('seen-last-week') && ids.filter((id) => !id.startsWith('gone-')).length === keptBefore, 'retention: and leaves every record used within 24 months alone', ids.join());
} catch (e) {
  res.push('CRASH ' + String(e.stack ?? e.message).slice(0, 500));
}
const failed = report();
await browser.close();
process.exit(failed);
