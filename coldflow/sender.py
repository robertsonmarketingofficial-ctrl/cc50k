"""Sends the queued emails over SMTP, spaced out per inbox. Dry-run by default."""
from __future__ import annotations

import os
import random
import smtplib
import sqlite3
import time
from collections import Counter
from datetime import date, datetime, timedelta
from email.message import EmailMessage
from email.utils import formataddr, format_datetime, make_msgid
from pathlib import Path

from .campaigns import Campaign, load_campaign
from .db import is_suppressed
from .scheduler import next_sending_day
from .templates import lead_context, missing_fields, render

try:
    from zoneinfo import ZoneInfo
except ImportError:  # pragma: no cover
    ZoneInfo = None  # type: ignore


def now_in(tz_name: str) -> datetime:
    try:
        return datetime.now(ZoneInfo(tz_name)) if ZoneInfo else datetime.now()
    except Exception:
        return datetime.now()


def in_window(moment: datetime, sending_cfg: dict) -> bool:
    hhmm = moment.strftime("%H:%M")
    return sending_cfg["window_start"] <= hhmm < sending_cfg["window_end"]


def compose(send: sqlite3.Row, enr: sqlite3.Row, lead: sqlite3.Row, inbox: sqlite3.Row,
            camp: Campaign, settings: dict) -> tuple[EmailMessage | None, int, str]:
    """Build the message, or return (None, _, reason) if it must be skipped."""
    company = settings["company"]
    step = camp.steps[send["step"]]
    variant_idx, variant = camp.variant_for(send["step"], lead["id"])
    ctx = lead_context(lead, inbox, company)
    body_src = variant.body.strip()
    missing = missing_fields(variant.subject + body_src, ctx)
    if missing:
        return None, variant_idx, f"missing fields without fallback: {', '.join(sorted(set(missing)))}"

    threaded = send["step"] > 0 and not step.new_thread and enr["thread_message_id"]
    if variant.subject:
        subject = render(variant.subject, ctx)
    elif threaded:
        base = enr["thread_subject"]
        subject = base if base.lower().startswith("re:") else f"Re: {base}"
    else:
        return None, variant_idx, "step has no subject and is not a threaded follow-up"

    signature = render(company.get("sender_signature", ""), ctx)
    footer = f"{settings['sending']['unsubscribe_line']}\n{company['name']}, {company['physical_address']}"
    text = f"{render(body_src, ctx)}\n\n{signature}\n\n--\n{footer}\n"

    msg = EmailMessage()
    msg["From"] = formataddr((inbox["from_name"], inbox["email"]))
    msg["To"] = formataddr((f"{lead['first_name']} {lead['last_name']}".strip(), lead["email"]))
    msg["Subject"] = subject
    msg["Date"] = format_datetime(datetime.now().astimezone())
    msg["Message-ID"] = make_msgid(domain=inbox["domain"])
    msg["List-Unsubscribe"] = f"<mailto:{inbox['email']}?subject=unsubscribe>"
    if threaded:
        msg["In-Reply-To"] = enr["thread_message_id"]
        msg["References"] = enr["thread_message_id"]
    msg.set_content(text)
    return msg, variant_idx, ""


def _smtp_send(inbox: sqlite3.Row, msg: EmailMessage) -> None:
    password = os.environ.get(inbox["password_env"])
    if not password:
        raise RuntimeError(f"env var {inbox['password_env']} is not set")
    if int(inbox["smtp_port"]) == 465:
        server: smtplib.SMTP = smtplib.SMTP_SSL(inbox["smtp_host"], 465, timeout=30)
    else:
        server = smtplib.SMTP(inbox["smtp_host"], int(inbox["smtp_port"]), timeout=30)
        server.starttls()
    try:
        server.login(inbox["username"], password)
        server.send_message(msg)
    finally:
        try:
            server.quit()
        except Exception:
            pass


def _advance(conn: sqlite3.Connection, enr: sqlite3.Row, camp: Campaign, msg: EmailMessage,
             sent_on: date, settings: dict) -> None:
    step = enr["step"]
    if step == 0:
        conn.execute(
            "UPDATE enrollments SET thread_message_id=?, thread_subject=? WHERE id=?",
            (msg["Message-ID"], msg["Subject"], enr["id"]),
        )
    nxt = step + 1
    if nxt >= len(camp.steps):
        conn.execute("UPDATE enrollments SET step=?, status='completed', next_send_date=NULL WHERE id=?", (nxt, enr["id"]))
        conn.execute("UPDATE leads SET status='completed' WHERE id=? AND status='active'", (enr["lead_id"],))
    else:
        gap = camp.steps[nxt].day - camp.steps[step].day
        when = next_sending_day(sent_on + timedelta(days=gap), settings["sending"])
        conn.execute("UPDATE enrollments SET step=?, next_send_date=? WHERE id=?", (nxt, when.isoformat(), enr["id"]))


def run(conn: sqlite3.Connection, on: date, settings, live: bool = False, limit: int | None = None,
        ignore_window: bool = False, log=print) -> Counter:
    stats: Counter = Counter()
    sending = settings["sending"]
    outbox = settings.path("outbox") / on.isoformat()
    campaigns: dict[int, Campaign] = {}

    queued = conn.execute(
        """SELECT s.* FROM sends s JOIN inboxes i ON i.id=s.inbox_id
           WHERE s.scheduled_for=? AND s.status='queued' AND i.status='active'
           ORDER BY s.id""",
        (on.isoformat(),),
    ).fetchall()
    if limit:
        queued = queued[:limit]

    # Interleave inboxes so no single inbox fires back-to-back.
    by_inbox: dict[int, list] = {}
    for s in queued:
        by_inbox.setdefault(s["inbox_id"], []).append(s)
    next_ok = {i: 0.0 for i in by_inbox}

    while any(by_inbox.values()):
        inbox_id = min((i for i in by_inbox if by_inbox[i]), key=lambda i: next_ok[i])
        if live:
            wait = next_ok[inbox_id] - time.time()
            if wait > 0:
                time.sleep(wait)
            if not ignore_window and not in_window(now_in(sending["timezone"]), sending):
                log("Outside the sending window; the rest stays queued for the next run.")
                stats["left_in_queue"] = sum(len(v) for v in by_inbox.values())
                break
        send = by_inbox[inbox_id].pop(0)
        enr = conn.execute("SELECT * FROM enrollments WHERE id=?", (send["enrollment_id"],)).fetchone()
        lead = conn.execute("SELECT * FROM leads WHERE id=?", (send["lead_id"],)).fetchone()
        inbox = conn.execute("SELECT * FROM inboxes WHERE id=?", (inbox_id,)).fetchone()

        # Re-check right before sending: a reply or opt-out may have landed since scheduling.
        if enr["status"] != "active" or enr["step"] != send["step"] or is_suppressed(conn, lead["email"]):
            if live:
                conn.execute("UPDATE sends SET status='skipped', error='stopped before send' WHERE id=?", (send["id"],))
                conn.commit()
            stats["skipped_stopped"] += 1
            continue
        if inbox["status"] != "active":
            stats["skipped_inbox_paused"] += 1
            continue

        camp_id = enr["campaign_id"]
        if camp_id not in campaigns:
            file = conn.execute("SELECT file FROM campaigns WHERE id=?", (camp_id,)).fetchone()["file"]
            campaigns[camp_id] = load_campaign(file)
        camp = campaigns[camp_id]

        msg, variant_idx, reason = compose(send, enr, lead, inbox, camp, settings)
        if msg is None:
            stats["skipped_template"] += 1
            if live:
                conn.execute("UPDATE sends SET status='skipped', error=? WHERE id=?", (reason, send["id"]))
                conn.execute("UPDATE enrollments SET status='stopped' WHERE id=?", (enr["id"],))
                conn.commit()
            log(f"skip {lead['email']}: {reason}")
            continue

        if not live:
            outbox.mkdir(parents=True, exist_ok=True)
            (outbox / f"{send['id']:07d}_{inbox['email']}_to_{lead['email']}.eml").write_bytes(bytes(msg))
            stats["dry_run_written"] += 1
            continue

        try:
            _smtp_send(inbox, msg)
        except Exception as exc:  # network/auth errors: keep going with other inboxes
            conn.execute("UPDATE sends SET status='failed', error=? WHERE id=?", (str(exc)[:500], send["id"]))
            conn.commit()
            stats["failed"] += 1
            log(f"FAIL {inbox['email']} -> {lead['email']}: {exc}")
            if isinstance(exc, (smtplib.SMTPAuthenticationError, RuntimeError)):
                by_inbox[inbox_id] = []  # no point retrying this inbox today
            continue

        conn.execute(
            "UPDATE sends SET status='sent', sent_at=datetime('now'), message_id=?, subject=?, variant=? WHERE id=?",
            (msg["Message-ID"], msg["Subject"], variant_idx, send["id"]),
        )
        _advance(conn, enr, camp, msg, on, settings)
        conn.commit()
        stats["sent"] += 1
        log(f"sent {inbox['email']} -> {lead['email']} (step {send['step'] + 1})")
        next_ok[inbox_id] = time.time() + random.uniform(
            float(sending["min_delay_seconds"]), float(sending["max_delay_seconds"])
        )

    if not live and stats["dry_run_written"]:
        log(f"Dry run: wrote {stats['dry_run_written']} .eml files to {outbox}")
    return stats
