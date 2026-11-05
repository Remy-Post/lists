// ops.js — every user mutation goes through here, so it is undoable.
// An undo is a fresh write of the "before" values (it syncs like any edit) and skips fields
// that changed since — e.g. edited on the other device (docs/research/04-architecture.md §5).
import * as S from './store.js';

const undos = [], redos = [];
const LIMIT = 500;
let cur = null;
export let onChange = () => {};
export const setOnChange = (fn) => { onChange = fn; };

const same = (a, b) => a === b || JSON.stringify(a) === JSON.stringify(b);

/**
 * Group mutations into one undo step.
 * opts.ctx: where to return on undo ({ route, sel }). opts.merge: coalesce key (typing).
 */
export function tx(label, fn, opts = {}) {
  if (cur) return fn();
  cur = { label, ch: new Map(), ctx: opts.ctx || null, merge: opts.merge || null, t: Date.now() };
  let out;
  try { out = fn(); } finally {
    const t = cur; cur = null;
    if (t.ch.size) record(t);
  }
  return out;
}
function record(t) {
  const top = undos[undos.length - 1];
  if (t.merge && top && top.merge === t.merge && t.t - top.t2 < 1500) {
    for (const [id, c] of t.ch) {
      const tc = top.ch.get(id);
      if (!tc) top.ch.set(id, c);
      else { for (const k in c.b) if (!(k in tc.b)) tc.b[k] = c.b[k]; Object.assign(tc.a, c.a); }
    }
    top.t2 = t.t;
  } else {
    t.t2 = t.t;
    undos.push(t);
    if (undos.length > LIMIT) undos.shift();
  }
  redos.length = 0;
  onChange();
}

/** Patch fields on a node, remembering the previous values. */
export function set(id, fields) {
  const existed = S.recs.has(id);
  if (cur) {
    let c = cur.ch.get(id);
    if (!c) cur.ch.set(id, (c = { b: {}, a: {} }));
    for (const k in fields) {
      if (!(k in c.b)) c.b[k] = existed ? S.val(id, k) : undefined;
      c.a[k] = fields[k];
    }
    if (!existed) c.b.deleted = 'void';
  }
  return S.patch(id, fields);
}

/** Create a node; returns its id. */
export function create(fields) {
  const id = fields.id || S.newId();
  delete fields.id;
  set(id, { created: Date.now(), ...fields, deleted: false });
  return id;
}

function apply(t, dir) {
  const from = dir === 'undo' ? 'a' : 'b', to = dir === 'undo' ? 'b' : 'a';
  for (const [id, c] of t.ch) {
    if (!S.recs.has(id)) continue;
    const f = {};
    for (const k in c[to]) {
      if (c[to][k] === undefined) continue;
      // Skip a field someone else changed after this step.
      if (k in c[from] && !same(S.val(id, k), c[from][k])) continue;
      f[k] = c[to][k];
    }
    if (Object.keys(f).length) S.patch(id, f);
  }
}
export function undo() {
  const t = undos.pop();
  if (!t) return null;
  apply(t, 'undo'); redos.push(t); onChange();
  return t;
}
export function redo() {
  const t = redos.pop();
  if (!t) return null;
  apply(t, 'redo'); undos.push(t); onChange();
  return t;
}
export const canUndo = () => undos.length > 0;
export const canRedo = () => redos.length > 0;
export const peekUndo = () => undos[undos.length - 1] || null;
