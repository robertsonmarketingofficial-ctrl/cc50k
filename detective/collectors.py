"""Collectors: each reads one public source and records sourced claims on the Case.

A collector gets (case, net). `net.json(url)` returns parsed JSON, None for 404, or raises FetchError.
Collectors never look up private contact details: no emails, phone numbers, home addresses or
personal locations, even when a source returns them.
"""
from __future__ import annotations

import html as htmllib
import json
import re
from datetime import datetime, timezone
from urllib.parse import quote, urlparse

from .core import safe_url

UA = "InternetDetective/0.1 (public-records research tool; one request per source)"


class FetchError(Exception):
    pass


class Net:
    def __init__(self, fetcher):
        self.fetcher = fetcher  # fetcher(url) -> (status, text, final_url)

    def text(self, url):
        status, body, final = self.fetcher(url)
        if status == 404:
            return None, final
        if status >= 400:
            raise FetchError(f"HTTP {status}")
        return body, final

    def json(self, url):
        body, _ = self.text(url)
        if body is None:
            return None
        try:
            return json.loads(body)
        except ValueError:
            raise FetchError("unexpected response (not JSON)")


def urllib_fetcher(url, timeout=20, max_bytes=4_000_000):
    import urllib.error
    import urllib.request
    req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json, text/html;q=0.9"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read(max_bytes)
            return r.status, raw.decode(r.headers.get_content_charset() or "utf-8", "replace"), r.geturl()
    except urllib.error.HTTPError as e:
        return e.code, "", url
    except Exception as e:  # DNS, TLS, timeout, proxy refusal
        raise FetchError(type(e).__name__)


def ymd(value) -> str:
    """ISO date from ISO strings, Wikidata '+2010-00-00T..' times or unix seconds."""
    if value in (None, ""):
        return ""
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value, timezone.utc).strftime("%Y-%m-%d")
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", str(value)) or re.fullmatch(r"\s*(\d{4})\s*", str(value))
    if not m:
        return ""
    y, mo, d = (m.groups() + ("00", "00"))[:3]
    if not mo or mo == "00":  # year precision only: never invent a month or day
        return y
    return f"{y}-{mo}" if not d or d == "00" else f"{y}-{mo}-{d}"


def strip_tags(s: str, n=300) -> str:
    s = htmllib.unescape(re.sub(r"<[^>]+>", " ", s or ""))
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[: n - 1] + "…"


SOCIAL = [  # (platform, host regex, path capture) — public profile URLs only
    ("X / Twitter", r"(?:twitter|x)\.com", r"/(?!intent|share|home|search)([A-Za-z0-9_]{1,15})/?$"),
    ("LinkedIn", r"linkedin\.com", r"/(company|in|school)/([^/?#]+)"),
    ("Facebook", r"facebook\.com", r"/(?!sharer|share|dialog)([A-Za-z0-9.\-]{2,})/?$"),
    ("Instagram", r"instagram\.com", r"/([A-Za-z0-9_.]{1,30})/?$"),
    ("YouTube", r"youtube\.com", r"/(@[\w.-]+|c/[\w.-]+|channel/[\w-]+|user/[\w.-]+)"),
    ("TikTok", r"tiktok\.com", r"/(@[\w.]+)"),
    ("GitHub", r"github\.com", r"/([A-Za-z0-9-]{1,39})/?$"),
    ("Pinterest", r"pinterest\.com", r"/([A-Za-z0-9_]{3,30})/?$"),
]


def social_handle(url: str):
    p = urlparse(url)
    host = (p.hostname or "").lower().removeprefix("www.").removeprefix("m.")
    for name, hre, pre in SOCIAL:
        if re.fullmatch(r"(?:[\w-]+\.)?" + hre, host):
            m = re.search(pre, p.path or "")
            if m:
                return name, m.group(m.lastindex).lower()
    return None


# ------------------------------------------------------------------------------------------------
# Domain collectors
# ------------------------------------------------------------------------------------------------

def rdap(case, net, domain):
    url = f"https://rdap.org/domain/{domain}"
    data = net.json(url)
    if not data:
        return "empty", "No registration record found"
    sid = case.source(f"RDAP registration record for {domain}", url, "Domain registry (via rdap.org)")
    for ev in data.get("events", []):
        act, date = ev.get("eventAction", ""), ymd(ev.get("eventDate"))
        if act == "registration":
            case.claim("websites", "Domain registered", date, sid, "record", key=f"fact:registered:{date}")
            case.event(date, f"{domain} registered", sid, "record")
        elif act == "expiration":
            case.claim("websites", "Registration expires", date, sid, "record")
        elif act == "last changed":
            case.claim("websites", "Record last changed", date, sid, "record")
    for ent in data.get("entities", []):
        if "registrar" in ent.get("roles", []):
            vc = ent.get("vcardArray", [None, []])[1]
            fn = next((v[3] for v in vc if v and v[0] == "fn"), "")
            case.claim("websites", "Registrar", fn, sid, "record", key=f"registrar:{fn.lower()}")
    ns = [n.get("ldhName", "").lower() for n in data.get("nameservers", []) if n.get("ldhName")]
    case.claim("websites", "Nameservers", ", ".join(ns), sid, "record")
    status = data.get("status", [])
    case.claim("websites", "Registry status", ", ".join(status), sid, "record",
               note="'client/server … prohibited' flags are normal locks against hijacking.")
    if data.get("secureDNS", {}).get("delegationSigned"):
        case.claim("websites", "DNSSEC", "Signed", sid, "record")
    return "ok", ""


MX_PROVIDERS = [("google.com", "Google Workspace"), ("googlemail.com", "Google Workspace"),
                ("outlook.com", "Microsoft 365"), ("zoho", "Zoho Mail"), ("protonmail", "Proton Mail"),
                ("mimecast", "Mimecast"), ("pphosted.com", "Proofpoint"), ("secureserver.net", "GoDaddy email"),
                ("messagingengine.com", "Fastmail"), ("icloud.com", "iCloud Mail"), ("barracudanetworks", "Barracuda")]
NS_PROVIDERS = [("cloudflare.com", "Cloudflare"), ("awsdns", "Amazon Route 53"), ("azure-dns", "Azure DNS"),
                ("domaincontrol.com", "GoDaddy DNS"), ("googledomains.com", "Google Cloud DNS"), ("nsone.net", "NS1"),
                ("registrar-servers.com", "Namecheap DNS"), ("wixdns.net", "Wix"), ("dnsimple", "DNSimple"),
                ("squarespacedns", "Squarespace"), ("vercel-dns.com", "Vercel"), ("digitalocean.com", "DigitalOcean")]
SPF_SENDERS = [("_spf.google.com", "Google Workspace"), ("spf.protection.outlook.com", "Microsoft 365"),
               ("sendgrid.net", "SendGrid"), ("mailgun.org", "Mailgun"), ("servers.mcsv.net", "Mailchimp"),
               ("amazonses.com", "Amazon SES"), ("_spf.salesforce.com", "Salesforce"), ("mail.zendesk.com", "Zendesk"),
               ("spf.mandrillapp.com", "Mailchimp Transactional"), ("hubspotemail.net", "HubSpot"),
               ("zoho.com", "Zoho"), ("mail.intercom.io", "Intercom"), ("spf.mtasv.net", "Postmark"),
               ("_spf.klaviyo.com", "Klaviyo"), ("shops.shopify.com", "Shopify")]
TXT_VERIFICATIONS = [("google-site-verification=", "Google Search Console"),
                     ("facebook-domain-verification=", "Meta Business"), ("ms=", "Microsoft 365"),
                     ("atlassian-domain-verification=", "Atlassian"), ("apple-domain-verification=", "Apple"),
                     ("docusign=", "DocuSign"), ("stripe-verification=", "Stripe"), ("zoom_verify_", "Zoom"),
                     ("adobe-idp-site-verification=", "Adobe"), ("openai-domain-verification=", "OpenAI"),
                     ("dropbox-domain-verification=", "Dropbox"), ("cisco-ci-domain-verification=", "Webex"),
                     ("hubspot-developer-verification=", "HubSpot"), ("miro-verification=", "Miro")]
A_HOSTS = [("23.227.38.", "Shopify"), ("198.185.159.", "Squarespace"), ("198.49.23.", "Squarespace"),
           ("76.76.21.", "Vercel"), ("75.2.60.", "Netlify"), ("185.199.108.", "GitHub Pages"),
           ("185.199.109.", "GitHub Pages"), ("185.199.110.", "GitHub Pages"), ("185.199.111.", "GitHub Pages")]


def dns(case, net, domain):
    def q(name, rtype):
        url = f"https://dns.google/resolve?name={name}&type={rtype}"
        data = net.json(url) or {}
        answers = [a.get("data", "") for a in data.get("Answer", []) if a.get("type") != 5]  # skip CNAME hops
        return url, answers

    found = False
    url, a = q(domain, "A")
    if a:
        found = True
        sid = case.source(f"DNS A records for {domain}", url, "Google Public DNS")
        case.claim("websites", "Web server IPs", ", ".join(a[:6]), sid, "record")
        for pre, host in A_HOSTS:
            if any(ip.startswith(pre) for ip in a):
                case.claim("connections", "Website hosting", host, sid, "inferred", key=f"tech:{host.lower()}",
                           note=f"The site resolves to an IP range {host} is known to use.")
                case.connection(domain, host, "website hosted on", sid, "inferred")
    url, mx = q(domain, "MX")
    if mx:
        found = True
        sid = case.source(f"DNS MX records for {domain}", url, "Google Public DNS")
        hosts = [m.split()[-1].rstrip(".").lower() for m in mx]
        case.claim("websites", "Mail servers", ", ".join(hosts[:5]), sid, "record")
        for pat, name in MX_PROVIDERS:
            if any(pat in h for h in hosts):
                case.claim("connections", "Email provider", name, sid, "inferred", key=f"tech:{name.lower()}",
                           note="Based on where the domain's mail is delivered.")
                case.connection(domain, name, "email handled by", sid, "inferred")
                break
    url, ns = q(domain, "NS")
    if ns:
        found = True
        sid = case.source(f"DNS NS records for {domain}", url, "Google Public DNS")
        for pat, name in NS_PROVIDERS:
            if any(pat in n.lower() for n in ns):
                case.claim("connections", "DNS provider", name, sid, "inferred", key=f"tech:{name.lower()}")
                case.connection(domain, name, "DNS hosted by", sid, "inferred")
                break
    url, txt = q(domain, "TXT")
    if txt:
        found = True
        sid = case.source(f"DNS TXT records for {domain}", url, "Google Public DNS")
        seen = set()
        for t in (x.strip('"').lower() for x in txt):
            if t.startswith("v=spf1"):
                for pat, name in SPF_SENDERS:
                    if pat in t and name not in seen:
                        seen.add(name)
                        case.claim("connections", "Allowed to send its email", name, sid, "inferred",
                                   key=f"tech:{name.lower()}", note="Listed in the domain's SPF record, which usually means they use this service.")
                        case.connection(domain, name, "authorises email from", sid, "inferred")
            for pat, name in TXT_VERIFICATIONS:
                if t.startswith(pat) and name not in seen:
                    seen.add(name)
                    case.claim("connections", "Verified account with", name, sid, "inferred", key=f"tech:{name.lower()}",
                               note="A verification record for this service exists. It may be old or unused.")
                    case.connection(domain, name, "verified domain with", sid, "inferred")
    url, dm = q(f"_dmarc.{domain}", "TXT")
    if dm:
        sid = case.source(f"DMARC policy for {domain}", url, "Google Public DNS")
        pol = re.search(r"\bp=(\w+)", " ".join(dm))
        case.claim("websites", "DMARC email policy", pol.group(1) if pol else "present", sid, "record",
                   note="reject/quarantine = spoofed email is blocked; none = monitoring only.")
    return ("ok", "") if found else ("empty", "No DNS records returned")


def certificates(case, net, domain):
    url = f"https://crt.sh/?q=%25.{domain}&output=json"
    data = net.json(url)
    if not data:
        return "empty", "No certificates logged"
    sid = case.source(f"Certificate Transparency logs for *.{domain}", f"https://crt.sh/?q=%25.{domain}", "crt.sh")
    subs, first = set(), None
    for c in data:
        for n in str(c.get("name_value", "")).lower().split("\n"):
            n = n.strip().lstrip("*.")
            if n.endswith(domain) and n != domain and DOMAINISH.match(n):
                subs.add(n)
        d = ymd(c.get("not_before"))
        if d and (first is None or d < first):
            first = d
    if first:
        case.claim("websites", "First HTTPS certificate", first, sid, "record")
        case.event(first, "Earliest logged HTTPS certificate", sid, "record")
    if subs:
        shown = sorted(subs, key=lambda s: (s.count("."), s))[:40]
        case.claim("websites", f"Subdomains seen in certificates ({len(subs)})", ", ".join(shown), sid, "record",
                   note="Public certificate logs. A subdomain may no longer be in use.")
        for s in shown[:12]:
            case.entity(s, "subdomain", sid, "record", pivot={"type": "domain", "q": s})
    return "ok", f"{len(data)} certificates"


DOMAINISH = re.compile(r"^[a-z0-9.-]+$")


def wayback(case, net, domain):
    url = (f"https://web.archive.org/cdx/search/cdx?url={domain}&output=json&fl=timestamp,original"
           f"&filter=statuscode:200&collapse=timestamp:4&limit=100")
    data = net.json(url)
    rows = (data or [])[1:]
    if not rows:
        return "empty", "Never archived"
    sid = case.source(f"Internet Archive captures of {domain}", f"https://web.archive.org/web/*/{domain}", "Internet Archive")
    first, last = rows[0], rows[-1]
    stamp = lambda ts: ymd(f"{ts[:4]}-{ts[4:6] or '01'}-{ts[6:8] or '01'}")
    fd, ld = stamp(first[0]), stamp(last[0])
    snap = case.source(f"Earliest archived snapshot of {domain}", f"https://web.archive.org/web/{first[0]}/{first[1]}", "Internet Archive")
    case.claim("websites", "First archived", fd, snap, "record", link=f"https://web.archive.org/web/{first[0]}/{first[1]}",
               note="The site existed by this date. It may be older.")
    case.claim("websites", "Years with archived snapshots", f"{len(rows)} (from {fd[:4]} to {ld[:4]})", sid, "record")
    case.event(fd, "First snapshot in the Internet Archive", snap, "record")
    return "ok", ""


def homepage(case, net, domain):
    url = f"https://{domain}/"
    html, final = net.text(url)
    if not html:
        return "empty", "Homepage not reachable"
    final = safe_url(final) or url
    sid = case.source(f"Homepage of {domain}", final, domain)
    t = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    case.claim("identity", "Website title", strip_tags(t.group(1), 160) if t else "", sid, "owner")
    for prop in ("og:site_name", "description", "og:description"):
        m = re.search(rf'<meta[^>]+(?:name|property)=["\']{prop}["\'][^>]+content=["\']([^"\']+)', html, re.I) or \
            re.search(rf'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:name|property)=["\']{prop}["\']', html, re.I)
        if m:
            label = "Name on website" if prop == "og:site_name" else "How it describes itself"
            case.claim("identity", label, strip_tags(m.group(1), 300), sid, "owner",
                       key="selfdesc" if label != "Name on website" else None)
    gen = re.search(r'<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)', html, re.I)
    if gen:
        case.claim("connections", "Website built with", strip_tags(gen.group(1), 60), sid, "owner",
                   key=f"tech:{gen.group(1).split()[0].lower()}")
    if "cdn.shopify.com" in html:
        case.claim("connections", "Website hosting", "Shopify", sid, "inferred", key="tech:shopify")
    # organisation facts published as structured data
    for block in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', html, re.I | re.S):
        try:
            data = json.loads(block)
        except ValueError:
            continue
        items = data if isinstance(data, list) else data.get("@graph", [data]) if isinstance(data, dict) else []
        for it in items:
            types = it.get("@type") if isinstance(it, dict) else None
            types = types if isinstance(types, list) else [types]
            if not any(t in ("Organization", "Corporation", "LocalBusiness", "OnlineStore") for t in types):
                continue
            case.claim("company", "Legal/brand name (structured data)", it.get("legalName") or it.get("name"), sid, "owner")
            fd = ymd(it.get("foundingDate"))
            if fd:
                case.claim("company", "Founded", fd[:4], sid, "owner", key=f"fact:founded:{fd[:4]}")
                case.event(fd, "Founded (according to its own website)", sid, "owner")
            same = it.get("sameAs") or []
            for u in same if isinstance(same, list) else [same]:
                sh = social_handle(str(u))
                if sh:
                    case.claim("social", sh[0], sh[1], sid, "owner", key=f"social:{sh[0]}:{sh[1]}", link=str(u),
                               note="Listed as its own profile in the site's structured data.")
    for href in set(re.findall(r'href=["\'](https?://[^"\'\s>]+)', html, re.I)):
        sh = social_handle(href)
        if sh:
            case.claim("social", sh[0], sh[1], sid, "owner", key=f"social:{sh[0]}:{sh[1]}", link=href,
                       note="Linked from the official website.")
    years = [int(y) for y in re.findall(r"(?:©|&copy;|copyright)\s*(?:\d{4}\s*[-–]\s*)?((?:19|20)\d{2})", html, re.I)]
    if years:
        case.claim("websites", "Copyright year in footer", max(years), sid, "owner", note="A stale year can mean the site is rarely updated.")
    return "ok", ""


# ------------------------------------------------------------------------------------------------
# Name collectors (company / person)
# ------------------------------------------------------------------------------------------------

WD = "https://www.wikidata.org/w/api.php"
HUMAN = "Q5"
WD_PROPS = {  # property -> (section, label, relation for entities)
    "P31": ("identity", "Instance of", None), "P452": ("company", "Industry", None),
    "P571": ("company", "Founded", None), "P159": ("company", "Headquarters (city)", None),
    "P17": ("company", "Country", None), "P1128": ("company", "Employees", None),
    "P414": ("company", "Stock exchange", None), "P249": ("company", "Ticker", None),
    "P112": ("related", None, "founded by"), "P169": ("related", None, "chief executive"),
    "P488": ("related", None, "chairperson"), "P749": ("related", None, "parent organization"),
    "P355": ("related", None, "subsidiary"), "P127": ("related", None, "owned by"),
    "P1830": ("related", None, "owns"), "P199": ("related", None, "business division"),
    "P106": ("identity", "Occupation", None), "P108": ("related", None, "employer"),
    "P39": ("identity", "Position held", None), "P69": ("related", None, "educated at"),
    "P463": ("related", None, "member of"),
}
WD_SOCIAL = {"P2002": ("X / Twitter", "https://x.com/{}"), "P2003": ("Instagram", "https://instagram.com/{}"),
             "P2013": ("Facebook", "https://facebook.com/{}"), "P4264": ("LinkedIn", "https://linkedin.com/company/{}"),
             "P2037": ("GitHub", "https://github.com/{}"), "P2397": ("YouTube", "https://youtube.com/channel/{}"),
             "P7085": ("TikTok", "https://tiktok.com/@{}")}


def _values(entity, prop):
    out = []
    for st in entity.get("claims", {}).get(prop, []):
        if st.get("rank") == "deprecated":
            continue
        dv = st.get("mainsnak", {}).get("datavalue", {})
        v = dv.get("value")
        if isinstance(v, dict) and "id" in v:
            out.append(("item", v["id"]))
        elif isinstance(v, dict) and "time" in v:
            out.append(("time", v["time"]))
        elif isinstance(v, dict) and "amount" in v:
            out.append(("qty", v["amount"].lstrip("+")))
        elif isinstance(v, str):
            out.append(("str", v))
    return out


def _labels(net, ids):
    ids = [i for i in dict.fromkeys(ids)][:50]
    if not ids:
        return {}
    data = net.json(f"{WD}?action=wbgetentities&ids={'|'.join(ids)}&props=labels|descriptions&languages=en&format=json") or {}
    return {k: (v.get("labels", {}).get("en", {}).get("value", k), v.get("descriptions", {}).get("en", {}).get("value", ""))
            for k, v in data.get("entities", {}).items()}


def _hosts(e):
    return {(urlparse(v).hostname or "").removeprefix("www.") for _, v in _values(e, "P856")}


def wikidata(case, net, name, want, require_domain=None):
    """want: 'company', 'person' or 'any' (a company, or a person with a Wikipedia article).
    require_domain: only accept an entry whose official website is this domain (used for domain searches).
    Sets case.pivot_domain / case.wiki_title for the next phase."""
    res = net.json(f"{WD}?action=wbsearchentities&search={quote(name)}&language=en&format=json&limit=7&type=item") or {}
    hits = res.get("search", [])
    if not hits:
        return "empty", "No Wikidata entry"
    ids = [h["id"] for h in hits]
    data = net.json(f"{WD}?action=wbgetentities&ids={'|'.join(ids)}&props=labels|descriptions|claims|sitelinks&languages=en&format=json") or {}
    ents = data.get("entities", {})

    def is_human(e):
        return any(v == HUMAN for _, v in _values(e, "P31"))

    def org(e):
        return not is_human(e) and bool(_values(e, "P856") or _values(e, "P571") or _values(e, "P452"))

    def fits(e):
        if require_domain:
            return require_domain in _hosts(e)
        if want == "person":
            return is_human(e)
        if want == "company":
            return org(e)
        return org(e) or (is_human(e) and "enwiki" in e.get("sitelinks", {}))

    ranked = [ents[i] for i in ids if i in ents and fits(ents[i])]
    if not ranked and require_domain:
        return "empty", "No Wikidata entry lists this as its official website"
    if not ranked:
        return "empty", f"No Wikidata entry that looks like a {want}"
    if want == "person" and "enwiki" not in ranked[0].get("sitelinks", {}):
        case.notes.append({"kind": "privacy", "text": "The only matching people have no Wikipedia article, so they may be private individuals. This tool doesn't build profiles of private people, so the search stops here."})
        return "skipped", "Not a public figure"
    e = ranked[0]
    qid = e["id"]
    label = e.get("labels", {}).get("en", {}).get("value", name)
    desc = e.get("descriptions", {}).get("en", {}).get("value", "")
    close = label.lower() == name.lower() or name.lower() in label.lower() or label.lower() in name.lower()
    if not require_domain and not close:  # never pivot a whole case onto a loose search result
        for other in ranked[:5]:
            case.alternatives.append({"name": other.get("labels", {}).get("en", {}).get("value", ""),
                                      "description": other.get("descriptions", {}).get("en", {}).get("value", ""),
                                      "url": f"https://www.wikidata.org/wiki/{other['id']}"})
        return "empty", "No close match (see suggestions)"
    sid = case.source(f"Wikidata: {label} ({qid})", f"https://www.wikidata.org/wiki/{qid}", "Wikidata (crowd-edited)")
    case.set_subject(label, desc, "person" if is_human(e) else "company", sid, "crowd")
    exact = label.lower() == name.lower()
    if require_domain:
        case.claim("identity", "Organisation behind this domain", f"{label}: {desc}" if desc else label, sid, "crowd",
                   note="Wikidata lists this domain as the organisation's official website.")
    else:
        case.claim("identity", "Best match", f"{label}: {desc}" if desc else label, sid, "crowd" if exact else "possible",
                   note="" if exact else "Matched by a similar name. Check the description is the one you mean.")
    for other in ranked[1:5]:
        ol = other.get("labels", {}).get("en", {}).get("value", "")
        od = other.get("descriptions", {}).get("en", {}).get("value", "")
        case.alternatives.append({"name": ol, "description": od, "url": f"https://www.wikidata.org/wiki/{other['id']}"})

    refs = [v for p in WD_PROPS for k, v in _values(e, p) if k == "item"]
    labels = _labels(net, refs)
    for p, (section, lab, rel) in WD_PROPS.items():
        for kind, v in _values(e, p)[:8]:
            if is_human(e) and p in ("P17", "P159", "P1128", "P414", "P249"):
                continue
            text = labels.get(v, (v, ""))[0] if kind == "item" else ymd(v)[:4] if kind == "time" else v
            if rel:
                pv = {"type": "person" if p in ("P112", "P169", "P488") else "company", "q": text}
                case.entity(text, rel, sid, "crowd", pivot=pv, note=labels.get(v, ("", ""))[1])
            elif p == "P571":
                case.claim(section, lab, text, sid, "crowd", key=f"fact:founded:{text}")
                case.event(ymd(v), f"{label} founded (inception)", sid, "crowd")
            else:
                case.claim(section, lab, text, sid, "crowd", key=f"wd:{p}:{text}")
    pivot = None
    for kind, v in _values(e, "P856")[:3]:
        host = (urlparse(v).hostname or "").removeprefix("www.")
        case.claim("websites", "Official website", host, sid, "crowd", key=f"website:{host}", link=v,
                   pivot={"type": "domain", "q": host})
        pivot = pivot or host
    for p, (plat, fmt) in WD_SOCIAL.items():
        for _, v in _values(e, p)[:2]:
            case.claim("social", plat, v.lower(), sid, "crowd", key=f"social:{plat}:{v.lower()}", link=fmt.format(v))
    wiki = e.get("sitelinks", {}).get("enwiki", {}).get("title")
    case.pivot_domain = pivot
    case.wiki_title = wiki
    return "ok", label


def wikipedia(case, net, title):
    url = f"https://en.wikipedia.org/api/rest_v1/page/summary/{quote(title.replace(' ', '_'))}"
    data = net.json(url)
    if not data or not data.get("extract"):
        return "empty", "No article summary"
    page = data.get("content_urls", {}).get("desktop", {}).get("page") or f"https://en.wikipedia.org/wiki/{quote(title)}"
    sid = case.source(f"Wikipedia: {data.get('title', title)}", page, "Wikipedia (crowd-edited)")
    case.claim("identity", "Summary", strip_tags(data["extract"], 700), sid, "crowd")
    return "ok", ""


def gleif(case, net, name):
    url = f"https://api.gleif.org/api/v1/lei-records?filter[fulltext]={quote(name)}&page[size]=6"
    data = net.json(url) or {}
    recs = data.get("data", [])
    if not recs:
        return "empty", "No legal-entity (LEI) records"
    norm = lambda s: re.sub(r"[^a-z0-9 ]", "", re.sub(r"\b(inc|llc|ltd|limited|corp|corporation|co|gmbh|plc|sa|bv)\b\.?", "", s.lower())).strip()
    shown = 0
    for r in recs:
        a = r.get("attributes", {})
        ent, reg = a.get("entity", {}), a.get("registration", {})
        legal = ent.get("legalName", {}).get("name", "")
        lei = a.get("lei") or r.get("id")
        if not legal or not lei:
            continue
        exact = norm(legal) == norm(name)
        sid = case.source(f"GLEIF LEI record: {legal}", f"https://search.gleif.org/#/record/{lei}", "GLEIF (global legal-entity registry)")
        addr = ent.get("legalAddress", {})
        where = ", ".join(x for x in (addr.get("city"), addr.get("country")) if x)
        level = "record" if exact else "possible"
        note = "Registry record. The name matches exactly, but check the country." if exact else "Similar name only. May be a different company."
        case.claim("company", "Registered legal entity", f"{legal} ({where}) · LEI {lei} · {ent.get('status', '').lower()}",
                   sid, level, note=note, link=f"https://search.gleif.org/#/record/{lei}")
        if ent.get("jurisdiction"):
            case.claim("company", f"Jurisdiction: {legal}", ent["jurisdiction"], sid, level)
        cd = ymd(ent.get("creationDate"))
        if cd and exact:
            case.event(cd, f"{legal} legally created ({where})", sid, "record")
        rd = ymd(reg.get("initialRegistrationDate"))
        if rd and exact:
            case.event(rd, f"{legal} received its LEI", sid, "record")
        shown += 1
        if shown >= 4:
            break
    return "ok", f"{shown} records"


def hn_mentions(case, net, term, is_domain=False):
    url = f"https://hn.algolia.com/api/v1/search?query={quote(term)}&tags=story&hitsPerPage=12"
    data = net.json(url) or {}
    hits = data.get("hits", [])
    if not hits:
        return "empty", "No Hacker News stories"
    n = 0
    for h in hits:
        title = h.get("title") or ""
        link = h.get("url") or ""
        about = is_domain and term in (urlparse(link).hostname or "")
        if not is_domain and term.lower() not in title.lower():
            continue
        item = f"https://news.ycombinator.com/item?id={h.get('objectID')}"
        sid = case.source(f"Hacker News: {title[:80]}", item, "Hacker News")
        d = ymd(h.get("created_at"))
        case.claim("mentions", d, f"{title} · {h.get('points', 0)} points, {h.get('num_comments', 0)} comments", sid,
                   "record" if about else "possible", link=item,
                   note="Links to this domain." if about else "Mentions the name. It may be about something else with the same name.")
        if h.get("points", 0) >= 100:
            case.event(d, f"Popular Hacker News story: {title[:90]}", sid, "record" if about else "possible")
        n += 1
        if n >= 8:
            break
    return ("ok", f"{n} stories") if n else ("empty", "No stories naming it")


# ------------------------------------------------------------------------------------------------
# Username collectors: public profiles only, and a match is never treated as proof of identity
# ------------------------------------------------------------------------------------------------

def github(case, net, user):
    data = net.json(f"https://api.github.com/users/{quote(user)}")
    if not data:
        return "empty", "No GitHub account"
    url = data.get("html_url") or f"https://github.com/{user}"
    sid = case.source(f"GitHub profile: {data.get('login', user)}", url, "GitHub")
    kind = "organisation" if data.get("type") == "Organization" else "user"
    case.claim("social", "GitHub", f"{data.get('login')} ({kind}) · {data.get('public_repos', 0)} public repos, {data.get('followers', 0)} followers",
               sid, "possible", key=f"social:GitHub:{user.lower()}", link=url, note="Same username. That alone doesn't prove it's the same person or company.")
    case.claim("identity", "Display name on GitHub", data.get("name"), sid, "owner", note="Self-chosen, unverified.")
    case.claim("identity", "GitHub bio", strip_tags(data.get("bio") or "", 200), sid, "owner")
    case.event(ymd(data.get("created_at")), "GitHub account created", sid, "record")
    blog = (data.get("blog") or "").strip()
    if blog:
        host = (urlparse(blog if "://" in blog else "https://" + blog).hostname or "").removeprefix("www.")
        if host:
            case.claim("websites", "Website listed on GitHub", host, sid, "owner", key=f"website:{host}", pivot={"type": "domain", "q": host})
            case.connection(f"GitHub @{user}", host, "links to website", sid, "owner")
    return "ok", ""


def gitlab(case, net, user):
    data = net.json(f"https://gitlab.com/api/v4/users?username={quote(user)}")
    if not data:
        return "empty", "No GitLab account"
    u = data[0]
    sid = case.source(f"GitLab profile: {u.get('username')}", u.get("web_url") or f"https://gitlab.com/{user}", "GitLab")
    case.claim("social", "GitLab", u.get("username"), sid, "possible", key=f"social:GitLab:{user.lower()}", link=u.get("web_url"),
               note="Same username. It may be someone else.")
    return "ok", ""


def hackernews_user(case, net, user):
    data = net.json(f"https://hacker-news.firebaseio.com/v0/user/{quote(user)}.json")
    if not data:
        return "empty", "No Hacker News account"
    url = f"https://news.ycombinator.com/user?id={quote(user)}"
    sid = case.source(f"Hacker News profile: {user}", url, "Hacker News")
    case.claim("social", "Hacker News", f"{user} · {data.get('karma', 0)} karma", sid, "possible",
               key=f"social:Hacker News:{user.lower()}", link=url, note="Same username. It may be someone else.")
    case.event(ymd(data.get("created")), "Hacker News account created", sid, "record")
    return "ok", ""


def devto(case, net, user):
    data = net.json(f"https://dev.to/api/users/by_username?url={quote(user)}")
    if not data:
        return "empty", "No DEV account"
    url = f"https://dev.to/{quote(user)}"
    sid = case.source(f"DEV profile: {user}", url, "DEV Community")
    case.claim("social", "DEV", user, sid, "possible", key=f"social:DEV:{user.lower()}", link=url, note="Same username. It may be someone else.")
    case.event(ymd(data.get("joined_at")), "DEV account created", sid, "record")
    for field, plat in (("github_username", "GitHub"), ("twitter_username", "X / Twitter")):
        v = data.get(field)
        if v:
            case.connection(f"DEV @{user}", f"{plat} @{v}", "profile links to", sid, "owner",
                            note="The account owner added this link themselves.")
    return "ok", ""


def keybase(case, net, user):
    data = net.json(f"https://keybase.io/_/api/1.0/user/lookup.json?usernames={quote(user)}&fields=basics,proofs_summary") or {}
    them = [t for t in (data.get("them") or []) if t]
    if not them:
        return "empty", "No Keybase account"
    url = f"https://keybase.io/{quote(user)}"
    sid = case.source(f"Keybase profile: {user}", url, "Keybase")
    case.claim("social", "Keybase", user, sid, "possible", key=f"social:Keybase:{user.lower()}", link=url)
    for p in (them[0].get("proofs_summary") or {}).get("all", [])[:12]:
        target = f"{p.get('proof_type')} @{p.get('nametag')}"
        case.connection(f"Keybase @{user}", target, "cryptographically proved ownership of", sid, "owner",
                        note="The owner published a signed proof linking these accounts.")
    return "ok", ""


USERNAME_COLLECTORS = [("GitHub", github), ("GitLab", gitlab), ("Hacker News", hackernews_user), ("DEV", devto), ("Keybase", keybase)]
