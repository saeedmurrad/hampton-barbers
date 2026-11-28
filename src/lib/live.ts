// Drawing helpers for the customer-facing live panel (LiveNow.astro) and the first-screen
// card (LiveChip.astro). The numbers themselves come from board.ts.
import { agoText, ord, placeOf, type Board, type BoardView } from './board';

const CHAIR = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h20a3 3 0 0 1 3 3v13H11V9a3 3 0 0 1 3-3Z"/><path d="M8 24h32a2 2 0 0 1 2 2v4H6v-4a2 2 0 0 1 2-2Z"/><path d="M22 30h4v8h-4z"/><path d="M13 39h22a2 2 0 0 1 0 4H13a2 2 0 0 1 0-4Z"/></svg>';

export function chairsHtml(v: BoardView): string {
  if (!v.chairs.length) return '<li class="none">No barbers cutting right now</li>';
  return v.chairs.map((c, i) => `<li class="${c.state === 'free' ? 'free' : 'busy'}" style="--n:${i}">${CHAIR}<span>${c.state === 'free' ? 'Free' : c.state === 'break' ? 'Break' : 'In use'}</span></li>`).join('');
}

// The waiting line as ticket numbers: in the shop, on the way, and "You".
export function queueHtml(v: BoardView, mine?: string): string {
  if (!v.line.length) return '<li class="empty">Nobody waiting</li>';
  const shown = v.line.slice(0, 8);
  return shown.map((x, i) => {
    const me = !!mine && x.id === mine;
    const what = me ? 'you' : x.s === 'way' ? 'on the way' : 'in the shop';
    return `<li style="--n:${i}" class="${me ? 'me' : x.s === 'way' ? 'online' : ''}" title="Number ${x.n}, ${what}"><b>${x.n}</b>${me ? '<em>You</em>' : ''}</li>`;
  }).join('') + (v.line.length > shown.length ? `<li class="more">+${v.line.length - shown.length}</li>` : '');
}

// Fill a live panel or the first-screen card with a shop's current state.
export function paintLive(root: HTMLElement, v: BoardView, updatedAt: number, mine?: string) {
  root.dataset.level = String(v.level);
  const set = (k: string, t: string) => root.querySelectorAll<HTMLElement>(`[data-live="${k}"]`).forEach((el) => { if (el.textContent !== t) el.textContent = t; });
  set('label', v.label);
  set('headline', v.headline);
  set('unit', v.unit);
  set('range', v.range);
  set('free', String(v.freeChairs));
  set('barbers', String(v.barbers));
  set('waiting', String(v.waiting));
  set('ago', agoText(updatedAt, Date.now()));
  const note = root.querySelector<HTMLElement>('[data-live="note"]');
  if (note) { note.textContent = v.note; note.hidden = !v.note; }
  root.querySelectorAll<HTMLElement>('[data-live-meter] i').forEach((seg, i) => seg.classList.toggle('on', v.level > 0 && i < v.level));
  // Redraw the icons only when they change, so their pop-in animation does not replay every few seconds.
  const fill = (sel: string, html: string) => { const el = root.querySelector<HTMLElement>(sel); if (el && el.dataset.html !== html) { el.innerHTML = html; el.dataset.html = html; } };
  fill('[data-live-chairs]', chairsHtml(v));
  fill('[data-live-queue]', queueHtml(v, mine));
}

// One short line about a visitor's own ticket, or '' when it is no longer in the queue.
export function mineText(b: Board, id: string, now: number): string {
  if (b.t[id]?.s === 'chair') return 'It’s your turn!';
  const p = placeOf(b, id, now);
  if (!p) return '';
  return p.ahead === 0 ? (p.k.s === 'here' ? 'You’re next!' : 'You’re first in line') : `You’re ${ord(p.ahead + 1)} in line`;
}
