// Live shop status: how busy the shop is right now, set by the admin.
// Demo: each design has its own scenario. In production there is one status for the shop.

export type LiveMode = 'auto' | 'quiet' | 'steady' | 'busy' | 'very-busy' | 'paused';
export type LiveStatus = {
  barbers: number;   // barbers cutting right now
  inChair: number;   // customers being served
  waiting: number;   // customers waiting
  minutes: number;   // average minutes per customer
  mode: LiveMode;    // 'auto' works the status out from the numbers
  note: string;      // optional short message, e.g. "Back from lunch at 2pm"
  updatedAt?: number; // ms since epoch; missing for the built-in demo values
};
export type LiveAll = Record<string, LiveStatus>;

export const LIVE_KEY = 'hb-live-v1';
export const LIVE_DESIGNS = ['heritage', 'fresh', 'street', 'club'] as const;

// Built-in demo scenarios, one per design.
export const LIVE_DEMO: LiveAll = {
  heritage: { barbers: 2, inChair: 0, waiting: 0, minutes: 20, mode: 'auto', note: '' },
  fresh: { barbers: 4, inChair: 4, waiting: 2, minutes: 20, mode: 'auto', note: '' },
  street: { barbers: 3, inChair: 3, waiting: 5, minutes: 20, mode: 'auto', note: '' },
  club: { barbers: 3, inChair: 2, waiting: 0, minutes: 20, mode: 'auto', note: '' },
};

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const MODES: LiveMode[] = ['auto', 'quiet', 'steady', 'busy', 'very-busy', 'paused'];

export function cleanStatus(v: Partial<LiveStatus> | undefined, fallback: LiveStatus): LiveStatus {
  if (!v || typeof v !== 'object') return { ...fallback };
  const barbers = clampInt(v.barbers, 0, 8, fallback.barbers);
  return {
    barbers,
    inChair: clampInt(v.inChair, 0, barbers, Math.min(fallback.inChair, barbers)),
    waiting: clampInt(v.waiting, 0, 30, fallback.waiting),
    minutes: clampInt(v.minutes, 5, 90, fallback.minutes),
    mode: MODES.includes(v.mode as LiveMode) ? (v.mode as LiveMode) : 'auto',
    note: typeof v.note === 'string' ? v.note.slice(0, 120) : '',
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : undefined,
  };
}

export function parseLiveAll(raw: string | null | undefined): LiveAll | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    return Object.fromEntries(LIVE_DESIGNS.map((d) => [d, cleanStatus(v[d], LIVE_DEMO[d])]));
  } catch {
    return null;
  }
}

export type LiveView = {
  level: 0 | 1 | 2 | 3 | 4;  // 0 paused, 1 quiet ... 4 very busy
  label: string;             // "Walk straight in", "Busy" ...
  headline: string;          // big wait text, e.g. "No wait" or "~30"
  unit: string;              // "min" or ""
  range: string;             // "about 25–35 minutes"
  freeChairs: number;
  barbers: number;
  inChair: number;
  waiting: number;
  note: string;
};

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);

// Rough wait: if a barber is free you go straight in. Otherwise you wait for the
// current cuts to finish (about half a cut on average) plus one full cut for every
// round of people ahead of you.
export function waitMinutes(s: LiveStatus): number {
  if (s.barbers <= 0) return Infinity;
  const free = Math.max(0, s.barbers - s.inChair);
  if (free > s.waiting) return 0;
  const ahead = s.waiting - free;
  return round5(s.minutes / 2 + Math.floor(ahead / s.barbers) * s.minutes);
}

export function viewOf(s: LiveStatus): LiveView {
  const free = Math.max(0, s.barbers - s.inChair);
  const base = { freeChairs: free, barbers: s.barbers, inChair: s.inChair, waiting: s.waiting, note: s.note };
  const w = waitMinutes(s);
  const autoLevel = !Number.isFinite(w) ? 0 : w === 0 ? 1 : w <= 15 ? 2 : w <= 35 ? 3 : 4;
  const forced: Record<string, LiveView['level']> = { paused: 0, quiet: 1, steady: 2, busy: 3, 'very-busy': 4 };
  const level = (s.mode === 'auto' ? autoLevel : forced[s.mode]) as LiveView['level'];
  const labels = ['Not cutting right now', 'Walk straight in', 'Short wait', 'Busy', 'Very busy'];
  if (level === 0 || !Number.isFinite(w)) {
    return { ...base, level: 0, label: labels[0], headline: '—', unit: '', range: 'Call the shop to check' };
  }
  if (w === 0) return { ...base, level, label: labels[level], headline: 'No wait', unit: '', range: free === 1 ? 'A barber is free right now' : `${free} barbers are free right now` };
  const lo = Math.max(5, w - 5), hi = w + 10;
  return { ...base, level, label: labels[level], headline: `~${w}`, unit: 'min', range: `about ${lo}–${hi} minutes` };
}

export function agoText(updatedAt?: number, now = Date.now()): string {
  if (!updatedAt) return 'Example status for this demo';
  const m = Math.max(0, Math.round((now - updatedAt) / 60000));
  if (m < 1) return 'Updated just now';
  if (m < 60) return `Updated ${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `Updated ${h} hour${h > 1 ? 's' : ''} ago` : 'Not updated today, call to check';
}

// Read the published status from Firebase (no sign-in needed).
const PROJECT_ID = import.meta.env.PUBLIC_FB_PROJECT_ID as string | undefined;
export async function fetchLiveStatus(): Promise<LiveAll | null> {
  if (!PROJECT_ID) return null;
  try {
    const r = await fetch(`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/site/live`, { cache: 'no-store' });
    if (!r.ok) return null;
    return parseLiveAll((await r.json())?.fields?.json?.stringValue);
  } catch {
    return null;
  }
}

// Fill a live panel (component LiveNow.astro) with a status.
export function paintLive(root: HTMLElement, s: LiveStatus) {
  const v = viewOf(s);
  root.dataset.level = String(v.level);
  const set = (k: string, t: string) => root.querySelectorAll<HTMLElement>(`[data-live="${k}"]`).forEach((el) => { el.textContent = t; });
  set('label', v.label);
  set('headline', v.headline);
  set('unit', v.unit);
  set('range', v.range);
  set('free', String(v.freeChairs));
  set('barbers', String(v.barbers));
  set('waiting', String(v.waiting));
  set('ago', agoText(s.updatedAt));
  const note = root.querySelector<HTMLElement>('[data-live="note"]');
  if (note) { note.textContent = v.note; note.hidden = !v.note; }
  root.querySelectorAll<HTMLElement>('[data-live-meter] i').forEach((seg, i) => seg.classList.toggle('on', v.level > 0 && i < v.level));

  const chairs = root.querySelector<HTMLElement>('[data-live-chairs]');
  if (chairs) chairs.innerHTML = chairsHtml(v);
  const queue = root.querySelector<HTMLElement>('[data-live-queue]');
  if (queue) queue.innerHTML = queueHtml(v);
}

const CHAIR = '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M14 6h20a3 3 0 0 1 3 3v13H11V9a3 3 0 0 1 3-3Z"/><path d="M8 24h32a2 2 0 0 1 2 2v4H6v-4a2 2 0 0 1 2-2Z"/><path d="M22 30h4v8h-4z"/><path d="M13 39h22a2 2 0 0 1 0 4H13a2 2 0 0 1 0-4Z"/></svg>';
const PERSON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"/><path d="M4 22a8 8 0 0 1 16 0Z"/></svg>';

export function chairsHtml(v: LiveView): string {
  if (v.barbers === 0) return '<li class="none">No barbers cutting right now</li>';
  return Array.from({ length: v.barbers }, (_, i) => {
    const busy = i < v.inChair;
    return `<li class="${busy ? 'busy' : 'free'}" style="--n:${i}">${CHAIR}<span>${busy ? 'In use' : 'Free'}</span></li>`;
  }).join('');
}

export function queueHtml(v: LiveView): string {
  if (v.waiting === 0) return '<li class="empty">Nobody waiting</li>';
  const shown = Math.min(v.waiting, 8);
  return Array.from({ length: shown }, (_, i) => `<li style="--n:${i}">${PERSON}</li>`).join('') + (v.waiting > shown ? `<li class="more">+${v.waiting - shown}</li>` : '');
}
