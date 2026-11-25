// Live shop status: how busy each shop is right now, plus the walk-in queue.
// Demo: Hampton Vale has its own scenario in each design; the other two shops are shared.
// Production: one status per shop.

export type LiveMode = 'auto' | 'quiet' | 'steady' | 'busy' | 'very-busy' | 'paused';
export type LiveStatus = {
  barbers: number;    // barbers cutting right now
  inChair: number;    // customers being served
  waiting: number;    // people waiting (always line.length)
  minutes: number;    // average minutes per customer
  mode: LiveMode;     // 'auto' works the status out from the numbers
  note: string;       // optional short message, e.g. "Back from lunch at 2pm"
  line: string[];     // the queue in order: 'w' for a walk-in, or an online ticket id
  called: string[];   // online tickets recently called to the chair (newest last)
  updatedAt?: number; // ms since epoch; missing for the built-in demo values
};
export type LiveAll = Record<string, LiveStatus>;

export const LIVE_KEY = 'hb-live-v1';
export const TICKET_KEY = 'hb-ticket-v1';    // this visitor's own place in a queue
export const TICKETS_KEY = 'hb-tickets-v1';  // online joiners made on this device (for same-device demos)
export const WALK_IN = 'w';
export const LIVE_DESIGNS = ['heritage', 'fresh', 'street', 'club'] as const;
export const LIVE_BRANCHES = ['shop-2', 'shop-3'] as const;
export const LIVE_KEYS: string[] = [...LIVE_DESIGNS, ...LIVE_BRANCHES];

const demo = (barbers: number, inChair: number, waiting: number): LiveStatus => ({
  barbers, inChair, waiting, minutes: 20, mode: 'auto', note: '', line: Array(waiting).fill(WALK_IN), called: [],
});
// Built-in demo scenarios: Hampton Vale per design, then the two other shops.
export const LIVE_DEMO: LiveAll = {
  heritage: demo(2, 0, 0),
  fresh: demo(4, 4, 2),
  street: demo(3, 3, 5),
  club: demo(3, 2, 0),
  'shop-2': demo(2, 2, 3),
  'shop-3': demo(3, 1, 0),
};

const clampInt = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d;
};
const MODES: LiveMode[] = ['auto', 'quiet', 'steady', 'busy', 'very-busy', 'paused'];
const TICKET_ID = /^[A-Za-z0-9_-]{6,40}$/;

export function cleanStatus(v: Partial<LiveStatus> | undefined, fallback: LiveStatus): LiveStatus {
  if (!v || typeof v !== 'object') return { ...fallback, line: [...fallback.line], called: [...fallback.called] };
  const barbers = clampInt(v.barbers, 0, 8, fallback.barbers);
  // Older saved copies only had a number of people waiting: turn that into a line of walk-ins.
  const line = Array.isArray(v.line)
    ? v.line.filter((x) => x === WALK_IN || (typeof x === 'string' && TICKET_ID.test(x))).slice(0, 30)
    : Array(clampInt(v.waiting, 0, 30, fallback.waiting)).fill(WALK_IN);
  const called = Array.isArray(v.called) ? v.called.filter((x) => typeof x === 'string' && TICKET_ID.test(x)).slice(-20) : [];
  return {
    barbers,
    inChair: clampInt(v.inChair, 0, barbers, Math.min(fallback.inChair, barbers)),
    waiting: line.length,
    minutes: clampInt(v.minutes, 5, 90, fallback.minutes),
    mode: MODES.includes(v.mode as LiveMode) ? (v.mode as LiveMode) : 'auto',
    note: typeof v.note === 'string' ? v.note.slice(0, 120) : '',
    line,
    called,
    updatedAt: typeof v.updatedAt === 'number' ? v.updatedAt : undefined,
  };
}

export function parseLiveAll(raw: string | null | undefined): LiveAll | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw);
    if (!v || typeof v !== 'object') return null;
    return Object.fromEntries(LIVE_KEYS.map((k) => [k, cleanStatus(v[k], LIVE_DEMO[k])]));
  } catch {
    return null;
  }
}

// Of two copies of a shop's status, use the one updated most recently.
export function newest(a?: LiveStatus, b?: LiveStatus, fallback?: LiveStatus): LiveStatus {
  if (a && b) return (a.updatedAt ?? 0) >= (b.updatedAt ?? 0) ? a : b;
  return a ?? b ?? fallback!;
}

export type LiveView = {
  level: 0 | 1 | 2 | 3 | 4;  // 0 paused, 1 quiet ... 4 very busy
  label: string;             // "Walk straight in", "Busy" ...
  headline: string;          // big wait text, e.g. "No wait" or "~30"
  unit: string;              // "min" or ""
  range: string;             // "about 25–35 minutes"
  minutes: number;           // estimated wait for someone arriving now (Infinity when not cutting)
  freeChairs: number;
  barbers: number;
  inChair: number;
  waiting: number;
  line: string[];
  note: string;
};

const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);

// Rough wait for someone with `ahead` people in front of them. If a barber is free for them
// they go straight in. Otherwise they wait for the current cuts to finish (about half a cut
// on average) plus one full cut for every round of people still ahead.
export function waitForPosition(s: LiveStatus, ahead: number): number {
  if (s.barbers <= 0 || s.mode === 'paused') return Infinity;
  const free = Math.max(0, s.barbers - s.inChair);
  if (free > ahead) return 0;
  return round5(s.minutes / 2 + Math.floor((ahead - free) / s.barbers) * s.minutes);
}
export const waitMinutes = (s: LiveStatus) => waitForPosition(s, s.line.length);

export function waitText(w: number): { headline: string; unit: string; range: string } {
  if (!Number.isFinite(w)) return { headline: '—', unit: '', range: 'Call the shop to check' };
  if (w === 0) return { headline: 'No wait', unit: '', range: 'A barber is free right now' };
  return { headline: `~${w}`, unit: 'min', range: `about ${Math.max(5, w - 5)}–${w + 10} minutes` };
}

export function viewOf(s: LiveStatus): LiveView {
  const free = Math.max(0, s.barbers - s.inChair);
  const base = { freeChairs: free, barbers: s.barbers, inChair: s.inChair, waiting: s.line.length, line: s.line, note: s.note };
  const w = waitMinutes(s);
  const autoLevel = !Number.isFinite(w) ? 0 : w === 0 ? 1 : w <= 15 ? 2 : w <= 35 ? 3 : 4;
  const forced: Record<string, LiveView['level']> = { paused: 0, quiet: 1, steady: 2, busy: 3, 'very-busy': 4 };
  const level = (s.mode === 'auto' ? autoLevel : forced[s.mode]) as LiveView['level'];
  const labels = ['Not cutting right now', 'Walk straight in', 'Short wait', 'Busy', 'Very busy'];
  const t = waitText(level === 0 ? Infinity : w);
  if (w === 0 && Number.isFinite(w)) t.range = free === 1 ? 'A barber is free right now' : `${free} barbers are free right now`;
  return { ...base, level, label: labels[level], minutes: level === 0 ? Infinity : w, ...t };
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
    // Local testing only (never on the real site): ?emulator reads the Firebase emulator.
    const emu = /^(localhost|127\.0\.0\.1|.+\.test)$/.test(location.hostname) && new URLSearchParams(location.search).has('emulator');
    const host = emu ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
    const r = await fetch(`${host}/v1/projects/${PROJECT_ID}/databases/(default)/documents/site/live`, { cache: 'no-store' });
    if (!r.ok) return null;
    return parseLiveAll((await r.json())?.fields?.json?.stringValue);
  } catch {
    return null;
  }
}

// Fill a live panel (LiveNow.astro) or the first-screen chip (LiveChip.astro) with a status.
export function paintLive(root: HTMLElement, s: LiveStatus, mine?: string) {
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
  if (queue) queue.innerHTML = queueHtml(v, mine);
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

// The waiting line: walk-ins, people who joined online (phone badge) and "You".
export function queueHtml(v: LiveView, mine?: string): string {
  if (v.waiting === 0) return '<li class="empty">Nobody waiting</li>';
  const shown = v.line.slice(0, 8);
  return shown.map((x, i) => {
    const me = !!mine && x === mine;
    const online = x !== WALK_IN;
    const title = me ? 'You' : online ? 'Joined online' : 'Waiting in the shop';
    return `<li style="--n:${i}" class="${me ? 'me' : online ? 'online' : ''}" title="${title}">${PERSON}${me ? '<em>You</em>' : ''}</li>`;
  }).join('') + (v.waiting > shown.length ? `<li class="more">+${v.waiting - shown.length}</li>` : '');
}

// The three shops side by side, with the quickest one marked.
export type ShopInfo = { id: string; name: string; place: string; directionsUrl: string };
export function quickestKey(keys: string[], pick: (k: string) => LiveStatus): string {
  let best = keys[0], bestW = waitMinutes(pick(keys[0]));
  for (const k of keys.slice(1)) {
    const w = waitMinutes(pick(k));
    if (w < bestW) { best = k; bestW = w; }
  }
  return best;
}
