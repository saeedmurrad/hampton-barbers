// Shared by the queue desk and the barber panel: who is signed in, which copy of each shop's
// queue to use (Firebase when signed in, this device otherwise), and saving changes.
import { expire, finish, londonDay, openToday, QueueError, type Board } from './board';
import { cleanInput, saleFor, type Sale, type SaleInput } from './sales';
import { read, write, CONNECTED, actLocal, localNames, localSales, newId, onDeviceChange, pickBoard, saveLocalSale, setDemoDevice, setLocalName } from './store';
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
  let role: cloud.Role | null = null;      // null when signed out, or while it is being checked
  let mine: cloud.StaffInfo | null = null; // this login's staff record, if it is a staff login
  let status = CONNECTED ? 'Loading…' : 'Not connected. Changes show on this device only.';
  let stops: (() => void)[] = [];
  const boards: Record<string, Board | null> = {};
  const online: Record<string, boolean> = {};
  const names: Record<string, cloud.Names> = {};
  const noNames = new Set<string>(); // shops whose names could not be read yet
  const ready = new Set<string>();   // shops whose real queue has arrived since signing in
  const stamp = () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  const say = (s: string) => { status = s; onChange(); };
  const explain = (e: unknown) => e instanceof QueueError ? SAY[e.code] ?? 'That could not be done.'
    : cloud.denied(e) ? 'This account is not allowed to do that. Sign in with the account that set the site up.'
    : 'Could not save. Check the internet connection and try again.';

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
    ready.clear();
    if (!email) return;
    for (const shop of shops) {
      stops.push(cloud.watchBoard(shop, (b, live) => { boards[shop] = b; online[shop] = live; ready.add(shop); tidy(shop); onChange(); }));
      watchNames(shop);
    }
  };
  // Names can only be read by the shop's own account. On a brand-new site that account is
  // not recorded until its first save, so a refused read is tried again after the next save.
  const watchNames = (shop: string) => {
    noNames.delete(shop);
    stops.push(cloud.watchNames(shop, (m) => { names[shop] = m; tidy(shop); onChange(); }, () => noNames.add(shop)));
  };
  // Works out what this login is to the shop. It runs at sign-in, and again after the first
  // save on a brand-new site, because that save is what makes the login the owner.
  const checkRole = (announce: boolean) => {
    const e = email;
    cloud.whoAmI().then((who) => {
      if (email !== e) return;
      role = who.role;
      mine = who.staff;
      // Once a day, the owner's desk clears out customer details that are past the 24-month limit.
      if (role === 'owner' && read<string>('hb-retention-day') !== londonDay(Date.now())) {
        cloud.removeExpiredCustomers().then(() => write('hb-retention-day', londonDay(Date.now())), () => { /* tried again next time */ });
      }
      if (announce && role === 'new') status = 'Signed in. The first change you save makes this login the owner.';
      if (announce && role === 'none') status = 'This login has not been added to the shop yet. Ask the owner to add it on the queue desk.';
      onChange();
    });
  };
  if (CONNECTED) cloud.onStaff((e) => {
    email = e;
    role = null;
    mine = null;
    setDemoDevice(!e); // used without signing in, this device runs the demo queue
    status = e ? 'Signed in. Every change goes live straight away.' : 'Demo on this device only. Sign in to run the real queue.';
    listen();
    onChange();
    if (e) checkRole(true);
  });
  else setDemoDevice(true);
  onDeviceChange(onChange);

  return {
    connected: CONNECTED,
    email: () => email,
    // 'owner', 'staff' (a login the owner added), 'new' (a site nobody owns yet) or 'none'.
    role: () => role,
    me: () => mine,
    status: () => status,
    signIn: (e: string, p: string) => cloud.staffSignIn(e, p),
    signOut: () => cloud.staffSignOut(),
    // Today's queue for a shop. Signed in with nothing saved yet today, this is a fresh queue
    // that gets saved (and becomes visible to customers) on the first change.
    board: (shop: string, now = Date.now()): Board => email ? openToday(boards[shop] ?? null, now) : pickBoard(shop, null, now).board,
    // True for the moment between signing in and the real queue arriving. Screens show
    // "Loading" then, never an empty queue that could be mistaken for the real one.
    loading: (shop: string) => Boolean(email) && !ready.has(shop),
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
          if (role === 'new') checkRole(false);
          say(`Live for everyone ✓ ${stamp()}`);
        }
        else { actLocal(shop, run); say(`Saved on this device only ✓ ${stamp()}`); }
        tidy(shop);
        return true;
      } catch (e) {
        say(explain(e));
        return false;
      }
    },
    // Finishes the cut in a barber's chair and writes down what was sold and how it was paid.
    async finishSale(shop: string, barberId: string, input: SaleInput): Promise<Sale | null> {
      try {
        let sale: Sale;
        if (email) {
          say('Saving…');
          const r = await cloud.finishSale(shop, (b, now) => { const cur = expire(b, now); return { board: finish(cur, barberId, now), sale: saleFor(cur, shop, barberId, now, input) }; });
          boards[shop] = r.board;
          sale = r.sale;
          say(`Live for everyone ✓ ${stamp()}`);
        } else {
          let made: Omit<Sale, 'id'> | undefined;
          actLocal(shop, (b, now) => { const cur = expire(b, now); made = saleFor(cur, shop, barberId, now, input); return finish(cur, barberId, now); });
          sale = { ...made!, id: newId('s') };
          saveLocalSale(sale);
          say(`Saved on this device only ✓ ${stamp()}`);
        }
        tidy(shop);
        return sale;
      } catch (e) {
        say(e instanceof QueueError && e.code === 'none' ? 'That cut was already finished on another screen.' : explain(e));
        return null;
      }
    },
    // Corrects a sale that was just recorded. The first version is kept on the record.
    async fixSale(sale: Sale, input: SaleInput): Promise<Sale | null> {
      const next: Sale = { ...sale, ...cleanInput(input), was: sale.was ?? { svc: sale.svc, price: sale.price, pay: sale.pay } };
      try {
        if (email) await cloud.changeSale(sale.shop, sale.id, { svc: next.svc, price: next.price, pay: next.pay, was: next.was });
        else saveLocalSale(next);
        say(`Corrected ✓ ${stamp()}`);
        return next;
      } catch (e) {
        say(cloud.denied(e) ? 'Too late to change this here. Ask the owner to correct it in the reports.' : explain(e));
        return null;
      }
    },
    // One barber's sales today: for "your takings today" on the barber panel.
    async takings(shop: string, barberId: string): Promise<Sale[] | null> {
      const day = londonDay(Date.now());
      if (!email) return localSales(shop).filter((s) => s.b === barberId && s.day === day);
      try { return await cloud.loadBarberDay(shop, barberId, day); } catch { return null; } // not this login's to see
    },
    setName(shop: string, id: string, name: string) {
      if (email) cloud.setName(shop, id, name).catch(() => { /* the number still works without a name */ });
      else setLocalName(shop, id, name);
    },
  };
}
