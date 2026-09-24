"""Lead import and list hygiene."""
from __future__ import annotations

import csv
import json
import re
import sqlite3
from collections import Counter
from pathlib import Path

from .db import is_suppressed

EMAIL_RE = re.compile(r"^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*\.[A-Za-z]{2,}$")

ROLE_PREFIXES = {
    "info", "admin", "administrator", "sales", "support", "help", "contact", "hello",
    "office", "billing", "accounts", "accounting", "careers", "jobs", "hr", "marketing",
    "noreply", "no-reply", "donotreply", "webmaster", "postmaster", "abuse", "team",
    "enquiries", "inquiries", "service", "customerservice", "privacy", "legal", "security",
}

FREE_MAIL = {
    "gmail.com", "googlemail.com", "yahoo.com", "hotmail.com", "outlook.com", "live.com",
    "msn.com", "aol.com", "icloud.com", "me.com", "mac.com", "proton.me", "protonmail.com",
    "gmx.com", "gmx.de", "yandex.com", "mail.com", "zoho.com", "comcast.net", "att.net",
    "verizon.net", "sbcglobal.net", "ymail.com", "rocketmail.com",
}

# Column aliases so exports from Apollo, Clay, Sales Nav tools, etc. import without editing.
ALIASES = {
    "email": ["email", "email address", "work email", "e-mail", "contact email"],
    "first_name": ["first_name", "first name", "firstname", "first"],
    "last_name": ["last_name", "last name", "lastname", "last"],
    "company": ["company", "company name", "organization", "organization name", "account name"],
    "title": ["title", "job title", "position"],
    "website": ["website", "company website", "domain", "company domain", "url"],
    "industry": ["industry"],
    "city": ["city", "location city"],
    "country": ["country"],
    "verification": ["verification", "email status", "status", "result", "verification status"],
}

VALID_STATUSES = {"valid", "deliverable", "verified", "ok", "safe"}
CATCH_ALL_STATUSES = {"catch-all", "catch_all", "catchall", "accept_all", "accept-all", "risky", "unknown"}


def _map_columns(header: list[str]) -> dict[str, str]:
    lower = {h.strip().lower(): h for h in header}
    mapping = {}
    for field, names in ALIASES.items():
        for name in names:
            if name in lower:
                mapping[field] = lower[name]
                break
    return mapping


def _has_mx(domain: str) -> bool | None:
    try:
        import dns.resolver  # type: ignore
    except ImportError:
        return None
    try:
        return bool(dns.resolver.resolve(domain, "MX", lifetime=5))
    except Exception:
        return False


def classify(email: str, verification: str, cfg: dict) -> str | None:
    """Return a rejection reason or None if the address is sendable."""
    if not EMAIL_RE.match(email):
        return "bad_syntax"
    local, domain = email.split("@", 1)
    if cfg.get("skip_role_accounts", True) and local.split("+")[0] in ROLE_PREFIXES:
        return "role_account"
    if cfg.get("skip_free_mail", True) and domain in FREE_MAIL:
        return "free_mail"
    v = verification.strip().lower()
    if v:
        if v in CATCH_ALL_STATUSES:
            if not cfg.get("allow_catch_all", False):
                return "catch_all"
        elif v not in VALID_STATUSES:
            return f"verifier_{v.replace(' ', '_')}"
    return None


def import_csv(conn: sqlite3.Connection, path: str | Path, cfg: dict, source: str = "") -> Counter:
    stats: Counter = Counter()
    mx_cache: dict[str, bool | None] = {}
    with open(path, newline="", encoding="utf-8-sig") as fh:
        reader = csv.DictReader(fh)
        if not reader.fieldnames:
            raise ValueError("CSV has no header row")
        cols = _map_columns(reader.fieldnames)
        if "email" not in cols:
            raise ValueError(f"No email column found. Headers: {reader.fieldnames}")
        known = set(cols.values())
        for row in reader:
            stats["rows"] += 1
            get = lambda f: (row.get(cols[f]) or "").strip() if f in cols else ""  # noqa: E731
            email = get("email").lower()
            reason = classify(email, get("verification"), cfg)
            if reason is None and is_suppressed(conn, email):
                reason = "suppressed"
            if reason is None and cfg.get("check_mx"):
                domain = email.split("@", 1)[1]
                if domain not in mx_cache:
                    mx_cache[domain] = _has_mx(domain)
                if mx_cache[domain] is False:
                    reason = "no_mx"
            if reason:
                stats[f"rejected_{reason}"] += 1
                continue
            custom = {k: v for k, v in row.items() if k not in known and k and v}
            first = get("first_name")
            first = first.title() if first.isupper() else first
            cur = conn.execute(
                """INSERT OR IGNORE INTO leads
                   (email, domain, first_name, last_name, company, title, website, industry,
                    city, country, custom, source)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
                (
                    email, email.split("@", 1)[1], first,
                    get("last_name"), get("company"), get("title"), get("website"), get("industry"),
                    get("city"), get("country"), json.dumps(custom), source or Path(path).name,
                ),
            )
            stats["imported" if cur.rowcount else "duplicate"] += 1
    conn.commit()
    return stats


def import_suppression(conn: sqlite3.Connection, path: str | Path, reason: str) -> int:
    """Import a CSV/TXT of emails or domains (first column) into the do-not-contact list."""
    from .db import suppress

    count = 0
    with open(path, newline="", encoding="utf-8-sig") as fh:
        for row in csv.reader(fh):
            if not row or not row[0].strip() or row[0].strip().lower() in {"email", "domain", "value"}:
                continue
            suppress(conn, row[0], reason)
            count += 1
    # Stop anyone already in flight.
    conn.execute(
        """UPDATE enrollments SET status='stopped'
           WHERE status IN ('pending','active') AND lead_id IN (
             SELECT l.id FROM leads l JOIN suppression s
               ON (s.kind='email' AND s.value=l.email) OR (s.kind='domain' AND s.value=l.domain))"""
    )
    conn.commit()
    return count
