// Quick-add grammar, natural-language dates and an RRULE subset. Pure, no DOM, no deps.
//
// Dates are floating local 'YYYY-MM-DD'. Internally a date is a whole UTC day number,
// so DST and time zones never shift a day. Weeks start on Monday.
//
// Grammar decisions (see tests/unit/parse.test.mjs for the fixtures):
// - Bare weekday "fri" = next occurrence strictly after today (Things): on a Friday it is
//   next Friday. "this fri" = today or later this week; "next fri" = Friday of next week.
// - Ambiguous words only count as a date at the tail of the text (followed by nothing but
//   other recognised tokens) or after on/by/due: bare weekdays, tod/tmr/tmrw, "weekend",
//   "3d"/"3 days", numeric 11/14 (M/D) and 14.11 (D.M). So "sunday school" and "1/2 cup
//   flour" stay literal, while "call mom sun" is dated.
// - Bare month names ("May", "march") and "tom" ("call Tom") are never quick-add dates;
//   they work in parseDate() and suggestDates().
// - Only the first token of each kind counts (tags excepted); later ones stay literal.
// - A time ("5pm", "at 17:00") alone dates the task today. Month-day without a year rolls
//   to the next year when already past (feb 29 waits for a leap year).
// - nextOccurrence clamps day-of-month to the month's length (31st → Feb 28).

const DAYS = 'monday tuesday wednesday thursday friday saturday sunday'.split(' ')
const MONS = 'january february march april may june july august september october november december'.split(' ')
const CODES = 'MO TU WE TH FR SA SU'.split(' ')
const FREQ = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' }
const OW = 'first second third fourth fifth'.split(' ')

const D = (y, m, d) => Date.UTC(y, m, d) / 864e5
const P = n => { const x = new Date(n * 864e5); return [x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()] }
const dow = n => (n % 7 + 10) % 7 // 0 = Monday
const wk = n => Math.floor((n + 3) / 7)
const dim = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
const toS = n => new Date(n * 864e5).toISOString().slice(0, 10)
const fromS = s => Date.parse(s) / 864e5
const day0 = now => D(now.getFullYear(), now.getMonth(), now.getDate())
const pad = n => String(n).padStart(2, '0')
const cap = s => s[0].toUpperCase() + s.slice(1)
const pre = (w, list) => w && w.length > 2 ? list.findIndex(x => x.startsWith(w)) : -1
const addM = (n, k) => { const [y, m, d] = P(n); return D(y, m + k, Math.min(d, dim(y, m + k))) }
const add = (n, k, u) => u == 'd' ? n + k : u == 'w' ? n + 7 * k : addM(n, u == 'm' ? k : 12 * k)
const norm = s => s.replace(/,/g, ' ').replace(/(\d)(st|nd|rd|th)\b/g, '$1').replace(/\s+/g, ' ').trim()
const ordn = n => n + (['th', 'st', 'nd', 'rd'][n % 100 > 10 && n % 100 < 14 ? 0 : n % 10] || 'th')
const rp = s => Object.fromEntries(s.split(';').map(x => x.split('=')))
const plain = R => !(R.BYDAY || R.BYMONTHDAY || R.BYMONTH)

export const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
export const fromYMD = s => { const [y, m, d] = s.split('-'); return new Date(y, m - 1, d) }

// Month (0-based) + day, optional year; without a year, the next valid date >= today.
function md(mo, dd, yy, t) {
  if (!(mo >= 0 && mo < 12)) return null
  const Y = P(t)[0], a = yy ? +yy : Y
  for (let y = a; y <= (yy ? a : Y + 8); y++)
    if (dd > 0 && dd <= dim(y, mo) && (yy || D(y, mo, dd) >= t)) return D(y, mo, dd)
  return null
}

// One normalised lowercase date phrase → { d, ev?, sd?, a? } (a: 1 ambiguous, 2 never inline).
function dt(p, t) {
  const [y, mo] = P(t), w = dow(t), v = d => d == null ? null : { d }
  let m, d, a
  const fx = {
    today: t, tomorrow: t + 1, eow: t + (11 - w) % 7, eom: D(y, mo + 1, 0), eoy: D(y, 11, 31),
    'next week': t + 7 - w, 'next month': D(y, mo + 1, 1), 'this weekend': w > 5 ? t : t + 5 - w,
    'next weekend': t + 12 - w,
  }
  if (p in fx) return { d: fx[p] }
  if (/^(tod|tmrw?|tom|weekend)$/.test(p)) return { d: p == 'tod' ? t : p[0] == 't' ? t + 1 : fx['this weekend'], a: p == 'tom' ? 2 : 1 }
  if (p == 'tonight' || p == 'this evening') return { d: t, ev: 1 }
  if (p == 'someday') return { d: null, sd: 1 }
  if (m = /^(.+) (evening|night)$/.exec(p)) return (d = dt(m[1], t)) && d.d != null ? { ...d, ev: 1 } : null
  if ((m = /^(?:(this|next) )?([a-z]+)$/.exec(p)) && (d = pre(m[2], DAYS)) >= 0)
    return { d: m[1] == 'next' ? t + 7 - w + d : m[1] ? t + (d - w + 7) % 7 : t + (d - w + 6) % 7 + 1, a: !m[1] }
  if ((d = pre(p, MONS)) >= 0) return { d: md(d, 1, 0, t), a: 2 }
  if (m = /^(in |\+)?(\d+|an?|one) ?(d|days?|w|wks?|weeks?|m|mos?|months?|y|yrs?|years?)$/.exec(p)) {
    a = !m[1]
    return a && !/\d/.test(m[2]) ? null : { d: add(t, /\d/.test(m[2]) ? +m[2] : 1, m[3][0]), a }
  }
  if ((m = /^([a-z]+)\.? (\d\d?)(?: (\d{4}))?$/.exec(p)) && (d = pre(m[1], MONS)) >= 0) return v(md(d, +m[2], m[3], t))
  if ((m = /^(\d\d?) (?:of )?([a-z]+)\.?(?: (\d{4}))?$/.exec(p)) && (d = pre(m[2], MONS)) >= 0) return v(md(d, +m[1], m[3], t))
  if (m = /^(\d\d?)([/.])(\d\d?)(?:\2(\d{4}))?$/.exec(p))
    return (d = m[2] == '/' ? md(m[1] - 1, +m[3], m[4], t) : md(m[3] - 1, +m[1], m[4], t)) == null ? null : { d, a: 1 }
  if (m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(p)) return v(md(m[2] - 1, +m[3], m[1], t))
  return null
}

// Recurrence detail after "every [N]": weekday list, nth day, nth weekday, month-day.
function spec(s) {
  let m = s.split(/\s*(?:,|&|\band\b)\s*|\s+/).filter(Boolean).map(w => pre(w, DAYS)), n, i
  if (m.length && m.every(i => i >= 0)) return ['week', ';BYDAY=' + [...new Set(m)].sort().map(i => CODES[i])]
  if (m = /^(?:the )?(\d\d?(?:st|nd|rd|th)|first|second|third|fourth|fifth|last)(?: ([a-z]+))?$/.exec(s)) {
    n = m[1] == 'last' ? -1 : parseInt(m[1]) || OW.indexOf(m[1]) + 1
    if (!m[2] || m[2] == 'day') return n && n < 32 && ['month', ';BYMONTHDAY=' + n]
    return (i = pre(m[2], DAYS)) >= 0 && n < 6 && n && ['month', ';BYDAY=' + n + CODES[i]]
  }
  if ((m = /^([a-z]+) (\d\d?)(?:st|nd|rd|th)?$|^(\d\d?)(?:st|nd|rd|th)? (?:of )?([a-z]+)$/.exec(s)) && (i = pre(m[1] || m[4], MONS)) >= 0)
    return (n = +(m[2] || m[3])) > 0 && n <= dim(2000, i) && ['year', `;BYMONTH=${i + 1};BYMONTHDAY=${n}`]
}

function rr(l) {
  let m = /^(?:every(!?)|(after)) (?:(other|\d+) )?(.+)$/.exec(l), f, by = '', u
  if (!m || (m[2] && !m[3])) return
  let n = m[3] == 'other' ? 2 : +(m[3] || 1), s = m[4]
  if (!n) return
  if (u = /^(day|week|month|year)s?(?: on (.+))?$/.exec(s)) {
    f = u[1]
    if (u[2]) { if (!(by = spec(u[2])) || by[0] != f) return; by = by[1] }
  } else if (/^weekdays?$/.test(s)) f = 'week', by = ';BYDAY=MO,TU,WE,TH,FR'
  else if (/^weekends?$/.test(s)) f = 'week', by = ';BYDAY=SA,SU'
  else if (u = spec(s) || +m[3] && (n = 1, spec(m[3] + ' ' + s))) [f, by] = u
  else return
  if (m[2] && by) return
  return { v: 'FREQ=' + FREQ[f] + (n > 1 ? ';INTERVAL=' + n : '') + by, done: !!(m[1] || m[2]) }
}

function tm(l) {
  if (/^(at )?noon$/.test(l)) return '12:00'
  const m = /^(?:at )?(\d\d?)(?::(\d\d))?(?: ?([ap])m)?$/.exec(l)
  let h = m && +m[1]
  if (!m || !(m[2] || m[3]) || m[2] > 59) return
  if (m[3]) { if (h < 1 || h > 12) return; h = h % 12 + (m[3] == 'p' ? 12 : 0) } else if (h > 23) return
  return pad(h) + ':' + (m[2] || '00')
}

// One candidate phrase (original case) → token payload or undefined.
function M(ph, t) {
  const l = ph.toLowerCase().replace(/\s+/g, ' ')
  let r = rr(l), m
  if (r) return { kind: 'repeat', ...r }
  if ((m = /^(by|due|on) (.+)/.exec(l)) && (r = dt(norm(m[2]), t)) && !(r.a > 1) && r.d != null)
    return { kind: m[1] == 'on' ? 'when' : 'deadline', d: r.d, ev: r.ev }
  if ((r = dt(norm(l), t)) && !(r.a > 1)) return { kind: 'when', ...r }
  if (r = tm(l)) return { kind: 'time', v: r }
  if (m = /^(!{1,3})$|^p([123])$/.exec(l)) return { kind: 'priority', v: m[1] ? m[1].length : 4 - m[2] }
  if (m = /^([#@])(?=[\p{N}_/-]*\p{L})([\p{L}\p{N}_/-]+)$/u.exec(ph)) return { kind: m[1] == '#' ? 'list' : 'tag', v: m[2] }
}

// First occurrence >= day s; intervals count from anchor day a.
function occ(R, s, a) {
  const n = +R.INTERVAL || 1, [ay, am, ad] = P(a), B = R.BYDAY, q = /\d/.test(B), v = +R.BYMONTHDAY
  if (B && !q) {
    const set = B.split(',').map(c => CODES.indexOf(c))
    for (let d = s; d < s + 7 * n + 7; d++) if (set.includes(dow(d)) && (wk(d) - wk(a)) % n == 0) return d
    return null
  }
  for (let k = 0, c; k < 240; k++) {
    if (R.FREQ == 'YEARLY') {
      const y = ay + k * n, mo = R.BYMONTH ? R.BYMONTH - 1 : am
      c = D(y, mo, Math.min(v || ad, dim(y, mo)))
    } else {
      const mi = am + k * n, L = dim(ay, mi), f = D(ay, mi, 1), l = f + L - 1
      if (q) {
        const [, o, cd] = /^(-?\d)(\w\w)$/.exec(B) || [], x = CODES.indexOf(cd)
        c = o > 0 ? f + (x - dow(f) + 7) % 7 + 7 * (o - 1) : l - (dow(l) - x + 7) % 7 + 7 * (+o + 1)
        if (c < f || c > l) continue
      } else c = D(ay, mi, v < 0 ? L + v + 1 : Math.min(v || ad, L))
    }
    if (c >= s) return c
  }
  return null
}

export function nextOccurrence(rule, from, repeatFrom = 'when', done) {
  const R = rp(rule), b = fromS(repeatFrom == 'done' && done || from || done)
  const r = plain(R) ? add(b, +R.INTERVAL || 1, R.FREQ[0].toLowerCase()) : occ(R, b + 1, b)
  return r == null || R.UNTIL && toS(r).replace(/-/g, '') > R.UNTIL.slice(0, 8) ? null : toS(r)
}

export function parseQuick(text, now = new Date(), { ignore = [] } = {}) {
  const t = day0(now), W = [...text.matchAll(/\S+/g)], C = [], seen = {}
  const hit = (s, e) => ignore.some(([a, b]) => s < b && e > a)
  for (let i = 0; i < W.length; i++) {
    const s = W[i].index
    for (let k = Math.min(9, W.length - i); k > 0; k--) {
      const w = W[i + k - 1], ph = text.slice(s, w.index + w[0].length), x = ph.replace(/([^\s.,;:!?])[.,;:!?]+$/, '$1')
      let e = s + ph.length, r = M(ph, t)
      if (!r && x && x != ph) r = M(x, t), e = s + x.length
      if (r && !hit(s, e)) { C.push({ ...r, start: s, end: e }); i += k - 1; break }
    }
  }
  // Ambiguous candidates survive only in the trailing run of tokens.
  for (let j = C.length, tail = text.length; j--;) {
    if (/^[\s.,;:!?]*$/.test(text.slice(C[j].end, tail))) tail = C[j].start
    else if (C[j].a) C.splice(j, 1)
  }
  const o = { title: '', when: null, evening: false, someday: false, time: null, deadline: null, priority: 0,
    list: null, tags: [], rrule: null, repeatFrom: 'when', tokens: [] }
  let title = '', p = 0
  for (const c of C) {
    const k = c.kind
    if (k != 'tag' && seen[k]) continue
    seen[k] = 1
    if (k == 'when') o.when = c.d == null ? null : toS(c.d), o.evening = !!c.ev, o.someday = !!c.sd
    else if (k == 'deadline') o.deadline = toS(c.d)
    else if (k == 'repeat') o.rrule = c.v, o.repeatFrom = c.done ? 'done' : 'when'
    else if (k == 'tag') o.tags.includes(c.v) || o.tags.push(c.v)
    else o[k] = c.v // priority, list, time
    o.tokens.push({ start: c.start, end: c.end, kind: k, text: text.slice(c.start, c.end) })
    title += text.slice(p, c.start) + ' ', p = c.end
  }
  o.title = (title + text.slice(p)).replace(/\s+/g, ' ').trim()
  if (o.rrule && !seen.when) {
    const R = rp(o.rrule), f = plain(R) ? t : occ({ ...R, INTERVAL: 1 }, t, t)
    o.when = f == null ? null : toS(f)
  }
  if (o.time && !seen.when && !o.rrule && !o.deadline) o.when = toS(t)
  return o
}

export function parseDate(str, now = new Date()) {
  const t = day0(now), p = norm(String(str || '').toLowerCase()).replace(/^on /, '')
  if (p == 'yesterday') return toS(t - 1)
  const r = dt(p, t)
  return r && r.d != null ? toS(r.d) : null
}

const KW = [['Today', 'today'], ['Tonight', 'tonight'], ['Tomorrow', 'tomorrow'], ['This Evening', 'this evening'],
  ['This Weekend', 'this weekend'], ['Next Week', 'next week'], ['Next Month', 'next month'], ['Someday', 'someday'],
  ['End of Week', 'eow'], ['End of Month', 'eom'], ['End of Year', 'eoy'],
  ...DAYS.map(d => [cap(d), d]), ...MONS.map(m => [cap(m.slice(0, 3)) + ' 1', m])]

export function suggestDates(prefix, now = new Date()) {
  const p = norm(String(prefix || '').toLowerCase()), t = day0(now), out = []
  const put = (label, r) => {
    const o = { label, date: r.d == null ? null : toS(r.d) }
    if (r.ev) o.evening = true
    if (r.sd) o.someday = true
    if (!out.some(x => x.date == o.date && !x.evening == !o.evening)) out.push(o)
  }
  if (!p) return out
  for (const [label, k] of KW) if (k.startsWith(p) || label.toLowerCase().startsWith(p)) put(label, dt(k, t))
  const r = dt(p, t)
  if (r && r.d != null) put(formatDay(toS(r.d), now), r)
  return out.slice(0, 8)
}

export function describeRRule(rule) {
  if (!rule) return ''
  const R = rp(rule), n = +R.INTERVAL || 1, B = R.BYDAY, v = +R.BYMONTHDAY, u = { D: 'day', W: 'week', M: 'month', Y: 'year' }[R.FREQ[0]]
  const nm = c => cap(DAYS[CODES.indexOf(c)])
  if (n == 1 && B == 'MO,TU,WE,TH,FR') return 'Every weekday'
  if (n == 1 && B == 'SA,SU') return 'Every weekend'
  let s = 'Every ' + (n > 1 ? n + ' ' + u + 's' : u), m
  if (B) {
    if (m = /^(-?\d)(\w\w)$/.exec(B)) s += ' on the ' + (m[1] < 0 ? 'last' : ordn(+m[1])) + ' ' + nm(m[2])
    else { const a = B.split(',').map(nm); s += ' on ' + (a.length > 1 ? a.slice(0, -1).join(', ') + ' and ' + a.at(-1) : a[0]) }
  }
  if (R.BYMONTH) s += ' on ' + cap(MONS[R.BYMONTH - 1].slice(0, 3)) + ' ' + v
  else if (v) s += ' on the ' + (v < 0 ? 'last day' : ordn(v))
  return s
}

export function formatDay(s, now = new Date()) {
  if (!s) return ''
  const n = fromS(s), t = day0(now), d = n - t, [y, m, dd] = P(n)
  return d == 0 ? 'Today' : d == 1 ? 'Tomorrow' : d == -1 ? 'Yesterday'
    : d > 1 && d < 7 ? cap(DAYS[dow(n)].slice(0, 3))
    : cap(MONS[m].slice(0, 3)) + ' ' + dd + (y == P(t)[0] ? '' : ', ' + y)
}
