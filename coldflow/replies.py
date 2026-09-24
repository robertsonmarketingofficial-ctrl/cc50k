"""Polls every sending inbox over IMAP, classifies replies/bounces/opt-outs and stops sequences."""
from __future__ import annotations

import email
import imaplib
import os
import re
import sqlite3
from collections import Counter
from datetime import date, timedelta
from email.message import Message
from email.utils import parseaddr

from .db import suppress

BOUNCE_SENDERS = ("mailer-daemon", "postmaster", "mail-daemon")
BOUNCE_SUBJECT = re.compile(
    r"(undeliver|delivery status notification|delivery failure|mail delivery failed|returned mail|"
    r"failure notice|could not be delivered|address not found)", re.I)
AUTO_SUBJECT = re.compile(r"(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|on vacation|\booo\b)", re.I)
UNSUB = re.compile(r"(unsubscribe|remove me|take me off|stop (emailing|contacting|sending)|opt[- ]?out|"
                   r"do not (contact|email)|don'?t (contact|email)|leave me alone|spam)", re.I)
NOT_INTERESTED = re.compile(r"(not interested|no thanks|no thank you|not a (good )?fit|we'?re (all )?(good|set)|"
                            r"not (right )?now|already have (an? )?(agency|someone|team))", re.I)
INTERESTED = re.compile(r"(interested|let'?s (talk|chat|connect)|sounds (good|great)|tell me more|more info|"
                        r"send (me )?(more|details|info)|pricing|how much|what (does|would) it cost|"
                        r"book|calendar|schedule|free (this|next)|available|call me|give me a call)", re.I)
EMAIL_IN_TEXT = re.compile(r"[\w.+'-]+@[\w-]+(?:\.[\w-]+)+")


def body_text(msg: Message) -> str:
    parts = msg.walk() if msg.is_multipart() else [msg]
    for part in parts:
        if part.get_content_type() == "text/plain" and not part.get_filename():
            payload = part.get_payload(decode=True) or b""
            return payload.decode(part.get_content_charset() or "utf-8", errors="replace")
    for part in (msg.walk() if msg.is_multipart() else [msg]):
        if part.get_content_type() == "text/html":
            payload = part.get_payload(decode=True) or b""
            html = payload.decode(part.get_content_charset() or "utf-8", errors="replace")
            return re.sub(r"<[^>]+>", " ", html)
    return ""


def strip_quoted(text: str) -> str:
    out = []
    for line in text.splitlines():
        s = line.strip()
        if s.startswith(">") or re.match(r"^On .+wrote:$", s) or s.startswith("-----Original Message") \
                or re.match(r"^From: .+", s):
            break
        out.append(line)
    return "\n".join(out).strip()


def classify(msg: Message) -> tuple[str, str]:
    """Return (kind, fresh_text). kind: bounce|auto_reply|unsubscribe|not_interested|interested|reply"""
    from_addr = parseaddr(msg.get("From", ""))[1].lower()
    subject = msg.get("Subject", "") or ""
    ctype = msg.get_content_type()
    text = body_text(msg)
    if from_addr.split("@")[0] in BOUNCE_SENDERS or ctype == "multipart/report" or BOUNCE_SUBJECT.search(subject):
        return "bounce", text
    auto = (msg.get("Auto-Submitted", "no").lower() != "no") or msg.get("X-Autoreply") or msg.get("X-Autorespond")
    if auto or AUTO_SUBJECT.search(subject):
        return "auto_reply", text
    fresh = strip_quoted(text)
    if UNSUB.search(fresh) or UNSUB.search(subject):
        return "unsubscribe", fresh
    if NOT_INTERESTED.search(fresh):
        return "not_interested", fresh
    if INTERESTED.search(fresh):
        return "interested", fresh
    return "reply", fresh


def bounced_recipients(msg: Message, text: str) -> list[str]:
    found = []
    for part in msg.walk():
        if part.get_content_type() == "message/delivery-status":
            for sub in part.get_payload():
                for header in ("Final-Recipient", "Original-Recipient"):
                    v = sub.get(header) if hasattr(sub, "get") else None
                    if v:
                        found.append(v.split(";")[-1].strip().lower())
    found += [m.lower() for m in re.findall(r"(?:Final-Recipient|Original-Recipient):\s*rfc822;\s*(\S+)", text, re.I)]
    return found or [m.lower() for m in EMAIL_IN_TEXT.findall(text)]


def apply(conn: sqlite3.Connection, inbox_id: int, msg: Message) -> str | None:
    """Record one incoming message. Returns the event kind, or None if ignored/duplicate."""
    msg_id = (msg.get("Message-ID") or "").strip()
    if msg_id and conn.execute("SELECT 1 FROM events WHERE source_message_id=?", (msg_id,)).fetchone():
        return None
    kind, text = classify(msg)
    from_addr = parseaddr(msg.get("From", ""))[1].lower()
    subject = msg.get("Subject", "") or ""

    lead = None
    if kind == "bounce":
        for addr in bounced_recipients(msg, text):
            lead = conn.execute(
                "SELECT l.* FROM leads l JOIN sends s ON s.lead_id=l.id WHERE l.email=? AND s.inbox_id=? LIMIT 1",
                (addr, inbox_id)).fetchone()
            if lead:
                break
    else:
        lead = conn.execute("SELECT * FROM leads WHERE email=?", (from_addr,)).fetchone()
        if lead is None and "@" in from_addr:
            # Someone else at the company answered (colleague, forwarded thread).
            lead = conn.execute(
                """SELECT l.* FROM leads l JOIN sends s ON s.lead_id=l.id
                   WHERE l.domain=? AND s.inbox_id=? ORDER BY s.id DESC LIMIT 1""",
                (from_addr.split("@", 1)[1], inbox_id)).fetchone()
    if lead is None:
        return None  # warmup traffic, newsletters, etc.

    conn.execute(
        """INSERT OR IGNORE INTO events (kind, lead_id, inbox_id, source_message_id, from_addr, subject, snippet)
           VALUES (?,?,?,?,?,?,?)""",
        (kind, lead["id"], inbox_id, msg_id or None, from_addr, subject[:300], text[:1000]),
    )
    stop = "UPDATE enrollments SET status=? WHERE lead_id=? AND status IN ('pending','active')"
    if kind == "bounce":
        conn.execute(stop, ("bounced", lead["id"]))
        conn.execute("UPDATE leads SET status='bounced' WHERE id=?", (lead["id"],))
        suppress(conn, lead["email"], "hard bounce")
    elif kind in ("unsubscribe", "not_interested"):
        conn.execute(stop, ("unsubscribed" if kind == "unsubscribe" else "replied", lead["id"]))
        conn.execute("UPDATE leads SET status=? WHERE id=?",
                     ("unsubscribed" if kind == "unsubscribe" else "replied", lead["id"]))
        suppress(conn, lead["email"], kind)
    elif kind in ("interested", "reply"):
        conn.execute(stop, ("replied", lead["id"]))
        conn.execute("UPDATE leads SET status='replied' WHERE id=?", (lead["id"],))
        # Don't keep pitching their colleagues while a conversation is open.
        conn.execute(
            """UPDATE enrollments SET status='stopped' WHERE status IN ('pending','active')
               AND lead_id IN (SELECT id FROM leads WHERE domain=? AND id<>?)""",
            (lead["domain"], lead["id"]))
    conn.commit()
    return kind


def poll(conn: sqlite3.Connection, days: int = 3, log=print) -> Counter:
    stats: Counter = Counter()
    since = (date.today() - timedelta(days=days)).strftime("%d-%b-%Y")
    for inbox in conn.execute("SELECT * FROM inboxes WHERE status<>'retired'").fetchall():
        password = os.environ.get(inbox["password_env"])
        if not password:
            log(f"skip {inbox['email']}: env var {inbox['password_env']} not set")
            stats["inbox_no_password"] += 1
            continue
        try:
            imap = imaplib.IMAP4_SSL(inbox["imap_host"], int(inbox["imap_port"]))
            imap.login(inbox["username"], password)
            imap.select("INBOX", readonly=True)
            _, data = imap.search(None, "SINCE", since)
            for num in data[0].split():
                _, fetched = imap.fetch(num, "(BODY.PEEK[])")
                raw = next((p[1] for p in fetched if isinstance(p, tuple)), None)
                if not raw:
                    continue
                msg = email.message_from_bytes(raw)
                sender = parseaddr(msg.get("From", ""))[1].lower()
                if sender == inbox["email"]:
                    continue
                kind = apply(conn, inbox["id"], msg)
                if kind:
                    stats[kind] += 1
            imap.logout()
            stats["inboxes_checked"] += 1
        except Exception as exc:
            log(f"IMAP error on {inbox['email']}: {exc}")
            stats["inbox_errors"] += 1
    return stats

