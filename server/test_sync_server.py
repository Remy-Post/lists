#!/usr/bin/env python3
"""Unit tests for sync_server.py. Run: python3 -m unittest server/test_sync_server.py -v"""
import gzip, hashlib, http.client, json, os, secrets, signal, sqlite3, subprocess, sys, tempfile, threading, time, unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sync_server as S


def tok():
    return secrets.token_hex(32)


class Base(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.TemporaryDirectory()
        self.db = os.path.join(self.dir.name, "t.db")
        self.srv = S.make_server(self.db, "127.0.0.1", 0, fail_max=10, new_max=5)
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
            {"dev": "a", "push": ["r"]}, [1, 2],
        ]
        for body in cases:
            code, js, _ = self.req("POST", "/api/sync", body, t)
            self.assertEqual(code, 400, body if not isinstance(body, dict) or len(str(body)) < 200 else "big")
        self.assertEqual(self.req("POST", "/api/sync", b"{nope", t)[0], 400)
        self.assertEqual(self.count(), 0)

    def test_body_limits(self):
        t = tok()
        self.assertEqual(self.raw(b"POST /api/sync HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer " + t.encode() +
                                  b"\r\nContent-Length: 2097153\r\n\r\n{"), 413)
        bomb = gzip.compress(b'{"dev":"a","pad":"' + b"0" * (9 * 1024 * 1024) + b'"}')
        self.assertLess(len(bomb), 2 * 1024 * 1024)
        self.assertEqual(self.req("POST", "/api/sync", bomb, t, {"Content-Encoding": "gzip"})[0], 413)
        self.assertEqual(self.req("POST", "/api/sync", b"garbage", t, {"Content-Encoding": "gzip"})[0], 400)
        self.assertEqual(self.req("POST", "/api/sync", b"{}", t, {"Content-Encoding": "br"})[0], 415)

    def raw(self, data):
        import socket
        with socket.create_connection(("127.0.0.1", self.port), timeout=5) as s:
            s.sendall(data)
            return int(s.recv(4096).split(b" ")[1])

    def test_length_required(self):
        self.assertEqual(self.raw(b"POST /api/sync HTTP/1.1\r\nHost: x\r\nAuthorization: Bearer " + tok().encode() +
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


if __name__ == "__main__":
    unittest.main()
