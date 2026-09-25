import csv
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from coldflow import campaigns, db, leads
from coldflow.config import load_settings
from coldflow.enrich import analyse, enrich_csv, icebreaker, score
from coldflow.templates import lead_context, render

ROOT = Path(__file__).resolve().parent.parent

ROOFER = """<html><head><title>Acme Roofing | Tampa Roof Replacement</title>
<meta name="viewport" content="width=device-width"><script src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script>
<script>gtag('config', 'AW-123456789');</script></head>
<body><a href="tel:+18135550100">Call</a><form action="/quote"></form>
<footer>&copy; 2025 Acme Roofing. Website by Bright Pixel Media</footer></body></html>"""
DENTIST = """<html><head><title>Bright Smiles Dental</title></head>
<body><p>Call us</p><footer>Copyright 2015-2019 Bright Smiles</footer></body></html>"""
STORE = """<html><head><title>Glow Skincare</title><meta name="viewport" content="width=device-width">
<link href="https://cdn.shopify.com/s/files/theme.css"><script>!function(f,b,e,v,n,t,s){};fbq('init','1');</script>
<script src="https://connect.facebook.net/en_US/fbevents.js"></script></head><body>&copy; 2026 Glow</body></html>"""


class Handler(BaseHTTPRequestHandler):
    pages = {"/roofer/": ROOFER, "/dentist/": DENTIST, "/store/": STORE,
             "/plain/": '<html><head><meta name="viewport" content="width=device-width"></head><body>Calendly.com/acme | tawk.to</body></html>'}

    def do_GET(self):
        body = self.pages.get(self.path)
        if body is None:
            self.send_response(404); self.end_headers(); return
        self.send_response(200); self.send_header("Content-Type", "text/html; charset=utf-8"); self.end_headers()
        self.wfile.write(body.encode())

    def log_message(self, *a):
        pass


class AnalyseTests(unittest.TestCase):
    def test_roofer_signals_and_hook(self):
        f = analyse(ROOFER, "https://acme.test/", this_year=2026)
        self.assertTrue(f["google_ads_seen"] and f["click_to_call"] and f["mobile_ready"] and f["has_form"])
        self.assertFalse(f["booking_seen"] or f["chat_or_text_seen"] or f["call_tracking_seen"])
        self.assertEqual(f["copyright_year"], 2025)
        self.assertEqual(f["agency_credit"], "Bright Pixel Media")
        pts, why, notes = score(f, "local", this_year=2026)
        self.assertEqual(pts, 8)                               # ads 3 + no booking 2 + no chat 2 + no call tracking 1
        self.assertTrue(any("verify" in n for n in notes))     # absences are flagged for checking, never claimed
        line = icebreaker(f, "Acme Roofing", "local", this_year=2026)
        self.assertIn("Google Ads", line)
        self.assertNotIn("no ", line.lower())                  # icebreakers never assert something is missing

    def test_old_site_uses_copyright_fact(self):
        f = analyse(DENTIST, "http://brightsmiles.test/", this_year=2026)
        self.assertEqual(f["copyright_year"], 2019)
        self.assertFalse(f["mobile_ready"] or f["https"])
        self.assertIn("2019", icebreaker(f, "Bright Smiles", "local", this_year=2026))

    def test_store_fit(self):
        f = analyse(STORE, "https://glow.test/", this_year=2026)
        self.assertEqual(f["platform"], "shopify")
        pts, why, _ = score(f, "ecom", this_year=2026)
        self.assertEqual(pts, 8)                               # shopify 3 + no email tool 3 + meta 2
        self.assertIn("Meta ads", icebreaker(f, "Glow", "ecom", this_year=2026))

    def test_nothing_to_say_means_blank(self):
        f = analyse("<html><body>hello</body></html>", "https://x.test/", this_year=2026)
        self.assertEqual(icebreaker(f, "X", "local", this_year=2026), "")


class EnrichCsvTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.base = f"http://127.0.0.1:{cls.server.server_address[1]}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown(); cls.server.server_close()

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(); self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_end_to_end_into_templates(self):
        src = self.dir / "leads.csv"
        with src.open("w", newline="") as fh:
            w = csv.writer(fh)
            w.writerow(["Email", "First Name", "Company Name", "Website", "Email Status"])
            w.writerow(["jane@acmeroofing.com", "Jane", "Acme Roofing", f"{self.base}/roofer/", "valid"])
            w.writerow(["bob@acmeroofing.com", "Bob", "Acme Roofing", f"{self.base}/roofer/", "valid"])   # same site: fetched once
            w.writerow(["amy@brightsmiles.co", "Amy", "Bright Smiles", f"{self.base}/dentist/", "valid"])
            w.writerow(["joe@gone.co", "Joe", "Gone LLC", f"{self.base}/missing/", "valid"])
            w.writerow(["sam@gmail.com", "Sam", "Sam's Plumbing", "", "valid"])                          # no site, free mail
        calls = []
        from coldflow import enrich as E
        fetch = lambda u: (calls.append(u), E.fetch(u, timeout=5))[1]
        out = self.dir / "leads_enriched.csv"
        stats = enrich_csv(src, out, niche="local", workers=4, fetcher=fetch, log=lambda *_: None)
        self.assertEqual(len(calls), 3)                        # roofer, dentist, missing; no site for gmail
        self.assertEqual((stats["ok"], stats["unreachable"], stats["no_website"]), (3, 1, 1))
        rows = list(csv.DictReader(out.open()))
        self.assertEqual(rows[0]["fit_tier"], "A")
        self.assertTrue(rows[0]["icebreaker"].startswith("Looks like Acme Roofing"))
        self.assertIn("unreachable", rows[3]["site_status"])
        self.assertEqual(rows[4]["site_status"], "no website")
        self.assertEqual(rows[0]["Email Status"], "valid")    # original columns untouched

        # The enriched file imports and the icebreaker reaches the email copy.
        cfg = self.dir / "coldflow.toml"; cfg.write_text("")
        settings = load_settings(cfg); conn = db.connect(settings.path("db"))
        leads.import_csv(conn, out, settings["leads"])
        lead = conn.execute("SELECT * FROM leads WHERE email='jane@acmeroofing.com'").fetchone()
        self.assertEqual(json.loads(lead["custom"])["fit_tier"], "A")
        camp = campaigns.load_campaign(ROOT / "campaigns" / "local-services.toml")
        body = render(camp.steps[0].variants[0].body, lead_context(lead, None, {"name": "Test"}))
        self.assertIn("put money into Google Ads", body)
        conn.close()

    def test_min_score_splits_low_fit(self):
        src = self.dir / "l.csv"
        with src.open("w", newline="") as fh:
            w = csv.writer(fh); w.writerow(["email", "website"])
            w.writerow(["a@acme.com", f"{self.base}/roofer/"]); w.writerow(["b@x.com", f"{self.base}/plain/"])
        stats = enrich_csv(src, self.dir / "out.csv", niche="local", min_score=6, log=lambda *_: None)
        self.assertEqual((stats["kept"], stats["low_fit"]), (1, 1))
        self.assertTrue((self.dir / "out_low_fit.csv").exists())


if __name__ == "__main__":
    unittest.main()
