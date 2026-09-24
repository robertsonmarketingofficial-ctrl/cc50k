"""Sending inboxes: import, warmup ramp and health guards."""
from __future__ import annotations

import csv
import sqlite3
from datetime import date
from pathlib import Path

PROVIDER_DEFAULTS = {
    "google": ("smtp.gmail.com", 587, "imap.gmail.com", 993),
    "microsoft": ("smtp.office365.com", 587, "outlook.office365.com", 993),
    "zoho": ("smtp.zoho.com", 587, "imap.zoho.com", 993),
}


def import_csv(conn: sqlite3.Connection, path: str | Path, default_cap: int) -> int:
    """Columns: email, from_name, provider, password_env, [daily_cap, warmup_start,
    smtp_host, smtp_port, imap_host, imap_port, username]."""
    count = 0
    with open(path, newline="", encoding="utf-8-sig") as fh:
        for row in csv.DictReader(fh):
            row = {k.strip().lower(): (v or "").strip() for k, v in row.items() if k}
            email = row["email"].lower()
            provider = row.get("provider", "google").lower() or "google"
            smtp_h, smtp_p, imap_h, imap_p = PROVIDER_DEFAULTS.get(provider, PROVIDER_DEFAULTS["google"])
            conn.execute(
                """INSERT INTO inboxes (email, from_name, domain, provider, smtp_host, smtp_port,
                       imap_host, imap_port, username, password_env, daily_cap, warmup_start)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT(email) DO UPDATE SET
                       from_name=excluded.from_name, provider=excluded.provider,
                       smtp_host=excluded.smtp_host, smtp_port=excluded.smtp_port,
                       imap_host=excluded.imap_host, imap_port=excluded.imap_port,
                       username=excluded.username, password_env=excluded.password_env,
                       daily_cap=excluded.daily_cap, warmup_start=excluded.warmup_start""",
                (
                    email,
                    row.get("from_name") or email.split("@")[0].title(),
                    email.split("@", 1)[1],
                    provider,
                    row.get("smtp_host") or smtp_h,
                    int(row.get("smtp_port") or smtp_p),
                    row.get("imap_host") or imap_h,
                    int(row.get("imap_port") or imap_p),
                    row.get("username") or email,
                    row.get("password_env") or env_name_for(email),
                    int(row.get("daily_cap") or default_cap),
                    row.get("warmup_start") or date.today().isoformat(),
                ),
            )
            count += 1
    conn.commit()
    return count


def env_name_for(email: str) -> str:
    """Default env var name for an inbox's app password, e.g. CF_PW_JOHN_AT_GETACME_CO."""
    safe = "".join(c if c.isalnum() else "_" for c in email.replace("@", "_at_"))
    return f"CF_PW_{safe.upper()}"


def cap_for(inbox: sqlite3.Row, on: date, warmup_cfg: dict) -> int:
    """Cold-email cap for an inbox on a given day, following the warmup ramp."""
    started = date.fromisoformat(inbox["warmup_start"])
    age = (on - started).days
    warm_days = int(warmup_cfg["warmup_only_days"])
    if age < warm_days:
        return 0
    ramp = int(warmup_cfg["ramp_start"]) + int(warmup_cfg["ramp_step"]) * (age - warm_days)
    return max(0, min(int(inbox["daily_cap"]), ramp))


def health_check(conn: sqlite3.Connection, health_cfg: dict, today: date) -> list[tuple[str, str]]:
    """Pause inboxes whose recent bounce or unsubscribe rate is over the limit."""
    lookback = int(health_cfg["lookback_days"])
    paused = []
    rows = conn.execute(
        f"""SELECT i.id, i.email,
               (SELECT COUNT(*) FROM sends s WHERE s.inbox_id=i.id AND s.status='sent'
                  AND s.sent_at >= date(?, '-{lookback} days')) AS sent,
               (SELECT COUNT(*) FROM events e WHERE e.inbox_id=i.id AND e.kind='bounce'
                  AND e.created_at >= date(?, '-{lookback} days')) AS bounces,
               (SELECT COUNT(*) FROM events e WHERE e.inbox_id=i.id AND e.kind='unsubscribe'
                  AND e.created_at >= date(?, '-{lookback} days')) AS unsubs
           FROM inboxes i WHERE i.status='active'""",
        (today.isoformat(),) * 3,
    ).fetchall()
    for r in rows:
        if r["sent"] < int(health_cfg["min_sends_for_health"]):
            continue
        bounce_rate = r["bounces"] / r["sent"]
        unsub_rate = r["unsubs"] / r["sent"]
        reason = ""
        if bounce_rate > float(health_cfg["max_bounce_rate"]):
            reason = f"bounce rate {bounce_rate:.1%} over {lookback}d"
        elif unsub_rate > float(health_cfg["max_unsubscribe_rate"]):
            reason = f"unsubscribe rate {unsub_rate:.1%} over {lookback}d"
        if reason:
            conn.execute("UPDATE inboxes SET status='paused', paused_reason=? WHERE id=?", (reason, r["id"]))
            paused.append((r["email"], reason))
    conn.commit()
    return paused
