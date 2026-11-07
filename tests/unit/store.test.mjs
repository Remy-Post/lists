// store.test.mjs — the incremental tree cache (completion edits) must always equal a brute-force recount.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../../src/js/store.js';

let seed = 7;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

function brute() {
  const open = new Map(), items = new Set();
  const walk = (p, doneAbove) => {
    let n = 0;
    for (const c of S.children(p)) {
      const kind = S.val(c, 'kind'), done = S.val(c, 'done'), heading = S.val(c, 'heading');
      const d = doneAbove || done;
      if (!d && !heading && kind === 'item') items.add(c);
      const sub = walk(c, d);
      if (kind !== 'log') n += sub + (!done && !heading ? 1 : 0);
    }
    open.set(p, n);
    return n;
  };
  walk(S.ROOT, false);
  return { open, items };
}

for (const sd of [7, 42, 1234]) test(`incremental counts and open items equal a full recount after random edits (seed ${sd})`, () => {
  seed = sd;
  S.hydrate([]);
  S.patch(S.INBOX, { kind: 'inbox', title: 'Inbox', pos: { parent: S.ROOT, key: 'a0', prev: null } });
  const ids = [S.INBOX];
  for (let i = 0; i < 400; i++) {
    const parent = ids[Math.floor(rnd() * ids.length)];
    const id = 'n' + i;
    S.patch(id, { title: 't' + i, pos: S.posAt(parent, S.children(parent).length), kind: rnd() < 0.05 ? 'log' : 'item', done: rnd() < 0.2 });
    ids.push(id);
  }
  const today = '2026-11-07';
  S.qToday(today); S.countOpen(S.ROOT); // warm the cache so edits go through the incremental path
  for (let step = 0; step < 600; step++) {
    const id = ids[1 + Math.floor(rnd() * (ids.length - 1))];
    const r = rnd();
    if (r < 0.6) S.patch(id, { done: !S.val(id, 'done'), doneAt: Date.now() });
    else if (r < 0.75) S.patch(id, { heading: !S.val(id, 'heading') });
    else if (r < 0.8) S.patch(id, { when: rnd() < 0.5 ? today : null });
    else if (r < 0.92) {
      // move: indent-like or to a random valid parent
      const np = ids[Math.floor(rnd() * ids.length)];
      if (np !== id && S.canMove(id, np)) S.patch(id, { pos: S.posAt(np, Math.floor(rnd() * (S.children(np).length + 1)), id, S.parentOf(id)) });
    }
    else S.patch(id, { title: 'x' + step });
    const b = brute();
    for (const n of [S.ROOT, ...ids]) assert.equal(S.countOpen(n), b.open.get(n) || 0, `open count of ${n} after step ${step}`);
    const t = S.qToday(today);
    const expectToday = [...b.items].filter((x) => S.val(x, 'when') && S.val(x, 'when') <= today).sort();
    assert.deepEqual([...t.day, ...t.eve].sort(), expectToday, `Today after step ${step}`);
  }
});
