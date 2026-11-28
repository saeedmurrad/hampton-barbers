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
  page.on('dialog', (d) => d.accept()); // "are you sure?" boxes
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
const joinAs = async (pg, name) => { await tap(pg, '[data-join]'); await setValue(pg, '#join-dialog input[name=name]', name); await submit(pg, '[data-join-form]'); };
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
  ok(await waitText(A, '[data-chairs]', /Chair 2 · Ali/), 'desk: a barber profile gets a name', (await txt(A, '[data-chairs]')).slice(0, 80));
  for (const name of ['Tom', '', '', '']) { await setValue(A, '[data-add] input', name); await submit(A, '[data-add]'); await sleep(500); }
  ok(await waitText(A, '[data-queue]', /1.*Tom.*2.*Walk-in.*3.*4/), 'desk: four walk-ins get numbers 1 to 4', (await txt(A, '[data-queue]')).slice(0, 120));
  for (const b of ['b1', 'b2', 'b3']) { await tap(A, `[data-call="${b}"]`); await sleep(600); }
  ok(await waitText(A, '[data-chairs]', /Chair 1 1 Tom.*Chair 2 · Ali 2.*Chair 3 3/), 'desk: three barbers call numbers 1, 2 and 3 to their chairs', (await txt(A, '[data-chairs]')).slice(0, 140));
  ok(/^4 Walk-in In the shop/.test(await txt(A, '[data-queue]')), 'desk: number 4 is left waiting in the shop', (await txt(A, '[data-queue]')).slice(0, 60));

  // ---------- the shop TV ----------
  const T = await open(await browser.createBrowserContext(), '/board/hampton-vale/?emulator', TV, 'tv');
  ok(await waitText(T, '[data-conn]', /^Live$/), 'tv: connects and shows Live', await txt(T, '[data-conn]'));
  ok(await waitText(T, '[data-chairs]', /Chair 1 1 .*Chair 2 · Ali 2 .*Chair 3 3 /), 'tv: shows numbers 1, 2 and 3 in the chairs', await txt(T, '[data-chairs]'));
  ok(/^1 4 In the shop/.test(await txt(T, '[data-line]')), 'tv: shows number 4 next up', await txt(T, '[data-line]'));
  ok(!/Tom/.test(await txt(T, 'main')), 'tv: never shows a customer’s name');
  ok(/about 20 min/.test(await txt(T, '[data-wait]')), 'tv: tells a walk-in the wait is about 20 minutes', await txt(T, '[data-wait]'));

  // ---------- a customer joins from home on their phone ----------
  const custCtx = await browser.createBrowserContext();
  const C = await open(custCtx, '/street/?emulator', PHONE, 'customer');
  ok(await waitText(C, '#live [data-live="waiting"]', /^1$/), 'customer: sees 1 person waiting', await txt(C, '#live [data-live="waiting"]'));
  ok(/~20/.test(await txt(C, '#live [data-live="headline"]')), 'customer: sees about 20 minutes', await txt(C, '#live [data-live="headline"]'));
  ok((await C.$$('[data-shop-key]')).length === 3, 'customer: sees all three shops');
  await joinAs(C, 'Sam');
  ok(await waitText(C, '[data-ticket] .tk__big', /^5/), 'customer: gets ticket number 5 straight away', await txt(C, '[data-ticket] .tk__big'));
  ok(/You’re in the queue at Hampton Vale, Sam/.test(await txt(C, '[data-ticket]')) && /2nd in line, 1 person ahead/.test(await txt(C, '[data-ticket]')), 'customer: is told 2nd in line, 1 person ahead', (await txt(C, '[data-ticket]')).slice(0, 110));
  ok(/You’re 2nd in line/.test(await txt(C, '.lchip')), 'customer: the first-screen card says "You’re 2nd in line"', (await txt(C, '.lchip')).slice(-30));
  ok((await C.$$('#live .live__queue li.me')).length === 1, 'customer: sees their own number marked "You"');
  await C.evaluate(() => document.querySelector('[data-ticket]').scrollIntoView({ block: 'start' }));
  await shot(C, 'p1-customer-way');
  ok(await waitText(A, '[data-queue]', /5 Sam On the way/), 'desk: sees number 5, Sam, on the way', (await txt(A, '[data-queue]')).slice(0, 140));
  ok(await waitText(T, '[data-line]', /2 5 On the way/), 'tv: lists number 5 as on the way', await txt(T, '[data-line]'));
  await tap(C, '[data-late]');
  ok(await waitText(C, '[data-ticket]', /held 10 minutes longer/), 'customer: "Running late" holds the place longer');
  ok(await waitText(A, '[data-queue]', /running late/), 'desk: shows that number 5 is running late');

  // ---------- the customer reaches the shop and scans the code on the door ----------
  const D = await open(custCtx, '/queue/hampton-vale/?here=1&emulator', PHONE, 'door');
  ok(await waitText(D, '[data-ticket]', /Checked in at Hampton Vale, Sam/), 'door code: checks the customer in', (await txt(D, '[data-ticket]')).slice(0, 80));
  ok(await waitText(A, '[data-queue]', /5 Sam In the shop · joined on their phone/), 'desk: number 5 now shows as in the shop', (await txt(A, '[data-queue]')).slice(0, 160));
  await shot(D, 'p1-customer-here');

  // ---------- a barber on their own phone ----------
  const B = await open(await browser.createBrowserContext(), '/barber/?shop=hampton-vale&emulator', PHONE, 'barber');
  await signIn(B, '#bp-signin');
  ok(await waitText(B, '#bp-account', /Signed in/), 'barber: signs in on their phone');
  await tap(B, '[data-me="b1"]');
  ok(await waitText(B, '[data-chair]', /In your chair 1 Tom/), 'barber: picks their profile and sees number 1, Tom, in their chair', await txt(B, '[data-chair]'));
  await tap(B, '[data-finish]');
  ok(await waitText(B, '[data-chair]', /Next for you 4/), 'barber: finishes, and number 4 is next for them', await txt(B, '[data-chair]'));
  ok(/Your cuts today: 1/.test(await txt(B, '[data-chair]')), 'barber: their own count shows 1 cut today');
  await shot(B, 'p1-barber');
  await tap(B, '[data-call]');
  ok(await waitText(T, '[data-call]', /Number 4 Chair 1/, 8000) && await T.$eval('[data-call]', (el) => !el.hidden), 'tv: announces "Number 4, chair 1" full screen', await txt(T, '[data-call]'));
  await shot(T, 'p1-tv-call');
  ok(await waitText(D, '[data-ticket]', /You’re next\./), 'customer: is told "You’re next"', (await txt(D, '[data-ticket]')).slice(0, 110));
  ok(await waitText(A, '[data-chairs]', /Chair 1 4 /), 'desk: follows the barber’s phone without a refresh', (await txt(A, '[data-chairs]')).slice(0, 60));

  // ---------- the desk seats the online customer ----------
  await tap(A, '[data-finish="b2"]');
  await sleep(700);
  await tap(A, '[data-call="b2"]');
  ok(await waitText(D, '[data-ticket]', /It’s your turn, Sam! Chair 2 with Ali\./), 'customer: "It’s your turn, Sam! Chair 2 with Ali."', await txt(D, '[data-ticket]'));
  ok(await waitText(C, '.lchip', /It’s your turn!/), 'customer: their other open page says so too');
  await shot(D, 'p1-customer-turn');
  await sleep(8500);
  await shot(T, 'p1-tv');
  ok(/Chair 2 · Ali 5 /.test(await txt(T, '[data-chairs]')) && /Nobody waiting/.test(await txt(T, '[data-line]')), 'tv: number 5 is in chair 2 and nobody is waiting', `${await txt(T, '[data-chairs]')} | ${await txt(T, '[data-line]')}`);
  await shot(A, 'p1-desk');
  await tap(A, '[data-finish="b2"]');
  ok(await waitText(D, '[data-ticket]', /All done, Sam/), 'customer: sees "All done" when the cut is finished', await txt(D, '[data-ticket]'));

  // ---------- another customer joins, then leaves; then online joining is paused ----------
  const E = await open(await browser.createBrowserContext(), '/club/?emulator', PHONE, 'customer2');
  await joinAs(E, 'Lee');
  ok(await waitText(A, '[data-queue]', /6 Lee On the way/), 'desk: sees a second customer, Lee, number 6', await txt(A, '[data-queue]'));
  await tap(E, '[data-leave]');
  ok(await waitText(A, '[data-queue]', /Nobody waiting/), 'desk: Lee leaves and disappears from the queue', await txt(A, '[data-queue]'));
  await setValue(A, '#qd-online', 'off');
  await sleep(1200);
  await joinAs(E, 'Lee');
  ok(await waitText(E, '[data-join-error]', /not open at this shop/), 'customer: cannot join while the shop has paused online joining', await txt(E, '[data-join-error]'));

  // ---------- same-device demo, nobody signed in: desk, TV and customer in three tabs ----------
  const demo = await browser.createBrowserContext();
  const AD = await open(demo, '/admin/live/?emulator', LAPTOP, 'demo-desk');
  ok(/Demo on this device only/.test(await txt(AD, '#qd-status')), 'demo: the desk says it is a demo on this device', await txt(AD, '#qd-status'));
  ok(/Chair 1 24 .*Chair 2 25 .*Chair 3 Free/.test(await txt(AD, '[data-chairs]')), 'demo: starts from the example queue (24 and 25 in the chairs)', (await txt(AD, '[data-chairs]')).slice(0, 90));
  const TD = await open(demo, '/board/hampton-vale/?emulator', TV, 'demo-tv');
  const CD = await open(demo, '/heritage/?emulator', LAPTOP, 'demo-customer');
  await joinAs(CD, 'Ava');
  ok(await waitText(CD, '[data-ticket] .tk__big', /^29/), 'demo: the customer tab gets number 29', await txt(CD, '[data-ticket] .tk__big'));
  ok(await waitText(AD, '[data-queue]', /29 Ava On the way/), 'demo: the desk tab sees Ava, number 29', (await txt(AD, '[data-queue]')).slice(-60));
  ok(await waitText(TD, '[data-line]', /29 On the way/), 'demo: the TV tab lists number 29', await txt(TD, '[data-line]'));
  ok(/Demo on this screen/.test(await txt(TD, '[data-conn]')), 'demo: the TV tab says it is a demo, not the real queue', await txt(TD, '[data-conn]'));
  ok(/this device only/.test(await txt(AD, '#qd-status')), 'demo: changes are saved on this device only', await txt(AD, '#qd-status'));
  await TD.bringToFront();
  await tap(AD, '[data-call="b3"]');
  ok(await waitText(TD, '[data-call]', /Number 26 Chair 3/, 8000), 'demo: the TV tab announces number 26, chair 3', await txt(TD, '[data-call]'));
  await tap(AD, `[data-arrived="${await AD.$eval('[data-queue] li:last-child [data-arrived]', (el) => el.dataset.arrived)}"]`);
  ok(await waitText(CD, '[data-ticket]', /Checked in at Hampton Vale, Ava/), 'demo: the desk marks Ava as arrived and her tab shows it', (await txt(CD, '[data-ticket]')).slice(0, 70));
  await tap(AD, '[data-finish="b1"]');
  await sleep(400);
  await tap(AD, '[data-queue] li:last-child [data-seat]');
  await sleep(400);
  const seated = await txt(AD, '[data-chairs]');
  ok(/Chair 1 (28|29) /.test(seated), 'demo: the desk can seat a waiting customer in the free chair', seated.slice(0, 80));
} catch (e) {
  res.push('CRASH ' + String(e.stack ?? e.message).slice(0, 400));
}
ok(errs.length === 0, 'no script errors on any page', errs.join(' | ').slice(0, 400));
console.log(res.join('\n'));
console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} of ${res.length} passed`);
await browser.close();
process.exit(res.some((r) => !r.startsWith('PASS')) ? 1 : 0);
