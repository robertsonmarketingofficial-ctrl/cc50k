"""Daily summary + warnings, pushed to a Slack/Discord webhook and/or an email address."""
from __future__ import annotations

import json
import os
import smtplib
import sqlite3
import urllib.request
from collections import Counter
from datetime import date
from email.message import EmailMessage

from .inboxes import cap_for


def build_summary(conn: sqlite3.Connection, settings, on: date, run_stats: dict[str, Counter] | None = None,
                  problems: list[str] | None = None) -> tuple[str, str, bool]:
    """Returns (subject, text, has_warnings)."""
    run_stats = run_stats or {}
    send = run_stats.get("send", Counter())
    sched = run_stats.get("schedule", Counter())
    reply = run_stats.get("replies", Counter())
    day = on.isoformat()
    warnings: list[str] = []

    for r in conn.execute("SELECT email, paused_reason FROM inboxes WHERE status='paused' ORDER BY email"):
        warnings.append(f"Inbox paused: {r['email']} ({r['paused_reason'] or 'manual'})")
    for p in problems or []:
        warnings.append(p)
    failing = conn.execute(
        """SELECT i.email, COUNT(*) n, MAX(s.error) err FROM sends s JOIN inboxes i ON i.id=s.inbox_id
           WHERE s.scheduled_for=? AND s.status IN ('queued','failed') AND s.error<>''
           GROUP BY i.email ORDER BY n DESC LIMIT 10""", (day,)).fetchall()
    for r in failing:
        warnings.append(f"Send errors on {r['email']} ({r['n']}): {r['err'][:120]}")
    if send.get("left_in_queue"):
        warnings.append(f"{send['left_in_queue']:,} emails didn't fit in the sending window (rolled to next day)")
    if sched.get("followups_deferred_no_capacity"):
        warnings.append(f"{sched['followups_deferred_no_capacity']:,} follow-ups deferred: inboxes at capacity")
    if sched.get("followups_waiting_paused_inbox"):
        warnings.append(f"{sched['followups_waiting_paused_inbox']:,} follow-ups waiting on paused inboxes")
    if send.get("recovered_interrupted"):
        warnings.append(f"{send['recovered_interrupted']} sends were interrupted by a crash (marked sent)")

    # Lead supply: first-touch capacity per day vs. leads waiting.
    share = float(settings["sending"].get("new_lead_share", 1.0))
    daily_new = sum(int(cap_for(r, on, settings["warmup"]) * share)
                    for r in conn.execute("SELECT * FROM inboxes WHERE status='active'"))
    waiting = conn.execute("SELECT COUNT(*) FROM enrollments WHERE status='pending'").fetchone()[0]
    days_left = waiting / daily_new if daily_new else float("inf")
    if daily_new and days_left < float(settings["alerts"].get("lead_supply_days", 3)):
        warnings.append(f"Lead supply low: {waiting:,} enrolled leads waiting ≈ {days_left:.1f} sending days")

    sent_today = conn.execute("SELECT COUNT(*) FROM sends WHERE status='sent' AND scheduled_for=?", (day,)).fetchone()[0]
    ev = dict(conn.execute(
        "SELECT kind, COUNT(*) FROM events WHERE date(created_at)=? GROUP BY kind", (day,)).fetchall())
    active = conn.execute("SELECT COUNT(*) FROM inboxes WHERE status='active'").fetchone()[0]
    lines = [
        f"Sent today: {sent_today:,}   Active inboxes: {active}   Leads waiting: {waiting:,}",
        f"Replies today: {ev.get('reply', 0) + ev.get('interested', 0) + ev.get('not_interested', 0)}"
        f" (interested {ev.get('interested', 0)}), bounces {ev.get('bounce', 0)}, opt-outs {ev.get('unsubscribe', 0)}",
    ]
    if send:
        lines.append(f"SMTP logins used: {send.get('smtp_logins', 0):,} for {send.get('sent', 0):,} emails")
    if reply:
        lines.append(f"Inbox sweep: {reply.get('messages_scanned', 0):,} new messages scanned, "
                     f"{reply.get('messages_downloaded', 0):,} downloaded")
    interested = conn.execute(
        """SELECT ev.from_addr, l.company, ev.snippet FROM events ev LEFT JOIN leads l ON l.id=ev.lead_id
           WHERE ev.kind='interested' AND date(ev.created_at)=? ORDER BY ev.id DESC LIMIT 10""", (day,)).fetchall()
    if interested:
        lines.append("")
        lines.append("Interested (answer within the hour):")
        lines += [f"  - {r['from_addr']} ({r['company'] or '?'}): {(r['snippet'] or '').strip()[:100]}"
                  for r in interested]
    text = ""
    if warnings:
        text += "WARNINGS\n" + "\n".join(f"  ! {w}" for w in warnings) + "\n\n"
    text += "\n".join(lines)
    subject = f"coldflow {day}: {'⚠ ' + str(len(warnings)) + ' warning(s)' if warnings else 'all good'}, " \
              f"{sent_today:,} sent, {ev.get('interested', 0)} interested"
    return subject, text, bool(warnings)


def _post_json(url: str, payload: dict) -> None:
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=20):
        pass


def notify(settings, subject: str, text: str, post=_post_json, smtp_factory=smtplib.SMTP) -> list[str]:
    """Deliver to every configured channel. Returns the channels used."""
    cfg = settings["alerts"]
    used = []
    if cfg.get("webhook_url"):
        # "text" is read by Slack/Teams-style hooks, "content" by Discord.
        post(cfg["webhook_url"], {"text": f"*{subject}*\n```{text}```", "content": f"**{subject}**\n```{text}```"})
        used.append("webhook")
    if cfg.get("email_to"):
        password = os.environ.get(cfg.get("smtp_password_env", ""), "")
        if not (cfg.get("smtp_username") and password):
            raise RuntimeError("alerts.email_to is set but smtp_username / the password env var is missing")
        msg = EmailMessage()
        msg["From"], msg["To"], msg["Subject"] = cfg["smtp_username"], cfg["email_to"], subject
        msg.set_content(text)
        server = smtp_factory(cfg["smtp_host"], int(cfg["smtp_port"]), timeout=30)
        try:
            server.starttls()
            server.login(cfg["smtp_username"], password)
            server.send_message(msg)
        finally:
            try:
                server.quit()
            except Exception:
                pass
        used.append("email")
    return used
