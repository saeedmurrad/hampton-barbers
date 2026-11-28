// The money side of the queue: what each customer had, who cut it, whether it was paid in
// cash or online, and how the takings split between each barber and the shop.
// Nothing here takes a payment: it only records one. Pure logic, no browser or Firebase code.
import { barberLabel, serving, QueueError, type Board } from './board.ts';

export type PayMethod = 'cash' | 'online' | 'none';
export type SaleInput = { svc: string; price: number; pay: PayMethod };
export type Sale = {
  id: string;
  shop: string;
  day: string;       // London date, e.g. 2026-11-28
  at: number;        // when it was saved (ms)
  b: string;         // barber id
  bn: string;        // the barber's name at the time
  chair: number;
  n: number;         // ticket number
  src: 'web' | 'qr' | 'desk';
  svc: string;       // what they had, e.g. "Skin Fade + Beard Trim"
  price: number;     // pence
  pay: PayMethod;
  wait: number;      // minutes waited in the shop before the chair
  mins: number;      // minutes in the chair
  by?: string;       // the sign-in that recorded it
  was?: { svc: string; price: number; pay: PayMethod }; // what it said before a correction
  void?: { at: number; why: string };                   // cancelled by the owner
};
// Each barber's share of a cut, as a percentage, with the date it applies from.
// A change takes effect from its date, so earlier sales keep the percentage they were made under.
export type PayRules = Record<string, { from: string; pct: number }[]>;

const MIN = 60_000;
const int = (v: unknown, lo: number, hi: number, d: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

// ---------- money and dates ----------
export const penceOf = (text: unknown) => Math.max(0, Math.round(parseFloat(String(text ?? '').replace(/[^0-9.]/g, '')) * 100) || 0);
export const money = (pence: number) => `£${(pence / 100).toLocaleString('en-GB', { minimumFractionDigits: pence % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
const toDate = (day: string) => new Date(`${day}T12:00:00Z`);
const toDay = (d: Date) => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number) => { const d = toDate(day); d.setUTCDate(d.getUTCDate() + n); return toDay(d); };
// Some browsers write "Saturday, 28 November"; the comma is dropped so every device reads the same.
const fmt = (o: Intl.DateTimeFormatOptions) => { const f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }); return { format: (d: Date) => f.format(d).replace(/,/g, '') }; };
const LONG = fmt({ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const SHORT = fmt({ weekday: 'short', day: 'numeric', month: 'short' });
const MONTH = fmt({ month: 'long', year: 'numeric' });
export const dayLabel = (day: string) => SHORT.format(toDate(day));

export type PeriodKind = 'day' | 'week' | 'month';
// The day, the Monday-to-Sunday week or the calendar month that contains `day`.
export function period(kind: PeriodKind, day: string): { from: string; to: string; label: string } {
  if (kind === 'day') return { from: day, to: day, label: LONG.format(toDate(day)) };
  if (kind === 'week') {
    const from = addDays(day, -((toDate(day).getUTCDay() + 6) % 7));
    return { from, to: addDays(from, 6), label: `${SHORT.format(toDate(from))} to ${SHORT.format(toDate(addDays(from, 6)))}` };
  }
  const from = `${day.slice(0, 8)}01`;
  const end = toDate(from);
  end.setUTCMonth(end.getUTCMonth() + 1, 0);
  return { from, to: toDay(end), label: MONTH.format(toDate(from)) };
}
export function shiftPeriod(kind: PeriodKind, day: string, dir: number): string {
  if (kind !== 'month') return addDays(day, (kind === 'week' ? 7 : 1) * dir);
  const d = toDate(`${day.slice(0, 8)}15`);
  d.setUTCMonth(d.getUTCMonth() + dir);
  return `${toDay(d).slice(0, 8)}01`;
}

// ---------- recording a sale ----------
// The record for the customer in a barber's chair, made at the moment the cut is finished.
export function saleFor(b: Board, shop: string, barberId: string, now: number, input: SaleInput): Omit<Sale, 'id'> {
  const cur = serving(b, barberId);
  const s = b.staff[barberId];
  if (!cur || !s) throw new QueueError('none');
  const k = cur[1];
  const called = k.ct ?? now;
  return {
    shop, day: b.day, at: now, b: barberId, bn: barberLabel(s), chair: s.chair, n: k.n, src: k.src,
    ...cleanInput(input),
    wait: int((called - (k.arr ?? k.at)) / MIN, 0, 600, 0), mins: int((now - called) / MIN, 0, 600, 0),
  };
}
export function cleanInput(input: SaleInput): SaleInput {
  const pay: PayMethod = input.pay === 'cash' || input.pay === 'online' ? input.pay : 'none';
  return { svc: String(input.svc || 'Haircut').trim().slice(0, 80), price: pay === 'none' ? 0 : int(input.price, 0, 100_000, 0), pay };
}
export function cleanSale(raw: unknown, id: string): Sale | null {
  const r = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!r || typeof r.day !== 'string' || typeof r.b !== 'string') return null;
  const sale: Sale = {
    id, shop: String(r.shop ?? ''), day: r.day.slice(0, 10), at: int(r.at, 0, 9e15, 0), b: r.b, bn: String(r.bn ?? '').slice(0, 30), chair: int(r.chair, 1, 30, 1),
    n: int(r.n, 1, 9999, 1), src: r.src === 'web' || r.src === 'qr' ? r.src : 'desk',
    ...cleanInput({ svc: String(r.svc ?? ''), price: Number(r.price), pay: r.pay as PayMethod }),
    wait: int(r.wait, 0, 600, 0), mins: int(r.mins, 0, 600, 0),
  };
  if (typeof r.by === 'string') sale.by = r.by;
  const was = r.was as Record<string, unknown> | undefined;
  if (was && typeof was === 'object') sale.was = cleanInput({ svc: String(was.svc ?? ''), price: Number(was.price), pay: was.pay as PayMethod });
  const v = r.void as Record<string, unknown> | undefined;
  if (v && typeof v === 'object') sale.void = { at: int(v.at, 0, 9e15, 0), why: String(v.why ?? '').slice(0, 120) };
  return sale;
}

// ---------- the split ----------
export function cleanRules(raw: unknown): PayRules {
  const out: PayRules = {};
  for (const [id, list] of Object.entries((raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>)) {
    if (!Array.isArray(list)) continue;
    out[id] = list.filter((x) => x && typeof x.from === 'string').map((x) => ({ from: String(x.from).slice(0, 10), pct: int(x.pct, 0, 100, 0) })).sort((x, y) => x.from.localeCompare(y.from)).slice(-40);
  }
  return out;
}
// The barber's percentage on a given day, or null if none had been set by then.
export function pctFor(rules: PayRules | undefined, barberId: string, day: string): number | null {
  let pct: number | null = null;
  for (const r of rules?.[barberId] ?? []) if (r.from <= day) pct = r.pct;
  return pct;
}
// Sets a barber's percentage from a date on. Earlier dates keep what they had.
export function setPct(rules: PayRules, barberId: string, from: string, pct: number): PayRules {
  const list = (rules[barberId] ?? []).filter((r) => r.from !== from);
  return cleanRules({ ...rules, [barberId]: [...list, { from, pct }] });
}
// Worked in whole pence, so the barber's share and the shop's share always add up to the price.
export const shareOf = (price: number, pct: number | null) => (pct === null ? 0 : Math.round(price * pct / 100));

// ---------- reports ----------
export type Row = { key: string; label: string; count: number; total: number; cash: number; online: number; barber: number; shop: number; wait: number; mins: number; pct: number | null | 'mixed' };
export type Report = { all: Row; byBarber: Row[]; byDay: Row[]; byService: { name: string; count: number; total: number }[]; voided: number; free: number };
const row = (key: string, label: string): Row => ({ key, label, count: 0, total: 0, cash: 0, online: 0, barber: 0, shop: 0, wait: 0, mins: 0, pct: null });

// Adds up a list of sales. `rules` holds each shop's percentages. Cancelled sales are left out.
export function summarize(sales: Sale[], rules: Record<string, PayRules>): Report {
  const all = row('all', 'All');
  const barbers = new Map<string, Row>(), days = new Map<string, Row>(), services = new Map<string, { name: string; count: number; total: number }>();
  const seen = new Map<string, Set<number | null>>();
  let voided = 0, free = 0;
  for (const s of [...sales].sort((x, y) => x.at - y.at)) {
    if (s.void) { voided++; continue; }
    if (s.pay === 'none') free++;
    const pct = pctFor(rules[s.shop], s.b, s.day);
    const share = shareOf(s.price, pct);
    const bKey = `${s.shop}/${s.b}`;
    if (!barbers.has(bKey)) barbers.set(bKey, row(bKey, s.bn));
    if (!days.has(s.day)) days.set(s.day, row(s.day, dayLabel(s.day)));
    barbers.get(bKey)!.label = s.bn; // the most recent name
    (seen.get(bKey) ?? seen.set(bKey, new Set()).get(bKey)!).add(pct);
    for (const r of [all, barbers.get(bKey)!, days.get(s.day)!]) {
      r.count++; r.total += s.price; r.barber += share; r.shop += s.price - share; r.wait += s.wait; r.mins += s.mins;
      if (s.pay === 'cash') r.cash += s.price; else if (s.pay === 'online') r.online += s.price;
    }
    for (const name of s.svc.split(' + ')) {
      const x = services.get(name) ?? { name, count: 0, total: 0 };
      x.count++;
      x.total += Math.round(s.price / s.svc.split(' + ').length);
      services.set(name, x);
    }
  }
  for (const [key, r] of barbers) { const set = seen.get(key)!; r.pct = set.size === 1 ? [...set][0] : 'mixed'; }
  return {
    all, voided, free,
    byBarber: [...barbers.values()].sort((x, y) => y.total - x.total),
    byDay: [...days.values()].sort((x, y) => x.key.localeCompare(y.key)),
    byService: [...services.values()].sort((x, y) => y.count - x.count),
  };
}

const csvCell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
// A spreadsheet of every sale in the list, one row each, for the accountant.
export function toCsv(sales: Sale[], rules: Record<string, PayRules>, shopName: (id: string) => string): string {
  const head = ['Date', 'Time', 'Shop', 'Ticket', 'Barber', 'Chair', 'Service', 'Price', 'Paid by', 'Barber %', 'Barber share', 'Shop share', 'Waited (min)', 'In chair (min)', 'Joined', 'Cancelled', 'Reason'];
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' });
  const lines = [...sales].sort((x, y) => x.at - y.at).map((s) => {
    const pct = pctFor(rules[s.shop], s.b, s.day), share = shareOf(s.price, pct);
    return [s.day, time.format(s.at), shopName(s.shop), s.n, s.bn, s.chair, s.svc, (s.price / 100).toFixed(2), s.pay === 'none' ? 'no charge' : s.pay, pct ?? '', (share / 100).toFixed(2), ((s.price - share) / 100).toFixed(2),
      s.wait, s.mins, s.src === 'desk' ? 'walk-in' : s.src === 'qr' ? 'door code' : 'online', s.void ? 'yes' : '', s.void?.why ?? ''].map(csvCell).join(',');
  });
  return [head.join(','), ...lines].join('\r\n');
}

// ---------- example figures for the demo ----------
// Believable sales for the last few weeks, the same every time for a given day, so the
// reports have something to show before the shop has recorded anything real.
export function exampleSales(shop: string, staff: { id: string; label: string; chair: number }[], services: { name: string; price: number }[], now: number, today: string, days = 35): Sale[] {
  const out: Sale[] = [];
  if (!staff.length || !services.length) return out;
  const weights = services.map((_, i) => Math.max(1, 6 - i)); // earlier items on the price list sell more
  const weightSum = weights.reduce((a, c) => a + c, 0);
  for (let d = days - 1; d >= 0; d--) {
    const day = addDays(today, -d);
    let seed = [...`${shop}${day}`].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
    const rnd = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const dow = toDate(day).getUTCDay();
    const busy = dow === 6 ? 1.35 : dow === 0 ? 0.6 : dow === 5 ? 1.15 : 1;
    const open = Date.parse(`${day}T09:00:00Z`);
    let n = 0;
    const cuts = staff.flatMap((s) => Array.from({ length: Math.round((9 + rnd() * 6) * busy) }, () => ({ s, at: open + Math.floor(rnd() * 600) * MIN }))).sort((x, y) => x.at - y.at);
    for (const c of cuts) {
      n++;
      if (c.at > now) continue;
      let pick = rnd() * weightSum, i = 0;
      while (pick > weights[i] && i < services.length - 1) { pick -= weights[i]; i++; }
      const online = rnd() < 0.62;
      out.push({ id: `ex-${shop}-${day}-${n}`, shop, day, at: c.at, b: c.s.id, bn: c.s.label, chair: c.s.chair, n, src: rnd() < 0.3 ? 'web' : 'desk', svc: services[i].name, price: services[i].price,
        pay: online ? 'online' : 'cash', wait: Math.floor(rnd() * 28), mins: 12 + Math.floor(rnd() * 16) });
    }
  }
  return out;
}
