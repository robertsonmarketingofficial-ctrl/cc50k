"""Case model: every claim, event, entity and connection must point at a registered source.

Confidence levels, strongest first:
  record    official registry / protocol data (RDAP, DNS, certificate logs, GLEIF)
  owner     linked or published by the account/site owner themselves
  crowd     crowd-edited reference data (Wikidata, Wikipedia)
  inferred  our interpretation of a record (e.g. "MX points at Google, so they likely use Google Workspace")
  possible  unconfirmed match: same name or username only, may be a different entity
"""
from __future__ import annotations

import re
import threading
from datetime import datetime, timezone
from urllib.parse import urlparse

LEVELS = {
    "record": "Official record",
    "owner": "Owner-published",
    "crowd": "Crowd-sourced",
    "inferred": "Inferred",
    "possible": "Unconfirmed match",
}
KINDS = ("domain", "username", "company", "person", "name")

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[a-z]{2,}$", re.I)
PHONE_RE = re.compile(r"^\+?[\d\s().-]{7,}$")
ADDRESS_RE = re.compile(r"\b\d{1,6}\s+\w+(\s\w+)*\s(street|st|road|rd|avenue|ave|lane|ln|drive|dr|blvd|court|ct|way)\b", re.I)
DOMAIN_RE = re.compile(r"^(?=.{4,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$", re.I)
USERNAME_RE = re.compile(r"^@?[A-Za-z0-9](?:[A-Za-z0-9_.-]{0,38})$")


class Refused(ValueError):
    """Input the tool will not investigate (private contact details)."""


def classify(raw: str, kind: str = "auto") -> tuple[str, str]:
    """Return (kind, normalised query). Raises Refused for emails, phone numbers and street addresses."""
    q = (raw or "").strip()
    if not q:
        raise ValueError("Enter a company, person, domain or username.")
    if len(q) > 120:
        raise ValueError("That's too long for a search. Use a name, domain or username.")
    if EMAIL_RE.match(q):
        raise Refused("Email address lookups aren't supported. They're mostly used to find private people. Search the domain or company instead.")
    if PHONE_RE.match(q) and sum(c.isdigit() for c in q) >= 7:
        raise Refused("Phone number lookups aren't supported, for privacy reasons.")
    if ADDRESS_RE.search(q):
        raise Refused("Street address lookups aren't supported, for privacy reasons.")
    if q.lower().startswith(("http://", "https://")) or "/" in q:
        host = urlparse(q if "://" in q else "https://" + q).hostname or ""
        q = host
    low = q.lower().removeprefix("www.")
    if kind == "auto":
        if DOMAIN_RE.match(low) and " " not in q:
            return "domain", low
        if q.startswith("@") or (USERNAME_RE.match(q) and " " not in q and not q[0].isupper()):
            return "username", q.lstrip("@")
        return "name", q  # a name resolves to a company or a public figure once Wikidata says which
    if kind not in KINDS:
        raise ValueError(f"Unknown type {kind!r}.")
    if kind == "domain":
        if not DOMAIN_RE.match(low):
            raise ValueError("That doesn't look like a domain (e.g. example.com).")
        return kind, low
    if kind == "username":
        if not USERNAME_RE.match(q):
            raise ValueError("Usernames can only contain letters, numbers, _ . and -.")
        return kind, q.lstrip("@")
    return kind, q


def safe_url(url: str | None) -> str:
    """Only http(s) links are ever passed to the page."""
    return url if isinstance(url, str) and url.lower().startswith(("http://", "https://")) else ""


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class Case:
    def __init__(self, query: str, kind: str):
        self.query, self.kind = query, kind
        self.subject = {"name": query, "description": "", "type": kind, "level": "possible", "source": None}
        self.sources, self.claims, self.events, self.entities, self.connections = [], [], [], [], []
        self.coverage, self.notes, self.alternatives = [], [], []
        self.demo = False
        self.pivot_domain = None
        self.wiki_title = None
        self._lock = threading.Lock()
        self._by_url = {}

    # --- registration -------------------------------------------------------------------------
    def source(self, title: str, url: str, publisher: str) -> int:
        url = safe_url(url)
        if not url:
            raise ValueError("A source needs an http(s) URL.")
        with self._lock:
            if url in self._by_url:
                return self._by_url[url]
            sid = len(self.sources) + 1
            self.sources.append({"id": sid, "title": title, "url": url, "publisher": publisher, "retrieved": now_iso()})
            self._by_url[url] = sid
            return sid

    def _check(self, sid, level):
        if not any(s["id"] == sid for s in self.sources):
            raise ValueError(f"Unknown source {sid}: every claim needs a registered source.")
        if level not in LEVELS:
            raise ValueError(f"Unknown confidence level {level!r}.")

    def claim(self, section, label, value, sid, level, key=None, note="", link="", pivot=None):
        if value in (None, "", []):
            return
        self._check(sid, level)
        with self._lock:
            self.claims.append({"section": section, "label": label, "value": str(value)[:600], "sources": [sid],
                                "level": level, "key": key, "note": note, "link": safe_url(link), "pivot": pivot})

    def event(self, date, text, sid, level, note=""):
        if not date:
            return
        self._check(sid, level)
        with self._lock:
            self.events.append({"date": str(date)[:10], "text": text, "sources": [sid], "level": level, "note": note})

    def entity(self, name, relation, sid, level, pivot=None, note=""):
        if not name:
            return
        self._check(sid, level)
        with self._lock:
            self.entities.append({"name": name, "relation": relation, "sources": [sid], "level": level,
                                  "pivot": pivot, "note": note})

    def connection(self, a, b, how, sid, level, note=""):
        self._check(sid, level)
        with self._lock:
            self.connections.append({"a": a, "b": b, "how": how, "sources": [sid], "level": level, "note": note})

    def set_subject(self, name, description, type_, sid, level):
        self._check(sid, level)
        with self._lock:
            self.subject = {"name": name, "description": description, "type": type_, "level": level, "source": sid}

    def cover(self, collector, status, detail=""):
        with self._lock:
            self.coverage = [c for c in self.coverage if c["collector"] != collector]
            self.coverage.append({"collector": collector, "status": status, "detail": detail})

    # --- analysis ---------------------------------------------------------------------------
    def finalise(self):
        """Merge claims that state the same fact from different sources, and flag contradictions."""
        with self._lock:
            merged, order = {}, []
            for c in self.claims:
                k = c["key"]
                if k and k in merged:
                    m = merged[k]
                    for s in c["sources"]:
                        if s not in m["sources"]:
                            m["sources"].append(s)
                    if list(LEVELS).index(c["level"]) < list(LEVELS).index(m["level"]):
                        m["level"] = c["level"]
                    continue
                c = dict(c, sources=list(c["sources"]))
                if k:
                    merged[k] = c
                order.append(c)
            pub = {s["id"]: s["publisher"] for s in self.sources}
            for c in order:  # corroborated = stated by two independent publishers, not two lookups at one
                c["corroborated"] = len({pub[s] for s in c["sources"]}) >= 2
            self.claims = order
            # contradictions: same fact family (key prefix before the last ':') with different values
            fams = {}
            for c in order:
                if c["key"] and c["key"].count(":") >= 1 and c["key"].startswith("fact:"):
                    fam = c["key"].rsplit(":", 1)[0]
                    fams.setdefault(fam, []).append(c)
            for fam, cs in fams.items():
                vals = {c["value"] for c in cs}
                if len(vals) > 1:
                    label = cs[0]["label"]
                    self.notes.append({"kind": "conflict", "text": f"Sources disagree on {label.lower()}: " +
                                       "; ".join(f"{c['value']} [{', '.join(map(str, c['sources']))}]" for c in cs)})
                    for c in cs:
                        c["conflict"] = True
            self.events.sort(key=lambda e: e["date"])

    def to_dict(self):
        with self._lock:
            return {"query": self.query, "kind": self.kind, "subject": self.subject, "demo": self.demo,
                    "levels": LEVELS, "sources": self.sources, "claims": self.claims, "events": self.events,
                    "entities": self.entities, "connections": self.connections, "coverage": self.coverage,
                    "notes": self.notes, "alternatives": self.alternatives}
