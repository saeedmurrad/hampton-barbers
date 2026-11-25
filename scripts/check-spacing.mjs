// Spacing check for every design, on a phone and a laptop:
//  1. blank bands: horizontal strips of the page with nothing in them that are too tall
//  2. lopsided grids: a grid whose items leave a big empty area on one side
//  3. cramped headings: a heading stuck to the top edge of a section with its own background
// Run after `npm run build`:  node scripts/check-spacing.mjs [design ...]
import puppeteer from 'puppeteer-core';
import sharp from 'sharp';
import { readFile, stat, mkdir } from 'node:fs/promises';
import path from 'node:path';

const DIST = path.resolve('dist'), ORIGIN = 'http://dist.test', BASE = '/hampton-barbers';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
const designs = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const LIVE = process.argv.includes('--live'); // check the published site instead of dist/
const DESIGNS = designs.length ? designs : ['heritage', 'fresh', 'street', 'club'];
const VIEWS = [
  { name: 'laptop', vp: { width: 1366, height: 900 }, band: 230 },
  { name: 'phone', vp: { width: 390, height: 844, isMobile: true, hasTouch: true }, band: 170 },
];
const OUT = path.resolve('.check'); await mkdir(OUT, { recursive: true });

const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, protocolTimeout: 60000 });
let problems = 0;

for (const view of VIEWS) {
  for (const d of DESIGNS) {
    const p = await b.newPage();
    await p.setViewport(view.vp);
    await p.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    if (!LIVE) await p.setRequestInterception(true);
    if (!LIVE) p.on('request', async (req) => {
      const u = new URL(req.url());
      if (u.origin !== ORIGIN) return req.abort();
      let f = path.join(DIST, decodeURIComponent(u.pathname).slice(BASE.length));
      if (u.pathname.endsWith('/')) f = path.join(f, 'index.html');
      try { await stat(f); req.respond({ status: 200, contentType: MIME[path.extname(f)] ?? 'application/octet-stream', body: await readFile(f) }); }
      catch { req.respond({ status: 404, body: '' }); }
    });
    await p.goto(LIVE ? `https://saeedmurrad.github.io${BASE}/${d}/?nocache=${Date.now()}` : `${ORIGIN}${BASE}/${d}/`, { waitUntil: 'load' });
    await p.addStyleTag({ content: '.designs,.fab,.draftnote{display:none!important}' });
    await p.evaluate(async () => {
      for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); }
      scrollTo(0, 0);
      await Promise.all([...document.images].filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = i.onerror = r; setTimeout(r, 4000); })));
    });
    await new Promise((r) => setTimeout(r, 600));

    const found = await p.evaluate(() => {
      const out = [];
      const label = (el) => {
        const sec = el.closest('section[id], section[class], header, footer') || el;
        const c = (sec.className && typeof sec.className === 'string') ? '.' + sec.className.trim().split(/\s+/)[0] : '';
        return `${sec.tagName.toLowerCase()}${sec.id ? '#' + sec.id : c}`;
      };
      // 2. lopsided grids
      for (const g of document.querySelectorAll('main *')) {
        const cs = getComputedStyle(g);
        if (cs.display !== 'grid') continue;
        const r = g.getBoundingClientRect();
        if (r.width < 480 || r.height < 40) continue;
        const kids = [...g.children].filter((k) => { const s = getComputedStyle(k); return s.display !== 'none' && s.position !== 'absolute' && s.position !== 'fixed' && k.getBoundingClientRect().width > 0; });
        if (!kids.length) continue;
        const left = r.left + parseFloat(cs.paddingLeft), right = r.right - parseFloat(cs.paddingRight), width = right - left;
        const minL = Math.min(...kids.map((k) => k.getBoundingClientRect().left));
        const maxR = Math.max(...kids.map((k) => k.getBoundingClientRect().right));
        const emptyRight = right - maxR, emptyLeft = minL - left;
        if (emptyRight > Math.max(140, width * 0.22) && emptyLeft < 40) out.push(`lopsided grid in ${label(g)}: ${Math.round(emptyRight)}px empty on the right (${g.className || g.tagName})`);
        if (emptyLeft > Math.max(140, width * 0.22) && emptyRight < 40) out.push(`lopsided grid in ${label(g)}: ${Math.round(emptyLeft)}px empty on the left (${g.className || g.tagName})`);
      }
      // 3. headings stuck to a section edge where the background changes
      const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = getComputedStyle(n).backgroundColor; if (c && c !== 'rgba(0, 0, 0, 0)' && c !== 'transparent') return c; } return 'none'; };
      for (const h of document.querySelectorAll('main h2')) {
        const sec = h.closest('section'); if (!sec) continue;
        const prev = sec.previousElementSibling; if (!prev) continue;
        if (bgOf(sec) === bgOf(prev)) continue;
        const gap = h.getBoundingClientRect().top - sec.getBoundingClientRect().top;
        if (gap >= 0 && gap < 28) out.push(`heading "${h.textContent.trim().slice(0, 40)}" is only ${Math.round(gap)}px from the top of its section`);
      }
      // section map for the blank-band report
      const secs = [...document.querySelectorAll('main > *, body > header, body > footer, main section')].map((s) => {
        const r = s.getBoundingClientRect();
        return { name: label(s), top: r.top + scrollY, bottom: r.bottom + scrollY };
      });
      // things that legitimately look blank in a screenshot (maps load late)
      const skip = [...document.querySelectorAll('.map, iframe')].map((m) => { const r = m.getBoundingClientRect(); return [r.top + scrollY, r.bottom + scrollY]; });
      return { out, secs, skip, h: document.documentElement.scrollHeight };
    });

    // 1. blank bands from a full-page screenshot
    const png = await p.screenshot({ fullPage: true, type: 'png', captureBeyondViewport: true });
    const { data, info } = await sharp(png).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height, C = info.channels;
    const blank = new Uint8Array(H);
    for (let y = 0; y < H; y++) {
      const row = y * W * C; const r0 = data[row], g0 = data[row + 1], b0 = data[row + 2];
      let odd = 0;
      for (let x = 0; x < W; x += 2) { const i = row + x * C; if (Math.abs(data[i] - r0) > 10 || Math.abs(data[i + 1] - g0) > 10 || Math.abs(data[i + 2] - b0) > 10) odd++; }
      blank[y] = odd <= W * 0.002 ? 1 : 0;
    }
    const bands = [];
    for (let y = 0; y < H;) {
      if (!blank[y]) { y++; continue; }
      let e = y; while (e < H && blank[e]) e++;
      const mid = (y + e) / 2;
      const inSkip = found.skip.some(([t, b2]) => mid > t - 4 && mid < b2 + 4);
      if (e - y >= view.band && !inSkip) {
        const above = found.secs.filter((s) => s.top <= y + 2 && s.bottom >= y).map((s) => s.name);
        const below = found.secs.filter((s) => s.top <= e && s.bottom >= e - 2).map((s) => s.name);
        bands.push(`blank band ${e - y}px tall at y=${y} (from ${above.at(-1) ?? '?'} to ${below.at(-1) ?? '?'})`);
      }
      y = e;
    }
    const all = [...found.out, ...bands];
    const tag = `${d} on ${view.name}`;
    if (all.length) {
      problems += all.length;
      console.log(`FAIL ${tag}:\n  ` + all.join('\n  '));
      await sharp(png).resize({ width: Math.min(W, 900) }).jpeg({ quality: 70 }).toFile(path.join(OUT, `${d}-${view.name}.jpg`));
    } else console.log(`PASS ${tag}`);
    await p.close();
  }
}
await b.close();
process.exit(problems ? 1 : 0);
