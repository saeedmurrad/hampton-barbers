// End-to-end test of the queue system against the Firebase emulators (never the real project).
// Run:  npm run build && npm run test:queue      (needs Java 21 for the emulators)
// It plays the queue desk (laptop), a barber's phone, the shop TV and customers' phones as
// separate browsers, then a same-device demo where nobody is signed in.
import puppeteer from 'puppeteer-core';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve('dist'), ORIGIN = 'http://dist.test', BASE = '/hampton-barbers';
const OUT = path.resolve(process.argv[2] ?? '.check');
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 60000,
  args: ['--mute-audio', '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests'],
});
const res = [];
const ok = (c, label, detail = '') => res.push(`${c ? 'PASS' : 'FAIL'}  ${label}${!c && detail ? ': ' + detail : ''}`);
const errs = [];
const open = async (ctx, p, vp, tag) => {
  const page = await ctx.newPage();
  await page.setViewport(vp);
  page.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'entered twice' : undefined)); // "are you sure?" and "why?" boxes
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = new URL(req.url());
    if (u.origin !== ORIGIN) return req.continue();
    let f = path.join(DIST, decodeURIComponent(u.pathname).slice(BASE.length));
    if (u.pathname.endsWith('/')) f = path.join(f, 'index.html');
    try { await stat(f); req.respond({ status: 200, contentType: MIME[path.extname(f)] ?? 'application/octet-stream', body: await readFile(f) }); }
    catch { req.respond({ status: 404, body: '' }); }
  });
  await page.goto(ORIGIN + BASE + p, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1500));
  return page;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// The text of an element, with a space between each piece of text inside it.
const txt = (pg, sel) => pg.$eval(sel, (e) => {
  const out = [], walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { const t = walk.currentNode.textContent.replace(/\s+/g, ' ').trim(); if (t) out.push(t); }
  return out.join(' ');
}).catch(() => '');
const tap = (pg, sel) => pg.$eval(sel, (el) => el.click());
const setValue = (pg, sel, value) => pg.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
const submit = (pg, sel) => pg.$eval(sel, (f) => f.requestSubmit());
const waitText = async (pg, sel, re, ms = 20000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (re.test(await txt(pg, sel))) return true; await sleep(300); }
  return false;
};
const signIn = async (pg, form) => { await setValue(pg, `${form} input[name=email]`, 'owner@test.local'); await setValue(pg, `${form} input[name=password]`, 'test-pass-1'); await submit(pg, form); };
// The payment step: tap a service, tap Cash or Online, save.
const pay = async (pg, svc, how) => { await pg.waitForSelector('dialog.pay[open]', { timeout: 6000 }); await tap(pg, `.pay [data-svc="${svc}"]`); await tap(pg, `.pay [data-pay="${how}"]`); await tap(pg, '.pay [data-save]'); };
// On the queue page: wait until the page knows the queue, open the join step, give a first name.
const joinAs = async (pg, name) => { await pg.waitForSelector('[data-join]:not([disabled])', { timeout: 15000 }); await tap(pg, '[data-join]'); await setValue(pg, '#join-dialog input[name=name]', name); await submit(pg, '[data-join-form]'); };
const shot = async (pg, name) => { await pg.bringToFront(); await sleep(700); await pg.screenshot({ path: path.join(OUT, `${name}.jpg`), type: 'jpeg', quality: 80 }); };
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const LAPTOP = { width: 1366, height: 900 };
const TV = { width: 1920, height: 1080 };

await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'owner@test.local', password: 'test-pass-1', returnSecureToken: true }),
});

try {
  // ---------- the queue desk: sign in, open the day, name a barber, add walk-ins ----------
  const A = await open(await browser.createBrowserContext(), '/admin/live/?emulator', LAPTOP, 'desk');
  await signIn(A, '#qd-signin');
  ok(await waitText(A, '#qd-account', /Signed in as owner@test\.local/), 'desk: the shop signs in');
  ok(await waitText(A, '[data-banner]', /not open yet/), 'desk: says today’s queue is not open yet', await txt(A, '[data-banner]'));
  await tap(A, '[data-open]');
  ok(await waitText(A, '#qd-status', /Live for everyone/), 'desk: opens today’s queue', await txt(A, '#qd-status'));
  await setValue(A, '[data-barber="b2"] input[data-f="name"]', 'Ali');
  ok(await waitText(A, '[data-chairs]', /Ali Chair 2/), 'desk: a barber profile gets a name', (await txt(A, '[data-chairs]')).slice(0, 80));
  for (const name of ['Tom', '', '', '']) { await setValue(A, '[data-add] input', name); await submit(A, '[data-add]'); await sleep(500); }
  ok(await waitText(A, '[data-queue]', /1.*Tom.*2.*Walk-in.*3.*4/), 'desk: four walk-ins get numbers 1 to 4', (await txt(A, '[data-queue]')).slice(0, 120));
  for (const b of ['b1', 'b2', 'b3']) { await tap(A, `[data-call="${b}"]`); await sleep(600); }
  ok(await waitText(A, '[data-chairs]', /1 \w Barber 1 Chair 1 · Tom.*2 \w Ali Chair 2 · Walk-in.*3 \w Barber 3 Chair 3 · Walk-in/), 'desk: three barbers call numbers 1, 2 and 3 to their chairs', (await txt(A, '[data-chairs]')).slice(0, 140));
  ok(/^4 Walk-in Waiting \d+ min In the shop/.test(await txt(A, '[data-queue]')), 'desk: number 4 is left waiting in the shop', (await txt(A, '[data-queue]')).slice(0, 60));

  // ---------- the shop TV ----------
  const T = await open(await browser.createBrowserContext(), '/board/hampton-vale/?emulator', TV, 'tv');
  ok(await waitText(T, '[data-conn]', /^Live$/), 'tv: connects and shows Live', await txt(T, '[data-conn]'));
  ok(await waitText(T, '[data-chairs]', /Chair 1 1 .*Chair 2 · Ali 2 .*Chair 3 3 /), 'tv: shows numbers 1, 2 and 3 in the chairs', await txt(T, '[data-chairs]'));
  ok(/^1 4 In the shop/.test(await txt(T, '[data-line]')), 'tv: shows number 4 next up', await txt(T, '[data-line]'));
  ok(!/Tom/.test(await txt(T, 'main')), 'tv: never shows a customer’s name');
  ok(/about 20 min/.test(await txt(T, '[data-wait]')), 'tv: tells a walk-in the wait is about 20 minutes', await txt(T, '[data-wait]'));

  // ---------- a customer looks at the website on their phone, then takes a ticket ----------
  const custCtx = await browser.createBrowserContext();
  const W = await open(custCtx, '/street/?emulator', PHONE, 'website');
  ok(await waitText(W, '#live [data-live="waiting"]', /^1$/), 'website: sees 1 person waiting', await txt(W, '#live [data-live="waiting"]'));
  ok(/~20/.test(await txt(W, '#live [data-live="headline"]')), 'website: sees about 20 minutes', await txt(W, '#live [data-live="headline"]'));
  ok((await W.$$('[data-shop-key]')).length === 3, 'website: sees all three shops');
  const joinHref = await W.$eval('#live [data-join]', (a) => a.getAttribute('href'));
  ok(joinHref.endsWith('/queue/hampton-vale/?join=1&emulator') && (await W.$$('#join-dialog')).length === 0, 'website: "Join the queue" opens the queue page', joinHref);
  const C = await open(custCtx, '/queue/hampton-vale/?join=1&emulator', PHONE, 'customer');
  ok(await waitText(C, '[data-wait] [data-live="headline"]', /~20/) && /1 waiting/.test(await txt(C, '[data-line-sum]')), 'customer: the queue page shows about 20 minutes and 1 waiting', `${await txt(C, '[data-wait] [data-live="headline"]')} | ${await txt(C, '[data-line-sum]')}`);
  await C.waitForSelector('#join-dialog[open]', { timeout: 8000 }).catch(() => {});
  ok(await C.$eval('#join-dialog', (d) => d.open) && !C.url().includes('join='), 'customer: the join step opens by itself, once', C.url());
  await shot(C, 'p1-customer-join');
  await setValue(C, '#join-dialog input[name=name]', 'Sam');
  await submit(C, '[data-join-form]');
  ok(await waitText(C, '[data-ticket] .u-pass__n', /^5$/), 'customer: gets ticket number 5 straight away', await txt(C, '[data-ticket] .u-pass__n'));
  ok(/Your ticket/.test(await txt(C, '[data-ticket]')) && /2nd in line/.test(await txt(C, '[data-ticket]')) && /1 person ahead of you/.test(await txt(C, '[data-line-sum]')) && /Hi, Sam/.test(await txt(C, '[data-hi]')), 'customer: is told 2nd in line, 1 person ahead', `${(await txt(C, '[data-ticket]')).slice(0, 90)} | ${await txt(C, '[data-line-sum]')} | ${await txt(C, '[data-hi]')}`);
  ok(await C.$eval('[data-wait]', (e) => e.hidden) && (await C.$$('[data-line] li.is-me')).length === 1 && /hold your place until/.test(await txt(C, '[data-line-note]')), 'customer: the ticket replaces the join card and their number is marked in the line', await txt(C, '[data-line-note]'));
  ok(await waitText(W, '.lchip', /You’re 2nd in line/) && (await W.$eval('.lchip', (a) => a.getAttribute('href'))).includes('/queue/hampton-vale/'), 'website: the first-screen card says "You’re 2nd in line" and opens the ticket', (await txt(W, '.lchip')).slice(-30));
  ok(await waitText(W, '[data-my-ticket]', /5 .*You’re 2nd in line .*Sam.*Open my ticket/) && await W.$eval('[data-my-ticket]', (a) => !a.hidden && a.getAttribute('href').includes('/queue/hampton-vale/')), 'website: shows a short ticket strip that opens the ticket', await txt(W, '[data-my-ticket]'));
  ok((await W.$$('#live .live__queue li.me')).length === 1 && await W.$eval('#live [data-join]', (a) => getComputedStyle(a).display === 'none'), 'website: marks their own number "You" and stops offering to join');
  await C.evaluate(() => scrollTo(0, 0));
  await shot(C, 'p1-customer-way');
  ok(await waitText(A, '[data-queue]', /5 Sam Due [\d:]+ [ap]m On the way/), 'desk: sees number 5, Sam, on the way', (await txt(A, '[data-queue]')).slice(0, 140));
  ok(await waitText(T, '[data-line]', /2 5 On the way/), 'tv: lists number 5 as on the way', await txt(T, '[data-line]'));
  await tap(C, '[data-late]');
  ok(await waitText(C, '[data-ticket]', /held 10 minutes longer/), 'customer: "Running late" holds the place longer');
  ok(await waitText(A, '[data-queue]', /running late/), 'desk: shows that number 5 is running late');

  // ---------- the customer reaches the shop and scans the code on the door ----------
  const D = await open(custCtx, '/queue/hampton-vale/?here=1&emulator', PHONE, 'door');
  ok(await waitText(D, '[data-ticket]', /Checked in/) && /Hi, Sam/.test(await txt(D, '[data-hi]')) && /In the shop/.test(await D.$eval('[data-ticket] .u-steps .is-now', (e) => e.textContent)), 'door code: checks the customer in', (await txt(D, '[data-ticket]')).slice(0, 80));
  ok(await waitText(A, '[data-queue]', /5 Sam Joined on their phone · waiting \d+ min In the shop/), 'desk: number 5 now shows as in the shop', (await txt(A, '[data-queue]')).slice(0, 160));
  await shot(D, 'p1-customer-here');

  // ---------- a barber on their own phone ----------
  const B = await open(await browser.createBrowserContext(), '/barber/?shop=hampton-vale&emulator', PHONE, 'barber');
  await signIn(B, '#bp-signin');
  ok(await waitText(B, '#bp-account', /Signed in/), 'barber: signs in on their phone');
  await tap(B, '[data-me="b1"]');
  ok(await waitText(B, '[data-chair]', /In your chair 1 Tom/), 'barber: picks their profile and sees number 1, Tom, in their chair', await txt(B, '[data-chair]'));
  await tap(B, '[data-finish]');
  await B.waitForSelector('dialog.pay[open]', { timeout: 6000 });
  await tap(B, '.pay [data-save]');
  ok(/Tap what they had/.test(await txt(B, '.pay__err')), 'payment: will not save without a service or a price', await txt(B, '.pay__err'));
  await tap(B, '.pay [data-svc="1"]');
  await tap(B, '.pay [data-save]');
  ok(/Tap Cash or Online/.test(await txt(B, '.pay__err')), 'payment: will not save until Cash or Online is chosen', await txt(B, '.pay__err'));
  await tap(B, '.pay [data-pay="online"]');
  await shot(B, 'p2-pay-phone');
  await tap(B, '.pay [data-save]');
  ok(await waitText(B, '[data-chair]', /Next for you 4/), 'barber: records a Skin Fade paid online, and number 4 is next for them', await txt(B, '[data-chair]'));
  ok(await waitText(B, '.staff-toast', /Number 1 finished: £20 online/), 'barber: is shown "Number 1 finished: £20 online"', await txt(B, '.staff-toast'));
  await tap(B, '.staff-toast button');
  await B.waitForSelector('dialog.pay[open]', { timeout: 6000 });
  ok(await B.$eval('.pay input[name=price]', (el) => el.value) === '20' && await B.$eval('.pay [data-svc="1"]', (el) => el.getAttribute('aria-pressed')) === 'true', 'payment: "Change" reopens the step with what was entered');
  await tap(B, '.pay [data-pay="cash"]');
  await tap(B, '.pay [data-save]');
  ok(await waitText(B, '.staff-toast', /Number 1 finished: £20 cash/), 'barber: corrects a wrong tap from online to cash', await txt(B, '.staff-toast'));
  ok(await waitText(B, '[data-today]', /Cuts 1 /), 'barber: their own count shows 1 cut today', await txt(B, '[data-today]'));
  await shot(B, 'p1-barber');
  await tap(B, '[data-call]');
  ok(await waitText(T, '[data-call]', /Number 4 Chair 1/, 8000) && await T.$eval('[data-call]', (el) => !el.hidden), 'tv: announces "Number 4, chair 1" full screen', await txt(T, '[data-call]'));
  await shot(T, 'p1-tv-call');
  ok(await waitText(D, '[data-ticket]', /You’re next\./), 'customer: is told "You’re next"', (await txt(D, '[data-ticket]')).slice(0, 110));
  ok(await waitText(A, '[data-chairs]', /4 \w Barber 1 Chair 1/), 'desk: follows the barber’s phone without a refresh', (await txt(A, '[data-chairs]')).slice(0, 60));

  // ---------- the desk seats the online customer ----------
  await tap(A, '[data-finish="b2"]');
  await A.waitForSelector('dialog.pay[open]', { timeout: 6000 });
  await shot(A, 'p2-pay-desk');
  await pay(A, 0, 'cash');
  ok(await waitText(A, '.staff-toast', /Number 2 finished: £17 cash/), 'desk: records a Gents Cut paid in cash', await txt(A, '.staff-toast'));
  await sleep(700);
  await tap(A, '[data-call="b2"]');
  ok(await waitText(D, '[data-ticket]', /It’s your turn, Sam!.*Chair 2 with Ali/) && await D.$eval('[data-ticket] .u-pass', (e) => e.classList.contains('is-turn')), 'customer: "It’s your turn, Sam!" with "Chair 2 with Ali"', await txt(D, '[data-ticket]'));
  ok(await waitText(C, '[data-ticket]', /It’s your turn, Sam!/), 'customer: their other open ticket page says so too');
  await W.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  ok(await waitText(W, '.lchip', /It’s your turn!/) && /It’s your turn!/.test(await txt(W, '[data-my-ticket]')), 'website: the card and the strip say "It’s your turn!" when the customer looks again', await txt(W, '[data-my-ticket]'));
  await shot(D, 'p1-customer-turn');
  await sleep(8500);
  await shot(T, 'p1-tv');
  ok(/Chair 2 · Ali 5 /.test(await txt(T, '[data-chairs]')) && /Nobody waiting/.test(await txt(T, '[data-line]')), 'tv: number 5 is in chair 2 and nobody is waiting', `${await txt(T, '[data-chairs]')} | ${await txt(T, '[data-line]')}`);
  await shot(A, 'p1-desk');
  await tap(A, '[data-finish="b2"]');
  await pay(A, 1, 'online');
  ok(await waitText(D, '[data-ticket]', /All done, Sam/), 'customer: sees "All done" when the cut is finished', await txt(D, '[data-ticket]'));
  await tap(D, '[data-done]');
  ok(await D.waitForSelector('[data-ticket][hidden]', { timeout: 10000 }).then(() => true, () => false) && await D.$eval('[data-wait]', (e) => !e.hidden) && await D.$eval('[data-hi]', (e) => e.hidden), 'customer: closing the finished ticket brings the join card back');
  await W.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await sleep(900);
  ok(await W.$eval('[data-my-ticket]', (a) => a.hidden) && await W.$eval('.lchip', (a) => a.getAttribute('href')) === '#live' && await W.$eval('#live [data-join]', (a) => getComputedStyle(a).display !== 'none'), 'website: the strip goes away and "Join the queue" comes back');

  // ---------- the owner's reports ----------
  const R = await open(A.browserContext(), '/admin/reports/?emulator', LAPTOP, 'reports');
  ok(await waitText(R, '#rp-status', /real figures/), 'reports: the owner opens the real figures', await txt(R, '#rp-status'));
  ok(await waitText(R, '[data-tiles]', /Customers 3 Takings £57 Cash £37 Online £20/), 'reports: today shows 3 customers and £57, of which £37 cash and £20 online', await txt(R, '[data-tiles]'));
  const perBarber = await txt(R, '[data-barbers]');
  ok(/Ali Hampton Vale £37 2 customers/.test(perBarber) && /Barber 1 Hampton Vale £20 1 customer/.test(perBarber), 'reports: takings are listed for each barber', perBarber);
  ok(/no percentage set/.test(perBarber), 'reports: says when a barber has no percentage yet');
  ok(/corrected, was £20 online/.test(await txt(R, '[data-sales]')), 'reports: a corrected sale shows what it said before', (await txt(R, '[data-sales]')).slice(0, 200));
  await setValue(R, '[data-pct="hampton-vale/b2"]', '40');
  await tap(R, '[data-save-pct="hampton-vale/b2"]');
  ok(await waitText(R, '[data-barbers]', /Ali Hampton Vale £37 2 customers Cash £17 Online £20 Barber’s share £14.80 Shop keeps £22.20 40% to the barber/), 'reports: on 40%, Ali’s share of £37 is £14.80 and the shop keeps £22.20', await txt(R, '[data-barbers]'));
  ok(/Barbers’ share £14.80 Shop keeps £42.20/.test(await txt(R, '[data-tiles]')), 'reports: the totals show the barbers’ share and what the shop keeps', await txt(R, '[data-tiles]'));
  await shot(R, 'p2-reports');
  await tap(R, '[data-sales] li:nth-child(2) [data-void]');
  ok(await waitText(R, '[data-tiles]', /Customers 2 Takings £40 1 cancelled sale left out/), 'reports: the owner cancels the £17 sale and the totals drop to £40', await txt(R, '[data-tiles]'));
  ok(/cancelled: entered twice/.test(await txt(R, '[data-sales]')), 'reports: the cancelled sale stays on the record with its reason');
  await tap(R, '[data-kind="week"]');
  ok(await waitText(R, '[data-days]', /2 £20 £20 £40/), 'reports: the week view lists the day with its cash, online and total', await txt(R, '[data-days]'));
  await R.reload({ waitUntil: 'load' });
  ok(await waitText(R, '[data-tiles]', /Customers 2 Takings £40/) && /40% to the barber/.test(await txt(R, '[data-barbers]')), 'reports: the cancellation and the percentage are still there after reloading', await txt(R, '[data-tiles]'));

  // ---------- staff logins: the owner makes one for the barber on chair 3 ----------
  ok(await waitText(A, '[data-login-list]', /No staff logins yet/), 'desk: the owner sees the staff logins section', await txt(A, '[data-login-list]'));
  await setValue(A, '[data-new-login] input[name=name]', 'Omar');
  await setValue(A, '[data-new-login] input[name=email]', 'omar@test.local');
  await setValue(A, '[data-new-login] input[name=password]', 'barber-pass-1');
  await setValue(A, '[data-login-for]', 'hampton-vale/b3');
  await submit(A, '[data-new-login]');
  ok(await waitText(A, '[data-login-list]', /Omar omar@test\.local · barber at Hampton Vale, chair 3/), 'desk: the owner creates a login for the barber on chair 3', await txt(A, '[data-login-list]'));
  ok(/Signed in as owner@test\.local/.test(await txt(A, '#qd-account')), 'desk: the owner is still signed in afterwards', await txt(A, '#qd-account'));
  await tap(A, '[data-view-link="barbers"]');
  await shot(A, 'p2-desk-logins');
  await tap(A, '[data-view-link="queue"]');
  const S = await open(await browser.createBrowserContext(), '/barber/?emulator', PHONE, 'staff');
  await setValue(S, '#bp-signin input[name=email]', 'omar@test.local');
  await setValue(S, '#bp-signin input[name=password]', 'barber-pass-1');
  await submit(S, '#bp-signin');
  ok(await waitText(S, '[data-who]', /Barber 3 Chair 3 · Hampton Vale/), 'staff: the barber signs in and lands on their own profile', await txt(S, '[data-who]'));
  ok(!/Change/.test(await txt(S, '[data-who]')), 'staff: a personal login cannot switch to another barber’s profile', await txt(S, '[data-who]'));
  ok(await waitText(S, '[data-chair]', /In your chair 3 /), 'staff: sees number 3 in their chair', await txt(S, '[data-chair]'));
  await tap(S, '[data-finish]');
  await pay(S, 2, 'cash');
  ok(await waitText(S, '.staff-toast', /Number 3 finished: £20 cash/), 'staff: records a sale with their own login', await txt(S, '.staff-toast'));
  ok(await waitText(S, '[data-today]', /Taken £20 Cash £20 Online £0/), 'staff: sees their own takings today, and only their own', await txt(S, '[data-today]'));
  await shot(S, 'p2-staff-phone');
  const SR = await open(S.browserContext(), '/admin/reports/?emulator', PHONE, 'staff-reports');
  ok(await waitText(SR, '#rp-account', /for the owner only/), 'staff: is told the reports are for the owner only', await txt(SR, '#rp-account'));
  ok(await SR.$eval('[data-body]', (el) => el.hidden), 'staff: the takings stay hidden from a staff login');
  await S.bringToFront();
  await tap(S, '[data-pw]');
  await setValue(S, '#bp-pw input[name=pw]', 'my-own-pass-22');
  await submit(S, '#bp-pw');
  ok(await waitText(S, '#bp-account', /Password changed/), 'staff: can change the password the owner gave them', await txt(S, '#bp-account'));
  await R.reload({ waitUntil: 'load' });
  ok(await waitText(R, '[data-tiles]', /Customers 3 Takings £60/), 'reports: the owner sees the sale the staff login recorded', await txt(R, '[data-tiles]'));
  await tap(A, '[data-remove-login]');
  ok(await waitText(A, '[data-login-list]', /No staff logins yet/), 'desk: the owner removes the staff login', await txt(A, '[data-login-list]'));
  await submit(S, '[data-add]');
  ok(await waitText(S, '#bp-status', /not allowed/), 'staff: a removed login can no longer change the queue', await txt(S, '#bp-status'));

  // ---------- another customer joins, then leaves; then online joining is paused ----------
  const E = await open(await browser.createBrowserContext(), '/queue/hampton-vale/?emulator', PHONE, 'customer2');
  await joinAs(E, 'Lee');
  ok(await waitText(A, '[data-queue]', /6 Lee Due [\d:]+ [ap]m On the way/), 'desk: sees a second customer, Lee, number 6', await txt(A, '[data-queue]'));
  await tap(E, '[data-leave]');
  ok(await waitText(A, '[data-queue]', /Nobody waiting/), 'desk: Lee leaves and disappears from the queue', await txt(A, '[data-queue]'));
  await setValue(A, '#qd-online', 'off');
  await sleep(1200);
  await joinAs(E, 'Lee');
  ok(await waitText(E, '[data-join-error]', /not open at this shop/), 'customer: cannot join while the shop has paused online joining', await txt(E, '[data-join-error]'));
  ok(await waitText(E, '[data-join-hint]', /not open at this shop/) && await E.$eval('[data-join]', (b) => b.disabled), 'customer: the join button is then switched off, with the reason', await txt(E, '[data-join-hint]'));

  // ---------- same-device demo, nobody signed in: desk, TV and customer in three tabs ----------
  const demo = await browser.createBrowserContext();
  const AD = await open(demo, '/admin/live/?emulator', LAPTOP, 'demo-desk');
  ok(/Demo on this device only/.test(await txt(AD, '#qd-status')), 'demo: the desk says it is a demo on this device', await txt(AD, '#qd-status'));
  ok(/24 \w Barber 1 Chair 1.*25 \w Barber 2 Chair 2.*Free \w Barber 3 Chair 3/.test(await txt(AD, '[data-chairs]')), 'demo: starts from the example queue (24 and 25 in the chairs)', (await txt(AD, '[data-chairs]')).slice(0, 90));
  const TD = await open(demo, '/board/hampton-vale/?emulator', TV, 'demo-tv');
  const WD = await open(demo, '/heritage/?emulator', LAPTOP, 'demo-website');
  const CD = await open(demo, '/queue/hampton-vale/?emulator', LAPTOP, 'demo-customer');
  await joinAs(CD, 'Ava');
  ok(await waitText(CD, '[data-ticket] .u-pass__n', /^29$/), 'demo: the customer tab gets number 29', await txt(CD, '[data-ticket] .u-pass__n'));
  ok(await waitText(WD, '[data-my-ticket]', /29 .*Ava/) && await WD.$eval('[data-my-ticket]', (a) => !a.hidden), 'demo: the website tab shows Ava’s ticket strip', await txt(WD, '[data-my-ticket]'));
  ok(await waitText(AD, '[data-queue]', /29 Ava Due [\d:]+ [ap]m On the way/), 'demo: the desk tab sees Ava, number 29', (await txt(AD, '[data-queue]')).slice(-60));
  ok(await waitText(TD, '[data-line]', /29 On the way/), 'demo: the TV tab lists number 29', await txt(TD, '[data-line]'));
  ok(/Demo on this screen/.test(await txt(TD, '[data-conn]')), 'demo: the TV tab says it is a demo, not the real queue', await txt(TD, '[data-conn]'));
  ok(/this device only/.test(await txt(AD, '#qd-status')), 'demo: changes are saved on this device only', await txt(AD, '#qd-status'));
  await TD.bringToFront();
  await tap(AD, '[data-call="b3"]');
  ok(await waitText(TD, '[data-call]', /Number 26 Chair 3/, 8000), 'demo: the TV tab announces number 26, chair 3', await txt(TD, '[data-call]'));
  await tap(AD, `[data-arrived="${await AD.$eval('[data-queue] li:last-child [data-arrived]', (el) => el.dataset.arrived)}"]`);
  ok(await waitText(CD, '[data-ticket]', /Checked in/) && /Hi, Ava/.test(await txt(CD, '[data-hi]')), 'demo: the desk marks Ava as arrived and her tab shows it', (await txt(CD, '[data-ticket]')).slice(0, 70));
  await tap(AD, '[data-finish="b1"]');
  await pay(AD, 3, 'online');
  const RD = await open(demo, '/admin/reports/?emulator', LAPTOP, 'demo-reports');
  ok(await waitText(RD, '#rp-status', /Example figures/), 'demo: the reports page shows example figures without signing in', await txt(RD, '#rp-status'));
  ok(await waitText(RD, '[data-sales]', /No\. 24 · Wash & Cut/), 'demo: a sale recorded on this device appears in the report', (await txt(RD, '[data-sales]')).slice(0, 120));
  ok(Number((await txt(RD, '[data-tiles]')).match(/Customers (\d+)/)?.[1]) > 20, 'demo: the example figures give the report something to show', (await txt(RD, '[data-tiles]')).slice(0, 80));
  await sleep(400);
  await tap(AD, '[data-queue] li:last-child [data-seat]');
  await sleep(400);
  const seated = await txt(AD, '[data-chairs]');
  ok(/(28|29) \w Barber 1 Chair 1/.test(seated), 'demo: the desk can seat a waiting customer in the free chair', seated.slice(0, 80));
} catch (e) {
  res.push('CRASH ' + String(e.stack ?? e.message).slice(0, 400));
}
ok(errs.length === 0, 'no script errors on any page', errs.join(' | ').slice(0, 400));
console.log(res.join('\n'));
console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} of ${res.length} passed`);
await browser.close();
process.exit(res.some((r) => !r.startsWith('PASS')) ? 1 : 0);
