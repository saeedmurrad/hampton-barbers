// Shared helpers for the browser tests: serve the built site to headless Chrome, drive the
// pages, and reach into the local Firebase emulators the way an administrator could.
import puppeteer from 'puppeteer-core';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const DIST = path.resolve('dist'), ORIGIN = 'http://dist.test', BASE = '/hampton-barbers';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.woff2': 'font/woff2' };
export const PHONE = { width: 390, height: 844, isMobile: true, hasTouch: true };
export const LAPTOP = { width: 1366, height: 900 };
export const TV = { width: 1920, height: 1080 };

export const launch = () => puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 60000,
  args: ['--mute-audio', '--disable-features=LocalNetworkAccessChecks,PrivateNetworkAccessSendPreflights,BlockInsecurePrivateNetworkRequests'],
});

// Results, and script errors seen on any page.
export const res = [];
export const errs = [];
export const ok = (c, label, detail = '') => res.push(`${c ? 'PASS' : 'FAIL'}  ${label}${!c && detail ? ': ' + detail : ''}`);
export const report = () => {
  ok(errs.length === 0, 'no script errors on any page', errs.join(' | ').slice(0, 400));
  console.log(res.join('\n'));
  console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} of ${res.length} passed`);
  return res.some((r) => !r.startsWith('PASS')) ? 1 : 0;
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function open(ctx, p, vp, tag) {
  const page = await ctx.newPage();
  await page.setViewport(vp);
  page.on('pageerror', (e) => errs.push(`${tag}: ${e.message}`));
  page.on('dialog', (d) => d.accept(d.type() === 'prompt' ? 'test reason' : undefined));
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
  await sleep(1500);
  return page;
}
// The text of an element, with a space between each piece of text inside it.
export const txt = (pg, sel) => pg.$eval(sel, (e) => {
  const out = [], walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  while (walk.nextNode()) { const t = walk.currentNode.textContent.replace(/\s+/g, ' ').trim(); if (t) out.push(t); }
  return out.join(' ');
}).catch(() => '');
export const tap = (pg, sel) => pg.$eval(sel, (el) => el.click());
export const setValue = (pg, sel, value) => pg.$eval(sel, (el, v) => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); }, value);
export const submit = (pg, sel) => pg.$eval(sel, (f) => f.requestSubmit());
export async function waitText(pg, sel, re, ms = 20000) {
  const t = Date.now();
  while (Date.now() - t < ms) { if (re.test(await txt(pg, sel))) return true; await sleep(300); }
  return false;
}
export async function signIn(pg, form, email = 'owner@test.local', password = 'test-pass-1') {
  await setValue(pg, `${form} input[name=email]`, email);
  await setValue(pg, `${form} input[name=password]`, password);
  await submit(pg, form);
}
// The payment step: tap a service, tap Cash or Online, save.
export async function pay(pg, svc, how) {
  await pg.waitForSelector('dialog.pay[open]', { timeout: 6000 });
  await tap(pg, `.pay [data-svc="${svc}"]`);
  await tap(pg, `.pay [data-pay="${how}"]`);
  await tap(pg, '.pay [data-save]');
}
export async function joinAs(pg, name) {
  await tap(pg, '[data-join]');
  await setValue(pg, '#join-dialog input[name=name]', name);
  await submit(pg, '[data-join-form]');
}

// ---------- the emulators, with administrator access (this never touches the real project) ----------
const P = 'hampton-barbers';
const DOCS = `http://127.0.0.1:8080/v1/projects/${P}/databases/(default)/documents`;
const ADMIN = { Authorization: 'Bearer owner', 'Content-Type': 'application/json' };
export const newAccount = (email, password = 'test-pass-1') => fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, returnSecureToken: true }),
});
const dec = (v) => 'integerValue' in v ? Number(v.integerValue) : 'doubleValue' in v ? v.doubleValue : 'stringValue' in v ? v.stringValue : 'booleanValue' in v ? v.booleanValue
  : 'mapValue' in v ? Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, dec(x)])) : null;
export async function readBoard(shop = 'hampton-vale') {
  const d = await (await fetch(`${DOCS}/boards/${shop}`, { headers: ADMIN })).json();
  return d.fields ? dec({ mapValue: { fields: d.fields } }) : null;
}
// Changes single fields of a shop's queue, e.g. { 'day': '2026-01-01' } or { 't.`abc`.at': 123 }.
export function editBoard(changes, shop = 'hampton-vale') {
  const enc = (v) => typeof v === 'number' ? { integerValue: String(Math.round(v)) } : typeof v === 'boolean' ? { booleanValue: v } : { stringValue: String(v) };
  const fields = {};
  for (const [pathStr, value] of Object.entries(changes)) {
    const parts = pathStr.split('.').map((x) => x.replace(/`/g, ''));
    let at = fields;
    parts.forEach((key, i) => {
      if (i === parts.length - 1) at[key] = enc(value);
      else { at[key] ??= { mapValue: { fields: {} } }; at = at[key].mapValue.fields; }
    });
  }
  const mask = Object.keys(changes).map((m) => `updateMask.fieldPaths=${encodeURIComponent(m)}`).join('&');
  return fetch(`${DOCS}/boards/${shop}?${mask}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields }) });
}
export async function countSales(shop = 'hampton-vale') {
  const d = await (await fetch(`${DOCS}/boards/${shop}/sales?pageSize=300`, { headers: ADMIN })).json();
  return (d.documents ?? []).length;
}
