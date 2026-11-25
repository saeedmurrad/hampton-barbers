#!/usr/bin/env node
/**
 * Screenshot + QA helper. Drives the Google Chrome already installed on this Mac
 * (puppeteer-core downloads no browser) and can serve the built `dist/` folder
 * through request interception, so no local web server is needed.
 *
 * Examples
 *   node scripts/shoot.mjs --dist dist --path / --theme heritage --mode fold --out shots/home
 *   node scripts/shoot.mjs --dist dist --path /services/ --mobile --mode full --axe --out shots/services-m
 *   node scripts/shoot.mjs --url http://localhost:4321/hampton-barbers/ --mode steps --out shots/dev
 *
 * Options
 *   --url <full url>      Page to open (dev server or live site). Wins over --dist.
 *   --dist <dir>          Serve this built folder at http://dist.test (GitHub Pages rules).
 *   --base </path>        Base path used with --dist (default /hampton-barbers).
 *   --path </page/>       Page path under the base (default /).
 *   --theme <id>          Adds ?theme=<id>.
 *   --viewport <WxH>      Default 1440x900.  --mobile = 390x844 touch.  --tablet = 820x1180 touch.
 *   --dpr <n>             Device pixel ratio (default 1).
 *   --mode <m>            fold | full | steps | element   (default fold)
 *   --selector <css>      Element to scroll to (mode element).
 *   --motion <m>          normal | reduce  (default: reduce for full, normal otherwise)
 *   --scheme <s>          light | dark  (prefers-color-scheme emulation)
 *   --wait <ms>           Pause after load before capturing (default 1800).
 *   --settle <ms>         Pause after each scroll step (default 900).
 *   --slice <px>          Slice height in full mode (default 1700 desktop, 2300 mobile).
 *   --max <n>             Max slices/steps (default 14).
 *   --axe                 Run axe-core accessibility checks.
 *   --out <prefix>        Output path prefix, e.g. shots/home-heritage  (required unless --no-shot)
 *   --no-shot             Skip screenshots, only print the report.
 *   --png                 PNG instead of JPEG.
 */
import puppeteer from 'puppeteer-core';
import { readFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const args = parseArgs(process.argv.slice(2));
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.xml': 'application/xml',
  '.txt': 'text/plain; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.gif': 'image/gif', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.webmanifest': 'application/manifest+json',
  '.mp4': 'video/mp4', '.webm': 'video/webm', '.map': 'application/json',
};

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function isDir(p) { try { return (await stat(p)).isDirectory(); } catch { return false; } }
async function isFile(p) { try { return (await stat(p)).isFile(); } catch { return false; } }

const base = String(args.base ?? '/hampton-barbers').replace(/\/$/, '');
const distDir = args.dist && !args.url ? path.resolve(String(args.dist)) : null;
const DIST_ORIGIN = 'http://dist.test';
const pagePath = String(args.path ?? '/');
const target = new URL(args.url ? String(args.url) : DIST_ORIGIN + base + pagePath);
if (args.theme) target.searchParams.set('theme', String(args.theme));

let viewport = { width: 1440, height: 900, isMobile: false, hasTouch: false };
if (args.mobile) viewport = { width: 390, height: 844, isMobile: true, hasTouch: true };
if (args.tablet) viewport = { width: 820, height: 1180, isMobile: true, hasTouch: true };
if (args.viewport) {
  const [w, h] = String(args.viewport).split('x').map(Number);
  viewport = { ...viewport, width: w, height: h };
}
viewport.deviceScaleFactor = Number(args.dpr ?? 1);

const mode = String(args.mode ?? 'fold');
const motion = String(args.motion ?? (mode === 'full' ? 'reduce' : 'normal'));
const waitMs = Number(args.wait ?? 1800);
const settleMs = Number(args.settle ?? 900);
const maxShots = Number(args.max ?? 14);
const sliceH = Number(args.slice ?? (viewport.width < 600 ? 2300 : 1700));
const ext = args.png ? 'png' : 'jpg';
const noShot = Boolean(args['no-shot']);
if (!noShot && !args.out) { console.error('Missing --out <prefix> (or pass --no-shot)'); process.exit(2); }
const outPrefix = args.out ? path.resolve(String(args.out)) : null;
if (outPrefix) await mkdir(path.dirname(outPrefix), { recursive: true });

const report = {
  url: target.href, mode, motion, viewport: `${viewport.width}x${viewport.height}`, status: null, title: null,
  consoleErrors: [], pageErrors: [], failedRequests: [], notFound: [], bytes: { html: 0, css: 0, js: 0, img: 0, font: 0, other: 0 },
  requests: 0, shots: [],
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: true,
  args: ['--hide-scrollbars', '--no-first-run', '--disable-extensions', '--mute-audio', '--disable-background-networking'],
});

try {
  const page = await browser.newPage();
  await page.setViewport(viewport);
  const media = [{ name: 'prefers-reduced-motion', value: motion === 'reduce' ? 'reduce' : 'no-preference' }];
  if (args.scheme) media.push({ name: 'prefers-color-scheme', value: String(args.scheme) });
  await page.emulateMediaFeatures(media);

  page.on('console', (m) => { if (m.type() === 'error') report.consoleErrors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => report.pageErrors.push(String(e?.message ?? e).slice(0, 300)));
  page.on('requestfailed', (r) => {
    const u = r.url();
    if (!u.startsWith('data:')) report.failedRequests.push(`${r.failure()?.errorText ?? 'failed'} ${u.slice(0, 200)}`);
  });

  const bucket = (ct, file) => {
    const e = path.extname(file).toLowerCase();
    if (e === '.html' || /html/.test(ct)) return 'html';
    if (e === '.css') return 'css';
    if (e === '.js' || e === '.mjs') return 'js';
    if (['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.svg', '.ico'].includes(e)) return 'img';
    if (['.woff2', '.woff', '.ttf'].includes(e)) return 'font';
    return 'other';
  };

  if (distDir) {
    await page.setRequestInterception(true);
    page.on('request', async (req) => {
      try {
        const u = new URL(req.url());
        if (u.origin !== DIST_ORIGIN) return void (await req.continue());
        let p = decodeURIComponent(u.pathname);
        const serve404 = async () => {
          report.notFound.push(u.pathname);
          const f = path.join(distDir, '404.html');
          const body = (await isFile(f)) ? await readFile(f) : Buffer.from('Not found');
          await req.respond({ status: 404, contentType: MIME['.html'], body });
        };
        if (base) {
          if (p === base) return void (await req.respond({ status: 301, headers: { location: base + '/' + u.search }, body: '' }));
          if (!p.startsWith(base + '/')) return void (await serve404());
          p = p.slice(base.length);
        }
        let file = path.join(distDir, p);
        if (!file.startsWith(distDir)) return void (await serve404());
        if (p.endsWith('/')) file = path.join(file, 'index.html');
        else if (await isDir(file)) return void (await req.respond({ status: 301, headers: { location: u.pathname + '/' + u.search }, body: '' }));
        else if (!(await isFile(file)) && (await isFile(file + '.html'))) file += '.html';
        if (!(await isFile(file))) return void (await serve404());
        const body = await readFile(file);
        const ct = MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
        report.bytes[bucket(ct, file)] += body.length;
        report.requests++;
        await req.respond({ status: 200, contentType: ct, body });
      } catch (err) {
        try { await req.abort(); } catch { /* already handled */ }
      }
    });
  }

  const res = await page.goto(target.href, { waitUntil: 'load', timeout: 45000 });
  report.status = res?.status() ?? null;
  try { await page.waitForNetworkIdle({ idleTime: 400, timeout: 8000 }); } catch { /* keep going */ }
  await page.evaluate(() => document.fonts?.ready);
  await sleep(waitMs);
  report.title = await page.title();

  const shot = async (suffix, opts = {}) => {
    if (noShot) return;
    const file = `${outPrefix}${suffix}.${ext}`;
    await page.screenshot({ path: file, type: args.png ? 'png' : 'jpeg', ...(args.png ? {} : { quality: 84 }), ...opts });
    report.shots.push(file);
  };

  const gentleScrollTo = async (y) => {
    await page.evaluate(async (targetY) => {
      const start = window.scrollY;
      const dist = targetY - start;
      const steps = Math.max(1, Math.min(40, Math.ceil(Math.abs(dist) / 120)));
      for (let i = 1; i <= steps; i++) {
        window.scrollTo({ top: start + (dist * i) / steps, behavior: 'instant' });
        await new Promise((r) => requestAnimationFrame(() => r()));
      }
    }, y);
  };

  const pageHeight = () => page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));

  if (mode === 'fold') {
    await shot('');
  } else if (mode === 'element') {
    const ok = await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      el.scrollIntoView({ block: 'start', behavior: 'instant' });
      return true;
    }, String(args.selector ?? 'main'));
    if (!ok) report.pageErrors.push(`selector not found: ${args.selector}`);
    await sleep(settleMs);
    await shot('');
  } else if (mode === 'steps') {
    const total = await pageHeight();
    const stride = Math.round(viewport.height * 0.86);
    let y = 0; let i = 0;
    while (i < maxShots) {
      await gentleScrollTo(y);
      await sleep(i === 0 ? 100 : settleMs);
      await shot(`-${String(i + 1).padStart(2, '0')}`);
      i++;
      if (y + viewport.height >= total - 2) break;
      y = Math.min(y + stride, total - viewport.height);
    }
    report.truncated = (await pageHeight()) > y + viewport.height + 2;
  } else if (mode === 'full') {
    // Walk the page once so lazy images and in-view states load, then capture slices.
    let total = await pageHeight();
    for (let y = 0; y < total; y += Math.round(viewport.height * 0.8)) { await gentleScrollTo(y); await sleep(120); }
    await gentleScrollTo(0);
    await page.evaluate(async () => {
      await Promise.all([...document.images].filter((im) => !im.complete).map((im) => new Promise((r) => { im.onload = im.onerror = r; setTimeout(r, 4000); })));
    });
    await sleep(500);
    total = await pageHeight();
    report.pageHeight = total;
    let i = 0;
    for (let y = 0; y < total && i < maxShots; y += sliceH, i++) {
      await shot(`-${String(i + 1).padStart(2, '0')}`, {
        clip: { x: 0, y, width: viewport.width, height: Math.min(sliceH, total - y) }, captureBeyondViewport: true,
      });
    }
    report.truncated = total > maxShots * sliceH;
  } else {
    throw new Error(`Unknown --mode ${mode}`);
  }

  // ---- page facts -------------------------------------------------------
  Object.assign(report, await page.evaluate(() => {
    const cssPath = (el) => {
      const parts = [];
      for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
        let s = n.tagName.toLowerCase();
        if (n.id) { parts.unshift(`${s}#${n.id}`); break; }
        const cls = [...n.classList].slice(0, 2).join('.');
        if (cls) s += `.${cls}`;
        parts.unshift(s);
      }
      return parts.join(' > ');
    };
    const de = document.documentElement;
    const vw = de.clientWidth;
    const overflowX = [];
    if (de.scrollWidth > vw + 1) {
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= vw + 1) continue;
        let clipped = false;
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(p).overflowX)) { clipped = true; break; }
        }
        if (!clipped) overflowX.push({ el: cssPath(el), right: Math.round(r.right), width: Math.round(r.width) });
        if (overflowX.length >= 8) break;
      }
    }
    const imgs = [...document.images];
    const h = (sel) => [...document.querySelectorAll(sel)].map((e) => e.textContent.trim().replace(/\s+/g, ' ').slice(0, 90));
    const meta = (n) => document.querySelector(`meta[name="${n}"],meta[property="${n}"]`)?.getAttribute('content') ?? null;
    return {
      theme: de.dataset.theme ?? null,
      lang: de.lang || null,
      docWidth: de.scrollWidth, viewportWidth: vw,
      overflowX,
      domNodes: document.querySelectorAll('*').length,
      h1: h('h1'), h2: h('h2').slice(0, 14),
      metaDescription: meta('description'), robots: meta('robots'), ogImage: meta('og:image'),
      canonical: document.querySelector('link[rel="canonical"]')?.href ?? null,
      jsonLdBlocks: document.querySelectorAll('script[type="application/ld+json"]').length,
      images: {
        total: imgs.length,
        missingAlt: imgs.filter((im) => !im.hasAttribute('alt')).map((im) => (im.currentSrc || im.src).split('/').pop()).slice(0, 8),
        broken: imgs.filter((im) => im.complete && im.naturalWidth === 0).map((im) => (im.currentSrc || im.src).slice(-80)).slice(0, 8),
        noDimensions: imgs.filter((im) => !(im.getAttribute('width') && im.getAttribute('height'))).length,
      },
      smallTapTargets: [...document.querySelectorAll('a[href],button,summary,input,select,[role="button"]')]
        .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24) && getComputedStyle(e).display !== 'inline'; })
        .map(cssPath).slice(0, 8),
    };
  }));

  // ---- web-vitals style metrics -----------------------------------------
  report.vitals = await page.evaluate(() => new Promise((resolve) => {
    const out = { lcpMs: null, lcpEl: null, cls: 0, fcpMs: null, loadMs: null };
    try {
      new PerformanceObserver((list) => {
        const e = list.getEntries().at(-1);
        if (e) { out.lcpMs = Math.round(e.startTime); out.lcpEl = e.element ? e.element.tagName.toLowerCase() + (e.element.className ? '.' + String(e.element.className).split(' ')[0] : '') : null; }
      }).observe({ type: 'largest-contentful-paint', buffered: true });
      new PerformanceObserver((list) => { for (const e of list.getEntries()) if (!e.hadRecentInput) out.cls += e.value; })
        .observe({ type: 'layout-shift', buffered: true });
    } catch { /* unsupported */ }
    const nav = performance.getEntriesByType('navigation')[0];
    out.loadMs = nav ? Math.round(nav.loadEventEnd) : null;
    const fcp = performance.getEntriesByName('first-contentful-paint')[0];
    out.fcpMs = fcp ? Math.round(fcp.startTime) : null;
    setTimeout(() => { out.cls = Math.round(out.cls * 1000) / 1000; resolve(out); }, 300);
  }));

  if (args.axe) {
    await page.addScriptTag({ path: require.resolve('axe-core/axe.min.js') });
    const results = await page.evaluate(async () => {
      // eslint-disable-next-line no-undef
      const r = await axe.run(document, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({
        id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
        sample: v.nodes.slice(0, 3).map((n) => ({ target: n.target.join(' '), html: n.html.slice(0, 140), why: (n.failureSummary || '').split('\n').slice(1, 3).join(' ').slice(0, 220) })),
      }));
    });
    report.axe = results;
  }
} catch (err) {
  report.fatal = String(err?.stack ?? err).slice(0, 600);
  process.exitCode = 1;
} finally {
  await browser.close();
}

console.log(JSON.stringify(report, null, 2));
