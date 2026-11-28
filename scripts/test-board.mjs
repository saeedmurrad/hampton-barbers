// Checks the queue logic on its own (no browser, no Firebase). Run: node scripts/test-board.mjs
import * as Q from '../src/lib/board.ts';

const res = [];
const ok = (c, label, detail = '') => res.push(`${c ? 'PASS' : 'FAIL'}  ${label}${!c && detail ? ': ' + detail : ''}`);
const throws = (fn, code, label) => { try { fn(); ok(false, label, 'no error'); } catch (e) { ok(e.code === code, label, String(e.code ?? e.message)); } };
const M = 60_000;
const now = Date.UTC(2026, 10, 28, 14, 0); // 28 Nov 2026, 2pm in London

let b = Q.openToday(null, now);
ok(b.day === '2026-11-28' && Object.keys(b.staff).length === 3 && b.seq === 0, 'a new day starts with three barbers and no tickets', b.day);
b = Q.addWalkIn(b, 'w1', now);
b = Q.addWalkIn(b, 'w2', now);
ok(b.t.w1.n === 1 && b.t.w2.n === 2 && b.t.w1.s === 'here', 'walk-ins get numbers 1 and 2 and count as in the shop');
b = Q.join(b, 'c1', now, 10, 'web');
ok(b.t.c1.n === 3 && b.t.c1.s === 'way', 'an online joiner gets number 3 and shows as on the way');
ok(Object.keys(b.t.c1).sort().join() === 'at,eta,n,s,src', 'a new online ticket holds only the five allowed fields', Object.keys(b.t.c1).join());
b = Q.addWalkIn(b, 'w4', now);
b = Q.callNext(b, 'b1', now);
b = Q.callNext(b, 'b2', now);
ok(b.t.w1.s === 'chair' && b.t.w1.b === 'b1' && b.t.w2.b === 'b2', 'barbers 1 and 2 call numbers 1 and 2');
b = Q.callNext(b, 'b3', now);
ok(b.t.w4.s === 'chair' && b.t.c1.s === 'way', 'the third barber skips number 3 (not here yet) and calls number 4');
ok(b.call?.n === 4 && b.call?.chair === 3, 'the shop TV is told: number 4, chair 3');
let p = Q.placeOf(b, 'c1', now);
ok(p?.ahead === 0 && p?.mins === 20, 'number 3 is first in line, about 20 minutes away', JSON.stringify(p));
let v = Q.boardView(b, now);
ok(v.minutes === 20 && v.level === 3 && v.headline === '~20', 'someone walking in now is told about 20 minutes: Busy', `${v.minutes} level ${v.level}`);
ok(v.chairs.length === 3 && v.chairs.every((c) => c.state === 'busy') && v.chairs[2].n === 4 && v.chairs[2].calling, 'the view lists three busy chairs, chair 3 calling number 4');
ok(v.line.length === 1 && v.line[0].n === 3 && v.line[0].s === 'way' && v.onWay === 1 && v.inShop === 0, 'the waiting line shows number 3 as on the way');
v = Q.boardView(b, now + 12 * M);
ok(v.chairs[0].mins === 12 && v.chairs[0].left === 8 && !v.chairs[0].calling, 'twelve minutes later the chair shows 12 minutes done, about 8 left');
ok(Q.placeOf(b, 'c1', now + 12 * M)?.mins === 8, 'and number 3 is about 8 minutes away without anyone tapping');

b = Q.arrive(b, 'c1', now + 8 * M);
ok(b.t.c1.s === 'here' && b.t.c1.arr === now + 8 * M, 'number 3 checks in at the shop');
b = Q.finish(b, 'b1', now + 18 * M);
ok(!b.t.w1 && b.done === 1 && b.staff.b1.done === 1 && b.obs.k === 1 && b.obs.m === 18, 'finishing records the cut and its 18 minutes');
ok(Q.cutMinutes(b) === 20, 'one timed cut barely moves the usual cut time', String(Q.cutMinutes(b)));
b = Q.callNext(b, 'b1', now + 18 * M);
ok(b.t.c1.s === 'chair' && b.t.c1.b === 'b1', 'number 3 is called to chair 1');
throws(() => Q.callNext(b, 'b1', now + 19 * M), 'busy', 'a barber with a customer cannot call another');
throws(() => Q.leave(b, 'c1', now + 19 * M), 'no', 'a customer in the chair cannot remove themselves');
throws(() => Q.setBarber(b, 'b3', { brk: true }, now + 19 * M), 'busy', 'a barber cannot go on a break mid-cut');
const u = Q.uncall(b, 'c1', now + 19 * M);
ok(u.t.c1.s === 'here' && !u.t.c1.b && u.call === null, 'a wrong call can be undone');

b = Q.join(b, 'c2', now + 20 * M, 10, 'web');
ok(Q.waiting(b, now + 39 * M).length === 1 && Q.waiting(b, now + 41 * M).length === 0, 'an online place lapses 10 minutes after the stated arrival time');
const late = Q.runLate(b, 'c2', now + 28 * M);
ok(late.t.c2.eta === 20 && Q.waiting(late, now + 49 * M).length === 1, '"running late" holds the place 10 minutes longer', String(late.t.c2.eta));
throws(() => Q.runLate(late, 'c2', now + 29 * M), 'no', '"running late" can be used once');
ok(!Q.expire(b, now + 41 * M).t.c2, 'the shop drops a lapsed place');
ok(!Q.leave(b, 'c2', now + 21 * M).t.c2, 'a waiting customer can leave');
throws(() => Q.callNext(Q.finish(b, 'b2', now + 22 * M), 'b2', now + 22 * M), 'none', 'nobody is called when the only person waiting is still on the way');
ok(Q.callNext(Q.finish(b, 'b2', now + 22 * M), 'b2', now + 22 * M, 'c2').t.c2.s === 'chair', 'but the barber can pick that person by hand if they are standing there');
throws(() => Q.join(Q.setOptions(b, { online: false }, now), 'c9', now, 10, 'web'), 'closed', 'no online joining while the shop has paused it');
throws(() => Q.join(b, 'c2', now + 21 * M, 10, 'web'), 'already', 'one phone cannot hold two places');
const door = Q.join(Q.openToday(null, now), 'q1', now, 30, 'qr');
ok(door.t.q1.s === 'here' && door.t.q1.eta === 0, 'joining from the door code counts as in the shop');
let full = Q.openToday(null, now);
for (let i = 0; i < Q.MAX_LINE; i++) full = Q.join(full, `f${i}`, now, 10, 'web');
throws(() => Q.join(full, 'one-more', now, 10, 'web'), 'full', `the online queue stops at ${Q.MAX_LINE} places`);

const next = Q.openToday(b, now + 24 * 60 * M);
ok(next.seq === 0 && !Object.keys(next.t).length && Object.keys(next.staff).length === 3 && next.staff.b1.done === 0, 'the next day starts at number 1 with the same barbers');
const stopped = Q.boardView(Q.setBarber(Q.setBarber(Q.setBarber(Q.openToday(null, now), 'b1', { on: false }, now), 'b2', { on: false }, now), 'b3', { brk: true }, now), now);
ok(stopped.level === 0 && stopped.headline === '—' && stopped.chairs.length === 1 && stopped.chairs[0].state === 'break', 'with nobody cutting the shop shows as not cutting');
const added = Q.setBarber(Q.openToday(null, now), 'b9', { name: '  Zed  ' }, now);
ok(added.staff.b9.chair === 4 && added.staff.b9.name === 'Zed', 'a new barber takes the next chair number');
ok(!Q.dropBarber(added, 'b9', now).staff.b9, 'a barber can be removed');

const junk = Q.cleanBoard({ seq: 'x', staff: { b1: { name: 'A very long barber name indeed', chair: 99, on: 1 } }, t: { ok1: { n: 5, s: 'chair', b: 'nobody' }, 'bad id!': { n: 1 } }, mode: 'nope', call: 7 });
ok(junk.seq === 0 && junk.staff.b1.chair === 30 && junk.staff.b1.name.length === 20 && junk.t.ok1.s === 'here' && !junk.t['bad id!'] && junk.mode === 'auto' && junk.call === null, 'bad saved data is cleaned before use');
ok(JSON.stringify(Q.cleanBoard(JSON.parse(JSON.stringify(b)))) === JSON.stringify(b), 'a saved board reads back exactly as it was');

const levels = ['hampton-vale', 'shop-2', 'shop-3'].map((k) => Q.boardView(Q.exampleBoard(k, now), now));
ok(levels.map((x) => x.level).join() === '3,4,1', 'the three example shops look busy, very busy and quiet', levels.map((x) => `${x.level}:${x.headline}`).join(' '));
ok(levels[0].line.map((x) => `${x.n}${x.s[0]}`).join() === '26h,27w,28h', 'the Hampton Vale example has numbers 26 to 28 waiting, 27 on the way', levels[0].line.map((x) => `${x.n}${x.s[0]}`).join());
ok(levels[0].line.map((x) => x.mins).join() === '0,14,6', 'in that example 26 goes now, 28 after 6 minutes and 27 after 14', levels[0].line.map((x) => x.mins).join());
ok(levels[0].turns.map((x) => x.n).join() === '26,28,27', 'so the shop TV lists them in calling order: 26, 28, then 27', levels[0].turns.map((x) => x.n).join());
const hv = Q.exampleBoard('hampton-vale', now);
ok(Q.placeOf(hv, 'ex28', now)?.ahead === 1 && Q.placeOf(hv, 'ex27', now)?.ahead === 2, 'and number 28 is told one person is ahead, number 27 two', `${Q.placeOf(hv, 'ex28', now)?.ahead} ${Q.placeOf(hv, 'ex27', now)?.ahead}`);
ok(Q.placeOf(Q.arrive(hv, 'ex27', now), 'ex27', now)?.ahead === 1, 'once number 27 arrives they move back ahead of number 28');
ok(Q.EXAMPLES.map((k) => Q.boardView(Q.exampleBoard(k, now), now).level).join() === '1,2,4', 'the quiet, steady and busy examples give three different looks', Q.EXAMPLES.map((k) => Q.boardView(Q.exampleBoard(k, now), now).level).join());
ok(Q.clockText(now + 45 * M) === '2:45 pm' && Q.minsText(0) === 'Next' && Q.minsText(13) === '15 min' && Q.ord(22) === '22nd', 'times and places read naturally', Q.clockText(now + 45 * M));

console.log(res.join('\n'));
console.log(`\n${res.filter((r) => r.startsWith('PASS')).length} of ${res.length} passed`);
process.exit(res.some((r) => !r.startsWith('PASS')) ? 1 : 0);
