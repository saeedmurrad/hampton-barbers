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
  const seen = await waitText(C, '[data-chairs]', new RegExp(`Chair ${winner === 'b1' ? 1 : 2} 1 Solo`));
  ok(seen && /1 Solo/.test(await txt(A, '[data-chairs]')), 'same instant: both desks show the customer in the chair', `winner ${winner} | A: ${await txt(A, '[data-chairs]')} | C: ${await txt(C, '[data-chairs]')} | C account: ${(await txt(C, '#qd-account')).slice(0, 60)}`);
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

  const C1 = await open(await browser.createBrowserContext(), '/fresh/?emulator', PHONE, 'customer1');
  const C2 = await open(await browser.createBrowserContext(), '/club/?emulator', PHONE, 'customer2');
  await tap(C1, '[data-join]');
  await setValue(C1, '#join-dialog input[name=name]', EVIL);
  await tap(C2, '[data-join]');
  await setValue(C2, '#join-dialog input[name=name]', 'Twin');
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
  await A.$eval('.qd__more', (el) => { el.open = true; });
  await tap(A, '[data-drop-barber="b2"]');
  ok(await waitText(A, '#qd-status', /has a customer in the chair/), 'shop floor: a barber with a customer in the chair cannot be removed', await txt(A, '#qd-status'));
  ok(Boolean((await readBoard()).staff.b2), 'shop floor: and their profile is still there');
  await tap(A, '[data-clear]');
  ok(await waitText(C2, '[data-ticket]', /no longer in the queue/), 'shop floor: when the queue is cleared, a waiting customer is told so', (await txt(C2, '[data-ticket]')).slice(0, 80));
  ok(await waitText(B, '[data-chair]', /Your chair is free/), 'shop floor: and the barber’s chair shows free', await txt(B, '[data-chair]'));

  // ---------- an online customer who never turns up ----------
  await tap(C2, '[data-again]');
  await setValue(C2, '#join-dialog input[name=name]', 'Late');
  await submit(C2, '[data-join-form]');
  await waitText(C2, '[data-ticket]', /You’re in the queue/);
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
} catch (e) {
  res.push('CRASH ' + String(e.stack ?? e.message).slice(0, 500));
}
const failed = report();
await browser.close();
process.exit(failed);
