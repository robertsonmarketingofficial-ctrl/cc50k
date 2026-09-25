"""Website enrichment for lead lists: visit each lead's site once, record what's on it,
score how well the lead fits our offers, and write an icebreaker only from facts we saw.

Runs on the CSV *before* `leads import`, so the new columns (fit_score, icebreaker, ...)
flow into each lead's custom fields and the templates can use {{icebreaker|...}}.

Absence is never stated to the prospect: a static fetch can miss widgets that load later
by JavaScript, so "no booking widget seen" only feeds the internal score and the audit notes.
"""
from __future__ import annotations

import csv
import re
import time
import urllib.error
import urllib.request
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from pathlib import Path

from .leads import ALIASES, FREE_MAIL

UA = "Mozilla/5.0 (compatible; RobertsonSiteCheck/1.0; one homepage visit per business)"
MAX_BYTES = 1_500_000

# Substrings found in page source. Keep lower-case.
SIGNALS = {
    "booking": ["calendly.com", "housecallpro", "servicetitan", "jobber", "acuityscheduling", "zocdoc", "nexhealth",
                "localmed", "setmore", "squareup.com/appointments", "book.squareup", "booksy", "vagaro", "mindbodyonline",
                "schedulicity", "getjobber", "workiz", "gohighlevel", "leadconnectorhq", "/book-online", "book online",
                "schedule online", "book now", "schedule service"],
    "chat_or_text": ["podium", "birdeye", "intercom", "drift.com", "tawk.to", "livechatinc", "tidio", "hubspot.com/conversations",
                     "leadconnectorhq", "webchat", "text us", "zendesk"],
    "google_ads": ["googleadservices.com"],          # plus Google Ads IDs (AW-123...), matched below
    "meta_pixel": ["connect.facebook.net", "fbq("],
    "analytics": ["googletagmanager.com", "google-analytics.com", "gtag("],
    "call_tracking": ["callrail", "calltrackingmetrics", "whatconverts", "invoca", "marchex"],
    "reviews_widget": ["trustindex", "elfsight", "birdeye", "podium", "reviewsonmywebsite", "grade.us", "nicejob"],
    "email_capture": ["klaviyo", "mailchimp", "omnisend", "privy", "attentive", "postscript", "justuno"],
    "klaviyo": ["klaviyo"],
    "google_guaranteed": ["google guaranteed", "google-guaranteed", "google screened", "google-screened"],
}
PLATFORMS = [("shopify", "cdn.shopify.com"), ("wordpress", "wp-content"), ("wix", "wixstatic.com"),
             ("squarespace", "squarespace"), ("webflow", "webflow"), ("godaddy", "godaddy"),
             ("duda", "multiscreensite"), ("weebly", "weebly")]
YEAR_RE = re.compile(r"(?:©|&copy;|&#169;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})", re.I)
CREDIT_RE = re.compile(r"(?:website|site|web design|designed|powered|built|marketing)\s+by\s*(?:<[^>]+>\s*)*([A-Z][\w&.' -]{2,40})", re.I)
TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)


def site_for(row: dict, cols: dict) -> str:
    """The lead's website, or the business domain from their email."""
    site = (row.get(cols["website"]) or "").strip() if "website" in cols else ""
    if not site:
        email = (row.get(cols["email"]) or "").strip().lower() if "email" in cols else ""
        domain = email.rsplit("@", 1)[-1] if "@" in email else ""
        if domain and domain not in FREE_MAIL:
            site = domain
    return site


def normalise(site: str) -> str:
    site = site.strip()
    if not site:
        return ""
    if not re.match(r"^https?://", site, re.I):
        site = "https://" + site
    return site.rstrip("/") + "/"


def fetch(url: str, timeout: float = 12) -> dict:
    """GET the homepage (https first, then http). Returns status, final url, timing and html."""
    tries = [url] if url.startswith("http://") else [url, "http://" + url[len("https://"):]]
    last_err = ""
    for u in tries:
        t0 = time.monotonic()
        try:
            req = urllib.request.Request(u, headers={"User-Agent": UA, "Accept": "text/html"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read(MAX_BYTES)
                charset = resp.headers.get_content_charset() or "utf-8"
                return {"ok": True, "code": resp.status, "final_url": resp.geturl(),
                        "ms": int((time.monotonic() - t0) * 1000), "html": raw.decode(charset, errors="replace")}
        except urllib.error.HTTPError as e:
            last_err = f"http {e.code}"
        except Exception as e:  # DNS failure, timeout, TLS, refused
            last_err = type(e).__name__
    return {"ok": False, "error": last_err or "unreachable"}


def analyse(html: str, final_url: str = "", this_year: int | None = None) -> dict:
    """Pure function: facts about one page. Keys ending in _seen are presence checks only."""
    this_year = this_year or date.today().year
    low = html.lower()
    f = {f"{k}_seen": any(s in low for s in subs) for k, subs in SIGNALS.items()}
    f["google_ads_seen"] = f["google_ads_seen"] or bool(re.search(r"\baw-\d{6,}", low))
    f["platform"] = next((name for name, sig in PLATFORMS if sig in low), "")
    f["click_to_call"] = 'href="tel:' in low or "href='tel:" in low
    f["has_form"] = "<form" in low
    f["mobile_ready"] = 'name="viewport"' in low or "name='viewport'" in low
    f["https"] = final_url.lower().startswith("https://")
    years = [int(y) for y in YEAR_RE.findall(html) if int(y) <= this_year]
    f["copyright_year"] = max(years) if years else ""
    m = CREDIT_RE.search(html)
    f["agency_credit"] = m.group(1).strip(" .-") if m else ""
    t = TITLE_RE.search(html)
    f["site_title"] = re.sub(r"\s+", " ", t.group(1)).strip()[:120] if t else ""
    return f


def score(f: dict, niche: str, this_year: int | None = None) -> tuple[int, list[str], list[str]]:
    """(fit score 0-10, reasons, audit notes). Notes on absences say 'verify' for the Revenue Leak Audit."""
    this_year = this_year or date.today().year
    pts, why, notes = 0, [], []
    spends = f["google_ads_seen"] or f["meta_pixel_seen"] or f["google_guaranteed_seen"]
    old = f["copyright_year"] and f["copyright_year"] <= this_year - 2
    if niche == "ecom":
        if f["platform"] == "shopify":
            pts += 3; why.append("Shopify store")
        if not f["klaviyo_seen"] and not f["email_capture_seen"]:
            pts += 3; why.append("no email tool seen"); notes.append("No email/SMS tool seen on the homepage (verify: sign up and abandon a cart)")
        if f["meta_pixel_seen"]:
            pts += 2; why.append("runs Meta ads")
    else:  # local services and B2B share the lead-handling checks
        if spends:
            pts += 3; why.append("pays for ads")
        if not f["booking_seen"]:
            pts += 2; why.append("no online booking seen"); notes.append("No online booking seen (verify on mobile)")
        if not f["chat_or_text_seen"]:
            pts += 2; why.append("no chat/text seen"); notes.append("No chat or text-us option seen (verify after hours)")
        if spends and not f["call_tracking_seen"]:
            pts += 1; why.append("ads without call tracking"); notes.append("Ads tag present but no call tracking seen: they may not know which ads make the phone ring")
        if niche == "local" and not f["reviews_widget_seen"]:
            notes.append("No reviews shown on the site (compare Google review count with the top 3 rivals)")
    if old:
        pts += 1; why.append(f"footer says {f['copyright_year']}"); notes.append(f"Footer copyright is {f['copyright_year']}")
    if not f["mobile_ready"]:
        pts += 1; why.append("not mobile-ready"); notes.append("No mobile viewport tag: the site may be hard to use on phones")
    if not f["click_to_call"] and niche == "local":
        notes.append("No tap-to-call link seen")
    return min(10, pts), why, notes


def icebreaker(f: dict, company: str, niche: str, this_year: int | None = None) -> str:
    """One line from a fact that is present on the page, or '' so the template's fallback is used."""
    this_year = this_year or date.today().year
    name = company or "your team"
    if niche == "local" and f["google_guaranteed_seen"]:
        return (f"Saw the Google Guaranteed badge on {name}'s site. Since October 1, Google bills Local Services Ads "
                f"for missed calls over 20 seconds, so every unanswered call now costs twice.")
    if niche == "local" and f["google_ads_seen"]:
        return f"Looks like {name} has put money into Google Ads, so every missed call is a lead you've already paid for."
    if niche == "ecom" and f["meta_pixel_seen"] and f["platform"] == "shopify":
        return f"Looks like {name} runs Meta ads to the Shopify store, which makes every repeat order worth more."
    if f["copyright_year"] and f["copyright_year"] <= this_year - 3:
        return f"Noticed the footer on your site still says {f['copyright_year']}, so I took a quick look at how it handles new enquiries."
    if f["meta_pixel_seen"]:
        return f"Looks like {name} has run Facebook ads, so I took a quick look at what happens after someone clicks."
    return ""


OUT_COLS = ["site_status", "site_url", "platform", "fit_score", "fit_tier", "fit_reasons", "audit_notes", "icebreaker",
            "google_ads_seen", "google_guaranteed_seen", "meta_pixel_seen", "booking_seen", "chat_or_text_seen", "call_tracking_seen",
            "email_capture_seen", "click_to_call", "mobile_ready", "copyright_year", "agency_credit", "site_title", "response_ms"]


def tier(pts: int) -> str:
    return "A" if pts >= 6 else "B" if pts >= 3 else "C"


def enrich_csv(src: str | Path, dst: str | Path, niche: str = "local", workers: int = 12, min_score: int = 0,
               fetcher=fetch, log=print) -> Counter:
    """Add enrichment columns to every row. Rows below min_score go to <dst>_low_fit.csv."""
    with open(src, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        header = list(reader.fieldnames or [])
        rows = list(reader)
    lower = {h.strip().lower(): h for h in header}
    cols = {}
    for field in ("email", "website", "company"):
        for alias in ALIASES[field]:
            if alias in lower:
                cols[field] = lower[alias]
                break
    # one visit per site, shared by every lead at that business
    sites = {}
    for r in rows:
        u = normalise(site_for(r, cols))
        r["_site"] = u
        if u:
            sites.setdefault(u, None)
    log(f"Checking {len(sites):,} websites for {len(rows):,} leads ({workers} at a time)...")
    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        for u, res in zip(sites, pool.map(fetcher, sites)):
            sites[u] = res
    stats: Counter = Counter()
    keep, low = [], []
    for r in rows:
        u, res = r.pop("_site"), None
        out = dict.fromkeys(OUT_COLS, "")
        if not u:
            out["site_status"] = "no website"
        else:
            res = sites[u]
            if not res["ok"]:
                out.update(site_status=f"unreachable ({res['error']})", site_url=u)
            else:
                f = analyse(res["html"], res["final_url"])
                pts, why, notes = score(f, niche)
                company = (r.get(cols["company"]) or "").strip() if "company" in cols else ""
                out.update({k: ("yes" if v is True else "" if v is False else v) for k, v in f.items() if k in out})
                out.update(site_status="ok", site_url=res["final_url"], fit_score=pts, fit_tier=tier(pts),
                           fit_reasons="; ".join(why), audit_notes=" | ".join(notes),
                           icebreaker=icebreaker(f, company, niche), response_ms=res["ms"])
                stats[f"tier_{tier(pts)}"] += 1
                if out["icebreaker"]:
                    stats["with_icebreaker"] += 1
        stats[out["site_status"].split(" (")[0].replace(" ", "_")] += 1
        r.update(out)
        (keep if (out["fit_score"] != "" and int(out["fit_score"]) >= min_score) or (min_score == 0) else low).append(r)
    fields = header + [c for c in OUT_COLS if c not in header]
    for path, data in ((Path(dst), keep), (Path(dst).with_name(Path(dst).stem + "_low_fit.csv"), low)):
        if data or path == Path(dst):
            with path.open("w", newline="", encoding="utf-8") as fh:
                w = csv.DictWriter(fh, fieldnames=fields, extrasaction="ignore")
                w.writeheader(); w.writerows(data)
    stats["rows"] = len(rows); stats["kept"] = len(keep); stats["low_fit"] = len(low)
    return stats
