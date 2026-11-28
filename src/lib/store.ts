// Where a shop's queue is kept. A real shop: Firebase (see cloud.ts). A demo on one device:
// this browser's storage. This file has no Firebase code, so ordinary page loads stay light.
import { cleanBoard, exampleBoard, londonDay, openToday, type Board, type TicketState } from './board';

export const BOARD_KEY = 'hb-board-v2';   // this device's copy of each shop's queue (demo use)
export const NAMES_KEY = 'hb-names-v2';   // first names for tickets made on this device (demo use)
export const TICKET_KEY = 'hb-ticket-v2'; // this visitor's own place in a queue
export const BARBER_KEY = 'hb-barber-v1'; // which shop and barber this device belongs to
export const DEMO_KEY = 'hb-demo-day';    // set (to today's date) while this device runs the demo queue
export const IS_DEMO = import.meta.env.PUBLIC_DEMO !== 'false';
const PROJECT_ID = import.meta.env.PUBLIC_FB_PROJECT_ID as string | undefined;
export const CONNECTED = Boolean(PROJECT_ID && import.meta.env.PUBLIC_FB_API_KEY);
// Local testing only (never on the real site): add ?emulator to use the Firebase emulators.
export const useEmulator = () => /^(localhost|127\.0\.0\.1|.+\.test)$/.test(location.hostname) && new URLSearchParams(location.search).has('emulator');

export type Mine = { shop: string; id: string; name: string; src: 'cloud' | 'local'; at: number; seen?: TicketState };
export type Source = 'cloud' | 'local' | 'example' | 'closed';

export const read = <T,>(k: string): T | null => { try { const x = localStorage.getItem(k); return x ? JSON.parse(x) as T : null; } catch { return null; } };
export const write = (k: string, x: unknown) => { try { if (x === null) localStorage.removeItem(k); else localStorage.setItem(k, JSON.stringify(x)); } catch { /* storage blocked */ } };
export const newId = (prefix: string) => prefix + Math.random().toString(36).slice(2, 12);
export const esc = (x: unknown) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

// ---------- this device ----------
const sameTab = new Set<() => void>();
// Runs `cb` when the queue, names or ticket kept on this device change, in this tab or another.
export function onDeviceChange(cb: () => void) {
  sameTab.add(cb);
  addEventListener('storage', (e) => { if (e.key === BOARD_KEY || e.key === NAMES_KEY || e.key === TICKET_KEY || e.key === DEMO_KEY) cb(); });
}
export function localBoard(shop: string, now = Date.now()): Board | null {
  const all = read<Record<string, unknown>>(BOARD_KEY);
  if (!all?.[shop]) return null;
  const b = cleanBoard(all[shop]);
  return b.day === londonDay(now) ? b : null; // yesterday's demo queue is not kept
}
export function actLocal(shop: string, fn: (b: Board, now: number) => Board): Board {
  const now = Date.now();
  const next = fn(localBoard(shop, now) ?? exampleBoard(shop, now), now);
  write(BOARD_KEY, { ...(read<Record<string, unknown>>(BOARD_KEY) ?? {}), [shop]: next });
  sameTab.forEach((cb) => cb());
  return next;
}
export const localNames = (shop: string): Record<string, string> => read<Record<string, Record<string, string>>>(NAMES_KEY)?.[shop] ?? {};
export function setLocalName(shop: string, id: string, name: string | null) {
  const all = read<Record<string, Record<string, string>>>(NAMES_KEY) ?? {};
  const m = { ...(all[shop] ?? {}) };
  if (name) m[id] = name.slice(0, 24); else delete m[id];
  write(NAMES_KEY, { ...all, [shop]: m });
  sameTab.forEach((cb) => cb());
}

// ---------- the published copy, read without loading Firebase ----------
type Wire = Record<string, unknown>;
const dec = (v: Wire): unknown => {
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('mapValue' in v) return Object.fromEntries(Object.entries(((v.mapValue as Wire).fields ?? {}) as Record<string, Wire>).map(([k, x]) => [k, dec(x)]));
  if ('arrayValue' in v) return (((v.arrayValue as Wire).values ?? []) as Wire[]).map(dec);
  return null;
};
export async function fetchBoards(): Promise<Record<string, Board> | null> {
  if (!PROJECT_ID) return null;
  try {
    const host = useEmulator() ? 'http://127.0.0.1:8080' : 'https://firestore.googleapis.com';
    const r = await fetch(`${host}/v1/projects/${PROJECT_ID}/databases/(default)/documents/boards?pageSize=20`, { cache: 'no-store' });
    if (!r.ok) return null;
    const out: Record<string, Board> = {};
    for (const d of ((await r.json()).documents ?? []) as { name: string; fields?: Wire }[]) {
      out[d.name.split('/').pop()!] = cleanBoard(dec({ mapValue: { fields: d.fields ?? {} } }));
    }
    return out;
  } catch {
    return null;
  }
}

// ---------- which copy a screen should show ----------
// A device is in demo mode for the day once the queue desk or a barber panel has been used on
// it without signing in. Every screen on that device then follows the demo queue kept on it.
export const demoDevice = (now = Date.now()) => read<string>(DEMO_KEY) === londonDay(now);
export function setDemoDevice(on: boolean) {
  if (on === demoDevice()) return;
  write(DEMO_KEY, on ? londonDay(Date.now()) : null);
  sameTab.forEach((cb) => cb());
}
// Today's published queue is what everyone sees, except on a device in demo mode. With no
// published queue, the demo site shows an example and the real site shows "closed".
export function pickBoard(shop: string, cloud: Board | null | undefined, now = Date.now()): { board: Board; source: Source } {
  const local = localBoard(shop, now);
  const live = cloud && cloud.day === londonDay(now) ? cloud : null;
  if (live && !demoDevice(now)) return { board: live, source: 'cloud' };
  if (local) return { board: local, source: 'local' };
  if (IS_DEMO || !CONNECTED) return { board: exampleBoard(shop, now), source: 'example' };
  return { board: { ...openToday(cloud ?? null, now), online: false, staff: {} }, source: 'closed' };
}

// Distance in metres between a phone's position and a shop.
export function metresBetween(a: { latitude: number; longitude: number }, b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a.latitude) * rad, dLng = (b[1] - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 6_371_000 * 2 * Math.asin(Math.sqrt(h));
}
