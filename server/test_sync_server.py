#!/usr/bin/env python3
"""Unit tests for sync_server.py. Run: python3 -m unittest server/test_sync_server.py -v"""
import gzip, hashlib, http.client, json, os, secrets, signal, socket, sqlite3, subprocess, sys, tempfile, threading, time, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_server as S


def tok():
    return secrets.token_hex(32)


def rss_mb(pid):
    try:
        with open(f"/proc/{pid}/status") as f:
            for line in f:
                if line.startswith("VmRSS:"): return int(line.split()[1]) / 1024
    except OSError:
        return 0


class Base(unittest.TestCase):
    opts = {}

    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.dir.name, "t.db")
        kw = dict(fail_max=10, new_max=5, vault_rpm=10000, proxies="127.0.0.1")
        kw.update(self.opts)
        self.srv = S.make_server(self.db, "127.0.0.1", 0, **kw)
        self.port = self.srv.server_address[1]
        self.t = threading.Thread(target=self.srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True)
        self.t.start()
        self.ip = 0

    def tearDown(self):
        self.srv.shutdown(); self.srv.server_close(); self.srv.store.close(); self.dir.cleanup()

    def req(self, method, path, body=None, token=None, headers=None, ip="10.0.0.1"):
        c = http.client.HTTPConnection("127.0.0.1", self.port, timeout=10)
        h = {"X-Real-IP": ip}
        if token: h["Authorization"] = "Bearer " + token
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode(); h["Content-Type"] = "application/json"
        h.update(headers or {})
        c.request(method, path, body=body, headers=h)
        r = c.getresponse()
        data = r.read()
        c.close()
        return r.status, (json.loads(data) if data else None), r

    def sync(self, token, dev, since=0, push=(), create=True, **kw):
        body = {"dev": dev, "since": since, "push": list(push), "create": create, **kw}
        code, js, _ = self.req("POST", "/api/sync", body, token)
        self.assertEqual(code, 200, js)
        return js

    def raw(self, data, timeout=5):
        with socket.create_connection(("127.0.0.1", self.port), timeout=timeout) as s:
            s.sendall(data)
            return int(s.recv(4096).split(b" ")[1])

    def accounted(self):
        """The per-vault quota counters must match the rows actually stored."""
        c = sqlite3.connect(self.db)
        try:
            for vid, n, b in c.execute("SELECT id, nrows, nbytes FROM vaults").fetchall():
                real = c.execute(f"SELECT COUNT(*), COALESCE(SUM({S.COST}),0) FROM changes WHERE vault=?",
                                 (vid,)).fetchone()
                self.assertEqual((n, b), real)
        finally:
            c.close()

    def count(self, rid=None):
        c = sqlite3.connect(self.db)
        try:
            if rid: return c.execute("SELECT COUNT(*) FROM changes WHERE rid=?", (rid,)).fetchone()[0]
            return c.execute("SELECT COUNT(*) FROM changes").fetchone()[0]
        finally:
            c.close()


def row(rid, ver, b="QUJD"):
    return {"id": rid, "v": ver, "b": b}


class Basics(Base):
    def test_health_and_headers(self):
        code, js, r = self.req("GET", "/api/health")
        self.assertEqual((code, js), (200, {"ok": True}))
        self.assertEqual(r.getheader("Cache-Control"), "no-store")
        self.assertEqual(r.getheader("Content-Type"), "application/json")
        self.assertEqual(r.getheader("X-Content-Type-Options"), "nosniff")
        self.assertEqual(r.getheader("Server"), "lists-sync")
        self.assertEqual(self.req("GET", "/nope")[0], 404)
        self.assertEqual(self.req("PUT", "/api/sync", b"x")[0], 405)

    def test_first_sync_creates_vault(self):
        t = tok()
        js = self.sync(t, "a", push=[row("r1", "v1")])
        self.assertEqual(js["rows"], [])
        self.assertFalse(js["more"])
        self.assertEqual(js["cursor"], js["head"])
        c = sqlite3.connect(self.db)
        stored = c.execute("SELECT token_sha256 FROM vaults").fetchall()
        c.close()
        self.assertEqual(stored, [(hashlib.sha256(t.encode()).digest(),)])   # only the hash is stored

    def test_join_unknown_vault_is_401_and_creates_nothing(self):
        code, js, _ = self.req("POST", "/api/sync", {"dev": "b", "since": 0, "push": []}, tok())
        self.assertEqual((code, js), (401, {"error": "unauthorized"}))
        self.assertEqual(self.count(), 0)


class Protocol(Base):
    def test_idempotent_retry(self):
        t = tok()
        p = [row("r1", "v1"), row("r2", "v1")]
        a = self.sync(t, "a", push=p)
        b = self.sync(t, "a", push=p)        # the same request retried
        self.assertEqual(self.count(), 2)
        self.assertEqual(a["head"], b["head"])

    def test_no_echo(self):
        t = tok()
        self.sync(t, "a", push=[row("r1", "v1")])
        self.assertEqual(self.sync(t, "a")["rows"], [])
        rows = self.sync(t, "b")["rows"]
        self.assertEqual([(r["id"], r["v"], r["b"]) for r in rows], [("r1", "v1", "QUJD")])

    def test_compaction_after_merge(self):
        t = tok()
        self.sync(t, "a", push=[row("r1", "v1")])
        cur = self.sync(t, "b")["cursor"]                   # b has merged v1
        self.sync(t, "b", since=cur, push=[row("r1", "v2")])
        self.assertEqual(self.count("r1"), 1)                # v1 superseded and dropped
        rows = self.sync(t, "a", since=0)["rows"]
        self.assertEqual([r["v"] for r in rows], ["v2"])
        self.accounted()

    def test_two_device_interleaving(self):
        t = tok()
        a = self.sync(t, "a", push=[row("r1", "a1")])["cursor"]
        b = self.sync(t, "b", since=0, push=[row("r1", "b1")], pull=False)["cursor"]
        self.assertEqual(b, 0)
        self.assertEqual(self.count("r1"), 2)                # concurrent: b had not seen a1, both kept
        ra = self.sync(t, "a", since=a)
        self.assertEqual([r["v"] for r in ra["rows"]], ["b1"])
        # a merges a1+b1 into a2 and pushes with its new cursor: both older rows are now superseded
        self.sync(t, "a", since=ra["cursor"], push=[row("r1", "a2")])
        self.assertEqual(self.count("r1"), 1)
        rb = self.sync(t, "b", since=0)
        self.assertEqual([r["v"] for r in rb["rows"]], ["a2"])
        # b, now caught up, sees nothing new
        self.assertEqual(self.sync(t, "b", since=rb["cursor"])["rows"], [])

    def test_unrelated_vaults_isolated(self):
        t1, t2 = tok(), tok()
        self.sync(t1, "a", push=[row("r1", "v1")])
        self.assertEqual(self.sync(t2, "b")["rows"], [])

    def test_paging_rows(self):
        t = tok()
        for k in range(3):    # 1200 rows in three pushes (max 1000 per push)
            self.sync(t, "a", push=[row(f"r{k}-{i}", "v1") for i in range(400)])
        got, since, pages = [], 0, []
        while True:
            js = self.sync(t, "b", since=since)
            got += js["rows"]; since = js["cursor"]; pages.append((len(js["rows"]), js["more"]))
            if not js["more"]: break
        self.assertEqual(pages, [(500, True), (500, True), (200, False)])
        self.assertEqual(len({r["id"] for r in got}), 1200)
        self.assertEqual(since, js["head"])

    def test_exact_page_is_not_more(self):
        t = tok()
        self.sync(t, "a", push=[row(f"r{i}", "v1") for i in range(500)])
        js = self.sync(t, "b")
        self.assertEqual((len(js["rows"]), js["more"]), (500, False))

    def test_paging_bytes(self):
        t = tok()
        big = "A" * (80 * 1024)
        for i in range(10):
            self.sync(t, "a", push=[row(f"r{i}", "v1", big)])
        js = self.sync(t, "b")
        self.assertTrue(js["more"])
        self.assertTrue(6 <= len(js["rows"]) <= 7, len(js["rows"]))
        js2 = self.sync(t, "b", since=js["cursor"])
        self.assertEqual(len(js["rows"]) + len(js2["rows"]), 10)
        self.assertFalse(js2["more"])

    def test_purge_marker(self):
        t = tok()
        self.sync(t, "a", push=[row("r1", "v1")])
        self.sync(t, "b", since=0, push=[row("r1", "v2")], pull=False)
        self.sync(t, "a", since=0, push=[{"id": "r1", "v": "v3", "b": None}], pull=False)
        self.assertEqual(self.count("r1"), 1)                # every older version dropped
        rows = self.sync(t, "b")["rows"]
        self.assertEqual([(r["v"], r["b"]) for r in rows], [("v3", None)])
        self.accounted()

    def test_gc_horizon_reset(self):
        t = tok()
        self.sync(t, "a", push=[{"id": "r1", "v": "v1", "b": None}, row("r2", "v1")])
        cb = self.sync(t, "b")["cursor"]
        self.sync(t, "b", since=cb)        # b confirms its cursor
        ca = self.sync(t, "a")["cursor"]
        self.sync(t, "a", since=ca)
        self.srv.store.gc()
        self.assertEqual(self.count("r1"), 0)                # marker dropped once everyone had it
        self.assertEqual(self.count("r2"), 1)
        self.accounted()
        self.sync(t, "c", push=[row("r3", "v1")])           # bump seq past the horizon
        self.assertEqual(self.sync(t, "c", since=1), {"reset": True})   # 0 < since < horizon

    def test_reset_on_foreign_cursor(self):
        t = tok()
        self.sync(t, "a", push=[row("r1", "v1")])
        self.assertEqual(self.sync(t, "a", since=10 ** 9), {"reset": True})

    def test_pull_false(self):
        t = tok()
        self.sync(t, "a", push=[row("r1", "v1")])
        js = self.sync(t, "b", since=0, pull=False, push=[row("r2", "v1")])
        self.assertEqual((js["rows"], js["cursor"], js["more"]), ([], 0, False))

    def test_delete_vault(self):
        t = tok()
        self.sync(t, "a", push=[row("r1", "v1")])
        code, js, r = self.req("DELETE", "/api/vault", token=t)
        self.assertEqual((code, js), (200, {"ok": True}))
        self.assertEqual(r.getheader("Cache-Control"), "no-store")
        self.assertEqual(self.count(), 0)
        code, _, _ = self.req("POST", "/api/sync", {"dev": "a", "since": 0, "push": []}, t)
        self.assertEqual(code, 401)                          # gone: no silent re-creation
        self.assertEqual(self.req("DELETE", "/api/vault", token=t)[0], 401)


class Security(Base):
    def test_auth_failures_then_429(self):
        bad = [None, "Basic abc", "Bearer " + "x" * 64, "Bearer " + "A" * 64, "Bearer " + "a" * 63]
        for h in bad:
            hd = {"Authorization": h} if h else {}
            code, js, _ = self.req("POST", "/api/sync", {"dev": "a"}, headers=hd, ip="9.9.9.9")
            self.assertEqual((code, js), (401, {"error": "unauthorized"}))
        for _ in range(5):   # unknown vault without create also counts
            self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip="9.9.9.9")[0], 401)
        code, js, r = self.req("POST", "/api/sync", {"dev": "a", "create": True}, tok(), ip="9.9.9.9")
        self.assertEqual(code, 429)
        self.assertGreater(int(r.getheader("Retry-After")), 0)
        # a different IP is unaffected
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a", "create": True}, tok(), ip="9.9.9.8")[0], 200)

    def test_new_vault_rate_limit(self):
        for _ in range(5):
            self.assertEqual(self.req("POST", "/api/sync", {"dev": "a", "create": True}, tok(), ip="7.7.7.7")[0], 200)
        code, js, _ = self.req("POST", "/api/sync", {"dev": "a", "create": True}, tok(), ip="7.7.7.7")
        self.assertEqual((code, js), (429, {"error": "slow down"}))
        self.assertEqual(self.count(), 0)
        c = sqlite3.connect(self.db); n = c.execute("SELECT COUNT(*) FROM vaults").fetchone()[0]; c.close()
        self.assertEqual(n, 5)
        # existing vaults keep syncing from that IP
        t = tok()
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a", "create": True}, t, ip="7.7.7.6")[0], 200)
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, t, ip="7.7.7.7")[0], 200)

    def test_validation(self):
        t = tok()
        self.sync(t, "a")
        cases = [
            {"since": 0},                                       # no dev
            {"dev": "a b"}, {"dev": "x" * 65}, {"dev": 5},
            {"dev": "a", "since": -1}, {"dev": "a", "since": "1"}, {"dev": "a", "since": 1.5},
            {"dev": "a", "push": {}}, {"dev": "a", "push": [row(f"r{i}", "v") for i in range(1001)]},
            {"dev": "a", "push": [{"id": "", "v": "v", "b": "x"}]},
            {"dev": "a", "push": [{"id": "r", "v": "v" * 65, "b": "x"}]},
            {"dev": "a", "push": [{"id": "r", "v": "v", "b": 5}]},
            {"dev": "a", "push": [{"id": "r", "v": "v", "b": "A" * (S.MAX_BLOB + 1)}]},
            {"dev": "a", "push": [{"id": "r", "v": "v", "b": "QUJD=="}]},          # base64url, unpadded
            {"dev": "a", "push": [{"id": "r", "v": "v", "b": "a+b/"}]},
            {"dev": "a", "push": [{"id": "r", "v": "v", "b": "<script>"}]},
            {"dev": "a", "since": 1 << 63},
            {"dev": "a", "push": ["r"]}, [1, 2],
        ]
        for body in cases:
            code, js, _ = self.req("POST", "/api/sync", body, t)
            self.assertEqual(code, 400, body if not isinstance(body, dict) or len(str(body)) < 200 else "big")
        self.assertEqual(self.req("POST", "/api/sync", b"{nope", t)[0], 400)
        self.assertEqual(self.count(), 0)

    def test_body_limits(self):
        t = tok()
        self.sync(t, "a")
        hdr = b"POST /api/sync HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer " + t.encode()
        self.assertEqual(self.raw(hdr + b"\r\nContent-Length: %d\r\n\r\n{" % (S.MAX_BODY + 1)), 413)
        bomb = gzip.compress(b'{"dev":"a","pad":"' + b"0" * (S.MAX_INFL + 10) + b'"}')
        self.assertLess(len(bomb), 16 << 10)
        self.assertEqual(self.req("POST", "/api/sync", bomb, t, {"Content-Encoding": "gzip"})[0], 413)
        self.assertEqual(self.req("POST", "/api/sync", b"garbage", t, {"Content-Encoding": "gzip"})[0], 400)
        self.assertEqual(self.req("POST", "/api/sync", gzip.compress(b'{"dev":"a"}')[:-6], t,
                                  {"Content-Encoding": "gzip"})[0], 400)          # truncated
        self.assertEqual(self.req("POST", "/api/sync", b"{}", t, {"Content-Encoding": "br"})[0], 415)
        self.assertEqual(self.req("POST", "/api/sync", b"[" * 100000, t)[0], 400)  # deep nesting
        self.assertEqual(self.req("POST", "/api/sync", b"[" + b"{}," * 30000 + b"{}]", t)[0], 400)  # value flood

    def test_length_required(self):
        t = tok()
        self.sync(t, "a")
        self.assertEqual(self.raw(b"POST /api/sync HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer " + t.encode() +
                                  b"\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{}\r\n0\r\n\r\n"), 411)

    def test_gzip_body(self):
        t = tok()
        body = json.dumps({"dev": "a", "since": 0, "create": True,
                           "push": [row(f"r{i}", "v1", "B" * 500) for i in range(50)]}).encode()
        code, js, _ = self.req("POST", "/api/sync", gzip.compress(body), t, {"Content-Encoding": "gzip"})
        self.assertEqual(code, 200)
        self.assertEqual(self.count(), 50)

    def test_concurrent_devices(self):
        t = tok()
        self.sync(t, "a")
        errs = []
        def worker(d):
            try:
                for i in range(20):
                    self.sync(t, d, since=0, push=[row(f"{d}{i}", "v1")], pull=False)
            except Exception as e:
                errs.append(e)
        th = [threading.Thread(target=worker, args=(f"d{k}",)) for k in range(4)]
        [x.start() for x in th]; [x.join() for x in th]
        self.assertEqual(errs, [])
        self.assertEqual(self.count(), 80)


class UnknownTokens(Base):
    """S2: an unknown token never gets a large body read, inflated or parsed."""

    def test_gzip_bomb_from_unknown_token_is_401(self):
        bomb = gzip.compress(b'{"dev":"a","create":true,"pad":"' + b"0" * (64 << 20) + b'"}', 9)
        self.assertLess(len(bomb), 100 << 10)
        t0 = time.monotonic()
        code, js, _ = self.req("POST", "/api/sync", bomb, tok(), {"Content-Encoding": "gzip"}, ip="6.6.6.1")
        self.assertEqual((code, js), (401, {"error": "unauthorized"}))
        self.assertLess(time.monotonic() - t0, 1.0)
        self.assertEqual(self.srv.fails.wait("6.6.6.1"), 0)
        self.assertEqual(len(self.srv.fails.h["6.6.6.1"]), 1)               # counted as a failure
        c = sqlite3.connect(self.db); n = c.execute("SELECT COUNT(*) FROM vaults").fetchone()[0]; c.close()
        self.assertEqual(n, 0)

    def test_no_quota_no_read(self):
        # The headers promise a body that never comes: an answer proves nothing was read.
        hdr = b"POST /api/sync HTTP/1.1\r\nHost: x\r\nX-Real-IP: 6.6.6.2\r\nContent-Length: 400000\r\nAuthorization: Bearer "
        for _ in range(5):
            self.srv.news.hit("6.6.6.2")                # create quota used up
        t0 = time.monotonic()
        self.assertEqual(self.raw(hdr + tok().encode() + b"\r\n\r\n", timeout=3), 429)
        for _ in range(10):
            self.srv.fails.hit("6.6.6.3")               # failure quota used up
        self.assertEqual(self.raw(hdr.replace(b"6.6.6.2", b"6.6.6.3") + tok().encode() + b"\r\n\r\n", timeout=3), 429)
        self.assertLess(time.monotonic() - t0, 1.0)

    def test_malformed_anon_bodies_are_401(self):
        for body, h in [(b"{nope", {}), (b"x" * 1000, {"Content-Encoding": "gzip"}), (b"{}", {"Content-Encoding": "br"}),
                        (json.dumps({"dev": "a b", "create": True}).encode(), {})]:
            self.assertEqual(self.req("POST", "/api/sync", body, tok(), h, ip="6.6.6.4")[0], 401)
        self.assertEqual(len(self.srv.fails.h["6.6.6.4"]), 4)

    def test_valid_token_served_while_ip_locked_out(self):
        t = tok()
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a", "create": True}, t, ip="5.5.5.5")[0], 200)
        for _ in range(10):
            self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip="5.5.5.5")
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip="5.5.5.5")[0], 429)   # locked out
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, "Z" * 64, ip="5.5.5.5")[0], 429)
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, t, ip="5.5.5.5")[0], 200)        # owner isn't
        self.assertEqual(self.req("DELETE", "/api/vault", token=t, ip="5.5.5.5")[0], 200)

    def test_busy_slots_503(self):
        t = tok()
        self.sync(t, "a")
        for _ in range(S.BODIES): self.srv.bodies.acquire()
        try:
            t0 = time.monotonic()
            code, js, r = self.req("POST", "/api/sync", {"dev": "a"}, t)
            self.assertEqual((code, js, r.getheader("Retry-After")), (503, {"error": "busy"}, "2"))
            self.assertLess(time.monotonic() - t0, S.SLOT_WAIT + 1)
            # unknown tokens have their own slot, so they can't starve known vaults (or vice versa)
            self.assertEqual(self.req("POST", "/api/sync", {"dev": "a", "create": True}, tok())[0], 200)
        finally:
            for _ in range(S.BODIES): self.srv.bodies.release()
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, t)[0], 200)

    def test_slow_body_gives_its_slot_back(self):
        t = tok()
        self.sync(t, "a")
        old, S.BODY_SECS = S.BODY_SECS, 0.5
        try:
            with socket.create_connection(("127.0.0.1", self.port), timeout=5) as s:
                s.sendall(b"POST /api/sync HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer " + t.encode() +
                          b"\r\nContent-Length: 100\r\n\r\n{")
                t0 = time.monotonic()
                self.assertEqual(s.recv(100), b"")                # dropped once the deadline passed
                self.assertLess(time.monotonic() - t0, 2)
        finally:
            S.BODY_SECS = old
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, t)[0], 200)


class Quotas(Base):
    opts = dict(vault_rows=3, vault_bytes=4000)

    def test_rows_quota_507_and_rollback(self):
        t = tok()
        c0 = self.sync(t, "a", push=[row(f"r{i}", "v1") for i in range(3)])["cursor"]
        code, js, _ = self.req("POST", "/api/sync", {"dev": "a", "since": c0, "push": [row("r3", "v1"), row("r4", "v1")]}, t)
        self.assertEqual((code, js), (507, {"error": "vault full"}))
        self.assertEqual(self.count(), 3)                                   # the whole push rolled back
        js = self.sync(t, "a", since=c0, push=[row("r0", "v2")])           # compaction still allowed
        self.assertEqual(self.count(), 3)
        self.assertEqual(js["head"], c0 + 1)
        self.accounted()

    def test_bytes_quota(self):
        t = tok()
        self.sync(t, "a", push=[row("r0", "v1", "A" * 3000)])
        code, js, _ = self.req("POST", "/api/sync", {"dev": "a", "push": [row("r1", "v1", "A" * 1000)]}, t)
        self.assertEqual((code, js), (507, {"error": "vault full"}))
        self.accounted()

    def test_other_vaults_unaffected(self):
        t1, t2 = tok(), tok()
        self.sync(t1, "a", push=[row(f"r{i}", "v1") for i in range(3)])
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a", "push": [row("x", "v1")]}, t1)[0], 507)
        self.sync(t2, "a", push=[row(f"r{i}", "v1") for i in range(3)])


class DiskGuard(Base):
    opts = dict(db_max=1)

    def test_server_full(self):
        code, js, _ = self.req("POST", "/api/sync", {"dev": "a", "create": True}, tok())
        self.assertEqual((code, js), (507, {"error": "server full"}))


class DiskGuardPush(Base):
    def test_push_refused_pull_served(self):
        t = tok()
        self.sync(t, "a", push=[row("r1", "v1")])
        self.srv.store.db_max = 1
        code, js, _ = self.req("POST", "/api/sync", {"dev": "b", "push": [row("r2", "v1")]}, t)
        self.assertEqual((code, js), (507, {"error": "server full"}))
        self.assertEqual(len(self.sync(t, "b")["rows"]), 1)                # reads still work


class VaultRate(Base):
    opts = dict(vault_rpm=3)

    def test_per_vault_rate_limit(self):
        t1, t2 = tok(), tok()
        for _ in range(3): self.sync(t1, "a")
        code, js, r = self.req("POST", "/api/sync", {"dev": "a"}, t1)
        self.assertEqual((code, js), (429, {"error": "slow down"}))
        self.assertGreater(int(r.getheader("Retry-After")), 0)
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, t1, ip="1.2.3.4")[0], 429)   # per vault, not IP
        self.sync(t2, "a")                                                  # another vault is unaffected


class Sequences(Base):
    """S3: seq/cursor/head are per vault, so they carry no signal about other vaults."""

    def test_per_vault_seq_isolation(self):
        t1, t2 = tok(), tok()
        a = self.sync(t1, "a", push=[row(f"r{i}", "v1") for i in range(5)])
        self.assertEqual((a["head"], a["cursor"]), (5, 5))
        b = self.sync(t2, "b", push=[row("x", "v1")])
        self.assertEqual(b["head"], 1)                                      # not 6
        for i in range(50):                                                 # lots of activity elsewhere
            self.sync(t2, "b", push=[row(f"y{i}", "v1")], pull=False)
        a2 = self.sync(t1, "a", since=a["cursor"])
        self.assertEqual((a2["head"], a2["cursor"], a2["rows"]), (5, 5, []))  # vault 1 sees no change
        self.assertEqual([r["s"] for r in self.sync(t1, "c")["rows"]], [1, 2, 3, 4, 5])
        self.assertEqual(self.sync(t1, "a", since=6), {"reset": True})      # beyond this vault's head

    def test_head_counts_deleted_rows(self):
        t = tok()
        c = self.sync(t, "a", push=[row("r1", "v1")])["cursor"]
        js = self.sync(t, "a", since=c, push=[row("r1", "v2")])            # v1 compacted away
        self.assertEqual((js["head"], js["cursor"], self.count()), (2, 2, 1))
        self.assertEqual(self.sync(t, "a", since=2)["rows"], [])           # no reset at head


V1_SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE vaults(id INTEGER PRIMARY KEY, token_sha256 BLOB NOT NULL UNIQUE,
  horizon INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL);
CREATE TABLE changes(seq INTEGER PRIMARY KEY AUTOINCREMENT,
  vault INTEGER NOT NULL, rid TEXT NOT NULL, ver TEXT NOT NULL, dev TEXT NOT NULL, blob TEXT,
  UNIQUE(vault, rid, ver));
CREATE INDEX changes_by_seq ON changes(vault, seq);
CREATE INDEX changes_by_rid ON changes(vault, rid, seq);
CREATE TABLE devices(vault INTEGER NOT NULL, dev TEXT NOT NULL, cursor INTEGER NOT NULL,
  seen INTEGER NOT NULL, PRIMARY KEY(vault, dev));
"""


class Migration(unittest.TestCase):
    def test_v1_to_per_vault_seq(self):
        with tempfile.TemporaryDirectory() as d:
            db = os.path.join(d, "v1.db")
            t1, t2 = tok(), tok()
            c = sqlite3.connect(db)
            c.executescript(V1_SCHEMA)
            for vid, t in ((1, t1), (2, t2)):
                c.execute("INSERT INTO vaults VALUES(?,?,0,0)", (vid, hashlib.sha256(t.encode()).digest()))
            for i in range(10):                                  # interleaved global seq 1..10
                c.execute("INSERT INTO changes(vault,rid,ver,dev,blob) VALUES(?,?,?,?,?)",
                          (1 + i % 2, f"r{i}", "v1", "a", None if i == 8 else "QUJD"))
            c.execute("INSERT INTO changes(vault,rid,ver,dev,blob) VALUES(2,'gone','v1','a','QQ')")
            c.execute("DELETE FROM changes WHERE seq=11")        # sqlite_sequence is now ahead of MAX(seq)
            c.execute("INSERT INTO devices VALUES(1,'a',9,?)", (int(time.time()),))
            c.commit(); c.close()

            srv = S.make_server(db, "127.0.0.1", 0)
            threading.Thread(target=srv.serve_forever, kwargs={"poll_interval": 0.05}, daemon=True).start()
            try:
                c = sqlite3.connect(db)
                self.assertEqual(c.execute("PRAGMA user_version").fetchone()[0], S.VERSION)
                got = c.execute("SELECT vault, seq, rid, blob FROM changes ORDER BY vault, seq").fetchall()
                self.assertEqual(got, [(1, 13 + k, f"r{2 * k}", None if 2 * k == 8 else "QUJD") for k in range(5)] +
                                      [(2, 13 + k, f"r{2 * k + 1}", "QUJD") for k in range(5)])
                v = c.execute("SELECT id, horizon, next_seq, nrows FROM vaults ORDER BY id").fetchall()
                self.assertEqual(v, [(1, 12, 18, 5), (2, 12, 18, 5)])
                self.assertEqual(c.execute("SELECT cursor FROM devices").fetchall(), [(0,)])
                self.assertFalse(c.execute("SELECT 1 FROM sqlite_sequence WHERE name='changes'").fetchone())
                c.close()
                port = srv.server_address[1]

                def sync(t, since):
                    h = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                    h.request("POST", "/api/sync", json.dumps({"dev": "b", "since": since}), {"Authorization": "Bearer " + t})
                    js = json.loads(h.getresponse().read()); h.close()
                    return js
                for old in (1, 9, 10, 11, 18):                       # every v1 cursor resets...
                    self.assertEqual(sync(t1, old), {"reset": True})
                js = sync(t1, 0)                                 # ...and a re-pull from 0 is clean
                self.assertEqual([r["id"] for r in js["rows"]], ["r0", "r2", "r4", "r6", "r8"])
                self.assertEqual(js["cursor"], 17)
                self.assertEqual(sync(t1, js["cursor"])["rows"], [])   # no reset loop
            finally:
                srv.shutdown(); srv.server_close(); srv.store.close()
            S.Store(db).close()                                  # reopening is a no-op
            c = sqlite3.connect(db)
            self.assertEqual(c.execute("SELECT COUNT(*) FROM changes").fetchone()[0], 10)
            c.close()

    def test_empty_v1_and_fresh(self):
        with tempfile.TemporaryDirectory() as d:
            db = os.path.join(d, "e.db")
            c = sqlite3.connect(db); c.executescript(V1_SCHEMA); c.close()
            S.Store(db).close()
            c = sqlite3.connect(db)
            self.assertEqual(c.execute("PRAGMA user_version").fetchone()[0], S.VERSION)
            self.assertIn("next_seq", [r[1] for r in c.execute("PRAGMA table_info(vaults)")])
            c.close()


class TrustedProxies(Base):
    opts = dict(proxies="")

    def test_proxy_list(self):
        p = S.Proxies(" 10.0.0.0/8, 192.168.1.7 ,localhost,,fd00::/8")
        for ip, ok in [("10.1.2.3", True), ("192.168.1.7", True), ("192.168.1.8", False), ("127.0.0.1", True),
                       ("fd00::1", True), ("172.18.0.3", False), ("junk", False)]:
            self.assertEqual(ip in p, ok, ip)
        self.assertFalse("127.0.0.1" in S.Proxies(""))
        self.assertFalse("127.0.0.1" in S.Proxies("no-such-host.invalid"))

    def test_untrusted_peer_cannot_pick_its_ip(self):
        # Nothing trusted: X-Real-IP is ignored, so rotating it doesn't escape the failure limit.
        for i in range(10):
            self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip=f"8.8.8.{i}")[0], 401)
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip="8.8.4.4")[0], 429)
        self.assertIn("127.0.0.1", self.srv.fails.h)

    def test_trusted_peer_header_used(self):
        self.srv.proxies = S.Proxies("127.0.0.0/8")
        for i in range(10):
            self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip="8.8.8.8")
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip="8.8.8.8")[0], 429)
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip="8.8.4.4")[0], 401)
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip="2001:db8::1")[0], 401)
        self.assertIn("2001:db8::/64", self.srv.fails.h)                # IPv6 grouped by /64
        self.assertEqual(self.req("POST", "/api/sync", {"dev": "a"}, tok(), ip="not an ip")[0], 401)
        self.assertIn("127.0.0.1", self.srv.fails.h)                    # junk header: the peer is used


class Process(unittest.TestCase):
    def test_sigterm_graceful_and_memory(self):
        with tempfile.TemporaryDirectory() as d:
            env = dict(os.environ, LISTS_DB=os.path.join(d, "p.db"), LISTS_PORT="0", LISTS_HOST="127.0.0.1")
            p = subprocess.Popen([sys.executable, "-I", S.__file__], env=env, stdout=subprocess.PIPE, text=True)
            try:
                port = int(p.stdout.readline().rsplit(":", 1)[1])
                t = tok()
                for k in range(5):
                    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                    c.request("POST", "/api/sync", json.dumps({"dev": "a", "since": 0, "create": True,
                              "push": [row(f"r{k}-{i}", "v1", "C" * 300) for i in range(500)]}),
                              {"Authorization": "Bearer " + t})
                    self.assertEqual(c.getresponse().status, 200); c.close()
                rss = 0
                try:
                    with open(f"/proc/{p.pid}/status") as f:
                        for line in f:
                            if line.startswith("VmRSS:"): rss = int(line.split()[1]) // 1024
                except OSError:
                    pass
                print(f"\n  server RSS after 2,500-row push: {rss} MB", file=sys.stderr)
                if rss: self.assertLess(rss, 30, f"RSS {rss} MB")
                p.send_signal(signal.SIGTERM)
                self.assertEqual(p.wait(5), 0)
                self.assertIn("stopped", p.stdout.read())
                self.assertFalse(os.path.exists(os.path.join(d, "p.db-wal")) and
                                 os.path.getsize(os.path.join(d, "p.db-wal")) > 0)
            finally:
                if p.poll() is None: p.kill()
                p.stdout.close()


    def test_gzip_bomb_rss(self):
        """S2 regression: 8 KB of gzip from an unknown token used to cost ~250 MB."""
        with tempfile.TemporaryDirectory() as d:
            env = dict(os.environ, LISTS_DB=os.path.join(d, "p.db"), LISTS_PORT="0", LISTS_HOST="127.0.0.1",
                       LISTS_FAIL_MAX="1000")
            p = subprocess.Popen([sys.executable, "-I", S.__file__], env=env, stdout=subprocess.PIPE, text=True)
            try:
                port = int(p.stdout.readline().rsplit(":", 1)[1])

                def post(body, t, gz=True):
                    c = http.client.HTTPConnection("127.0.0.1", port, timeout=5)
                    c.request("POST", "/api/sync", body, {"Authorization": "Bearer " + t,
                                                         **({"Content-Encoding": "gzip"} if gz else {})})
                    code = c.getresponse().status; c.close()
                    return code
                bomb = gzip.compress(b'{"dev":"a","create":true,"pad":"' + b"0" * (8 << 20) + b'"}', 9)
                self.assertLess(len(bomb), 10 << 10)
                post(b'{"dev":"a"}', tok(), False)
                before = rss_mb(p.pid)
                t0 = time.monotonic()
                codes = [post(bomb, tok()) for _ in range(20)]
                dt = (time.monotonic() - t0) / 20
                self.assertEqual(set(codes), {401})
                known = tok()
                self.assertEqual(post(json.dumps({"dev": "a", "create": True}).encode(), known, False), 200)
                big = gzip.compress(b'{"dev":"a","pad":"' + b"0" * (64 << 20) + b'"}', 9)
                self.assertEqual({post(big, known) for _ in range(5)}, {413})
                after = rss_mb(p.pid)
                print(f"\n  RSS {before:.1f} -> {after:.1f} MB after 20 unknown-token bombs + 5 known-vault bombs; "
                      f"{dt * 1000:.0f} ms each", file=sys.stderr)
                self.assertLess(dt, 0.5)
                if before: self.assertLess(after - before, 8, f"RSS grew {after - before:.1f} MB")
            finally:
                p.kill(); p.wait(); p.stdout.close()


if __name__ == "__main__":
    unittest.main()
