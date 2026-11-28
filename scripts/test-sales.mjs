// Checks the money logic on its own (no browser, no Firebase). Run: node scripts/test-sales.mjs
import * as Q from '../src/lib/board.ts';
import * as S from '../src/lib/sales.ts';

const res = [];
const ok = (c, label, detail = '') => res.push(`${c ? 'PASS' : 'FAIL'}  ${label}${!c && detail ? ': ' + detail : ''}`);
const M = 60_000;
const now = Date.UTC(2026, 10, 28, 14, 0); // Saturday 28 Nov 2026, 2pm in London

ok(S.penceOf('£17') === 1700 && S.penceOf('17.50') === 1750 && S.penceOf('£1,234.5') === 123450 && S.penceOf('') === 0 && S.penceOf('free') === 0, 'prices are read as pence', `${S.penceOf('£17')} ${S.penceOf('17.50')} ${S.penceOf('£1,234.5')}`);
ok(S.money(1700) === '£17' && S.money(1750) === '£17.50' && S.money(123450) === '£1,234.50' && S.money(0) === '£0', 'money is written the way people read it', `${S.money(1700)} ${S.money(1750)} ${S.money(123450)}`);

const wk = S.period('week', '2026-11-28'), mo = S.period('month', '2026-11-28'), dy = S.period('day', '2026-11-28');
ok(wk.from === '2026-11-23' && wk.to === '2026-11-29', 'a week runs Monday to Sunday', `${wk.from} ${wk.to}`);
ok(mo.from === '2026-11-01' && mo.to === '2026-11-30' && mo.label === 'November 2026', 'a month is the calendar month', `${mo.from} ${mo.to} ${mo.label}`);
ok(dy.from === dy.to && dy.label === 'Saturday 28 November 2026', 'a day is named in full', dy.label);
ok(S.period('month', '2028-02-10').to === '2028-02-29', 'February in a leap year ends on the 29th');
ok(S.shiftPeriod('month', '2026-01-31', -1) === '2025-12-01' && S.shiftPeriod('month', '2026-01-31', 1) === '2026-02-01' && S.shiftPeriod('week', '2026-11-28', -1) === '2026-11-21' && S.shiftPeriod('day', '2026-11-30', 1) === '2026-12-01', 'stepping back and forward lands on the right dates');

let rules = S.setPct({}, 'b1', '2026-11-01', 40);
rules = S.setPct(rules, 'b1', '2026-11-20', 50);
ok(S.pctFor(rules, 'b1', '2026-10-31') === null && S.pctFor(rules, 'b1', '2026-11-10') === 40 && S.pctFor(rules, 'b1', '2026-11-20') === 50 && S.pctFor(rules, 'b1', '2026-11-28') === 50, 'a percentage applies from its date, and earlier days keep the old one');
ok(S.pctFor(rules, 'b2', '2026-11-28') === null, 'a barber with no percentage set has none');
ok(S.setPct(rules, 'b1', '2026-11-20', 55).b1.length === 2 && S.pctFor(S.setPct(rules, 'b1', '2026-11-20', 55), 'b1', '2026-11-28') === 55, 'setting a percentage twice on one day keeps the last one');
ok(S.shareOf(2000, 20) === 400 && S.shareOf(1999, 33) === 660 && 1999 - S.shareOf(1999, 33) === 1339 && S.shareOf(2000, null) === 0, 'on 20%, a £20 cut gives the barber £4; shares always add up to the price');

// A real finish: number 1 waits 6 minutes in the shop, then 18 minutes in chair 2.
let b = Q.openToday(null, now);
b = Q.setBarber(b, 'b2', { name: 'Ali' }, now);
b = Q.addWalkIn(b, 'w1', now);
b = Q.callNext(b, 'b2', now + 6 * M);
const sale = S.saleFor(b, 'hampton-vale', 'b2', now + 24 * M, { svc: 'Skin Fade', price: 2000, pay: 'online' });
ok(sale.n === 1 && sale.b === 'b2' && sale.bn === 'Ali' && sale.chair === 2 && sale.day === '2026-11-28' && sale.wait === 6 && sale.mins === 18 && sale.price === 2000 && sale.pay === 'online' && sale.src === 'desk', 'finishing a cut records who, what, how paid, the wait and the time in the chair', JSON.stringify(sale));
let threw = false;
try { S.saleFor(b, 'hampton-vale', 'b1', now, { svc: 'x', price: 1, pay: 'cash' }); } catch (e) { threw = e.code === 'none'; }
ok(threw, 'a barber with an empty chair has nothing to record');
ok(S.cleanInput({ svc: '', price: 1700.4, pay: 'cash' }).svc === 'Haircut' && S.cleanInput({ svc: 'x', price: 1700.4, pay: 'cash' }).price === 1700 && S.cleanInput({ svc: 'x', price: 900, pay: 'gift' }).price === 0 && S.cleanInput({ svc: 'x', price: 900, pay: 'gift' }).pay === 'none', 'odd input is tidied: no blank service, whole pence, and no-charge means £0');
ok(S.cleanSale({ nonsense: true }, 'x') === null && S.cleanSale({ ...sale, void: { at: 5, why: 'test' } }, 'abc')?.void?.why === 'test', 'bad stored records are dropped, good ones read back');

const mk = (id, day, bId, bn, price, pay, extra = {}) => ({ id, shop: 'hampton-vale', day, at: Date.parse(`${day}T12:00:00Z`) + Number(id.slice(1)) * M, b: bId, bn, chair: 1, n: 1, src: 'desk', svc: 'Gents Cut', price, pay, wait: 10, mins: 20, ...extra });
const sales = [
  mk('s1', '2026-11-10', 'b1', 'Sam', 1700, 'cash'),                     // 40% -> 680
  mk('s2', '2026-11-25', 'b1', 'Sam', 2000, 'online'),                   // 50% -> 1000
  mk('s3', '2026-11-25', 'b2', 'Ali', 2600, 'online', { svc: 'Gents Cut + Beard Trim' }), // no percentage set
  mk('s4', '2026-11-25', 'b2', 'Ali', 1700, 'cash', { void: { at: 1, why: 'entered twice' } }),
  mk('s5', '2026-11-28', 'b1', 'Sam', 0, 'none'),
];
const rep = S.summarize(sales, { 'hampton-vale': rules });
ok(rep.all.count === 4 && rep.all.total === 6300 && rep.all.cash === 1700 && rep.all.online === 4600, 'totals: 4 customers, £63, of which £17 cash and £46 online', JSON.stringify(rep.all));
ok(rep.voided === 1 && rep.free === 1, 'a cancelled sale is left out and counted, a no-charge cut is counted');
ok(rep.all.barber === 1680 && rep.all.shop === 4620 && rep.all.barber + rep.all.shop === rep.all.total, 'the barbers get £16.80 and the shop £46.20, which add up to the takings', `${rep.all.barber} ${rep.all.shop}`);
const sam = rep.byBarber.find((r) => r.label === 'Sam'), ali = rep.byBarber.find((r) => r.label === 'Ali');
ok(sam?.count === 3 && sam.total === 3700 && sam.barber === 1680 && sam.pct === 'mixed', 'Sam: 3 customers, £37, share £16.80 at a percentage that changed mid-month', JSON.stringify(sam));
ok(ali?.count === 1 && ali.total === 2600 && ali.barber === 0 && ali.pct === null, 'Ali: 1 customer, £26, no percentage set so no share yet', JSON.stringify(ali));
ok(rep.byDay.map((d) => `${d.key}:${d.total}`).join() === '2026-11-10:1700,2026-11-25:4600,2026-11-28:0', 'days are listed in order with their takings', rep.byDay.map((d) => `${d.key}:${d.total}`).join());
ok(rep.byService[0].name === 'Gents Cut' && rep.byService[0].count === 4 && rep.byService.find((x) => x.name === 'Beard Trim')?.count === 1, 'services are counted, including both halves of a combined one', JSON.stringify(rep.byService));
ok(rep.all.wait / rep.all.count === 10 && rep.all.mins / rep.all.count === 20, 'average wait and cut time can be worked out');

const csv = S.toCsv(sales, { 'hampton-vale': rules }, () => 'Hampton Vale').split('\r\n');
ok(csv.length === 6 && csv[0].startsWith('Date,Time,Shop,Ticket,Barber') && csv[1].includes('2026-11-10') && csv[1].includes('17.00,cash,40,6.80,10.20') && csv[4].includes('yes,entered twice'), 'the spreadsheet has a heading and one row per sale', csv[1]);
ok(S.toCsv([mk('s9', '2026-11-28', 'b1', 'O"Neil, J', 100, 'cash')], {}, () => 'x').includes('"O""Neil, J"'), 'names with commas or quotes are written safely');

const staff = [{ id: 'b1', label: 'Barber 1', chair: 1 }, { id: 'b2', label: 'Barber 2', chair: 2 }, { id: 'b3', label: 'Barber 3', chair: 3 }];
const services = [{ name: 'Gents Cut', price: 1700 }, { name: 'Skin Fade', price: 2000 }, { name: 'Beard Trim', price: 1000 }];
const ex = S.exampleSales('hampton-vale', staff, services, now, '2026-11-28');
const ex2 = S.exampleSales('hampton-vale', staff, services, now, '2026-11-28');
ok(JSON.stringify(ex) === JSON.stringify(ex2) && ex.length > 700 && ex.length < 1600, 'the demo figures are the same every time and look like five weeks of trade', String(ex.length));
ok(ex.every((s) => s.at <= now && s.price > 0) && new Set(ex.map((s) => s.day)).size === 35 && ex.some((s) => s.day === '2026-11-28'), 'they stop at the present moment and cover every day');
ok(new Set(ex.map((s) => s.id)).size === ex.length, 'every demo sale has its own id');

// ---------- awkward inputs and edge cases ----------
const empty = S.summarize([], {});
ok(empty.all.count === 0 && empty.all.total === 0 && empty.byBarber.length === 0 && empty.byDay.length === 0 && empty.voided === 0, 'an empty period adds up to nothing, without errors');
ok(S.summarize(sales, {}).all.barber === 0 && S.summarize(sales, {}).all.shop === 6300, 'with no percentages set, everything is the shop’s');
const junkRules = S.cleanRules({ b1: 'oops', b2: [{ from: '2026-11-05', pct: 250 }, { pct: 10 }, null, { from: '2026-11-01', pct: -5 }], b3: [] });
ok(!junkRules.b1 && junkRules.b2.length === 2 && junkRules.b2[0].from === '2026-11-01' && junkRules.b2[0].pct === 0 && junkRules.b2[1].pct === 100 && S.cleanRules(null).b1 === undefined && S.cleanRules('x').b1 === undefined, 'damaged percentage settings are repaired and put in date order');
ok(S.pctFor({ b1: [{ from: '2026-11-20', pct: 50 }, { from: '2026-11-01', pct: 40 }] }, 'b1', '2026-11-10') === 40 || S.pctFor(S.cleanRules({ b1: [{ from: '2026-11-20', pct: 50 }, { from: '2026-11-01', pct: 40 }] }), 'b1', '2026-11-10') === 40, 'percentages saved out of order still apply by date');
ok(S.shareOf(1, 50) === 1 && S.shareOf(0, 50) === 0 && S.shareOf(100000, 100) === 100000 && S.shareOf(333, 33) + (333 - S.shareOf(333, 33)) === 333, 'odd pennies never go missing in the split');
ok(S.cleanInput({ svc: 'x'.repeat(200), price: 99999999, pay: 'online' }).svc.length === 80 && S.cleanInput({ svc: 'x', price: 99999999, pay: 'online' }).price === 100000 && S.cleanInput({ svc: 'x', price: -50, pay: 'cash' }).price === 0 && S.cleanInput({ svc: 'x', price: NaN, pay: 'cash' }).price === 0, 'a price is kept between £0 and £1,000 and a service name to 80 letters');
ok(S.penceOf('-5') === 500 && S.penceOf('12.999') === 1300 && S.penceOf('£ 1 7') === 1700 && S.penceOf(null) === 0 && S.penceOf(undefined) === 0 && S.penceOf('12.3.4') === 1230, 'whatever is typed in the price box becomes a sensible amount', `${S.penceOf('-5')} ${S.penceOf('12.999')} ${S.penceOf('12.3.4')}`);
const voidOnly = S.summarize([mk('s1', '2026-11-25', 'b1', 'Sam', 1700, 'cash', { void: { at: 1, why: 'x' } })], { 'hampton-vale': rules });
ok(voidOnly.all.count === 0 && voidOnly.voided === 1 && voidOnly.byBarber.length === 0, 'a period with only cancelled sales shows no takings');
ok(S.exampleSales('x', [], services, now, '2026-11-28').length === 0 && S.exampleSales('x', staff, [], now, '2026-11-28').length === 0, 'no barbers or no price list means no demo figures');
ok(S.cleanSale({ day: '2026-11-28', b: 'b1', price: '2000', pay: 'weird', svc: '', was: { svc: 'A', price: 5, pay: 'cash' } }, 'z')?.pay === 'none' && S.cleanSale({ day: '2026-11-28', b: 'b1', price: 2000, pay: 'cash', was: { svc: 'A', price: 500, pay: 'online' } }, 'z')?.was?.price === 500 && S.cleanSale(null, 'z') === null && S.cleanSale({ day: 5, b: 'b1' }, 'z') === null, 'stored sales with odd values are tidied or dropped');
ok(S.period('week', '2026-11-23').from === '2026-11-23' && S.period('week', '2026-11-29').from === '2026-11-23' && S.period('week', '2026-12-31').to === '2027-01-03' && S.period('month', '2026-12-31').to === '2026-12-31' && S.period('month', '2027-02-10').to === '2027-02-28', 'weeks and months are right at the edges of the year');
const online0 = S.saleFor(Q.callNext(Q.arrive(Q.join(Q.openToday(null, now), 'web1', now, 10, 'web'), 'web1', now + 9 * M), 'b1', now + 15 * M), 'hampton-vale', 'b1', now + 30 * M, { svc: 'Gents Cut', price: 1700, pay: 'cash' });
ok(online0.src === 'web' && online0.wait === 6 && online0.mins === 15, 'an online customer’s wait counts from when they arrived, not from when they joined', JSON.stringify(online0));

console.log(res.join('\n'));
console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} of ${res.length} passed`);
process.exit(res.some((r) => !r.startsWith('PASS')) ? 1 : 0);
