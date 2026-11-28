// Shared by the queue desk and the barber panel: who is signed in, which copy of each shop's
// queue to use (Firebase when signed in, this device otherwise), and saving changes.
import { expire, londonDay, openToday, QueueError, type Board } from './board';
import { CONNECTED, actLocal, localNames, onDeviceChange, pickBoard, setDemoDevice, setLocalName } from './store';
import * as cloud from './cloud';

const SAY: Record<string, string> = {
  busy: 'That barber has a customer in the chair.',
  none: 'Nobody is waiting in the shop yet.',
  off: 'That barber is not on shift.',
  full: 'That is the most the queue can hold.',
};

export type Desk = ReturnType<typeof createDesk>;
export function createDesk(shops: string[], onChange: () => void) {
  let email: string | null = null;
  let status = CONNECTED ? 'Loading…' : 'Not connected. Changes show on this device only.';
  let stops: (() => void)[] = [];
  const boards: Record<string, Board | null> = {};
  const online: Record<string, boolean> = {};
  const names: Record<string, cloud.Names> = {};
  const noNames = new Set<string>(); // shops whose names could not be read yet
  const stamp = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const say = (s: string) => { status = s; onChange(); };

  // The promise to customers: a first name is kept only until the cut is done.
  const tidy = (shop: string) => {
    const now = Date.now();
    if (email) {
      const b = boards[shop];
      for (const [id, x] of Object.entries(names[shop] ?? {})) if (b && !b.t[id] && now - x.at > 60_000) cloud.dropName(shop, id).catch(() => { /* next time */ });
    } else {
      const b = pickBoard(shop, null, now).board;
      for (const id of Object.keys(localNames(shop))) if (!b.t[id]) setLocalName(shop, id, null);
    }
  };
  const listen = () => {
    stops.forEach((stop) => stop());
    stops = [];
    if (!email) return;
    for (const shop of shops) {
      stops.push(cloud.watchBoard(shop, (b, live) => { boards[shop] = b; online[shop] = live; tidy(shop); onChange(); }));
      watchNames(shop);
    }
  };
  // Names can only be read by the shop's own account. On a brand-new site that account is
  // not recorded until its first save, so a refused read is tried again after the next save.
  const watchNames = (shop: string) => {
    noNames.delete(shop);
    stops.push(cloud.watchNames(shop, (m) => { names[shop] = m; tidy(shop); onChange(); }, () => noNames.add(shop)));
  };
  if (CONNECTED) cloud.onStaff((e) => {
    email = e;
    setDemoDevice(!e); // used without signing in, this device runs the demo queue
    status = e ? 'Signed in. Every change goes live straight away.' : 'Demo on this device only. Sign in to run the real queue.';
    listen();
    onChange();
  });
  else setDemoDevice(true);
  onDeviceChange(onChange);

  return {
    connected: CONNECTED,
    email: () => email,
    status: () => status,
    signIn: (e: string, p: string) => cloud.staffSignIn(e, p),
    signOut: () => cloud.staffSignOut(),
    // Today's queue for a shop. Signed in with nothing saved yet today, this is a fresh queue
    // that gets saved (and becomes visible to customers) on the first change.
    board: (shop: string, now = Date.now()): Board => email ? openToday(boards[shop] ?? null, now) : pickBoard(shop, null, now).board,
    // Whether customers can see this shop's queue yet today.
    opened: (shop: string) => !email || boards[shop]?.day === londonDay(Date.now()),
    offline: (shop: string) => Boolean(email) && online[shop] === false,
    name: (shop: string, id: string): string => email ? names[shop]?.[id]?.name ?? '' : localNames(shop)[id] ?? '',
    async act(shop: string, fn: (b: Board, now: number) => Board): Promise<boolean> {
      const run = (b: Board, now: number) => fn(expire(b, now), now);
      try {
        if (email) {
          say('Saving…');
          boards[shop] = await cloud.actStaff(shop, run);
          if (noNames.has(shop)) watchNames(shop);
          say(`Live for everyone ✓ ${stamp()}`);
        }
        else { actLocal(shop, run); say(`Saved on this device only ✓ ${stamp()}`); }
        tidy(shop);
        return true;
      } catch (e) {
        say(e instanceof QueueError ? SAY[e.code] ?? 'That could not be done.'
          : cloud.denied(e) ? 'This account is not allowed to run the queue. Sign in with the account that set the site up.'
          : 'Could not save. Check the internet connection and try again.');
        return false;
      }
    },
    setName(shop: string, id: string, name: string) {
      if (email) cloud.setName(shop, id, name).catch(() => { /* the number still works without a name */ });
      else setLocalName(shop, id, name);
    },
  };
}
