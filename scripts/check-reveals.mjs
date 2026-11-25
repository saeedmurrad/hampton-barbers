// Scrolls each design to the bottom with animations on, then checks that every
// animated element finished: fully visible, not shifted, not blurred, not clipped,
// and that no heading is covered by a following element.
import puppeteer from 'puppeteer-core';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const DIST = path.resolve('dist'), ORIGIN = 'http://dist.test', BASE = '/hampton-barbers';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
let failures = 0;
for (const vp of [{ width: 390, height: 844, isMobile: true, hasTouch: true }, { width: 1366, height: 900 }]) {
  for (const d of ['heritage', 'fresh', 'street', 'club']) {
    const p = await b.newPage(); await p.setViewport(vp);
    await p.setRequestInterception(true);
    p.on('request', async (req) => {
      const u = new URL(req.url()); if (u.origin !== ORIGIN) return req.abort();
      let f = path.join(DIST, decodeURIComponent(u.pathname).slice(BASE.length)); if (u.pathname.endsWith('/')) f = path.join(f, 'index.html');
      try { await stat(f); req.respond({ status: 200, contentType: MIME[path.extname(f)] ?? 'application/octet-stream', body: await readFile(f) }); } catch { req.respond({ status: 404, body: '' }); }
    });
    await p.goto(`${ORIGIN}${BASE}/${d}/`, { waitUntil: 'load' });
    await p.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 300) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } });
    await new Promise((r) => setTimeout(r, 3500));
    const bad = await p.evaluate(() => {
      const out = [];
      const name = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : '') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"';
      for (const el of document.querySelectorAll('[data-reveal]')) {
        const targets = [el, ...el.querySelectorAll(':scope img')];
        for (const t of targets) {
          const cs = getComputedStyle(t);
          const probs = [];
          if (!el.classList.contains('in')) probs.push('never revealed');
          if (+cs.opacity < 0.99) probs.push('opacity ' + cs.opacity);
          if (cs.transform !== 'none' && !/^matrix\(1, 0, 0, 1, 0, 0\)$/.test(cs.transform)) probs.push('transform ' + cs.transform);
          if (cs.filter !== 'none' && !(document.body.classList.contains('street') && /^grayscale\(1\)( contrast\([\d.]+\))?$/.test(cs.filter))) probs.push('filter ' + cs.filter);
          if (cs.clipPath !== 'none' && !/inset\(0(px)?( -2%)?( 0(px)?)*( round 0(px)?)?\)|inset\(0px -2% 0px 0px\)|inset\(0px\)/.test(cs.clipPath)) probs.push('clip ' + cs.clipPath);
          if (probs.length) out.push(name(t) + ': ' + probs.join(', '));
        }
      }
      // headings covered by later content
      for (const h of document.querySelectorAll('main h2, main h1')) {
        const r = h.getBoundingClientRect(); if (!r.height) continue;
        const sib = h.nextElementSibling; if (!sib) continue;
        const s = sib.getBoundingClientRect();
        if (s.height && s.top < r.bottom - 4 && s.left < r.right - 4 && s.right > r.left + 4) out.push('heading overlapped by next element: ' + name(h));
      }
      return out;
    });
    const tag = `${d} @${vp.width}`;
    if (bad.length) { failures += bad.length; console.log(`FAIL ${tag}:\n  ` + [...new Set(bad)].slice(0, 12).join('\n  ')); } else console.log(`PASS ${tag}`);
    await p.close();
  }
}
await b.close();
process.exit(failures ? 1 : 0);
