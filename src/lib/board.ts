// Pure queue logic shared by every screen: the customer pages, the queue desk, the barber
// panel and the shop TV. No browser or Firebase code in here, so it can be tested on its own.

export type LiveMode = 'auto' | 'quiet' | 'steady' | 'busy' | 'very-busy' | 'paused';
export type Barber = { name: string; chair: number; on: boolean; brk: boolean; done: number };
export type TicketState = 'way' | 'here' | 'chair';
export type Ticket = {
  n: number;        // ticket number for today
  s: TicketState;   // on the way, in the shop, or in the chair
  at: number;       // when they joined (ms)
  eta: number;      // minutes after joining that an online customer said they would arrive
  src: 'web' | 'qr' | 'desk';
  arr?: number;     // when they arrived (ms)
  late?: number;    // 1 once "running late" has been used
  b?: string;       // barber id, once called to a chair
  ct?: number;      // when they were called to the chair (ms)
};
export type Board = {
  v: 2;
  day: string;      // the London date this queue belongs to; ticket numbers restart each day
  online: boolean;  // whether customers can join from their phones
  seq: number;      // last ticket number given out today
  staff: Record<string, Barber>;
  t: Record<string, Ticket>;
  avg: number;      // the shop's usual minutes per cut
  obs: { m: number; k: number }; // minutes and number of cuts actually timed today
  done: number;     // cuts finished today
  mode: LiveMode;
  note: string;
  call: { n: number; chair: number; at: number } | null; // the last number called, for the shop TV
  updatedAt: number;
};

export const SHOP_IDS = ['hampton-vale', 'shop-2', 'shop-3'];
export const GRACE_MIN = 10;      // an online place lapses this long after the stated arrival time
export const MAX_LINE = 40;       // most places a shop's queue can hold
export const CALLING_MS = 90_000; // how long a newly called number shows as "calling"
const MIN = 60_000;

export class QueueError extends Error {
  code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function fail(code: string): never { throw new QueueError(code); }

const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFmt = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: 'numeric', minute: '2-digit', hour12: true });
export const londonDay = (ms: number) => dayFmt.format(ms);
export const clockText = (ms: number) => clockFmt.format(ms).replace(/\s/g, ' ').toLowerCase();
export const ord = (n: number) => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const round5 = (n: number) => Math.max(0, Math.round(n / 5) * 5);
const ID = /^[A-Za-z0-9_-]{2,40}$/;
const MODES: LiveMode[] = ['auto', 'quiet', 'steady', 'busy', 'very-busy', 'paused'];

export const emptyBoard = (day: string): Board => ({
  v: 2, day, online: true, seq: 0, staff: {}, t: {}, avg: 20, obs: { m: 0, k: 0 }, done: 0, mode: 'auto', note: '', call: null, updatedAt: 0,
});
const starterStaff = (): Record<string, Barber> => ({
  b1: { name: '', chair: 1, on: true, brk: false, done: 0 },
  b2: { name: '', chair: 2, on: true, brk: false, done: 0 },
  b3: { name: '', chair: 3, on: true, brk: false, done: 0 },
});

// Anything read from storage or the internet goes through here before it is used.
export function cleanBoard(raw: unknown): Board {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const staff: Record<string, Barber> = {};
  for (const [id, v] of Object.entries(obj(r.staff)).slice(0, 12)) {
    if (!ID.test(id) || !v || typeof v !== 'object') continue;
    const x = v as Record<string, unknown>;
    staff[id] = { name: String(x.name ?? '').trim().slice(0, 20), chair: int(x.chair, 1, 30, 1), on: Boolean(x.on), brk: Boolean(x.brk), done: int(x.done, 0, 999, 0) };
  }
  const t: Record<string, Ticket> = {};
  for (const [id, v] of Object.entries(obj(r.t)).slice(0, 80)) {
    if (!ID.test(id) || !v || typeof v !== 'object') continue;
    const x = v as Record<string, unknown>;
    const s = x.s === 'chair' && typeof x.b === 'string' && staff[x.b] ? 'chair' : x.s === 'way' ? 'way' : 'here';
    const k: Ticket = { n: int(x.n, 1, 9999, 1), s, at: int(x.at, 0, 9e15, 0), eta: int(x.eta, 0, 120, 0), src: x.src === 'web' || x.src === 'qr' ? x.src : 'desk' };
    if (x.arr !== undefined) k.arr = int(x.arr, 0, 9e15, 0);
    if (x.late) k.late = 1;
    if (s === 'chair') { k.b = x.b as string; k.ct = int(x.ct, 0, 9e15, k.at); }
    t[id] = k;
  }
  const c = r.call && typeof r.call === 'object' ? r.call as Record<string, unknown> : null;
  const o = obj(r.obs);
  return {
    v: 2,
    day: typeof r.day === 'string' ? r.day.slice(0, 10) : '',
    online: r.online !== false,
    seq: int(r.seq, 0, 9999, 0),
    staff, t,
    avg: int(r.avg, 5, 90, 20),
    obs: { m: int(o.m, 0, 99999, 0), k: int(o.k, 0, 999, 0) },
    done: int(r.done, 0, 9999, 0),
    mode: MODES.includes(r.mode as LiveMode) ? r.mode as LiveMode : 'auto',
    note: typeof r.note === 'string' ? r.note.slice(0, 120) : '',
    call: c ? { n: int(c.n, 1, 9999, 1), chair: int(c.chair, 1, 30, 1), at: int(c.at, 0, 9e15, 0) } : null,
    updatedAt: int(r.updatedAt, 0, 9e15, 0),
  };
}

// ---------- reading a board ----------
export const lapsed = (k: Ticket, now: number) => k.s === 'way' && now > k.at + (k.eta + GRACE_MIN) * MIN;
// Everyone still waiting, in ticket order. People on their way keep their place in this list.
export function waiting(b: Board, now: number): [string, Ticket][] {
  return Object.entries(b.t).filter(([, k]) => k.s !== 'chair' && !lapsed(k, now)).sort((x, y) => x[1].n - y[1].n);
}
export const serving = (b: Board, barberId: string) => Object.entries(b.t).find(([, k]) => k.s === 'chair' && k.b === barberId);
export const working = (b: Board) => Object.entries(b.staff).filter(([, s]) => s.on && !s.brk).sort((x, y) => x[1].chair - y[1].chair);
// The shop's usual cut time, nudged towards what has actually been timed today.
export const cutMinutes = (b: Board) => Math.round((b.avg * 3 + b.obs.m) / (3 + b.obs.k));
// The next person a free barber should call: the lowest number that is in the shop.
export function nextUp(b: Board, now: number): string | null {
  const w = waiting(b, now).find(([, k]) => k.s === 'here');
  return w ? w[0] : null;
}
export const barberLabel = (s: { name: string; chair: number }) => s.name || `Barber ${s.chair}`;

// Plays the queue forward: each chair takes the lowest number that is in the shop at that
// moment. Someone on their way is skipped until their stated arrival time.
function simulate(b: Board, now: number, withWalkIn: boolean): Record<string, number> {
  const cut = cutMinutes(b) * MIN;
  const chairs = working(b).map(([id]) => { const cur = serving(b, id); return cur ? Math.max(now + 2 * MIN, (cur[1].ct ?? now) + cut) : now; });
  const start: Record<string, number> = {};
  if (!chairs.length) return start;
  const queue = waiting(b, now).map(([id, k]) => ({ id, ready: k.s === 'here' ? now : Math.max(now + 2 * MIN, k.at + k.eta * MIN) }));
  if (withWalkIn) queue.push({ id: '', ready: now });
  while (queue.length) {
    let c = 0;
    for (let i = 1; i < chairs.length; i++) if (chairs[i] < chairs[c]) c = i;
    let at = chairs[c];
    let i = queue.findIndex((q) => q.ready <= at);
    if (i < 0) { i = 0; for (let j = 1; j < queue.length; j++) if (queue[j].ready < queue[i].ready) i = j; at = queue[i].ready; }
    const [q] = queue.splice(i, 1);
    start[q.id] = at;
    chairs[c] = at + cut;
  }
  return start;
}
// When each waiting ticket should reach a chair, and when someone walking in now would.
export function estimate(b: Board, now: number): { start: Record<string, number>; walkIn: number; free: number } {
  const stopped = b.mode === 'paused' || !working(b).length;
  return {
    start: stopped ? {} : simulate(b, now, false),
    walkIn: stopped ? Infinity : simulate(b, now, true)[''],
    free: working(b).filter(([id]) => !serving(b, id)).length,
  };
}

export type ChairItem = { id: string; chair: number; name: string; state: 'free' | 'busy' | 'break'; tid?: string; n?: number; mins?: number; left?: number; calling?: boolean };
export type LineItem = { id: string; n: number; s: TicketState; mins: number; due: number };
export type BoardView = {
  level: 0 | 1 | 2 | 3 | 4;  // 0 not cutting, 1 quiet ... 4 very busy
  label: string; headline: string; unit: string; range: string;
  minutes: number;           // wait for someone walking in now (Infinity when not cutting)
  freeChairs: number; barbers: number; inChair: number; waiting: number; inShop: number; onWay: number;
  chairs: ChairItem[];
  line: LineItem[];   // everyone waiting, in ticket-number order
  turns: LineItem[];  // the same people in the order they are expected to be called
  note: string;
};

export function waitText(w: number): { headline: string; unit: string; range: string } {
  if (!Number.isFinite(w)) return { headline: '—', unit: '', range: 'Call the shop to check' };
  if (w === 0) return { headline: 'No wait', unit: '', range: 'A barber is free right now' };
  return { headline: `~${w}`, unit: 'min', range: `about ${Math.max(5, w - 5)}–${w + 10} minutes` };
}
// "Next", "5 min", "10 min": how long until a waiting ticket reaches a chair.
export const minsText = (mins: number) => mins < 0 ? '' : mins <= 2 ? 'Next' : `${Math.max(5, Math.round(mins / 5) * 5)} min`;

// The order people are expected to be called in: someone still on their way comes after the
// people already in the shop who will be seated before they arrive.
const byTurn = (line: LineItem[]) => [...line].sort((x, y) => (x.mins < 0 ? Infinity : x.mins) - (y.mins < 0 ? Infinity : y.mins) || x.n - y.n);

export function boardView(b: Board, now: number): BoardView {
  const est = estimate(b, now);
  const cut = cutMinutes(b);
  const chairs: ChairItem[] = Object.entries(b.staff).filter(([, s]) => s.on).sort((x, y) => x[1].chair - y[1].chair).map(([id, s]) => {
    const cur = serving(b, id);
    if (!cur) return { id, chair: s.chair, name: s.name, state: s.brk ? 'break' : 'free' };
    const mins = Math.max(0, Math.round((now - (cur[1].ct ?? now)) / MIN));
    return { id, chair: s.chair, name: s.name, state: 'busy', tid: cur[0], n: cur[1].n, mins, left: Math.max(0, cut - mins), calling: now - (cur[1].ct ?? 0) < CALLING_MS };
  });
  const line: LineItem[] = waiting(b, now).map(([id, k]) => ({
    id, n: k.n, s: k.s, due: k.s === 'way' ? k.at + k.eta * MIN : 0,
    mins: est.start[id] === undefined ? -1 : Math.max(0, Math.round((est.start[id] - now) / MIN)),
  }));
  const w = Number.isFinite(est.walkIn) ? round5((est.walkIn - now) / MIN) : Infinity;
  const auto = !Number.isFinite(w) ? 0 : w === 0 ? 1 : w <= 15 ? 2 : w <= 35 ? 3 : 4;
  const forced: Record<string, number> = { paused: 0, quiet: 1, steady: 2, busy: 3, 'very-busy': 4 };
  const level = (b.mode === 'auto' ? auto : forced[b.mode]) as BoardView['level'];
  const text = waitText(level === 0 ? Infinity : w);
  if (level !== 0 && w === 0 && est.free > 1) text.range = `${est.free} barbers are free right now`;
  return {
    level, label: ['Not cutting right now', 'Walk straight in', 'Short wait', 'Busy', 'Very busy'][level], ...text,
    minutes: level === 0 ? Infinity : w,
    freeChairs: est.free, barbers: working(b).length, inChair: chairs.filter((c) => c.state === 'busy').length,
    waiting: line.length, inShop: line.filter((x) => x.s === 'here').length, onWay: line.filter((x) => x.s === 'way').length,
    chairs, line, turns: byTurn(line), note: b.note,
  };
}

// One customer's place: how many will be called before them and roughly when their turn is.
export function placeOf(b: Board, id: string, now: number): { k: Ticket; ahead: number; mins: number; at: number } | null {
  const k = b.t[id];
  if (!k || k.s === 'chair' || lapsed(k, now)) return null;
  const start = estimate(b, now).start;
  const at = start[id];
  const before = (x: string, kx: Ticket) => at === undefined || start[x] === undefined ? kx.n < k.n : start[x] < at || (start[x] === at && kx.n < k.n);
  return { k, ahead: waiting(b, now).filter(([x, kx]) => x !== id && before(x, kx)).length, mins: at === undefined ? -1 : Math.max(0, Math.round((at - now) / MIN)), at: at ?? 0 };
}

export function agoText(updatedAt: number, now: number): string {
  if (!updatedAt) return 'Example status for this demo';
  const m = Math.max(0, Math.round((now - updatedAt) / MIN));
  if (m < 1) return 'Updated just now';
  if (m < 60) return `Updated ${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `Updated ${h} hour${h > 1 ? 's' : ''} ago` : 'Not updated today, call to check';
}

// ---------- changing a board (every function returns a new board) ----------
const copy = (b: Board): Board => ({ ...b, staff: { ...b.staff }, t: { ...b.t }, obs: { ...b.obs } });
const touch = (b: Board, now: number): Board => { b.updatedAt = Math.max(now, b.updatedAt + 1); return b; };

// A new day starts a new queue: numbers go back to 1 and yesterday's tickets are dropped.
export function openToday(b: Board | null, now: number): Board {
  const day = londonDay(now);
  if (b && b.day === day) return b;
  const staff: Record<string, Barber> = {};
  for (const [id, s] of Object.entries(b && Object.keys(b.staff).length ? b.staff : starterStaff())) staff[id] = { ...s, brk: false, done: 0 };
  return { ...emptyBoard(day), staff, avg: b?.avg ?? 20, online: b?.online ?? true };
}
// Drops online places whose owner never arrived.
export function expire(b: Board, now: number): Board {
  const gone = Object.entries(b.t).filter(([, k]) => lapsed(k, now));
  if (!gone.length) return b;
  const n = copy(b);
  for (const [id] of gone) delete n.t[id];
  return touch(n, now);
}

// What a customer can do: join, say they have arrived, say they are running late, leave.
export function join(b: Board, id: string, now: number, eta: number, src: 'web' | 'qr'): Board {
  if (!b.online) fail('closed');
  if (b.t[id]) fail('already');
  if (Object.keys(b.t).length >= MAX_LINE) fail('full');
  const n = copy(b);
  n.seq = b.seq + 1;
  n.t[id] = { n: n.seq, s: src === 'qr' ? 'here' : 'way', at: now, eta: src === 'qr' ? 0 : int(eta, 0, 60, 10), src };
  return touch(n, now);
}
export function arrive(b: Board, id: string, now: number): Board {
  const k = b.t[id];
  if (!k) fail('gone');
  if (k.s !== 'way') return b;
  const n = copy(b);
  n.t[id] = { ...k, s: 'here', arr: now };
  return touch(n, now);
}
export function runLate(b: Board, id: string, now: number): Board {
  const k = b.t[id];
  if (!k) fail('gone');
  if (k.s !== 'way' || k.late) fail('no');
  const n = copy(b);
  n.t[id] = { ...k, eta: Math.min(120, Math.max(k.eta, Math.ceil((now - k.at) / MIN)) + 10), late: 1 };
  return touch(n, now);
}
export function leave(b: Board, id: string, now: number): Board {
  const k = b.t[id];
  if (!k) return b;
  if (k.s === 'chair') fail('no');
  const n = copy(b);
  delete n.t[id];
  return touch(n, now);
}

// What the shop can do.
export function addWalkIn(b: Board, id: string, now: number): Board {
  if (Object.keys(b.t).length >= MAX_LINE + 20) fail('full');
  const n = copy(b);
  n.seq = b.seq + 1;
  n.t[id] = { n: n.seq, s: 'here', at: now, eta: 0, src: 'desk', arr: now };
  return touch(n, now);
}
// Calls a customer to a barber's chair: the next person in the shop, or a chosen ticket.
export function callNext(b: Board, barberId: string, now: number, ticketId?: string): Board {
  const s = b.staff[barberId];
  if (!s || !s.on || s.brk) fail('off');
  if (serving(b, barberId)) fail('busy');
  const id = ticketId ?? nextUp(b, now);
  const k = id ? b.t[id] : undefined;
  if (!id || !k || k.s === 'chair') fail('none');
  const n = copy(b);
  n.t[id] = { ...k, s: 'chair', b: barberId, ct: now, arr: k.arr ?? now };
  n.call = { n: k.n, chair: s.chair, at: now };
  return touch(n, now);
}
// Puts a called customer back in the line (a wrong tap).
export function uncall(b: Board, id: string, now: number): Board {
  const k = b.t[id];
  if (!k || k.s !== 'chair') return b;
  const n = copy(b);
  n.t[id] = { n: k.n, s: 'here', at: k.at, eta: k.eta, src: k.src, arr: k.arr ?? now, ...(k.late ? { late: 1 } : {}) };
  if (n.call?.n === k.n) n.call = null;
  return touch(n, now);
}
export function finish(b: Board, barberId: string, now: number): Board {
  const cur = serving(b, barberId);
  if (!cur) fail('none');
  const n = copy(b);
  delete n.t[cur[0]];
  n.done = b.done + 1;
  n.staff[barberId] = { ...b.staff[barberId], done: b.staff[barberId].done + 1 };
  const mins = Math.round((now - (cur[1].ct ?? now)) / MIN);
  if (mins >= 3 && mins <= 90) n.obs = { m: b.obs.m + mins, k: b.obs.k + 1 }; // ignore forgotten taps
  if (n.call?.n === cur[1].n) n.call = null;
  return touch(n, now);
}
export function removeTicket(b: Board, id: string, now: number): Board {
  const k = b.t[id];
  if (!k) return b;
  const n = copy(b);
  delete n.t[id];
  if (n.call?.n === k.n) n.call = null;
  return touch(n, now);
}
export function setBarber(b: Board, id: string, patch: Partial<Barber>, now: number): Board {
  const cur = b.staff[id] ?? { name: '', chair: Math.max(0, ...Object.values(b.staff).map((s) => s.chair)) + 1, on: true, brk: false, done: 0 };
  if (!b.staff[id] && Object.keys(b.staff).length >= 12) fail('full');
  if (serving(b, id) && (patch.on === false || patch.brk === true)) fail('busy');
  const n = copy(b);
  n.staff[id] = { ...cur, ...patch, name: String(patch.name ?? cur.name).trim().slice(0, 20), chair: int(patch.chair ?? cur.chair, 1, 30, cur.chair) };
  if (!n.staff[id].on) n.staff[id].brk = false;
  return touch(n, now);
}
export function dropBarber(b: Board, id: string, now: number): Board {
  if (!b.staff[id]) return b;
  if (serving(b, id)) fail('busy');
  const n = copy(b);
  delete n.staff[id];
  return touch(n, now);
}
export function setOptions(b: Board, patch: { avg?: number; mode?: LiveMode; note?: string; online?: boolean }, now: number): Board {
  const n = copy(b);
  if (patch.avg !== undefined) n.avg = int(patch.avg, 5, 90, b.avg);
  if (patch.mode !== undefined && MODES.includes(patch.mode)) n.mode = patch.mode;
  if (patch.note !== undefined) n.note = String(patch.note).slice(0, 120);
  if (patch.online !== undefined) n.online = Boolean(patch.online);
  return touch(n, now);
}
// Empties the queue but keeps the day's numbering, so no number is ever given out twice.
export function clearQueue(b: Board, now: number): Board {
  const n = copy(b);
  n.t = {};
  n.call = null;
  return touch(n, now);
}

// ---------- example boards for the demo ----------
const PLANS: Record<string, { staff: number; first: number; chair: number[]; wait: ('h' | 'w')[] }> = {
  'hampton-vale': { staff: 3, first: 24, chair: [14, 6], wait: ['h', 'w', 'h'] },
  'shop-2': { staff: 2, first: 31, chair: [17, 9], wait: ['h', 'h', 'w', 'h'] },
  'shop-3': { staff: 3, first: 12, chair: [8], wait: [] },
  quiet: { staff: 3, first: 9, chair: [], wait: [] },
  steady: { staff: 3, first: 18, chair: [15, 9, 4], wait: ['h'] },
  busy: { staff: 3, first: 27, chair: [16, 11, 5], wait: ['h', 'h', 'w', 'h', 'w', 'h'] },
};
export const EXAMPLES = ['quiet', 'steady', 'busy'];
// A believable queue in mid-flow. `updatedAt` stays 0, which marks it as an example.
export function exampleBoard(key: string, now: number, keep?: Board): Board {
  const plan = PLANS[key] ?? PLANS['hampton-vale'];
  const b = openToday(null, now);
  if (keep && Object.keys(keep.staff).length) b.staff = Object.fromEntries(Object.entries(keep.staff).map(([id, s]) => [id, { ...s, brk: false }]));
  else Object.keys(b.staff).slice(plan.staff).forEach((id) => delete b.staff[id]);
  const ids = working(b).map(([id]) => id);
  let n = plan.first - 1;
  plan.chair.slice(0, ids.length).forEach((mins, i) => {
    n++;
    b.t[`ex${n}`] = { n, s: 'chair', at: now - (mins + 12) * MIN, eta: 0, src: 'desk', arr: now - (mins + 12) * MIN, b: ids[i], ct: now - mins * MIN };
  });
  plan.wait.forEach((w, i) => {
    n++;
    const at = now - Math.max(2, 11 - i * 3) * MIN;
    b.t[`ex${n}`] = w === 'w' ? { n, s: 'way', at, eta: 15, src: 'web' } : { n, s: 'here', at, eta: 0, src: 'desk', arr: at };
  });
  b.seq = n;
  b.done = plan.first - 1;
  if (!keep) ids.forEach((id, i) => { b.staff[id].done = Math.floor((plan.first - 1) / ids.length) + (i < (plan.first - 1) % ids.length ? 1 : 0); });
  return b;
}
