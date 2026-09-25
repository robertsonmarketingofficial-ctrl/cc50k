import json
import threading
import unittest
import urllib.request
from http.server import ThreadingHTTPServer

from detective import demo
from detective.collectors import FetchError, ymd
from detective.core import Case, Refused, classify
from detective.investigate import investigate
from detective.server import App, make_handler


def spy(base=demo.fetcher, fail=()):
    calls = []

    def f(url):
        calls.append(url)
        if any(p in url for p in fail):
            raise FetchError("timeout")
        return base(url)
    return f, calls


def all_refs(c):
    ids = {s["id"] for s in c["sources"]}
    for group in ("claims", "events", "entities", "connections"):
        for item in c[group]:
            yield group, item, ids


class Classify(unittest.TestCase):
    def test_kinds(self):
        self.assertEqual(classify("https://www.Example.com/about"), ("domain", "example.com"))
        self.assertEqual(classify("@octocat"), ("username", "octocat"))
        self.assertEqual(classify("Northwind Roasters"), ("name", "Northwind Roasters"))
        self.assertEqual(classify("Octocat", "username"), ("username", "Octocat"))

    def test_private_details_refused(self):
        for q in ("jane.doe@gmail.com", "+1 (415) 555-0100", "221 Baker Street London"):
            with self.assertRaises(Refused, msg=q):
                classify(q)

    def test_dates_keep_their_precision(self):
        self.assertEqual(ymd("+2014-00-00T00:00:00Z"), "2014")
        self.assertEqual(ymd("2015"), "2015")
        self.assertEqual(ymd("2014-08-19T17:02:11Z"), "2014-08-19")
        self.assertEqual(ymd(0), "1970-01-01")


class Evidence(unittest.TestCase):
    def test_claims_require_a_registered_source(self):
        c = Case("x", "domain")
        with self.assertRaises(ValueError):
            c.claim("identity", "Name", "X", 1, "record")
        with self.assertRaises(ValueError):
            c.source("bad", "javascript:alert(1)", "x")
        sid = c.source("ok", "https://example.org", "x")
        with self.assertRaises(ValueError):
            c.claim("identity", "Name", "X", sid, "certain")  # unknown confidence level

    def test_every_item_in_every_case_is_sourced(self):
        for q in ("northwind-roasters.example", "Northwind Roasters", "@northwindhq"):
            c = investigate(q, fetcher=demo.fetcher).to_dict()
            self.assertTrue(c["claims"], q)
            for group, item, ids in all_refs(c):
                self.assertTrue(item["sources"], (q, group, item))
                self.assertTrue(set(item["sources"]) <= ids, (q, group, item))
                self.assertIn(item["level"], c["levels"])
            for s in c["sources"]:
                self.assertTrue(s["url"].startswith("https://"), s)

    def test_conflicts_and_corroboration(self):
        c = investigate("Northwind Roasters", fetcher=demo.fetcher).to_dict()
        self.assertTrue(any(n["kind"] == "conflict" and "2014" in n["text"] and "2015" in n["text"] for n in c["notes"]))
        founded = [x for x in c["claims"] if x["label"] == "Founded"]
        self.assertTrue(founded and all(x.get("conflict") for x in founded))
        ig = next(x for x in c["claims"] if x["label"] == "Instagram")
        self.assertTrue(ig["corroborated"])                 # Wikidata + the company's own site
        gw = next(x for x in c["claims"] if x["value"] == "Google Workspace")
        self.assertFalse(gw["corroborated"])                # MX + SPF are both DNS: one publisher, not two

    def test_domain_case_contents(self):
        c = investigate("northwind-roasters.example", fetcher=demo.fetcher).to_dict()
        vals = {x["label"]: x for x in c["claims"]}
        self.assertEqual(vals["Domain registered"]["level"], "record")
        self.assertEqual(vals["Email provider"]["level"], "inferred")
        self.assertIn("Klaviyo", [x["value"] for x in c["claims"] if x["label"] == "Allowed to send its email"])
        self.assertEqual(c["subject"]["name"], "Northwind Roasters")   # Wikidata entry that lists this domain
        mention = [x for x in c["claims"] if x["section"] == "mentions"]
        self.assertEqual([m["level"] for m in mention], ["record", "possible"])  # links to domain vs name only
        self.assertTrue(any(e["relation"] == "subdomain" and e["pivot"] for e in c["entities"]))


class Privacy(unittest.TestCase):
    def test_username_never_asserts_same_owner(self):
        c = investigate("@northwindhq", fetcher=demo.fetcher).to_dict()
        profiles = [x for x in c["claims"] if x["section"] == "social"]
        self.assertTrue(profiles and all(x["level"] == "possible" for x in profiles))
        self.assertNotIn("SHOULD NOT APPEAR", json.dumps(c))       # GitHub location is never copied
        self.assertTrue(any(n["kind"] == "caution" for n in c["notes"]))

    def test_unknown_person_stops_after_reference_check(self):
        f, calls = spy()
        c = investigate("Jane Nobody", "person", fetcher=f).to_dict()
        self.assertTrue(all("wikidata.org" in u for u in calls), calls)
        self.assertFalse(c["claims"])
        self.assertTrue(any(n["kind"] == "privacy" for n in c["notes"]))

    def test_unidentified_name_skips_mentions(self):
        f, calls = spy()
        investigate("Jane Nobody", fetcher=f)
        self.assertFalse(any("hn.algolia" in u for u in calls), calls)


class Resilience(unittest.TestCase):
    def test_failed_source_is_reported_not_fatal(self):
        f, _ = spy(fail=("crt.sh",))
        c = investigate("northwind-roasters.example", fetcher=f).to_dict()
        cov = {x["collector"]: x["status"] for x in c["coverage"]}
        self.assertEqual(cov["Certificate logs"], "failed")
        self.assertEqual(cov["Domain registry (RDAP)"], "ok")


class Server(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.httpd = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(App(demo.fetcher, demo=True)))
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.httpd.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown(); cls.httpd.server_close()

    def events(self, path):
        with urllib.request.urlopen(self.base + path, timeout=10) as r:
            chunks = r.read().decode().strip().split("\n\n")
        return [(c.split("\n")[0][7:], json.loads(c.split("\n")[1][6:])) for c in chunks]

    def test_page_and_stream(self):
        with urllib.request.urlopen(self.base + "/", timeout=5) as r:
            self.assertIn("Internet Detective", r.read().decode())
            self.assertIn("default-src 'self'", r.headers["Content-Security-Policy"])
        evs = self.events("/api/investigate?q=northwind-roasters.example&type=auto")
        self.assertEqual(evs[-1][0], "done")
        self.assertTrue(evs[-1][1]["demo"])
        self.assertEqual(self.events("/api/investigate?q=a%40b.com")[-1][0], "refused")
        self.assertEqual(self.events("/api/investigate?q=bad%20domain&type=domain")[-1][0], "invalid")


if __name__ == "__main__":
    unittest.main()
