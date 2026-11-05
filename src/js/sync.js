// sync.js: end-to-end-encrypted, opportunistic sync for Lists (contract: docs/TEAMS.md).
// Protocol, key handling and threat model: server/README.md. No dependencies.
const E = new TextEncoder(), D = new TextDecoder(), S = crypto.subtle;
const A32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32
const MIN = 60e3, PUSH_STALE = 2 * MIN, PULL_STALE = 15 * MIN, BACKUP_AGE = 3 * 1440 * MIN;
const MAX_ROWS = 200, MAX_BYTES = 256 << 10, MAX_BLOB = 90 * 1024, KEEPALIVE = 65536;
const K = 'sync'; // meta key: { key: Uint8Array(32), dev, cursor, lastPush, lastPull, dirty, mk }

const hex = (b) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
const rnd = (n) => crypto.getRandomValues(new Uint8Array(n));
const b64 = (u) => {
  let s = '';
  for (let i = 0; i < u.length; i += 32768) s += String.fromCharCode(...u.subarray(i, i + 32768));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const unb64 = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

/** 32 bytes -> "XXXX-XXXX-…" (52 Crockford base32 chars in groups of 4). */
export function encodeKey(b) {
  let s = '', v = 0, n = 0;
  for (const x of b) for (v = (v << 8 | x) & 4095, n += 8; n >= 5;) s += A32[v >>> (n -= 5) & 31];
  if (n) s += A32[v << (5 - n) & 31];
  return s.match(/.{1,4}/g).join('-');
}

/** Pairing code -> 32 bytes, or null. Case, spaces and dashes are ignored; O→0, I/L→1. */
export function decodeKey(code) {
  const s = String(code).toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{52}$/.test(s)) return null;
  const out = new Uint8Array(32);
  let v = 0, n = 0, i = 0;
  for (const c of s) if (v = (v << 5 | A32.indexOf(c)) & 4095, (n += 5) >= 8) out[i++] = v >>> (n -= 8) & 255;
  return v & 15 ? null : out; // the 4 padding bits must be zero
}

/** HKDF-SHA256(key) -> { tok: hex auth token (server sees only its SHA-256), key: AES-GCM-256, non-extractable }. */
export async function deriveKeys(raw) {
  const base = await S.importKey('raw', raw, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const p = (i) => ({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: E.encode(`lists/${i}/v1`) });
  return {
    tok: hex(await S.deriveBits(p('auth'), base, 256)),
    key: await S.deriveKey(p('enc'), base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']),
  };
}

const aes = (iv, r) => ({ name: 'AES-GCM', iv, additionalData: E.encode(`${r.id}|${r.v}`) });

/** Rec -> wire row { id, v, b: base64url(0x01 ‖ iv96 ‖ ciphertext+tag) }; f === null is a purge marker. */
export async function seal(key, r) {
  if (r.f == null) return { id: r.id, v: r.v, b: null };
  const iv = rnd(12), ct = new Uint8Array(await S.encrypt(aes(iv, r), key, E.encode(JSON.stringify(r))));
  const u = new Uint8Array(13 + ct.length);
  u[0] = 1, u.set(iv, 1), u.set(ct, 13);
  return { id: r.id, v: r.v, b: b64(u) };
}

/** Wire row -> Rec. Throws if the blob was altered, moved to another id/version, or made with another key. */
export async function unseal(key, row) {
  if (row.b == null) return { id: row.id, v: row.v, f: null };
  const u = unb64(row.b);
  if (u[0] != 1) throw Error('kid');
  const r = JSON.parse(D.decode(await S.decrypt(aes(u.subarray(1, 13), row), key, u.subarray(13))));
  if (r.id !== row.id || r.v !== row.v) throw Error('aad');
  return r;
}

export function createSync({
  db, onStatus = () => {}, base = '/api', nav = globalThis.navigator, now = Date.now,
  fetch: f = (...a) => fetch(...a),
}) {
  let st = {}, keys, keysFor, lastQ, lastEval = -1e9, timer = 0, fails = 0, backoff = 0, halted = 0;
  let chain = Promise.resolve(), held = 0;

  const load = async () => (st = (await db.getMeta(K)) || {});
  const save = () => db.setMeta(K, { ...st });
  const conn = () => nav && nav.connection;
  const online = () => !nav || nav.onLine !== false;
  const getKeys = async (s = st) => {
    const c = encodeKey(s.key);
    if (keysFor !== c) keys = await deriveKeys(s.key), keysFor = c;
    return keys;
  };
  const status = (state, message) => onStatus({
    state, lastPush: st.lastPush || 0, lastPull: st.lastPull || 0,
    backupAgeMs: st.lastPush ? now() - st.lastPush : null, message,
  });

  // One tab syncs at a time. `wait` queues behind the holder; otherwise skip if busy.
  const lock = (fn, wait) => {
    const L = nav && nav.locks;
    if (L) return L.request('lists-sync', wait ? {} : { ifAvailable: true }, (l) => l && fn());
    if (held && !wait) return Promise.resolve();
    const p = chain.then(() => (held = 1, fn())).finally(() => (held = 0));
    return (chain = p.catch(() => {})), p;
  };

  async function post(tok, body, keepalive) {
    let b = E.encode(JSON.stringify(body)), gz = b.length > 1024 && typeof CompressionStream == 'function';
    if (gz) b = new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    if (keepalive && b.length >= KEEPALIVE) return null;
    const headers = { authorization: 'Bearer ' + tok, 'content-type': 'application/json' };
    if (gz) headers['content-encoding'] = 'gzip';
    const r = await f(base + '/sync', {
      method: 'POST', headers, body: b, keepalive, cache: 'no-store', signal: AbortSignal.timeout?.(60e3),
    }).catch((e) => { throw Object.assign(e, { net: 1 }); });
    if (!r.ok) throw Object.assign(Error('HTTP ' + r.status), { status: r.status, retry: +r.headers.get('retry-after') });
    return r.json();
  }

  async function linkQuality() {
    if (!online()) return 'offline';
    const c = conn();
    if (c && (c.type || c.effectiveType)) {
      if (c.type == 'none') return 'offline';
      return !c.saveData && (c.type == 'wifi' || c.type == 'ethernet' || c.effectiveType == '4g' && !(c.rtt > 300)) ? 'good' : 'poor';
    }
    // No Network Information API (Safari, Firefox): time GET /api/health, best of two, cached 30 s.
    if (lastQ && now() - lastQ[1] < 30e3) return lastQ[0];
    let ms = Infinity;
    for (let i = 0; i < 2 && ms > 300; i++) {
      const t = performance.now();
      try {
        const r = await f(base + '/health', { cache: 'no-store' });
        await r.arrayBuffer();
        if (r.ok) ms = Math.min(ms, performance.now() - t);
      } catch { break; }
    }
    return (lastQ = [ms <= 300 ? 'good' : ms < Infinity ? 'poor' : 'offline', now()])[0];
  }

  // Backup-age rule: a backup older than 3 days relaxes "good" to online && !saveData && not 2g.
  const relaxed = (s = st) => {
    const c = conn();
    return now() - (s.lastPush || 0) > BACKUP_AGE && online() && !(c && (c.saveData || /2g/.test(c.effectiveType)));
  };

  // Push the outbox and pull until caught up. Lock held, st loaded and paired. Throws on failure.
  async function run() {
    const { tok, key } = await getKeys();
    let more = 1, bad = 0, big = 0, ok = 0;
    status('syncing');
    try {
      for (let i = 0; i < 100; i++) {
        const out = await db.getOutbox();
        if (i && !more && !out.length) break;
        const push = [], recs = [];
        let size = 0;
        big = 0;
        for (const r of out) {
          const row = await seal(key, r);
          if (row.b && row.b.length > MAX_BLOB) { big++; continue; }
          if (push.length >= MAX_ROWS || (size += (row.b || '').length + 99) > MAX_BYTES) break;
          push.push(row), recs.push(r);
        }
        const res = await post(tok, { dev: st.dev, since: st.cursor || 0, push, ...(st.mk && { create: true }) });
        ok++;
        if (res.reset) { st.cursor = 0, more = 1; await save(); if (db.requeueAll) await db.requeueAll(); continue; }
        const got = [];
        for (const row of res.rows) try { got.push(await unseal(key, row)); } catch { bad++; }
        if (got.length) await db.applyRemote(got);
        if (recs.length) await db.ackOutbox(recs);
        const left = out.length - push.length - big;
        st.cursor = res.cursor, st.mk = 0, more = res.more;
        if (!more) st.lastPull = now();
        if (!left && !big) st.lastPush = now(), st.dirty = 0;
        await save();
        if (!more && !left && !res.rows.length) break;
      }
    } catch (e) {
      e.n = ok, fails++;
      const s = e.status;
      if (s == 401) halted = 1;
      backoff = now() + (s == 429 ? (e.retry || 60) * 1e3 : Math.min(30 * MIN, 15e3 * 2 ** fails));
      status(e.net ? 'offline' : 'error', s == 401 ? 'Sync key not recognised by the server' : s ? 'Server error ' + s : e.net ? 'Network error' : String(e.message || e));
      throw e;
    }
    fails = 0;
    status('idle', bad ? bad + ' rows failed to decrypt' : big ? big + ' items too large to sync' : undefined);
  }

  // The gate (PLAN §5): stale (outbox dirty ≥ 2 min, or last pull ≥ 15 min) and a good link.
  async function gate() {
    await load();
    if (!st.key) return status('unpaired');
    if (!online()) return status('offline');
    const t = now();
    if (halted || t < backoff) return;
    const n = (await db.getOutbox()).length;
    if (!n != !st.dirty) st.dirty = n ? t : 0, await save();
    if (!(n && t - st.dirty >= PUSH_STALE || t - (st.lastPull || 0) >= PULL_STALE)) return;
    if (!relaxed()) {
      const q = await linkQuality();
      if (q != 'good') return status(q == 'poor' ? 'idle' : q, q == 'poor' ? 'Waiting for a good connection' : undefined);
    }
    await run();
  }

  const api = {
    linkQuality,
    /** Cheap to call often (edits, timers, visibility, online, connection change): throttled to one check per 2 s. */
    maybeSync(reason) {
      if (reason == 'online') backoff = 0;
      const wait = lastEval + 2e3 - now();
      if (wait > 0) {
        if (!timer) timer = setTimeout(() => (timer = 0, api.maybeSync(reason)), wait), timer.unref?.();
        return Promise.resolve();
      }
      lastEval = now();
      return lock(gate).catch(() => {});
    },
    /** Manual "Sync now": ignores staleness, link quality and backoff; still needs to be online. Resolves true on success. */
    syncNow: () => lock(async () => {
      await load();
      if (!st.key) return status('unpaired'), false;
      if (!online()) return status('offline'), false;
      halted = 0;
      return await run(), true;
    }, 1).catch(() => false),
    /** First device: make a new 256-bit key (works offline); the vault is created on its first sync. */
    createVault: () => lock(async () => {
      await load();
      if (!st.key) st = { key: rnd(32), dev: 'd_' + hex(rnd(8)), cursor: 0, mk: 1 }, await save(), status('idle');
      return encodeKey(st.key);
    }, 1).then((code) => (api.syncNow(), code)),
    /** Second device: pair with a code and pull the vault. Rejects (and stays as it was) if the code is unknown. */
    join: (code) => lock(async () => {
      const key = decodeKey(code);
      if (!key) throw Error('Invalid pairing code');
      const prev = await load();
      st = { key, dev: 'd_' + hex(rnd(8)), cursor: 0 }, halted = 0, backoff = 0;
      try {
        await run();
      } catch (e) {
        if (e.n) return; // paired and partly synced: the rest follows on the next sync
        st = prev, halted = 0, backoff = 0;
        await save(), status(st.key ? 'idle' : 'unpaired');
        throw Error(e.status == 401 ? 'Unknown pairing code' : 'Could not reach the sync server');
      }
    }, 1),
    /** Forget the key on this device. unpair(true) also erases the server copy first (rejects if that fails). */
    unpair: (erase) => lock(async () => {
      await load();
      if (erase && st.key) {
        const r = await f(base + '/vault', { method: 'DELETE', headers: { authorization: 'Bearer ' + (await getKeys()).tok } });
        if (!r.ok && r.status != 401) throw Error('Could not erase the server copy');
      }
      st = {}, keysFor = keys = 0, halted = 0;
      await save(), status('unpaired');
    }, 1),
    pairingCode: async () => {
      const s = await db.getMeta(K);
      return s && s.key ? encodeKey(s.key) : null;
    },
    /** On visibilitychange:hidden / pagehide: push the outbox with fetch keepalive if the body is < 64 KiB. */
    async flushOnHide() {
      try {
        const s = await db.getMeta(K);
        if (!s || !s.key || !online()) return false;
        const c = conn();
        const go = relaxed(s) || (c && (c.type || c.effectiveType) ? await linkQuality() : lastQ ? lastQ[0] : 'good') == 'good';
        const { tok, key } = await getKeys(s);
        const out = go && await db.getOutbox();
        if (!out || !out.length || out.length > MAX_ROWS) return false;
        const push = await Promise.all(out.map((r) => seal(key, r)));
        const res = await post(tok, { dev: s.dev, since: s.cursor || 0, push, pull: false, ...(s.mk && { create: true }) }, true);
        if (!res || res.reset) return false;
        await db.ackOutbox(out);
        const p = { lastPush: now(), dirty: 0, mk: 0 }, cur = (await db.getMeta(K)) || {};
        if (cur.dev == s.dev) await db.setMeta(K, { ...cur, ...p });
        if (st.dev == s.dev) Object.assign(st, p);
        return true;
      } catch { return false; }
    },
  };
  return api;
}
