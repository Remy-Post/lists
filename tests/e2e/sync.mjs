// sync.mjs — two devices (two browser contexts = two profiles) against one local sync server.
// A turns on backup and shows its pairing code, B joins with it, both edit (real keyboard), both sync, and the
// replicas must converge. Then a concurrent-move cycle made offline must converge to the same acyclic tree.
// Usage: node tests/e2e/sync.mjs     env: NO_BUILD=1
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { build, startStatic, startSync, ready, app, sleep, killAll, checker, CHROME_ARGS } from './lib.mjs';

const C = checker('sync');
const MAC = { viewport: { width: 1728, height: 1000 }, serviceWorkers: 'block' };
build();
const sy = await startSync(8099);
const st = await startStatic(8089, 8099);
const browser = await chromium.launch({ args: CHROME_ARGS });

async function device(name) {
  const ctx = await browser.newContext(MAC);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto(st.url + '/#/inbox'); await ready(page);
  return { name, ctx, page, errs };
}
const q = (d, fn, arg) => app(d.page, fn, arg);
const syncNow = async (d) => { await q(d, async (S, O, A, DB, st, ui) => { await ui.syncNow(); }); await sleep(150); return q(d, (S, O, A, DB, st, ui) => ui.syncState()); };
/** Canonical snapshot: every live record (id → title/parent/done) and the rendered tree order from ROOT. */
const snapshot = (d) => q(d, (S) => {
  const recs = {};
  for (const [id] of S.recs) if (S.isLive(id)) recs[id] = [S.val(id, 'title'), S.parentOf(id), !!S.val(id, 'done'), S.val(id, 'when')];
  const tree = [];
  const walk = (p, dep) => { for (const c of S.children(p)) { tree.push('  '.repeat(dep) + S.val(c, 'title')); walk(c, dep + 1); } };
  walk(S.ROOT, 0);
  return { recs, tree };
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const focus = async (d, id) => { await d.page.keyboard.press('Escape'); await q(d, (S, O, A, DB, st, ui, x) => ui.focus(x), id); };

const A = await device('A');
const B = await device('B');

await C.step('pairing', async () => {
  const code = await q(A, (S, O, A, DB, st, ui) => ui.createVault());
  await sleep(500);
  const shown = await q(A, (S, O, A, DB, st, ui) => ui.pairingCode());
  C.ok(/^[0-9A-Z]{4}(-[0-9A-Z]{1,4}){12}$/.test(code) && shown === code, 'A: createVault() returns a 52-char pairing code, pairingCode() matches', code);
  const bBefore = await q(B, (S) => S.children(S.INBOX).length);
  await q(B, (S, O, A, DB, st, ui, c) => ui.join(c), code);
  const sB = await q(B, (S, O, A, DB, st, ui) => ui.syncState());
  C.ok(sB.state === 'idle', 'B: join(code) succeeds and B is backed up', sB);
  await syncNow(A);
  const inboxA = await q(A, (S) => S.children(S.INBOX).map((id) => S.val(id, 'title')));
  C.ok(inboxA.length === bBefore * 2 ? false : true, 'pairing a fresh device does not duplicate the first-run tour', { inboxOnA: inboxA.length, tourItemsPerDevice: bBefore });
  const wrong = await q(B, async (S, O, A, DB, st, ui) => { try { await ui.join('0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000-0000'); return 'joined?'; } catch (e) { return e.message; } });
  C.ok(/already|paired|Unknown|Invalid/i.test(wrong), 'joining with an unknown code is rejected', wrong);
  await sleep(200);
  C.ok((await q(B, (S, O, A, DB, st, ui) => ui.pairingCode())) === code, 'a rejected join leaves B paired to the original vault');
});

await C.step('edits on both devices converge', async () => {
  // A: new item via keyboard, and retitle the 2nd Inbox item.
  const [i0, i1, i2, i3] = await q(A, (S) => S.children(S.INBOX).slice(0, 4));
  await focus(A, i0); await A.page.keyboard.press('o'); await A.page.keyboard.type('from A', { delay: 5 }); await A.page.keyboard.press('Escape');
  await focus(A, i1); await A.page.keyboard.press('i'); await A.page.keyboard.type(' (A edit)', { delay: 5 }); await A.page.keyboard.press('Escape');
  // B: new item, complete i2, indent i3 under i2, and edit the same title as A (i1) — later write wins.
  await sleep(30);
  await focus(B, i0); await B.page.keyboard.press('o'); await B.page.keyboard.type('from B', { delay: 5 }); await B.page.keyboard.press('Escape');
  await focus(B, i2); await B.page.keyboard.press('x');
  await focus(B, i3); await B.page.keyboard.press('Tab');
  await focus(B, i1); await B.page.keyboard.press('i'); await B.page.keyboard.type(' (B edit)', { delay: 5 }); await B.page.keyboard.press('Escape');
  await sleep(400);
  const s1 = await syncNow(A), s2 = await syncNow(B), s3 = await syncNow(A);
  const a = await snapshot(A), b = await snapshot(B);
  C.ok([s1, s2, s3].every((s) => s.state === 'idle'), 'syncNow A, B, A all succeed', [s1.state, s2.state, s3.state]);
  C.ok(same(a.recs, b.recs) && same(a.tree, b.tree), 'A and B hold identical records and the same rendered tree', { a: a.tree.length, b: b.tree.length, diff: Object.keys(a.recs).filter((k) => !same(a.recs[k], b.recs[k])).slice(0, 5) });
  const t1 = a.recs[i1] && a.recs[i1][0];
  C.ok(a.tree.some((t) => t.trim() === 'from A') && a.tree.some((t) => t.trim() === 'from B'), 'both new items are on both devices');
  C.ok(/\(B edit\)$/.test(t1) && !/\(A edit\)/.test(t1), 'concurrent title edits: the later write (B) wins on both devices', t1);
  C.ok(a.recs[i2][2] === true && a.recs[i3][1] === i2, 'B’s completion and indent reached A', { done: a.recs[i2][2], parentOfI3: a.recs[i3][1] === i2 });
  // The server only ever sees ciphertext.
  const dump = execFileSync('python3', ['-c', `import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print('\\n'.join(str(r) for r in c.execute('select rid, blob from changes')))`, join(sy.dir, 'lists.db')]).toString();
  C.ok(dump.length > 100 && !/from A|from B|A edit|Inbox/.test(dump), 'server rows contain no plaintext titles', `${dump.split('\n').length} rows`);
});

await C.step('concurrent moves that form a cycle converge acyclic', async () => {
  // Shared setup: list P with siblings X and Y.
  const ids = await q(A, (S, O, A) => {
    const P = A.newList('Cycle P');
    const X = A.createAt(P, 0, { title: 'X' });
    const Y = A.createAt(P, 1, { title: 'Y' });
    A.createAt(X, 0, { title: 'X child' });
    A.createAt(Y, 0, { title: 'Y child' });
    return { P, X, Y };
  });
  await syncNow(A); await syncNow(B);
  C.ok((await q(B, (S, O, A, DB, st, ui, x) => S.parentOf(x.X) === x.P && S.parentOf(x.Y) === x.P, ids)), 'setup reached B');
  // Offline on both: A puts X under Y, B puts Y under X.
  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  await q(A, (S, O, A, DB, st, ui, x) => A.moveTo([x.X], x.Y), ids);
  await sleep(20);
  await q(B, (S, O, A, DB, st, ui, x) => A.moveTo([x.Y], x.X), ids);
  await sleep(300);
  await A.ctx.setOffline(false); await B.ctx.setOffline(false);
  await syncNow(A); await syncNow(B); await syncNow(A);
  const check = (d) => q(d, (S, O, A, DB, st, ui, x) => {
    const chain = (id) => { const out = []; for (let c = id, i = 0; c && c !== S.ROOT && i < 50; c = S.parentOf(c), i++) out.push(c); return out; };
    const cx = chain(x.X), cy = chain(x.Y);
    return {
      pX: S.parentOf(x.X), pY: S.parentOf(x.Y), acyclic: cx.length < 50 && cy.length < 50 && !(cx.includes(x.Y) && cy.includes(x.X)),
      reachesRoot: S.ancestors(x.X).length < 50 && S.ancestors(x.Y).length < 50, live: S.isLive(x.X) && S.isLive(x.Y),
      visibleInP: (() => { const seen = []; const w = (p) => { for (const c of S.children(p)) { seen.push(c); w(c); } }; w(x.P); return seen.includes(x.X) && seen.includes(x.Y); })(),
    };
  }, ids);
  const a = await check(A), b = await check(B);
  C.ok(a.acyclic && b.acyclic && a.reachesRoot && b.reachesRoot, 'no cycle on either device after sync', { a, b });
  C.ok(a.pX === b.pX && a.pY === b.pY, 'both devices pick the same effective parents', { A: [a.pX, a.pY], B: [b.pX, b.pY] });
  C.ok(a.live && b.live && a.visibleInP && b.visibleInP, 'neither X nor Y is lost (both still under P)', { a, b });
  const sa = await snapshot(A), sb = await snapshot(B);
  C.ok(same(sa.tree, sb.tree), 'rendered trees identical after the cycle repair', sa.tree.filter((t) => /X|Y|Cycle/.test(t)));
  // A fresh boot (rebuild from IDB) must give the same answer as the live merge.
  await A.page.reload(); await ready(A.page);
  const a2 = await check(A);
  C.ok(a2.pX === a.pX && a2.pY === a.pY, 'after a reload, A repairs the cycle the same way', { before: [a.pX, a.pY], after: [a2.pX, a2.pY] });
});

await C.step('delete syncs', async () => {
  const x = await q(A, (S) => S.children(S.INBOX).find((id) => S.val(id, 'title') === 'from A'));
  await focus(A, x); await A.page.keyboard.press('Backspace');
  await syncNow(A); await syncNow(B);
  const onB = await q(B, (S, O, A, DB, st, ui, id) => ({ deleted: S.val(id, 'deleted'), inTrash: S.qTrash().includes(id) }), x);
  C.ok(onB.deleted === 'trash' && onB.inTrash, 'an item deleted on A is in Trash on B', onB);
});

C.ok(A.errs.length + B.errs.length === 0, 'no page errors on either device', [...A.errs, ...B.errs].slice(0, 4));
await browser.close();
C.save('sync.json');
const fails = C.summary();
killAll();
process.exit(fails ? 1 : 0);
