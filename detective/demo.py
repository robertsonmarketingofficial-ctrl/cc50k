"""Offline demo data for a FICTIONAL company on a reserved .example domain.

Used by `--demo` and the tests. Every name, record and number here is made up; the page shows a
banner saying so. Nothing here describes a real organisation or person.
"""
import json

D = "northwind-roasters.example"
HOME = f"""<!doctype html><html><head><title>Northwind Roasters | Small-batch coffee, roasted in Portland</title>
<meta name="description" content="Northwind Roasters is an independent coffee roaster shipping fresh beans across the US.">
<meta property="og:site_name" content="Northwind Roasters"><meta name="generator" content="WordPress 6.6">
<script type="application/ld+json">{{"@context":"https://schema.org","@type":"Organization","name":"Northwind Roasters",
"legalName":"Northwind Roasters LLC","foundingDate":"2015","sameAs":["https://www.instagram.com/northwindroasters/",
"https://www.linkedin.com/company/northwind-roasters"]}}</script></head><body>
<a href="https://www.instagram.com/northwindroasters/">Instagram</a> <a href="https://x.com/northwindhq">X</a>
<a href="https://www.facebook.com/sharer/sharer.php?u=x">share</a> <a href="https://github.com/northwindhq">Code</a>
<footer>&copy; 2016-2024 Northwind Roasters</footer></body></html>"""

WD_ENTITY = {"id": "Q999999001", "labels": {"en": {"value": "Northwind Roasters"}},
             "descriptions": {"en": {"value": "fictional coffee roasting company (demo data)"}},
             "sitelinks": {"enwiki": {"title": "Northwind Roasters"}},
             "claims": {
                 "P31": [{"mainsnak": {"datavalue": {"value": {"id": "Q999999101"}}}}],
                 "P452": [{"mainsnak": {"datavalue": {"value": {"id": "Q999999102"}}}}],
                 "P571": [{"mainsnak": {"datavalue": {"value": {"time": "+2014-00-00T00:00:00Z"}}}}],
                 "P159": [{"mainsnak": {"datavalue": {"value": {"id": "Q999999103"}}}}],
                 "P112": [{"mainsnak": {"datavalue": {"value": {"id": "Q999999104"}}}}],
                 "P749": [{"mainsnak": {"datavalue": {"value": {"id": "Q999999105"}}}}],
                 "P856": [{"mainsnak": {"datavalue": {"value": f"https://www.{D}/"}}}],
                 "P2003": [{"mainsnak": {"datavalue": {"value": "northwindroasters"}}}],
                 "P2002": [{"mainsnak": {"datavalue": {"value": "NorthwindHQ"}}}]}}
WD_OTHER = {"id": "Q999999002", "labels": {"en": {"value": "Northwind"}},
            "descriptions": {"en": {"value": "fictional shipping line (demo data)"}}, "sitelinks": {},
            "claims": {"P571": [{"mainsnak": {"datavalue": {"value": {"time": "+1998-00-00T00:00:00Z"}}}}]}}
LABELS = {"Q999999101": "business", "Q999999102": "coffee roasting", "Q999999103": "Portland",
          "Q999999104": "Dana Example", "Q999999105": "Example Beverage Holdings"}

ROUTES = [
    ("rdap.org/domain/" + D, {"ldhName": D, "status": ["client transfer prohibited"],
        "events": [{"eventAction": "registration", "eventDate": "2014-08-19T17:02:11Z"},
                   {"eventAction": "expiration", "eventDate": "2027-08-19T17:02:11Z"},
                   {"eventAction": "last changed", "eventDate": "2026-07-01T09:00:00Z"}],
        "entities": [{"roles": ["registrar"], "vcardArray": ["vcard", [["version", {}, "text", "4.0"], ["fn", {}, "text", "Example Registrar, Inc."]]]}],
        "nameservers": [{"ldhName": "ADA.NS.CLOUDFLARE.COM"}, {"ldhName": "BOB.NS.CLOUDFLARE.COM"}]}),
    (f"name=_dmarc.{D}&type=TXT", {"Answer": [{"type": 16, "data": "v=DMARC1; p=quarantine; rua=mailto:x"}]}),
    (f"name={D}&type=A", {"Answer": [{"type": 1, "data": "23.227.38.65"}]}),
    (f"name={D}&type=MX", {"Answer": [{"type": 15, "data": "1 aspmx.l.google.com."}, {"type": 15, "data": "5 alt1.aspmx.l.google.com."}]}),
    (f"name={D}&type=NS", {"Answer": [{"type": 2, "data": "ada.ns.cloudflare.com."}]}),
    (f"name={D}&type=TXT", {"Answer": [{"type": 16, "data": "\"v=spf1 include:_spf.google.com include:_spf.klaviyo.com ~all\""},
                                       {"type": 16, "data": "\"google-site-verification=abc123\""},
                                       {"type": 16, "data": "\"facebook-domain-verification=xyz\""}]}),
    ("crt.sh/?q=%25." + D, [{"name_value": f"{D}\nwww.{D}", "not_before": "2015-02-01T00:00:00"},
                            {"name_value": f"shop.{D}", "not_before": "2019-05-10T00:00:00"},
                            {"name_value": f"*.wholesale.{D}", "not_before": "2023-03-02T00:00:00"}]),
    ("web.archive.org/cdx", [["timestamp", "original"], ["20150311120000", f"http://{D}/"],
                             ["20180101000000", f"https://{D}/"], ["20260102000000", f"https://www.{D}/"]]),
    ("hn.algolia.com", {"hits": [{"title": "Northwind Roasters open-sources its roast-profile logger", "url": f"https://{D}/blog/logger",
                                  "points": 142, "num_comments": 51, "objectID": "1", "created_at": "2021-06-02T10:00:00Z"},
                                 {"title": "Northwind (1998) shipping line archive", "url": "https://archive.example/northwind",
                                  "points": 12, "num_comments": 2, "objectID": "2", "created_at": "2019-01-01T10:00:00Z"}]}),
    ("props=labels|descriptions|claims", {"entities": {"Q999999001": WD_ENTITY, "Q999999002": WD_OTHER}}),
    ("props=labels|descriptions&", {"entities": {k: {"labels": {"en": {"value": v}}} for k, v in LABELS.items()}}),
    ("wbsearchentities", {"search": [{"id": "Q999999001"}, {"id": "Q999999002"}]}),
    ("en.wikipedia.org/api/rest_v1/page/summary/", {"title": "Northwind Roasters", "extract": "Northwind Roasters is a fictional coffee roaster used as demo data. It was founded in 2014 and sells online.",
                                                    "content_urls": {"desktop": {"page": "https://en.wikipedia.org/wiki/Northwind_Roasters"}}}),
    ("api.gleif.org", {"data": [{"id": "DEMO00000000000000001", "attributes": {"lei": "DEMO00000000000000001",
        "entity": {"legalName": {"name": "Northwind Roasters LLC"}, "legalAddress": {"city": "Portland", "country": "US"},
                   "jurisdiction": "US-OR", "status": "ACTIVE", "creationDate": "2015-01-12T00:00:00Z"},
        "registration": {"initialRegistrationDate": "2019-04-02T00:00:00Z"}}}]}),
    ("api.github.com/users/northwindhq", {"login": "northwindhq", "type": "Organization", "public_repos": 7, "followers": 88,
                                          "html_url": "https://github.com/northwindhq", "name": "Northwind Roasters",
                                          "blog": f"https://{D}", "created_at": "2016-03-09T00:00:00Z", "location": "SHOULD NOT APPEAR"}),
    ("gitlab.com/api/v4/users", []),
    ("dev.to/api/users", {"username": "northwindhq", "joined_at": "Mar 2, 2020", "github_username": "northwindhq"}),
    ("keybase.io", {"them": [None]}),
    (f"https://{D}/", "HOME"),
]


def fetcher(url):
    for pat, body in ROUTES:
        if pat in url:
            if body == "HOME":
                return 200, HOME, f"https://www.{D}/"
            return 200, json.dumps(body), url
    return 404, "", url
