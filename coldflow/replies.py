"""Polls every sending inbox over IMAP, classifies replies/bounces/opt-outs and stops sequences."""
from __future__ import annotations

import email
import imaplib
import re
import sqlite3
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import date, timedelta
from email.message import Message
from email.utils import parseaddr

from .auth import imap_login, secret_for
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


HEADER_FIELDS = "FROM SUBJECT MESSAGE-ID CONTENT-TYPE AUTO-SUBMITTED X-AUTOREPLY X-AUTORESPOND"
UID_RE = re.compile(rb"UID (\d+)")


@dataclass
class Job:
    inbox_id: int
    email: str
    host: str
    port: int
    username: str
    auth: str
    secret: str
    since: str
    uidvalidity: int | None
    last_uid: int
    lead_emails: set[str]
    lead_domains: set[str]
    deep: bool = False


@dataclass
class Result:
    job: Job
    uidvalidity: int | None = None
    max_uid: int = 0
    scanned: int = 0
    messages: list[bytes] = field(default_factory=list)
    error: str = ""


def worth_downloading(headers: Message, job: Job) -> bool:
    """Header-only triage: a lead (or their company) wrote, or it looks like a bounce.
    Warmup traffic and everything else is never downloaded."""
    sender = parseaddr(headers.get("From", ""))[1].lower()
    if not sender:
        return False
    if sender.split("@")[0] in BOUNCE_SENDERS or BOUNCE_SUBJECT.search(headers.get("Subject", "") or ""):
        return True
    if "multipart/report" in (headers.get("Content-Type", "") or "").lower():
        return True
    return sender in job.lead_emails or sender.rsplit("@", 1)[-1] in job.lead_domains


def fetch_inbox(job: Job, imap_factory=imaplib.IMAP4_SSL) -> Result:
    """Runs in a worker thread: network only, no database access."""
    res = Result(job=job)
    try:
        imap = imap_factory(job.host, job.port)
        try:
            imap_login(imap, job.auth, job.username, job.secret)
            imap.select("INBOX", readonly=True)
            _, v = imap.response("UIDVALIDITY")
            res.uidvalidity = int(v[0]) if v and v[0] else None
            incremental = (not job.deep and job.last_uid and res.uidvalidity is not None
                           and res.uidvalidity == job.uidvalidity)
            if incremental:
                _, data = imap.uid("SEARCH", "UID", f"{job.last_uid + 1}:*")
            else:
                _, data = imap.uid("SEARCH", "SINCE", job.since)
            uids = [int(u) for u in (data[0] or b"").split()]
            if incremental:
                uids = [u for u in uids if u > job.last_uid]  # "N:*" always returns the newest message
            res.scanned = len(uids)
            prior = job.last_uid if incremental or (job.deep and res.uidvalidity == job.uidvalidity) else 0
            res.max_uid = max(uids + [prior])

            wanted: list[int] = []
            for i in range(0, len(uids), 200):
                chunk = ",".join(str(u) for u in uids[i:i + 200])
                _, parts = imap.uid("FETCH", chunk, f"(BODY.PEEK[HEADER.FIELDS ({HEADER_FIELDS})])")
                for part in parts:
                    if not isinstance(part, tuple):
                        continue
                    m = UID_RE.search(part[0])
                    if m and worth_downloading(email.message_from_bytes(part[1]), job):
                        wanted.append(int(m.group(1)))
            for uid in wanted:
                _, parts = imap.uid("FETCH", str(uid), "(BODY.PEEK[])")
                raw = next((p[1] for p in parts if isinstance(p, tuple)), None)
                if raw:
                    res.messages.append(raw)
        finally:
            try:
                imap.logout()
            except Exception:
                pass
    except Exception as exc:
        res.error = str(exc) or exc.__class__.__name__
    return res


def _jobs(conn: sqlite3.Connection, settings, days: int, deep: bool, problems: list[str]) -> list[Job]:
    since = (date.today() - timedelta(days=days)).strftime("%d-%b-%Y")
    jobs = []
    for inbox in conn.execute("SELECT * FROM inboxes WHERE status<>'retired' ORDER BY id").fetchall():
        try:
            secret = secret_for(inbox, settings)  # main thread: token refreshes write the token file
        except Exception as exc:
            problems.append(f"{inbox['email']}: {exc}")
            continue
        state = conn.execute("SELECT * FROM imap_state WHERE inbox_id=?", (inbox["id"],)).fetchone()
        contacted = conn.execute(
            """SELECT DISTINCT l.email, l.domain FROM sends s JOIN leads l ON l.id=s.lead_id
               WHERE s.inbox_id=? AND s.status IN ('sent','sending')""", (inbox["id"],)).fetchall()
        jobs.append(Job(
            inbox_id=inbox["id"], email=inbox["email"], host=inbox["imap_host"], port=int(inbox["imap_port"]),
            username=inbox["username"], auth=inbox["auth"] or "password", secret=secret, since=since,
            uidvalidity=state["uidvalidity"] if state else None, last_uid=state["last_uid"] if state else 0,
            lead_emails={r["email"] for r in contacted}, lead_domains={r["domain"] for r in contacted}, deep=deep,
        ))
    return jobs


def poll(conn: sqlite3.Connection, settings, days: int = 3, deep: bool = False, log=print,
         fetcher=fetch_inbox) -> tuple[Counter, list[str]]:
    """Sweep every inbox. Normal runs read only mail that arrived since the last sweep;
    deep=True re-reads the last `days` days (use weekly to catch late bounces)."""
    stats: Counter = Counter()
    problems: list[str] = []
    jobs = _jobs(conn, settings, days, deep, problems)
    stats["inbox_skipped_no_credentials"] = len(problems)
    workers = max(1, int(settings["replies"].get("imap_workers", 8)))
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = [pool.submit(fetcher, job) for job in jobs]
        for fut in as_completed(futures):
            res = fut.result()
            job = res.job
            if res.error:
                stats["inbox_errors"] += 1
                problems.append(f"{job.email}: IMAP {res.error}")
                log(f"IMAP error on {job.email}: {res.error}")
                continue
            stats["inboxes_checked"] += 1
            stats["messages_scanned"] += res.scanned
            stats["messages_downloaded"] += len(res.messages)
            for raw in res.messages:
                msg = email.message_from_bytes(raw)
                if parseaddr(msg.get("From", ""))[1].lower() == job.email:
                    continue
                kind = apply(conn, job.inbox_id, msg)
                if kind:
                    stats[kind] += 1
            if res.uidvalidity is not None:
                conn.execute(
                    """INSERT INTO imap_state (inbox_id, uidvalidity, last_uid, checked_at)
                       VALUES (?,?,?,datetime('now'))
                       ON CONFLICT(inbox_id) DO UPDATE SET uidvalidity=excluded.uidvalidity,
                         last_uid=excluded.last_uid, checked_at=excluded.checked_at""",
                    (job.inbox_id, res.uidvalidity, res.max_uid))
                conn.commit()
    return stats, problems
