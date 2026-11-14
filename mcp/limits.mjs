// limits.mjs — every number the connector enforces (MCP-PLAN §7 as amended by §10), plus the small
// counters that enforce them. Nothing here touches the store.
import { isIP } from 'node:net';

export const L = {
  bodyBytes: 256 << 10,        // POST body cap for /mcp and /mcp-admin (413 above)
  bodyMs: 5_000,               // a POST body must arrive within this (408 and the connection closed)
  jsonDepth: 160,              // raw JSON nesting before zod runs (64 levels of `children` ≈ 130)
  ipPerMin: 120,               // requests per client IP per minute (429)
  globalPerMin: 600,           // requests per minute in total (429)
  ipOpen: 3,                   // in-flight non-listen requests per IP (429)
  globalOpen: 32,              // in-flight requests in total, listen streams included (503)
  maxSubscriptions: 16,        // SDK cap on open subscriptions/listen streams
  ipListens: 4,                // listen streams per IP; a new one evicts that IP's oldest
  keepAliveMs: 25_000,         // SSE comment-frame keepalive
  listenMaxMs: 10 * 60_000,    // listen streams are closed after this long (clients reconnect)
  syncPerMin: 20,              // the bridge's own budget against lists-sync (the vault has 60/min for everyone)
  pullStaleMs: 10_000,         // pull before a tool if the last pull is older than this
  pushWaitMs: 10_000,          // a write tool waits this long for its push, then answers pushed:false
  batchNodes: 100,             // nodes per write call, nested children included
  maxDepth: 64,                // resulting tree depth (a list is depth 1)
  titleChars: 500,
  notesChars: 20_000,
  tags: 20,
  tagChars: 64,
  sealedBytes: 90 * 1024,      // sync.js MAX_BLOB: a bigger sealed record would never sync
  createsPerHour: 1000,        // rolling hour, all callers together
  textPerHour: 2 << 20,        // characters of new text per rolling hour, all callers together
  replicaFloor: 20_000,        // creates refused above max(2 × size at connect, this)
  outboxMax: 2000,             // creates refused while this many records wait to be pushed
  undoSteps: 200,              // undo history kept (in memory; lost on restart)
  resultChars: 100_000,        // a read result stops near this and returns next_cursor
  pageDefault: 50,
  pageMax: 200,
  graveyardDays: 30,
  graveyardBytes: 5 << 20,
  auditBytes: 1 << 20,         // audit.jsonl rotates at this size, 3 files kept
};
// Test-only knob: the suites shrink a few limits so they can be hit in seconds. Unknown keys are ignored.
if (process.env.LISTS_MCP_TEST_LIMITS) {
  for (const [k, v] of Object.entries(JSON.parse(process.env.LISTS_MCP_TEST_LIMITS))) if (k in L) L[k] = v;
}

/** Token bucket: `n` tokens refilled evenly over `ms`. take() → 0 when granted, else ms until the next token. */
export function bucket(n, ms, now = Date.now) {
  let tokens = n, at = now();
  return {
    take() {
      const t = now();
      tokens = Math.min(n, tokens + ((t - at) * n) / ms);
      at = t;
      if (tokens >= 1) { tokens -= 1; return 0; }
      return Math.ceil(((1 - tokens) * ms) / n);
    },
  };
}

/**
 * Fixed one-minute windows per key. hit(key, n) → 0 when allowed, else seconds until the window resets.
 * At most `cap` keys: past it, expired windows are swept at most once a second, and a new key that still
 * doesn't fit shares one overflow window, so a flood of distinct keys costs O(1) each.
 */
export const OVERFLOW = '\0overflow';
export function perMinute(now = Date.now, cap = 10_000) {
  const m = new Map();
  let swept = -Infinity;
  return {
    hit(key, n) {
      const t = now();
      if (!m.has(key) && m.size >= cap) {
        if (t - swept >= 1000) { swept = t; for (const [k, w] of m) if (t - w.at >= 60_000) m.delete(k); }
        if (m.size >= cap) key = OVERFLOW;
      }
      const w = m.get(key);
      if (!w || t - w.at >= 60_000) { m.set(key, { at: t, c: 1 }); return 0; }
      if (w.c >= n) return Math.max(1, Math.ceil((w.at + 60_000 - t) / 1000));
      w.c++;
      return 0;
    },
    size: () => m.size,
  };
}

/** Rolling-hour budget of creates and new text across all callers. */
export function growthBudget(now = Date.now) {
  const log = []; // [time, creates, chars]
  const trim = () => { const t = now() - 3600_000; while (log.length && log[0][0] < t) log.shift(); };
  const sum = (i) => log.reduce((s, e) => s + e[i], 0);
  return {
    /** null when allowed, else a plain reason. Does not spend anything. */
    check(creates, chars) {
      trim();
      if (sum(1) + creates > L.createsPerHour) return `The connector has created ${L.createsPerHour} items in the last hour, its limit. Try again later.`;
      if (sum(2) + chars > L.textPerHour) return 'The connector has written its hourly limit of new text. Try again later.';
      return null;
    },
    spend(creates, chars) { if (creates || chars) log.push([now(), creates, chars]); },
  };
}

/** The per-client key for rate and concurrency limits: an IPv6 client counts per /64 (as lists-sync does). */
export function rateKey(ip) {
  if (isIP(ip) !== 6) return ip;
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip); // IPv4-mapped: the IPv4 address itself
  if (v4) return v4[1];
  const [l, r] = ip.split('::'), hex = (x) => (x ? x.split(':') : []);
  const left = hex(l), right = r === undefined ? [] : hex(r);
  const fill = r === undefined ? [] : Array(Math.max(0, 8 - left.length - right.length - (ip.includes('.') ? 1 : 0))).fill('0');
  return [...left, ...fill, ...right].slice(0, 4).map((x) => parseInt(x, 16).toString(16)).join(':') + '::/64';
}
