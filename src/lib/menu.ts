// One place that turns the price list into HTML for each design.
// Used at build time (for SEO) and in the browser (to show prices edited in the admin page).
import type { Category } from '../data/site';

export const STORE_KEY = 'hb-menu-v1';

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function renderMenu(design: string, cats: Category[]): string {
  const live = (cats ?? []).filter((c) => c && Array.isArray(c.items) && c.items.length);
  if (design === 'heritage') {
    return live.map((c) => `<section class="mcat"><h3 class="mcat__h">${esc(c.name)}</h3><ul class="cols">${c.items.map((i) =>
      `<li><div class="row"><h4>${esc(i.name)}</h4><i></i><b>${esc(i.price)}</b></div>${i.note ? `<p>${esc(i.note)}</p>` : ''}</li>`).join('')}</ul></section>`).join('');
  }
  if (design === 'fresh') {
    return live.map((c) => `<section class="pgroup"><h3 class="pgroup__h">${esc(c.name)}</h3><div class="cards">${c.items.map((i) =>
      `<article class="pc"><b>${esc(i.price)}</b><h4>${esc(i.name)}</h4>${i.note ? `<p>${esc(i.note)}</p>` : ''}</article>`).join('')}</div></section>`).join('');
  }
  if (design === 'street') {
    let n = 0;
    return live.map((c) => `<li class="cat">${esc(c.name)}</li>${c.items.map((i) =>
      `<li><span class="no">${String(++n).padStart(2, '0')}</span><div><h4>${esc(i.name)}</h4>${i.note ? `<p>${esc(i.note)}</p>` : ''}</div><b>${esc(i.price)}</b></li>`).join('')}`).join('');
  }
  // club
  return live.map((c) => `<div><h3>${esc(c.name)}</h3><ul>${c.items.map((i) =>
    `<li><span>${esc(i.name)}${i.note ? `<small>${esc(i.note)}</small>` : ''}</span><b>${esc(i.price)}</b></li>`).join('')}</ul></div>`).join('');
}
