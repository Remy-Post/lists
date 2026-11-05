#!/usr/bin/env python3
"""lists-sync: a tiny delta-sync store for Lists. Python stdlib only.

The server never sees plaintext. Each row is (record id, version, opaque blob)
inside a vault, and a vault is addressed by SHA-256(authToken). Protocol and
limits: see server/README.md and docs/research/04-architecture.md §3, §4, §8.
"""
import gzip, hashlib, hmac, io, json, os, re, signal, sqlite3, sys, threading, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

E = os.environ.get
MAX_BODY = 2 << 20        # bytes on the wire (compressed or not) -> 413 above this
MAX_INFL = 8 << 20        # inflated gzip body cap (zip-bomb guard) -> 413
MAX_PUSH = 1000           # rows per push
MAX_BLOB = 90 * 1024      # chars of base64url per row (~64 KB of ciphertext)
PAGE_ROWS = 500           # rows per pull page
PAGE_BYTES = 512 << 10    # approx bytes per pull page
GC_DAYS = 90              # devices unseen this long stop holding back GC
WORKERS = 2               # concurrent POST bodies being processed (bounds peak RAM)
TOKEN = re.compile(r"[0-9a-f]{64}\Z")          # hex(HKDF-SHA256, 256 bit)
DEV = re.compile(r"[A-Za-z0-9_-]{1,64}\Z")

SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS vaults(
  id INTEGER PRIMARY KEY, token_sha256 BLOB NOT NULL UNIQUE,
  horizon INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS changes(
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  vault INTEGER NOT NULL, rid TEXT NOT NULL, ver TEXT NOT NULL,
  dev TEXT NOT NULL, blob TEXT,              -- NULL blob = purge marker
  UNIQUE(vault, rid, ver));
CREATE INDEX IF NOT EXISTS changes_by_seq ON changes(vault, seq);
CREATE INDEX IF NOT EXISTS changes_by_rid ON changes(vault, rid, seq);
CREATE TABLE IF NOT EXISTS devices(
  vault INTEGER NOT NULL, dev TEXT NOT NULL, cursor INTEGER NOT NULL,
  seen INTEGER NOT NULL, PRIMARY KEY(vault, dev));
"""


class Bad(Exception):
    """Client error -> (status, message)."""
    def __init__(self, code, msg, retry=0):
        super().__init__(msg); self.code, self.msg, self.retry = code, msg, retry


class Store:
    """One SQLite connection in WAL mode, serialised by a lock (one user: plenty)."""

    def __init__(self, path):
        self.c = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
        self.c.executescript(SCHEMA)
        self.c.execute("PRAGMA synchronous=NORMAL")
        self.c.execute("PRAGMA cache_size=-2000")      # 2 MB page cache
        self.c.execute("PRAGMA busy_timeout=10000")
        self.lock = threading.Lock()

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

    def vault(self, digest, create=False):
        """-> (id, horizon) or None. Creates the vault when asked to."""
        def run(c):
            row = c.execute("SELECT id, token_sha256, horizon FROM vaults WHERE token_sha256=?",
                            (digest,)).fetchone()
            if row and hmac.compare_digest(row[1], digest):
                return row[0], row[2]
            if not create:
                return None
            cur = c.execute("INSERT INTO vaults(token_sha256, created) VALUES(?,?)", (digest, int(time.time())))
            return cur.lastrowid, 0
        return self.tx(run)

    def sync(self, vid, horizon, dev, since, push, pull):
        def run(c):
            top = c.execute("SELECT seq FROM sqlite_sequence WHERE name='changes'").fetchone()
            if 0 < since < horizon or since > (top[0] if top else 0):
                return {"reset": True}     # slept through a GC, or a cursor from another server
            for rid, ver, blob in push:
                cur = c.execute("INSERT OR IGNORE INTO changes(vault,rid,ver,dev,blob) VALUES(?,?,?,?,?)",
                                (vid, rid, ver, dev, blob))
                if cur.rowcount:           # a new version: drop what it supersedes
                    # purge marker: every older version goes. Otherwise the client had merged
                    # everything up to `since`, so versions at or below it are superseded.
                    lim = cur.lastrowid if blob is None else since + 1
                    c.execute("DELETE FROM changes WHERE vault=? AND rid=? AND seq<?", (vid, rid, lim))
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
            head = c.execute("SELECT COALESCE(MAX(seq),0) FROM changes WHERE vault=?", (vid,)).fetchone()[0]
            cursor = rows[-1]["s"] if more else max(head, since) if pull else since
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
                n = c.execute("DELETE FROM changes WHERE vault=? AND blob IS NULL AND seq<=?",
                              (vid, low)).rowcount
                if n:
                    c.execute("UPDATE vaults SET horizon=MAX(horizon,?) WHERE id=?", (low, vid))
            self.tx(run)

    def close(self):
        with self.lock:
            try:
                self.c.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                self.c.close()


class Limiter:
    """Sliding-window counter per key (client IP). In memory; bounded."""

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


def parse(req):
    """Validate a sync request body -> (dev, since, push, pull, create)."""
    if not isinstance(req, dict): raise Bad(400, "bad request")
    dev, since, push = req.get("dev"), req.get("since", 0), req.get("push", [])
    if not isinstance(dev, str) or not DEV.match(dev): raise Bad(400, "bad dev")
    if type(since) is not int or since < 0: raise Bad(400, "bad since")
    if not isinstance(push, list) or len(push) > MAX_PUSH: raise Bad(400, "bad push")
    out = []
    for r in push:
        if not isinstance(r, dict): raise Bad(400, "bad row")
        rid, ver, b = r.get("id"), r.get("v"), r.get("b")
        if not (isinstance(rid, str) and 0 < len(rid) <= 128 and isinstance(ver, str) and 0 < len(ver) <= 64):
            raise Bad(400, "bad row")
        if b is not None and not (isinstance(b, str) and 0 < len(b) <= MAX_BLOB): raise Bad(400, "bad blob")
        out.append((rid, ver, b))
    return dev, since, out, req.get("pull", True) is not False, req.get("create") is True


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
        # Caddy sets X-Real-IP from the TCP peer (header_up), overwriting anything the client sent.
        return (self.headers.get("X-Real-IP") or self.client_address[0]).strip()[:64]

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

    def token(self, ip):
        """-> sha256(token) or raises 429/401. Failures count against the IP."""
        wait = self.server.fails.wait(ip)
        if wait: raise Bad(429, "slow down", wait)
        h = self.headers.get("Authorization", "")
        tok = h[7:].strip() if h.startswith("Bearer ") else ""
        if not TOKEN.match(tok):
            self.server.fails.hit(ip); raise Bad(401, "unauthorized")
        return hashlib.sha256(tok.encode()).digest()   # 256-bit random token: a fast hash is fine

    def body(self):
        if self.headers.get("Transfer-Encoding"): raise Bad(411, "length required")
        try: n = int(self.headers.get("Content-Length", ""))
        except ValueError: raise Bad(411, "length required")
        if n <= 0: raise Bad(400, "empty body")
        if n > MAX_BODY: raise Bad(413, "too large")
        raw = self.rfile.read(n)
        if len(raw) < n: raise ConnectionError("short body")
        return raw

    def inflate(self, raw):
        enc = (self.headers.get("Content-Encoding") or "identity").strip().lower()
        if enc == "identity": return raw
        if enc != "gzip": raise Bad(415, "unsupported encoding")
        try:
            out = gzip.GzipFile(fileobj=io.BytesIO(raw)).read(MAX_INFL + 1)
        except (OSError, EOFError, ValueError):
            raise Bad(400, "bad gzip")
        if len(out) > MAX_INFL: raise Bad(413, "too large")
        return out

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
        raw = self.body()
        if not srv.workers.acquire(timeout=10): raise Bad(503, "busy")
        try:
            raw = self.inflate(raw)
            try: req = json.loads(raw)
            except ValueError: raise Bad(400, "bad json")
            del raw
            dev, since, push, pull, create = parse(req)
            del req
            who = srv.store.vault(digest)
            if not who:
                if not create:                  # unknown vault (typo'd pairing code, or erased)
                    srv.fails.hit(ip); raise Bad(401, "unauthorized")
                wait = srv.news.wait(ip)
                if wait: raise Bad(429, "slow down", wait)
                srv.news.hit(ip)
                who = srv.store.vault(digest, create=True)
            out = srv.store.sync(who[0], who[1], dev, since, push, pull)
        finally:
            srv.workers.release()
        self.reply(200, out)

    def delete(self):
        if self.route() != "/api/vault": return self.reply(404, {"error": "not found"}, close=True)
        ip, srv = self.ip(), self.server
        digest = self.token(ip)
        if self.headers.get("Content-Length", "0") != "0": self.body()   # drain and ignore
        who = srv.store.vault(digest)
        if not who:
            srv.fails.hit(ip); raise Bad(401, "unauthorized")
        srv.store.wipe(who[0])
        self.reply(200, {"ok": True})

    def log_message(self, fmt, *args):     # Caddy already logs requests
        pass


class Server(ThreadingHTTPServer):
    daemon_threads = True

    def handle_error(self, request, client_address):
        if not isinstance(sys.exc_info()[1], OSError):      # resets and timeouts are routine
            super().handle_error(request, client_address)


def make_server(db_path, host="0.0.0.0", port=8787, fail_max=10, new_max=5):
    srv = Server((host, port), Handler)
    srv.store = Store(db_path)
    srv.fails = Limiter(fail_max, 600)         # bad/unknown tokens: N per IP per 10 min, then 429
    srv.news = Limiter(new_max, 3600)          # new vaults: N per IP per hour, then 429
    srv.workers = threading.BoundedSemaphore(WORKERS)
    srv.active, srv.active_lock = 0, threading.Lock()
    return srv


def main():
    srv = make_server(E("LISTS_DB", "/data/lists.db"), E("LISTS_HOST", "0.0.0.0"), int(E("LISTS_PORT", "8787")),
                      int(E("LISTS_FAIL_MAX", "10")), int(E("LISTS_NEW_VAULTS", "5")))
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
