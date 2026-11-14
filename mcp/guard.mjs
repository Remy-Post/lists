// guard.mjs — everything a tool checks before it may call an app verb (MCP-PLAN §10 S1/S2): id and
// destination resolvers, the depth cap, input formats (dates, time, repeat rules) and the field allowlist.
// A batch is checked whole first; nothing is written unless every entry passes.
import * as S from '../src/js/store.js';
import { parseQuick, describeRRule } from '../src/js/parse.js';
import { L } from './limits.mjs';
import { sanitize } from './sanitize.mjs';

/** An error the caller can act on; its message is returned to the model as-is. */
export class UserError extends Error {}

/* ---------------- ids ---------------- */
const val = S.val;
const shown = (id) => (typeof id === 'string' ? id.slice(0, 128) : String(id));

/**
 * Why `id` can't be the target of `mode`, or null. Modes: 'edit' (update, append, move, complete, reopen),
 * 'trash', 'restore', 'delete' (delete_forever: only items already in Trash; already-void is a no-op).
 */
export function targetProblem(id, mode) {
  if (typeof id !== 'string' || id === S.ROOT || !S.recs.has(id)) return 'no item has this id';
  if (id === S.INBOX) return 'the Inbox itself can’t be changed (use it as parent_id instead)';
  const deleted = val(id, 'deleted');
  if (deleted === 'void') return mode === 'delete' ? null : 'this item was deleted forever';
  if (mode === 'edit' && val(id, 'kind') === 'log') return 'this is a logbook entry of a repeating item and can’t be edited';
  if (mode === 'delete' && deleted !== 'trash') return 'not in Trash: trash it first, then delete it forever';
  return null;
}

/** Dedupe and check every id; throws one UserError listing each bad id, so nothing is half-applied. */
export function resolveTargets(ids, mode, extra = () => null) {
  const out = [], errors = [];
  for (const id of ids) {
    if (out.includes(id)) continue;
    const p = targetProblem(id, mode) || extra(id);
    if (p) errors.push(`${JSON.stringify(shown(id))}: ${p}`);
    else out.push(id);
  }
  if (errors.length) throw new UserError(`Nothing was changed. ${errors.join('; ')}`);
  return out;
}

/** Why `parent` can't receive items, or null. ROOT (a new top-level list) only where `allowRoot`. */
export function destinationProblem(parent, allowRoot) {
  if (parent === S.ROOT) return allowRoot ? null : 'use create_list to make a new top-level list';
  if (typeof parent !== 'string' || !S.recs.has(parent)) return 'no item has this id';
  if (!S.isLive(parent)) return 'it is in Trash or deleted';
  if (val(parent, 'kind') === 'log') return 'logbook entries can’t have children';
  return null;
}
export function checkDestination(parent, after, allowRoot) {
  const p = destinationProblem(parent, allowRoot);
  if (p) throw new UserError(`Nothing was changed. parent_id ${JSON.stringify(shown(parent))}: ${p}`);
  if (after != null && !(S.recs.has(after) && S.isLiveSelf(after) && S.parentOf(after) === parent)) {
    throw new UserError(`Nothing was changed. after_id ${JSON.stringify(shown(after))} is not a live child of parent_id ${JSON.stringify(shown(parent))}`);
  }
}

/* ---------------- depth ---------------- */
/** Depth of a node: a list is 1, its items 2, … ROOT is 0. */
export const depthOf = (id) => (id === S.ROOT ? 0 : S.ancestors(id).length + 1);

/** Height of an existing subtree (the node itself counts 1), walked with an explicit stack. */
export function subtreeHeight(id) {
  let h = 0;
  const stack = [[id, 1]];
  while (stack.length) {
    const [n, d] = stack.pop();
    if (d > h) h = d;
    for (const c of S.childrenAll(n)) if (val(c, 'deleted') !== 'void') stack.push([c, d + 1]);
  }
  return h;
}

/** Nodes and height of a nested `children` input, iteratively. */
export function measureInput(items) {
  let nodes = 0, height = 0;
  const stack = items.map((it) => [it, 1]);
  while (stack.length) {
    const [it, d] = stack.pop();
    nodes++;
    if (d > height) height = d;
    if (it.children) for (const c of it.children) stack.push([c, d + 1]);
  }
  return { nodes, height };
}

/** True when a parsed JSON value nests no deeper than `max` (checked before zod, which recurses). */
export function shallowEnough(value, max) {
  const stack = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop();
    if (d > max) return false;
    if (v && typeof v === 'object') for (const k in v) stack.push([v[k], d + 1]);
  }
  return true;
}

/* ---------------- formats ---------------- */
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A real calendar date that round-trips (no 2026-02-30). */
export function realDate(s) {
  if (!DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d));
  return y >= 1900 && y <= 2999 && t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** A valid IANA zone, as Intl understands it (an invalid TZ would silently become UTC). */
export function validZone(tz) {
  if (typeof tz !== 'string' || !/^[A-Za-z][A-Za-z0-9_+\-/]{0,63}$/.test(tz)) return false;
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true; } catch { return false; }
}

const CODES = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];
const RULE_KEYS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'UNTIL']);
const REPEAT_HELP = 'Use words like "every day", "every 2 weeks on monday and friday", "every weekday", ' +
  '"every month on the last friday", "every year on mar 5", "after 3 days" (counts from completion), ' +
  'or an RRULE the app can express (FREQ=DAILY|WEEKLY|MONTHLY|YEARLY, INTERVAL 1–99, BYDAY, BYMONTHDAY, BYMONTH, UNTIL=YYYYMMDD).';
const ruleMap = (s) => Object.fromEntries(s.split(';').filter(Boolean).map((x) => x.split('=')));

/**
 * A repeat rule as the composer would store it, or a UserError. `text` is natural language ("every monday")
 * or an RRULE; RRULEs must round-trip through the app's own grammar, which also bounds INTERVAL.
 * → { rrule, repeatFrom, first } where `first` is the first occurrence on or after today.
 */
export function normalizeRepeat(text, repeatFrom) {
  const s = String(text).trim();
  if (/^(RRULE:)?FREQ=/i.test(s)) {
    const R = ruleMap(s.replace(/^RRULE:/i, '').toUpperCase());
    const bad = Object.keys(R).find((k) => !RULE_KEYS.has(k));
    if (bad) throw new UserError(`Repeat rule part ${bad} isn't supported. ${REPEAT_HELP}`);
    if (R.INTERVAL != null && !(/^\d{1,2}$/.test(R.INTERVAL) && +R.INTERVAL >= 1)) throw new UserError(`INTERVAL must be 1–99. ${REPEAT_HELP}`);
    if (R.UNTIL != null && !(/^\d{8}$/.test(R.UNTIL) && realDate(`${R.UNTIL.slice(0, 4)}-${R.UNTIL.slice(4, 6)}-${R.UNTIL.slice(6)}`))) throw new UserError(`UNTIL must be YYYYMMDD. ${REPEAT_HELP}`);
    const { UNTIL, ...core } = R;
    if (core.INTERVAL === '1') delete core.INTERVAL;
    if (core.BYDAY && /^[A-Z,]+$/.test(core.BYDAY)) core.BYDAY = [...new Set(core.BYDAY.split(','))].sort((a, b) => CODES.indexOf(a) - CODES.indexOf(b)).join(',');
    const coreText = Object.entries(core).map(([k, v]) => `${k}=${v}`).join(';');
    let p = null;
    try { p = parseQuick('x ' + describeRRule(coreText).toLowerCase()); } catch { /* not expressible */ }
    const canon = p && p.rrule ? ruleMap(p.rrule) : null;
    const same = canon && Object.keys(canon).length === Object.keys(core).length && Object.keys(canon).every((k) => canon[k] === core[k]);
    if (!same) throw new UserError(`The app can't repeat by "${s.slice(0, 80)}". ${REPEAT_HELP}`);
    return { rrule: p.rrule + (UNTIL ? ';UNTIL=' + UNTIL : ''), repeatFrom: repeatFrom || 'when', first: p.when };
  }
  const p = parseQuick('x ' + s);
  if (!p.rrule || p.title !== 'x' || p.tokens.length !== 1) throw new UserError(`"${s.slice(0, 80)}" isn't a repeat the app understands. ${REPEAT_HELP}`);
  return { rrule: p.rrule, repeatFrom: repeatFrom || p.repeatFrom, first: p.when };
}

/* ---------------- fields ---------------- */
const textOf = (s) => sanitize(s).text;

/**
 * Build the record fields for an add or an update from an allowlist (never id, pos, deleted, kind, v…),
 * applying the app's own rules: a date clears Someday, Someday clears the date, Evening needs a date
 * (today if none), a repeat without a date starts on its first occurrence. `cur` is the item being
 * updated (null for a create); `baseWhen` stands in for its date when a create's quick text gave one.
 * Returns { fields, chars } where chars counts new text.
 */
export function buildFields(input, cur, today, baseWhen) {
  const f = {};
  let chars = 0;
  if (input.title !== undefined) chars += (f.title = textOf(input.title)).length;
  if (input.notes !== undefined) chars += (f.notes = textOf(input.notes)).length;
  if (input.tags !== undefined) {
    const tags = input.tags && [...new Set(input.tags.map(textOf).map((t) => t.trim()).filter(Boolean))];
    f.tags = tags && tags.length ? tags : null;
    if (tags) chars += tags.join('').length;
  }
  if (input.priority !== undefined) f.priority = input.priority;
  if (input.heading !== undefined) { f.heading = input.heading; if (input.heading) f.done = false; }
  if (input.time !== undefined) f.time = input.time;
  if (input.deadline !== undefined) f.deadline = input.deadline;
  if (input.repeat_from !== undefined) f.repeatFrom = input.repeat_from;

  const curWhen = baseWhen !== undefined ? baseWhen : (cur ? val(cur, 'when') : null);
  if (input.someday === true && input.when) throw new UserError('An item can’t be both dated (when) and Someday; send one of them.');
  if (input.when !== undefined) {
    f.when = input.when;
    if (input.when) f.someday = false; else f.evening = false;
  }
  if (input.someday !== undefined) {
    f.someday = input.someday;
    if (input.someday) { f.when = null; f.evening = false; }
  }
  if (input.evening !== undefined) {
    if (input.evening && f.when === null) throw new UserError('Evening needs a date; send a when or leave it out to mean today.');
    f.evening = input.evening;
    if (input.evening && f.when === undefined && !curWhen) { f.when = today; f.someday = false; }
  }
  if (input.repeat !== undefined) {
    if (input.repeat === null) f.rrule = null;
    else {
      const r = normalizeRepeat(input.repeat, input.repeat_from);
      f.rrule = r.rrule; f.repeatFrom = r.repeatFrom;
      if (f.when === undefined && !curWhen && r.first) { f.when = r.first; f.someday = false; }
    }
  }
  return { fields: f, chars };
}
