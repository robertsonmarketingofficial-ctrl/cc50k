"""Builds the day's send queue: follow-ups first, then new leads, inside every inbox's cap."""
from __future__ import annotations

import heapq
import sqlite3
from collections import Counter
from datetime import date, timedelta

from .inboxes import cap_for

DAY_NAMES = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"]


def is_sending_day(d: date, sending_cfg: dict) -> bool:
    return DAY_NAMES[d.weekday()] in {x.lower()[:3] for x in sending_cfg["sending_days"]}


def next_sending_day(d: date, sending_cfg: dict) -> date:
    for _ in range(7):
        if is_sending_day(d, sending_cfg):
            return d
        d += timedelta(days=1)
    raise ValueError("sending_days is empty")


def build_queue(conn: sqlite3.Connection, on: date, settings: dict) -> Counter:
    stats: Counter = Counter()
    sending = settings["sending"]
    if not is_sending_day(on, sending):
        stats["not_a_sending_day"] = 1
        return stats
    day = on.isoformat()

    # Anything queued on an earlier day that never went out rolls onto today.
    rolled = conn.execute(
        "UPDATE sends SET scheduled_for=? WHERE status='queued' AND scheduled_for<?", (day, day)
    ).rowcount
    stats["rolled_over"] = rolled

    inboxes = {r["id"]: r for r in conn.execute("SELECT * FROM inboxes WHERE status='active'")}
    used = Counter({
        r["inbox_id"]: r["n"] for r in conn.execute(
            "SELECT inbox_id, COUNT(*) n FROM sends WHERE scheduled_for=? AND status IN ('queued','sending','sent') GROUP BY inbox_id",
            (day,),
        )
    })
    remaining = {i: cap_for(r, on, settings["warmup"]) - used[i] for i, r in inboxes.items()}
    stats["fleet_capacity"] = sum(max(0, cap_for(r, on, settings["warmup"])) for r in inboxes.values())

    # 1) Follow-ups due today go out from the inbox that started the thread.
    due = conn.execute(
        """SELECT e.id, e.lead_id, e.inbox_id, e.step FROM enrollments e
           WHERE e.status='active' AND e.next_send_date<=? AND e.step>0
             AND NOT EXISTS (SELECT 1 FROM sends s WHERE s.enrollment_id=e.id AND s.step=e.step)
           ORDER BY e.next_send_date, e.id""",
        (day,),
    ).fetchall()
    for e in due:
        if e["inbox_id"] not in inboxes:
            stats["followups_waiting_paused_inbox"] += 1
            continue
        if remaining[e["inbox_id"]] <= 0:
            stats["followups_deferred_no_capacity"] += 1
            continue
        conn.execute(
            "INSERT INTO sends (enrollment_id, inbox_id, lead_id, step, scheduled_for) VALUES (?,?,?,?,?)",
            (e["id"], e["inbox_id"], e["lead_id"], e["step"], day),
        )
        remaining[e["inbox_id"]] -= 1
        stats["followups_queued"] += 1

    # 2) New leads fill what's left, capped per inbox so follow-ups always have room.
    share = float(sending.get("new_lead_share", 1.0))
    new_room = {
        i: min(remaining[i], int(cap_for(r, on, settings["warmup"]) * share) - _new_today(conn, i, day))
        for i, r in inboxes.items()
    }
    heap = [(-room, i) for i, room in new_room.items() if room > 0]
    heapq.heapify(heap)
    if not heap:
        conn.commit()
        return stats

    per_domain_max = int(sending["max_per_company_domain_per_day"])
    domain_today = Counter({
        r["domain"]: r["n"] for r in conn.execute(
            """SELECT l.domain, COUNT(*) n FROM sends s JOIN leads l ON l.id=s.lead_id
               WHERE s.scheduled_for=? AND s.step=0 GROUP BY l.domain""",
            (day,),
        )
    })
    total_room = sum(-r for r, _ in heap)
    pending = conn.execute(
        """SELECT e.id, e.lead_id, l.domain FROM enrollments e
           JOIN leads l ON l.id=e.lead_id
           JOIN campaigns c ON c.id=e.campaign_id AND c.status='active'
           WHERE e.status='pending'
             AND NOT EXISTS (SELECT 1 FROM suppression s
                 WHERE (s.kind='email' AND s.value=l.email) OR (s.kind='domain' AND s.value=l.domain))
           ORDER BY e.id LIMIT ?""",
        (total_room * 3,),
    )
    for e in pending:
        if not heap:
            break
        if domain_today[e["domain"]] >= per_domain_max:
            stats["new_deferred_same_company"] += 1
            continue
        neg_room, inbox_id = heapq.heappop(heap)
        conn.execute(
            "UPDATE enrollments SET inbox_id=?, status='active', next_send_date=? WHERE id=?",
            (inbox_id, day, e["id"]),
        )
        conn.execute(
            "INSERT INTO sends (enrollment_id, inbox_id, lead_id, step, scheduled_for) VALUES (?,?,?,0,?)",
            (e["id"], inbox_id, e["lead_id"], day),
        )
        domain_today[e["domain"]] += 1
        stats["new_queued"] += 1
        if neg_room + 1 < 0:
            heapq.heappush(heap, (neg_room + 1, inbox_id))
    conn.commit()
    return stats


def _new_today(conn: sqlite3.Connection, inbox_id: int, day: str) -> int:
    return conn.execute(
        "SELECT COUNT(*) FROM sends WHERE inbox_id=? AND scheduled_for=? AND step=0 AND status IN ('queued','sending','sent')",
        (inbox_id, day),
    ).fetchone()[0]
