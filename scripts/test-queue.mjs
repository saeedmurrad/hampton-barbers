// End-to-end test of the live queue against the Firebase emulators.
// Run:  npm run build && JAVA_HOME=<java 21> firebase emulators:exec --only auth,firestore \
//         --project hampton-barbers "node scripts/test-queue.mjs .check"
// It plays a barber (admin page, laptop) and customers (phones) in separate browsers,
// plus a same-device demo where the barber is not signed in.
import puppeteer from 'puppeteer-core';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve('dist'), ORIGIN = 'http://dist.test', BASE = '/hampton-barbers';
const OUT = path.resolve(process.argv[2] ?? '.check');
await mkdir(OUT, { recursive: true });
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
const b = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 60000,
  args: ['--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests'],
});
const res = [];
const ok = (c, l, d = '') => res.push(`${c ? 'PASS' : 'FAIL'}  ${l}${d ? ': ' + d : ''}`);
const errs = [];
const serve = async (page, tag) => {
  page.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  await page.setRequestInterception(true);
  page.on('request', async (req) => {
    const u = new URL(req.url());
    if (u.origin !== ORIGIN) return req.continue();
    let f = path.join(DIST, decodeURIComponent(u.pathname).slice(BASE.length));
    if (u.pathname.endsWith('/')) f = path.join(f, 'index.html');
    try { await stat(f); req.respond({ status: 200, contentType: MIME[path.extname(f)] ?? 'application/octet-stream', body: await readFile(f) }); }
    catch { req.respond({ status: 404, body: '' }); }
  });
};
const open = async (ctx, p, vp, tag) => {
  const page = await ctx.newPage();
  await page.setViewport(vp);
  await serve(page, tag);
  await page.goto(ORIGIN + BASE + p, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 1500));
  return page;
};
const txt = (pg, sel) => pg.$eval(sel, (e) => e.textContent.replace(/\s+/g, ' ').trim()).catch(() => '');
const waitText = async (pg, sel, re, ms = 30000) => {
  const t = Date.now();
  while (Date.now() - t < ms) { if (re.test(await txt(pg, sel))) return true; await new Promise((r) => setTimeout(r, 400)); }
  return false;
};
const rowOf = (pg, name) => pg.$$eval('[data-queue] li', (lis, n) => lis.findIndex((li) => li.textContent.includes(n)), name);
const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true };
const LAPTOP = { width: 1366, height: 900 };

await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'owner@test.local', password: 'test-pass-1', returnSecureToken: true }),
});

try {
  // ---------- the barber: admin page on a laptop, signed in ----------
  const adminCtx = await b.createBrowserContext();
  const A = await open(adminCtx, '/admin/live/?emulator', LAPTOP, 'admin');
  await A.type('#la-signin input[name=email]', 'owner@test.local');
  await A.type('#la-signin input[name=password]', 'test-pass-1');
  await A.click('#la-signin button[type=submit]');
  ok(await waitText(A, '#la-account', /Signed in as owner@test\.local/), 'barber signs in');
  await A.click('[data-tab="street"]');
  await A.click('[data-quick="empty"]');
  for (let i = 0; i < 5; i++) await A.click('[data-quick="walkin"]');
  ok(await waitText(A, '#la-status', /Live for everyone/), 'barber publishes: 3 in chairs, 2 waiting', await txt(A, '#la-status'));

  // ---------- a customer on their phone ----------
  const custCtx = await b.createBrowserContext();
  const C = await open(custCtx, '/street/?emulator', PHONE, 'customer');
  ok(await waitText(C, '#live [data-live="waiting"]', /^2$/), 'customer sees 2 people waiting', await txt(C, '#live [data-live="waiting"]'));
  ok(/~10/.test(await txt(C, '#live [data-live="headline"]')), 'customer sees about 10 min wait', await txt(C, '#live [data-live="headline"]'));
  ok((await C.$$('[data-shop-key]')).length === 3, 'customer sees all three shops');
  await C.evaluate(() => document.querySelector('[data-join]').scrollIntoView({ block: 'center' }));
  await C.click('[data-join]');
  ok(await C.$eval('#join-dialog', (d) => d.open), 'join dialog opens');
  await C.screenshot({ path: path.join(OUT, 'q-c1-dialog.jpg'), type: 'jpeg', quality: 80 });
  await C.type('#join-dialog input[name=name]', 'Sam');
  await C.click('#join-dialog [data-join-submit]');
  ok(await waitText(C, '[data-ticket]', /in the queue at Hampton Vale|Checking you in at Hampton Vale/), 'customer is in the queue', (await txt(C, '[data-ticket]')).slice(0, 80));
  ok(/3\s*rd/.test(await txt(C, '[data-ticket] .tk__big')), 'customer is 3rd in line', await txt(C, '[data-ticket] .tk__big'));
  ok(/You’re 3rd in line/.test(await txt(C, '.lchip')), 'first-screen card shows "You’re 3rd in line"', (await txt(C, '.lchip')).slice(-30));
  ok((await C.$$('#live .live__queue li.me')).length === 1, 'customer sees themselves ("You") in the queue icons');
  await C.evaluate(() => document.querySelector('[data-ticket]').scrollIntoView({ block: 'start' }));
  await new Promise((r) => setTimeout(r, 900));
  await C.screenshot({ path: path.join(OUT, 'q-c2-in-queue.jpg'), type: 'jpeg', quality: 80 });

  // ---------- the barber sees Sam appear, then seats people in order ----------
  ok(await waitText(A, '[data-queue]', /Sam/, 25000), 'barber sees Sam in the online queue', (await txt(A, '[data-queue]')).slice(0, 120));
  ok(/1/.test(await txt(A, '[data-tab="street"] .badge')), 'Street tab shows 1 online joiner');
  await A.screenshot({ path: path.join(OUT, 'q-a1-queue.jpg'), type: 'jpeg', quality: 80 });
  await A.click('[data-seat="0"]');
  ok(await waitText(A, '#la-status', /Live for everyone/), 'barber seats the first walk-in');
  ok(await waitText(C, '[data-ticket]', /1 person ahead of you/, 30000), 'customer moves up: 1 person ahead', await txt(C, '[data-ticket] .tk__line'));
  await A.click('[data-seat="0"]');
  ok(await waitText(C, '[data-ticket]', /You’re next/, 30000), 'customer is told "You’re next"', await txt(C, '[data-ticket] .tk__line'));
  await C.screenshot({ path: path.join(OUT, 'q-c3-next.jpg'), type: 'jpeg', quality: 80 });
  await A.click(`[data-seat="${await rowOf(A, 'Sam')}"]`);
  ok(await waitText(C, '[data-ticket]', /It’s your turn, Sam/, 30000), 'customer is told "It’s your turn"');
  ok(/It’s your turn/.test(await txt(C, '.lchip')), 'first-screen card shows "It’s your turn!"');
  await C.screenshot({ path: path.join(OUT, 'q-c4-turn.jpg'), type: 'jpeg', quality: 80 });
  await new Promise((r) => setTimeout(r, 9000));
  ok(!/Sam/.test(await txt(A, '[data-queue]')), 'Sam is no longer in the barber’s queue');

  // ---------- a second customer joins, then leaves ----------
  const c2Ctx = await b.createBrowserContext();
  const D = await open(c2Ctx, '/street/?emulator', PHONE, 'customer2');
  await D.evaluate(() => document.querySelector('[data-join]').scrollIntoView({ block: 'center' }));
  await D.click('[data-join]');
  await D.type('#join-dialog input[name=name]', 'Lee');
  await D.click('#join-dialog [data-join-submit]');
  ok(await waitText(A, '[data-queue]', /Lee/, 25000), 'barber sees Lee join');
  await D.click('[data-leave]');
  ok(await waitText(A, '[data-queue]', /^(?!.*Lee).*$/, 25000), 'Lee leaves and disappears from the barber’s queue', (await txt(A, '[data-queue]')).slice(0, 80));

  // ---------- same-device demo, barber NOT signed in ----------
  const demoCtx = await b.createBrowserContext();
  const AD = await open(demoCtx, '/admin/live/?emulator', LAPTOP, 'admin-demo');
  await AD.click('[data-tab="heritage"]');
  const CD = await open(demoCtx, '/heritage/?emulator', LAPTOP, 'customer-demo');
  await CD.bringToFront();
  await CD.evaluate(() => document.querySelector('[data-join]').scrollIntoView({ block: 'center' }));
  await CD.click('[data-join]');
  await CD.type('#join-dialog input[name=name]', 'Ava');
  await CD.click('#join-dialog [data-join-submit]');
  ok(await waitText(AD, '[data-queue]', /Ava/, 25000), 'same device, not signed in: barber tab sees Ava');
  ok(/this device only/.test(await txt(AD, '#la-status')), 'not signed in: says this device only');
  await AD.bringToFront();
  await AD.$eval(`[data-seat="${await rowOf(AD, 'Ava')}"]`, (el) => el.click());
  await CD.bringToFront();
  ok(await waitText(CD, '[data-ticket]', /It’s your turn, Ava/, 15000), 'same device: customer tab shows "It’s your turn"');
} catch (e) {
  res.push('CRASH ' + String(e.message).slice(0, 200));
}
ok(errs.length === 0, 'no script errors', errs.join(' | ').slice(0, 300));
console.log(res.join('\n'));
await b.close();
process.exit(res.some((r) => !r.startsWith('PASS')) ? 1 : 0);
