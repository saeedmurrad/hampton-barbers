// The step shown when a barber finishes a cut: what did the customer have, and did they pay
// in cash or online? It only writes the payment down. No money moves through this screen.
import { serving } from './board';
import { fetchLive } from './menu';
import { money, penceOf, type PayMethod, type Sale, type SaleInput } from './sales';
import { esc } from './store';
import type { Desk } from './desk';

export type Service = { name: string; price: number };
type Toast = (msg: string, action?: { label: string; run: () => void }) => void;

// The services a barber can tap: the published price list if there is one, else the built-in list.
export async function loadServices(builtIn: Service[]): Promise<Service[]> {
  const live = await fetchLive();
  const list = (live?.menu ?? []).flatMap((c) => (c.items ?? []).map((i) => ({ name: String(i.name ?? '').trim(), price: penceOf(i.price) }))).filter((s) => s.name);
  return list.length ? list : builtIn;
}

export function askPayment(opts: { title: string; services: Service[]; preset?: SaleInput }): Promise<SaleInput | null> {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'pay';
    dlg.setAttribute('aria-labelledby', 'pay-title');
    dlg.innerHTML = `<form class="pay__form" novalidate>
      <h2 id="pay-title">${esc(opts.title)}</h2>
      <fieldset class="pay__set"><legend>What did they have?</legend>
        <div class="pay__svcs">${opts.services.map((s, i) => `<button type="button" data-svc="${i}" aria-pressed="false"><b>${esc(s.name)}</b><small>${money(s.price)}</small></button>`).join('')}</div>
      </fieldset>
      <label class="pay__price">Price<span><i>£</i><input name="price" inputmode="decimal" autocomplete="off" placeholder="0" /></span></label>
      <fieldset class="pay__set"><legend>How did they pay?</legend>
        <div class="pay__how">
          <button type="button" data-pay="cash" aria-pressed="false"><b>Cash</b></button>
          <button type="button" data-pay="online" aria-pressed="false"><b>Online</b><small>card or transfer</small></button>
        </div>
      </fieldset>
      <p class="pay__err" role="alert" hidden></p>
      <div class="pay__btns">
        <button type="button" data-cancel>Cancel</button>
        <button type="button" data-free>No charge</button>
        <button type="submit" class="primary" data-save>${opts.preset ? 'Save the correction' : 'Save and finish'}</button>
      </div>
      <p class="pay__note">This only records how the customer paid. No money is taken through this screen.</p>
    </form>`;
    document.body.append(dlg);
    const priceEl = dlg.querySelector<HTMLInputElement>('input[name="price"]')!;
    const errEl = dlg.querySelector<HTMLElement>('.pay__err')!;
    const chosen = new Set<number>();
    let pay: PayMethod | '' = '';
    let typed = false; // once a price is typed by hand, tapping services no longer changes it
    let done = false;
    const end = (value: SaleInput | null) => { if (done) return; done = true; resolve(value); dlg.close(); dlg.remove(); };
    const names = () => [...chosen].sort((a, b) => a - b).map((i) => opts.services[i].name).join(' + ').slice(0, 80) || 'Haircut';
    const paint = () => {
      dlg.querySelectorAll<HTMLElement>('[data-svc]').forEach((b) => b.setAttribute('aria-pressed', String(chosen.has(Number(b.dataset.svc)))));
      dlg.querySelectorAll<HTMLElement>('[data-pay]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.pay === pay)));
      if (!typed) { const sum = [...chosen].reduce((a, i) => a + opts.services[i].price, 0); priceEl.value = sum ? money(sum).slice(1).replace(/,/g, '') : ''; }
    };
    if (opts.preset) {
      const had = opts.preset.svc.split(' + ');
      opts.services.forEach((s, i) => { if (had.includes(s.name)) chosen.add(i); });
      pay = opts.preset.pay === 'none' ? '' : opts.preset.pay;
      if (opts.preset.price) { typed = true; priceEl.value = money(opts.preset.price).slice(1).replace(/,/g, ''); }
    }
    paint();
    dlg.addEventListener('click', (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('button');
      if (e.target === dlg || t?.dataset.cancel !== undefined) return end(null);
      if (!t) return;
      errEl.hidden = true;
      if (t.dataset.svc) { const i = Number(t.dataset.svc); if (chosen.has(i)) chosen.delete(i); else chosen.add(i); paint(); }
      else if (t.dataset.pay) { pay = t.dataset.pay as PayMethod; paint(); }
      else if (t.dataset.free !== undefined) end({ svc: names(), price: 0, pay: 'none' });
    });
    priceEl.addEventListener('input', () => { typed = priceEl.value.trim() !== ''; errEl.hidden = true; });
    dlg.querySelector('form')!.addEventListener('submit', (e) => {
      e.preventDefault();
      // A plain amount only: up to £999.99, with a dot or a comma before the pence.
      const typedText = priceEl.value.trim();
      const plain = /^£?\s*\d{1,3}([.,]\d{1,2})?$/.test(typedText);
      const price = plain ? penceOf(typedText.replace(',', '.')) : 0;
      const problem = typedText && !plain ? 'Type the price as a number, like 17 or 17.50.'
        : !price ? 'Tap what they had or type the price. For a free cut, tap “No charge”.' : !pay ? 'Tap Cash or Online.' : '';
      if (problem) { errEl.textContent = problem; errEl.hidden = false; return; }
      end({ svc: names(), price, pay: pay as PayMethod });
    });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); end(null); });
    dlg.showModal();
  });
}

const paid = (x: Sale) => (x.pay === 'none' ? 'no charge' : `${money(x.price)} ${x.pay}`);

// Used by the queue desk and the barber panel: ask what was sold and how it was paid, finish
// the cut, then offer a "Change" button for a few seconds in case of a wrong tap.
export async function finishAndPay(desk: Desk, shop: string, barberId: string, services: Service[], toast: Toast): Promise<void> {
  const b = desk.board(shop);
  const cur = serving(b, barberId);
  const s = b.staff[barberId];
  if (!cur || !s) return;
  const input = await askPayment({ title: `Number ${cur[1].n} · Chair ${s.chair}${s.name ? ` · ${s.name}` : ''}`, services });
  if (!input) return;
  const sale = await desk.finishSale(shop, barberId, input);
  if (!sale) return;
  const tell = (x: Sale) => toast(`Number ${x.n} finished: ${paid(x)}`, {
    label: 'Change',
    run: async () => {
      const again = await askPayment({ title: `Correct number ${x.n}`, services, preset: { svc: x.svc, price: x.price, pay: x.pay } });
      const fixed = again && await desk.fixSale(x, again);
      if (fixed) tell(fixed);
    },
  });
  tell(sale);
}
