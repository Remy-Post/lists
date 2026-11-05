#!/usr/bin/env python3
"""lists-sync: a tiny delta-sync store for Lists. Python stdlib only.

The server never sees plaintext. Each row is (record id, version, opaque blob)
inside a vault, and a vault is addressed by SHA-256(authToken). Protocol and
limits: see server/README.md and docs/research/04-architecture.md §3, §4, §8.
"""
import contextlib, hashlib, ipaddress, json, os, re, signal, socket, sqlite3, sys, threading, time, zlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

E = os.environ.get
MAX_BODY = 512 << 10      # bytes on the wire per request -> 413 (the client sends <= ~260 KB)
MAX_INFL = 2 << 20        # inflated body cap for a known vault -> 413
ANON_INFL = 1 << 20       # inflated body cap for an unknown token (maybe a first sync) -> 401
BODY_SECS = 15            # whole-body read deadline, so a trickled upload gives its slot back
BODIES = 2                # known-vault requests holding a body at once (bounds peak RAM)
ANON_BODIES = 1           # unknown-token requests holding a body at once
SLOT_WAIT = 2             # seconds to wait for a body slot, then 503 + Retry-After
MAX_CONN = 64             # open connections (one thread each); more are dropped at accept
MAX_PUSH = 1000           # rows per push
MAX_BLOB = 90 * 1024      # chars of base64url per row (~64 KB of ciphertext)
MAX_COMMAS = 20 * MAX_PUSH  # bounds the JSON value count, so parsing can't amplify memory
PAGE_ROWS = 500           # rows per pull page
PAGE_BYTES = 512 << 10    # approx bytes per pull page
GC_DAYS = 90              # devices unseen this long stop holding back GC
TOKEN = re.compile(r"[0-9a-f]{64}\Z")          # hex(HKDF-SHA256, 256 bit)
DEV = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")
B64 = re.compile(r"[A-Za-z0-9_-]+\Z")           # base64url, unpadded
ROW_COST = 48                                   # per-row overhead counted against the quota
COST = f"length(rid)+length(ver)+length(dev)+COALESCE(length(blob),0)+{ROW_COST}"
VERSION = 2                                     # PRAGMA user_version

CHANGES = """CREATE TABLE {name}(
  vault INTEGER NOT NULL, seq INTEGER NOT NULL,  -- seq is per vault: no signal across vaults
  rid TEXT NOT NULL, ver TEXT NOT NULL,
  dev TEXT NOT NULL, blob TEXT,                  -- NULL blob = purge marker
  UNIQUE(vault, seq), UNIQUE(vault, rid, ver))"""
SCHEMA = f"""
CREATE TABLE IF NOT EXISTS vaults(
  id INTEGER PRIMARY KEY, token_sha256 BLOB NOT NULL UNIQUE,
  horizon INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL,
  next_seq INTEGER NOT NULL DEFAULT 1, nrows INTEGER NOT NULL DEFAULT 0, nbytes INTEGER NOT NULL DEFAULT 0);
{CHANGES.format(name="IF NOT EXISTS changes")};
CREATE INDEX IF NOT EXISTS changes_by_rid ON changes(vault, rid, seq);
CREATE TABLE IF NOT EXISTS devices(
  vault INTEGER NOT NULL, dev TEXT NOT NULL, cursor INTEGER NOT NULL,
  seen INTEGER NOT NULL, PRIMARY KEY(vault, dev));
PRAGMA user_version={VERSION};
"""


class Bad(Exception):
    """Client error -> (status, message)."""
    def __init__(self, code, msg, retry=0):
        super().__init__(msg); self.code, self.msg, self.retry = code, msg, retry


def cost(rid, ver, dev, blob):
    return len(rid) + len(ver) + len(dev) + len(blob or "") + ROW_COST


class Store:
    """One SQLite connection in WAL mode, serialised by a lock (one user: plenty)."""

    def __init__(self, path, vault_bytes=50 << 20, vault_rows=100_000, db_max=500 << 20):
        self.max_bytes, self.max_rows, self.db_max = vault_bytes, vault_rows, db_max
        self.c = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
        self.c.execute("PRAGMA journal_mode=WAL")
        self.c.execute("PRAGMA synchronous=NORMAL")
        self.c.execute("PRAGMA cache_size=-2000")      # 2 MB page cache
        self.c.execute("PRAGMA busy_timeout=10000")
        self.lock = threading.Lock()
        ver = self.c.execute("PRAGMA user_version").fetchone()[0]
        if ver < VERSION and self.c.execute("SELECT 1 FROM sqlite_master WHERE name='changes'").fetchone():
            self.migrate_v1()
        self.c.executescript(SCHEMA)

    def migrate_v1(self):
        """v1 had one AUTOINCREMENT seq shared by every vault. Renumber per vault, keeping every row.

        New seqs start above every v1 seq, and the horizon sits at that boundary, so any cursor a
        client still holds (0 < since <= old top) gets {reset: true} and re-pulls from 0; since=0
        pulls normally and lands at or above the horizon. Quota counters are filled in.
        """
        c = self.c
        c.execute("BEGIN IMMEDIATE")
        try:
            top = c.execute("SELECT COALESCE(MAX(seq),0) FROM changes").fetchone()[0]
            if c.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone():
                top = max(top, c.execute("SELECT COALESCE(MAX(seq),0) FROM sqlite_sequence "
                                         "WHERE name='changes'").fetchone()[0])
            base = top + 1
            cols = {r[1] for r in c.execute("PRAGMA table_info(vaults)")}
            for col in ("next_seq INTEGER NOT NULL DEFAULT 1", "nrows INTEGER NOT NULL DEFAULT 0",
                        "nbytes INTEGER NOT NULL DEFAULT 0"):
                if col.split()[0] not in cols:
                    c.execute(f"ALTER TABLE vaults ADD COLUMN {col}")
            c.execute(CHANGES.format(name="changes_v2"))
            c.execute("INSERT INTO changes_v2(vault,seq,rid,ver,dev,blob) SELECT vault, "
                      "?+ROW_NUMBER() OVER (PARTITION BY vault ORDER BY seq), rid, ver, dev, blob "
                      "FROM changes WHERE vault IN (SELECT id FROM vaults)", (base,))
            c.execute("DROP TABLE changes")
            if c.execute("SELECT 1 FROM sqlite_master WHERE name='sqlite_sequence'").fetchone():
                c.execute("DELETE FROM sqlite_sequence WHERE name='changes'")
            c.execute("ALTER TABLE changes_v2 RENAME TO changes")
            c.execute("CREATE INDEX changes_by_rid ON changes(vault, rid, seq)")
            c.execute(f"""UPDATE vaults SET horizon=?,
                nrows=(SELECT COUNT(*) FROM changes WHERE vault=vaults.id),
                nbytes=(SELECT COALESCE(SUM({COST}),0) FROM changes WHERE vault=vaults.id),
                next_seq=?+1+(SELECT COUNT(*) FROM changes WHERE vault=vaults.id)""", (base, base))
            c.execute("UPDATE devices SET cursor=0")       # v1 positions mean nothing now
            c.execute(f"PRAGMA user_version={VERSION}")
        except BaseException:
            c.execute("ROLLBACK"); raise
        c.execute("COMMIT")
        n = c.execute("SELECT COUNT(*), (SELECT COUNT(*) FROM vaults) FROM changes").fetchone()
        print(f"lists-sync: migrated to per-vault seq ({n[0]} rows, {n[1]} vaults, base {base})", file=sys.stderr, flush=True)

    def tx(self, fn):
        with self.lock:
            self.c.execute("BEGIN IMMEDIATE")
            try:
                out = fn(self.c)
            except BaseException:
                self.c.execute("ROLLBACK"); raise
            self.c.execute("COMMIT")
            return out

    def ping(self):
        with self.lock:
            self.c.execute("SELECT 1").fetchone()

    def lookup(self, digest):
        """-> vault id or None. A plain indexed read: no body has been read yet."""
        with self.lock:
            row = self.c.execute("SELECT id FROM vaults WHERE token_sha256=?", (digest,)).fetchone()
        return row[0] if row else None

    def used(self, c):
        """Bytes of the database actually in use (free pages are reused, so they don't count)."""
        n = c.execute("PRAGMA page_count").fetchone()[0] - c.execute("PRAGMA freelist_count").fetchone()[0]
        return n * c.execute("PRAGMA page_size").fetchone()[0]

    def create(self, digest):
        def run(c):
            row = c.execute("SELECT id FROM vaults WHERE token_sha256=?", (digest,)).fetchone()
            if row: return row[0]                 # a concurrent first sync won the race
            if self.used(c) > self.db_max: raise Bad(507, "server full")
            return c.execute("INSERT INTO vaults(token_sha256, created) VALUES(?,?)",
                             (digest, int(time.time()))).lastrowid
        return self.tx(run)

    def sync(self, vid, dev, since, push, pull):
        def run(c):
            row = c.execute("SELECT horizon, next_seq, nrows, nbytes FROM vaults WHERE id=?", (vid,)).fetchone()
            if not row: raise Bad(401, "unauthorized")    # erased while this request waited
            horizon, nxt, nrows, nbytes = row
            if 0 < since < horizon or since >= nxt:
                return {"reset": True}     # slept through a GC, or a cursor this vault never issued
            if push and self.used(c) > self.db_max: raise Bad(507, "server full")
            first, r0, b0 = nxt, nrows, nbytes
            for rid, ver, blob in push:
                cur = c.execute("INSERT OR IGNORE INTO changes(vault,seq,rid,ver,dev,blob) VALUES(?,?,?,?,?,?)",
                                (vid, nxt, rid, ver, dev, blob))
                if not cur.rowcount: continue       # a retry: already stored
                nrows, nbytes = nrows + 1, nbytes + cost(rid, ver, dev, blob)
                # A new version drops what it supersedes. Purge marker: every older version goes.
                # Otherwise the client had merged everything up to `since`, so versions at or below it go.
                lim = nxt if blob is None else since + 1
                nxt += 1
                n, b = c.execute(f"SELECT COUNT(*), COALESCE(SUM({COST}),0) FROM changes "
                                 "WHERE vault=? AND rid=? AND seq<?", (vid, rid, lim)).fetchone()
                if n:
                    c.execute("DELETE FROM changes WHERE vault=? AND rid=? AND seq<?", (vid, rid, lim))
                    nrows, nbytes = nrows - n, nbytes - b
            if nxt != first:
                # Over quota only refuses pushes that grow the vault; compaction still goes through.
                if nrows > self.max_rows and nrows > r0 or nbytes > self.max_bytes and nbytes > b0:
                    raise Bad(507, "vault full")    # rolls the whole push back
                c.execute("UPDATE vaults SET next_seq=?, nrows=?, nbytes=? WHERE id=?", (nxt, nrows, nbytes, vid))
            rows, size, more = [], 0, False
            if pull:
                q = c.execute("SELECT seq, rid, ver, blob FROM changes WHERE vault=? AND seq>? AND dev<>? "
                              "ORDER BY seq LIMIT ?", (vid, since, dev, PAGE_ROWS + 1))
                for seq, rid, ver, blob in q:
                    if len(rows) == PAGE_ROWS or size >= PAGE_BYTES:
                        more = True; break
                    rows.append({"s": seq, "id": rid, "v": ver, "b": blob})
                    size += len(rid) + len(ver) + len(blob or "") + 40
                q.close()
            head = nxt - 1
            cursor = rows[-1]["s"] if more else head if pull else since
            # The device has applied everything up to `since` (what it asks from), so that is
            # its confirmed position for GC, not the cursor we are about to hand it.
            c.execute("INSERT INTO devices VALUES(?,?,?,?) ON CONFLICT(vault,dev) DO UPDATE "
                      "SET cursor=excluded.cursor, seen=excluded.seen", (vid, dev, since, int(time.time())))
            return {"rows": rows, "cursor": cursor, "more": more, "head": head}
        return self.tx(run)

    def wipe(self, vid):
        def run(c):
            for t in ("changes", "devices"):
                c.execute(f"DELETE FROM {t} WHERE vault=?", (vid,))
            c.execute("DELETE FROM vaults WHERE id=?", (vid,))
        self.tx(run)

    def gc(self, now=None):
        """Drop purge markers every recently seen device has pulled; raise the horizon."""
        cutoff = int(now or time.time()) - GC_DAYS * 86400
        with self.lock:
            vaults = [v for (v,) in self.c.execute("SELECT id FROM vaults").fetchall()]
        for vid in vaults:
            def run(c):
                low = c.execute("SELECT MIN(cursor) FROM devices WHERE vault=? AND seen>?",
                                (vid, cutoff)).fetchone()[0]
                if low is None:
                    return
                n, b = c.execute(f"SELECT COUNT(*), COALESCE(SUM({COST}),0) FROM changes "
                                 "WHERE vault=? AND blob IS NULL AND seq<=?", (vid, low)).fetchone()
                if n:
                    c.execute("DELETE FROM changes WHERE vault=? AND blob IS NULL AND seq<=?", (vid, low))
                    c.execute("UPDATE vaults SET horizon=MAX(horizon,?), nrows=nrows-?, nbytes=nbytes-? "
                              "WHERE id=?", (low, n, b, vid))
            self.tx(run)

    def close(self):
        with self.lock:
            try:
                self.c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                self.c.close()


class Limiter:
    """Sliding-window counter per key (client IP or vault). In memory; bounded."""

    def __init__(self, n, window):
        self.n, self.win, self.h, self.l = n, window, {}, threading.Lock()

    def wait(self, k):
        """Seconds until k may act again (0 = allowed now)."""
        now = time.monotonic()
        with self.l:
            q = [t for t in self.h.get(k, ()) if now - t < self.win]
            if q: self.h[k] = q
            else: self.h.pop(k, None)
            return 0 if len(q) < self.n else int(q[0] + self.win - now) + 1

    def hit(self, k):
        with self.l:
            if len(self.h) > 10000: self.h.clear()      # crude bound on memory
            self.h.setdefault(k, []).append(time.monotonic())


class Proxies:
    """Peers whose X-Real-IP is believed. LISTS_TRUSTED_PROXIES: comma-separated IPs, CIDRs or
    hostnames (a container name such as n8n-caddy-1, re-resolved every 60 s). Empty = trust none."""

    def __init__(self, spec):
        self.nets, self.names = [], []
        for s in (x.strip() for x in (spec or "").split(",")):
            if not s: continue
            try: self.nets.append(ipaddress.ip_network(s, strict=False))
            except ValueError: self.names.append(s)
        self.ips, self.at, self.l = frozenset(), -1e9, threading.Lock()

    def resolved(self):
        with self.l:
            if self.names and time.monotonic() - self.at > 60:
                ips = set()
                for n in self.names:
                    try: ips.update(ipaddress.ip_address(a[4][0]) for a in socket.getaddrinfo(n, None))
                    except (OSError, ValueError): pass
                self.ips, self.at = frozenset(ips), time.monotonic()
            return self.ips

    def __contains__(self, peer):
        try: a = ipaddress.ip_address(peer)
        except ValueError: return False
        return any(a in n for n in self.nets) or a in self.resolved()


def parse(req):
    """Validate a sync request body -> (dev, since, push, pull, create)."""
    if not isinstance(req, dict): raise Bad(400, "bad request")
    dev, since, push = req.get("dev"), req.get("since", 0), req.get("push", [])
    if not isinstance(dev, str) or not DEV.match(dev): raise Bad(400, "bad dev")
    if type(since) is not int or not 0 <= since < 1 << 62: raise Bad(400, "bad since")
    if not isinstance(push, list) or len(push) > MAX_PUSH: raise Bad(400, "bad push")
    out = []
    for r in push:
        if not isinstance(r, dict): raise Bad(400, "bad row")
        rid, ver, b = r.get("id"), r.get("v"), r.get("b")
        if not (isinstance(rid, str) and 0 < len(rid) <= 128 and isinstance(ver, str) and 0 < len(ver) <= 64):
            raise Bad(400, "bad row")
        if b is not None and not (isinstance(b, str) and 0 < len(b) <= MAX_BLOB and B64.match(b)):
            raise Bad(400, "bad blob")
        out.append((rid, ver, b))
    return dev, since, out, req.get("pull", True) is not False, req.get("create") is True


@contextlib.contextmanager
def slot(sem):
    """Hold one of a bounded number of body slots; never queue for long."""
    if not sem.acquire(timeout=SLOT_WAIT): raise Bad(503, "busy", 2)
    try: yield
    finally: sem.release()


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"
    sys_version = ""
    timeout = 20                                   # per-socket-read; stops slow clients pinning threads

    def reply(self, code, obj, close=False, retry=0):
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if retry: self.send_header("Retry-After", str(retry))
        if close:
            self.send_header("Connection", "close"); self.close_connection = True
        self.end_headers()
        if self.command != "HEAD": self.wfile.write(body)

    def version_string(self):
        return "lists-sync"

    def ip(self):
        """Rate-limit key. X-Real-IP only from a trusted proxy (Caddy sets it from the TCP peer);
        IPv6 clients are grouped by /64, since one host usually holds the whole prefix."""
        peer, real = self.client_address[0], self.headers.get("X-Real-IP")
        a = None
        if real and peer in self.server.proxies:
            try: a = ipaddress.ip_address(real.strip())
            except ValueError: pass
        if a is None:
            try: a = ipaddress.ip_address(peer)
            except ValueError: return peer[:64]
        return str(ipaddress.ip_network(f"{a}/64", strict=False)) if a.version == 6 else str(a)

    def route(self):
        return self.path.split("?", 1)[0]

    def guarded(self, fn):
        srv = self.server
        with srv.active_lock: srv.active += 1
        try:
            fn()
        except Bad as e:
            self.reply(e.code, {"error": e.msg}, close=True, retry=e.retry)
        except (TimeoutError, ConnectionError):
            self.close_connection = True
        except Exception as e:                      # never leak a traceback to the client
            print(f"lists-sync: {type(e).__name__}: {e}", file=sys.stderr, flush=True)
            try: self.reply(500, {"error": "internal"}, close=True)
            except Exception: self.close_connection = True
        finally:
            with srv.active_lock: srv.active -= 1

    def throttled(self, ip):
        wait = self.server.fails.wait(ip)
        if wait: raise Bad(429, "slow down", wait)

    def fail(self, ip):
        self.server.fails.hit(ip)
        raise Bad(401, "unauthorized")

    def token(self, ip):
        """-> sha256(token). A malformed token is a failure: throttled per IP, then 401."""
        h = self.headers.get("Authorization", "")
        tok = h[7:].strip() if h.startswith("Bearer ") else ""
        if not TOKEN.match(tok):
            self.throttled(ip); self.fail(ip)
        return hashlib.sha256(tok.encode()).digest()   # 256-bit random token: a fast hash is fine

    def body(self):
        """Read the whole body (<= MAX_BODY) within BODY_SECS. Call only while holding a slot."""
        if self.headers.get("Transfer-Encoding"): raise Bad(411, "length required")
        try: n = int(self.headers.get("Content-Length", ""))
        except ValueError: raise Bad(411, "length required")
        if n <= 0: raise Bad(400, "empty body")
        if n > MAX_BODY: raise Bad(413, "too large")
        buf, end = bytearray(), time.monotonic() + BODY_SECS
        while len(buf) < n:
            left = end - time.monotonic()
            if left <= 0: raise TimeoutError("slow body")
            self.connection.settimeout(min(left, self.timeout))
            chunk = self.rfile.read1(min(65536, n - len(buf)))
            if not chunk: raise ConnectionError("short body")
            buf += chunk
        self.connection.settimeout(self.timeout)
        return buf

    def inflate(self, raw, cap):
        enc = (self.headers.get("Content-Encoding") or "identity").strip().lower()
        if enc == "identity": return raw
        if enc != "gzip": raise Bad(415, "unsupported encoding")
        d = zlib.decompressobj(wbits=31)               # gzip framing; stops after cap+1 bytes out
        try: out = d.decompress(raw, cap + 1)
        except zlib.error: raise Bad(400, "bad gzip")
        if len(out) > cap: raise Bad(413, "too large")
        if not d.eof: raise Bad(400, "bad gzip")       # truncated
        return out

    def read_json(self, cap):
        raw = self.inflate(self.body(), cap)
        if raw.count(b",") > MAX_COMMAS: raise Bad(400, "bad request")
        try: return json.loads(raw)
        except (ValueError, RecursionError): raise Bad(400, "bad json")

    # --- endpoints ---
    def do_GET(self): self.guarded(self.get)
    def do_HEAD(self): self.guarded(self.get)
    def do_POST(self): self.guarded(self.post)
    def do_DELETE(self): self.guarded(self.delete)
    def do_PUT(self): self.reply(405, {"error": "method not allowed"}, close=True)
    do_PATCH = do_OPTIONS = do_PUT

    def get(self):
        if self.route() != "/api/health": return self.reply(404, {"error": "not found"})
        self.server.store.ping()
        self.reply(200, {"ok": True})

    def post(self):
        if self.route() != "/api/sync": return self.reply(404, {"error": "not found"}, close=True)
        ip, srv = self.ip(), self.server
        digest = self.token(ip)
        vid = srv.store.lookup(digest)            # before any byte of the body is read
        if vid is not None:
            # A known vault is served whatever the IP's failure count (a 256-bit token can't be
            # guessed), but each vault gets a request budget of its own.
            wait = srv.vrate.wait(vid)
            if wait: raise Bad(429, "slow down", wait)
            srv.vrate.hit(vid)
            with slot(srv.bodies):
                dev, since, push, pull, _ = parse(self.read_json(MAX_INFL))
                self.reply(200, srv.store.sync(vid, dev, since, push, pull))
            return
        # Unknown token: only a first sync ("create": true) from an IP with quota left gets a
        # body read at all, into a single small slot. Anything else is a failure and a 401.
        self.throttled(ip)
        wait = srv.news.wait(ip)
        if wait: raise Bad(429, "slow down", wait)
        with slot(srv.anon):
            try:
                dev, since, push, pull, create = parse(self.read_json(ANON_INFL))
            except Bad:
                create = False
            except (TimeoutError, ConnectionError):
                srv.fails.hit(ip); raise
            if not create: self.fail(ip)
            srv.news.hit(ip)
            vid = srv.store.create(digest)
            srv.vrate.hit(vid)
            self.reply(200, srv.store.sync(vid, dev, since, push, pull))

    def delete(self):
        if self.route() != "/api/vault": return self.reply(404, {"error": "not found"}, close=True)
        ip, srv = self.ip(), self.server
        digest = self.token(ip)
        vid = srv.store.lookup(digest)
        if vid is None:
            self.throttled(ip); self.fail(ip)
        srv.store.wipe(vid)
        # The body (the client sends none) is never read; close so it can't parse as a request.
        self.reply(200, {"ok": True}, close=self.headers.get("Content-Length", "0") != "0")

    def log_message(self, fmt, *args):     # Caddy already logs requests
        pass


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def process_request(self, request, client_address):
        if not self.conns.acquire(blocking=False):      # bounds threads, and so memory
            self.shutdown_request(request); return
        try: super().process_request(request, client_address)
        except BaseException: self.conns.release(); raise

    def process_request_thread(self, request, client_address):
        try: super().process_request_thread(request, client_address)
        finally: self.conns.release()

    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], OSError):      # resets and timeouts are routine
            super().handle_error(request, client_address)


def make_server(db_path, host="0.0.0.0", port=8787, fail_max=10, new_max=5, vault_rpm=60,
                vault_bytes=50 << 20, vault_rows=100_000, db_max=500 << 20, proxies=""):
    srv = Server((host, port), Handler)
    srv.store = Store(db_path, vault_bytes, vault_rows, db_max)
    srv.fails = Limiter(fail_max, 600)         # bad/unknown tokens: N per IP per 10 min, then 429
    srv.news = Limiter(new_max, 3600)          # new vaults: N per IP per hour, then 429
    srv.vrate = Limiter(vault_rpm, 60)         # requests per vault per minute, then 429
    srv.proxies = Proxies(proxies)
    srv.bodies = threading.BoundedSemaphore(BODIES)
    srv.anon = threading.BoundedSemaphore(ANON_BODIES)
    srv.conns = threading.BoundedSemaphore(MAX_CONN)
    srv.active, srv.active_lock = 0, threading.Lock()
    return srv


def main():
    n = lambda k, d: int(E(k, str(d)))
    srv = make_server(E("LISTS_DB", "/data/lists.db"), E("LISTS_HOST", "0.0.0.0"), n("LISTS_PORT", 8787),
                      n("LISTS_FAIL_MAX", 10), n("LISTS_NEW_VAULTS", 5), n("LISTS_VAULT_RPM", 60),
                      n("LISTS_VAULT_MB", 50) << 20, n("LISTS_VAULT_ROWS", 100_000), n("LISTS_DB_MAX_MB", 500) << 20,
                      E("LISTS_TRUSTED_PROXIES", ""))
    stop = threading.Event()

    def term(*_):
        stop.set(); threading.Thread(target=srv.shutdown, daemon=True).start()
    signal.signal(signal.SIGTERM, term); signal.signal(signal.SIGINT, term)

    def gc_loop():
        while not stop.wait(3600):
            try: srv.store.gc()
            except Exception as e: print(f"lists-sync gc: {e}", file=sys.stderr, flush=True)
    threading.Thread(target=gc_loop, daemon=True).start()

    print(f"lists-sync listening on {srv.server_address[0]}:{srv.server_address[1]}", flush=True)
    srv.serve_forever(poll_interval=0.5)
    srv.server_close()
    deadline = time.monotonic() + 5            # let in-flight requests finish (docker stop gives 10 s)
    while srv.active and time.monotonic() < deadline:
        time.sleep(0.05)
    srv.store.close()
    print("lists-sync stopped", flush=True)


if __name__ == "__main__":
    main()
